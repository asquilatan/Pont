import * as vscode from 'vscode';
import { AdbBridge } from '../services/adbBridge';
import { PairingSession } from '../services/pairingSession';
import { StatusPanelController } from '../ui/statusPanel';
import { showPairingQrPanel } from '../ui/pairingQrPanel';
import type { PairingMethod, PairingTarget } from '../types';
import type { WirelessServiceEndpoint } from '../services/adbBridge';

interface PairDeviceDependencies {
  adb: AdbBridge;
  session: PairingSession;
  panel: StatusPanelController;
}

export async function runPairDeviceFlow(deps: PairDeviceDependencies): Promise<void> {
  deps.panel.show();

  const method = await vscode.window.showQuickPick(
    [
      {
        label: 'Pairing code',
        method: 'pairing-code' as const,
        description: 'Enter the host, port, and pairing code shown on the phone.',
      },
      {
        label: 'QR code',
        method: 'qr-code' as const,
        description: 'Paste the QR payload or pairing endpoint encoded in the QR.',
      },
    ],
    {
      title: 'Pair Android Device',
      placeHolder: 'Choose how to connect the device',
    }
  );

  if (!method) {
    return;
  }

  const code = await promptForPairingCode(method.method);
  if (!code) {
    return;
  }

  const target = await resolvePairingTarget(deps.adb, method.method, code);
  if (!target) {
    return;
  }

  if (method.method === 'qr-code') {
    await showPairingQrPanel(target);
  }

  await executePairing(deps, target);
}

async function promptForPairingCode(method: PairingMethod): Promise<string | undefined> {
  const code = await vscode.window.showInputBox({
    title: method === 'qr-code' ? 'QR pairing code' : 'Pairing code',
    prompt: 'Enter the 6-digit wireless debugging code shown on the device.',
    placeHolder: '123456',
    ignoreFocusOut: true,
  });

  if (!code) {
    return undefined;
  }

  return code.trim();
}

async function resolvePairingTarget(
  adb: AdbBridge,
  method: PairingMethod,
  code: string
): Promise<PairingTarget | undefined> {
  const endpoints = await adb.discoverWirelessEndpoints();
  if (endpoints.length === 0) {
    void vscode.window.showErrorMessage(
      'No wireless debugging endpoint found. Open Wireless debugging on the phone and retry.'
    );
    return undefined;
  }

  const endpoint = endpoints.length === 1 ? endpoints[0] : await pickEndpoint(endpoints);
  if (!endpoint) {
    return undefined;
  }

  return {
    method,
    host: endpoint.host,
    port: endpoint.port,
    code,
  };
}

async function pickEndpoint(endpoints: WirelessServiceEndpoint[]): Promise<WirelessServiceEndpoint | undefined> {
  const pick = await vscode.window.showQuickPick(
    endpoints.map((endpoint) => ({
      label: endpoint.label,
      description: `${endpoint.host}:${endpoint.port}`,
      endpoint,
    })),
    {
      title: 'Select wireless debugging endpoint',
      placeHolder: 'Choose the Android wireless debugging service to pair with',
    }
  );

  return pick?.endpoint;
}

async function executePairing(deps: PairDeviceDependencies, target: PairingTarget): Promise<void> {
  deps.session.beginPairing(target);
  deps.panel.update();

  try {
    await deps.adb.ensureAvailable();
    await deps.adb.pair(target);
    const connectOutput = await deps.adb.connect(target.host, target.port);
    deps.session.setConnected(`${target.host}:${target.port}`, connectOutput.trim() || 'Android device connected.');
    deps.panel.update();
    await vscode.window.showInformationMessage('Android device paired and connected.');
  } catch (error) {
    const message = toErrorMessage(error);
    deps.session.setFailed(message);
    deps.panel.update();
    await vscode.window.showErrorMessage(message);
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Pairing failed. Check the device wireless debugging screen and try again.';
}
