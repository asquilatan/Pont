import * as vscode from 'vscode';
import { AdbBridge } from '../services/adbBridge';
import { PairingSession } from '../services/pairingSession';
import { StatusPanelController } from '../ui/statusPanel';
import type { PairingMethod, PairingTarget } from '../types';

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

  if (method.method === 'pairing-code') {
    const target = await promptForPairingTarget('pairing-code');
    if (!target) {
      return;
    }
    await executePairing(deps, target);
    return;
  }

  const target = await promptForPairingTarget('qr-code');
  if (!target) {
    return;
  }
  await executePairing(deps, target);
}

async function promptForPairingTarget(method: PairingMethod): Promise<PairingTarget | undefined> {
  const payload = await vscode.window.showInputBox({
    title: method === 'qr-code' ? 'QR code payload' : 'Pairing host and port',
    prompt:
      method === 'qr-code'
        ? 'Paste the pairing payload encoded in the QR code, or enter host:port|code.'
        : 'Enter the pairing endpoint as host:port.',
    placeHolder:
      method === 'qr-code'
        ? 'android-wireless-debugging://pair?host=192.168.0.17&port=37099&code=123456'
        : '192.168.0.17:37099',
    ignoreFocusOut: true,
  });

  if (!payload) {
    return undefined;
  }

  const parsed = parseEndpoint(payload.trim());
  if (method === 'qr-code' && parsed?.code) {
    return normalizePairingTarget(method, payload, parsed.code);
  }

  const code = await vscode.window.showInputBox({
    title: method === 'qr-code' ? 'QR pairing code' : 'Pairing code',
    prompt: 'Enter the 6-digit wireless debugging code shown on the device.',
    placeHolder: '123456',
    ignoreFocusOut: true,
  });

  if (!code) {
    return undefined;
  }

  return normalizePairingTarget(method, payload, code);
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

function normalizePairingTarget(method: PairingMethod, payload: string, code: string): PairingTarget {
  const trimmed = payload.trim();
  const parsed = parseEndpoint(trimmed);

  if (parsed) {
    return {
      method,
      host: parsed.host,
      port: parsed.port,
      code: parsed.code?.trim() || code.trim(),
    };
  }

  const [hostPart, portPart] = trimmed.split(':');
  const port = Number.parseInt(portPart ?? '', 10);
  if (!hostPart || Number.isNaN(port)) {
    throw new Error('Enter pairing target as host:port or a QR payload with host and port.');
  }

  return {
    method,
    host: hostPart,
    port,
    code: code.trim(),
  };
}

function parseEndpoint(value: string): { host: string; port: number; code?: string } | undefined {
  try {
    const url = new URL(value);
    const host = url.searchParams.get('host') ?? url.hostname;
    const port = Number.parseInt(url.searchParams.get('port') ?? '', 10);
    const code = url.searchParams.get('code') ?? undefined;

    if (host && !Number.isNaN(port)) {
      return { host, port, code: code ?? undefined };
    }
  } catch {
    // fall through to raw endpoint parsing
  }

  const raw = value.match(/(?<host>[^:]+):(?<port>\d{2,5})(?:\|(?<code>\d{4,8}))?/);
  if (raw?.groups?.host && raw.groups.port) {
    return {
      host: raw.groups.host,
      port: Number.parseInt(raw.groups.port, 10),
      code: raw.groups.code,
    };
  }

  return undefined;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Pairing failed. Check the device wireless debugging screen and try again.';
}
