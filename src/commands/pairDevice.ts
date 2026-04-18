import * as vscode from 'vscode';
import { AdbBridge } from '../services/adbBridge';
import { PairingSession } from '../services/pairingSession';
import { StatusPanelController } from '../ui/statusPanel';
import type { PairingTarget } from '../types';
import type { WirelessServiceEndpoint } from '../services/adbBridge';

interface PairDeviceDependencies {
  adb: AdbBridge;
  session: PairingSession;
  panel: StatusPanelController;
  getLastHost: () => string | undefined;
  setLastHost: (host: string) => Thenable<void>;
  showPanel?: boolean;
  onPaired?: () => Promise<void>;
}

export async function runPairDeviceFlow(deps: PairDeviceDependencies): Promise<void> {
  if (deps.showPanel !== false) {
    deps.panel.show();
  }

  const selection = await pickPairingSelection(deps.adb, deps.getLastHost);
  if (!selection) {
    return;
  }

  const code = await promptForPairingCode();
  if (!code) {
    return;
  }

  const target: PairingTarget = {
    method: 'pairing-code',
    host: selection.pairHost,
    port: selection.pairPort,
    code,
  };

  const paired = await executePairing(deps, target, selection.connectHost, selection.connectPort);
  if (!paired) {
    return;
  }

  await deps.setLastHost(selection.pairHost);
  if (deps.onPaired) {
    await deps.onPaired();
  }
}

async function promptForPairingCode(): Promise<string | undefined> {
  const code = await vscode.window.showInputBox({
    title: 'Pairing code',
    prompt: 'Enter the 6-digit wireless debugging code shown on the device.',
    placeHolder: '123456',
    ignoreFocusOut: true,
  });

  if (!code) {
    return undefined;
  }

  return code.trim();
}

interface PairingSelection {
  pairHost: string;
  pairPort: number;
  connectHost: string;
  connectPort: number;
}

async function pickPairingSelection(
  adb: AdbBridge,
  getLastHost: () => string | undefined
): Promise<PairingSelection | undefined> {
  const endpoints = await discoverEndpointsWithRetry(adb);
  if (endpoints.length === 0) {
    return pickManualSelection(true, getLastHost);
  }
  return pickDiscoveredSelection(endpoints, getLastHost);
}

async function discoverEndpointsWithRetry(adb: AdbBridge): Promise<WirelessServiceEndpoint[]> {
  const attempts = 6;
  const delayMs = 3000;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const endpoints = await adb.discoverWirelessEndpoints();
    if (endpoints.length > 0) {
      return endpoints;
    }

    if (attempt === 0) {
      void vscode.window.showInformationMessage(
        'Open "Pair device with pairing code" on your phone, then wait a moment while devices are discovered.'
      );
    }

    await wait(delayMs);
  }

  return [];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickDiscoveredSelection(
  endpoints: WirelessServiceEndpoint[],
  getLastHost: () => string | undefined
): Promise<PairingSelection | undefined> {
  const pairingByHost = new Map<string, WirelessServiceEndpoint[]>();
  const connectByHost = new Map<string, WirelessServiceEndpoint[]>();
  const unknownByHost = new Map<string, WirelessServiceEndpoint[]>();

  for (const endpoint of endpoints) {
    if (endpoint.kind === 'pairing') {
      const list = pairingByHost.get(endpoint.host) ?? [];
      list.push(endpoint);
      pairingByHost.set(endpoint.host, list);
      continue;
    }

    if (endpoint.kind === 'connect') {
      const list = connectByHost.get(endpoint.host) ?? [];
      list.push(endpoint);
      connectByHost.set(endpoint.host, list);
      continue;
    }

    const list = unknownByHost.get(endpoint.host) ?? [];
    list.push(endpoint);
    unknownByHost.set(endpoint.host, list);
  }

  const hosts = new Set<string>([
    ...pairingByHost.keys(),
    ...connectByHost.keys(),
    ...unknownByHost.keys(),
  ]);

  const items = [...hosts].map((host) => {
    const pair = (pairingByHost.get(host) ?? [])[0] ?? (unknownByHost.get(host) ?? [])[0] ?? (connectByHost.get(host) ?? [])[0];
    const connect = (connectByHost.get(host) ?? [])[0] ?? (unknownByHost.get(host) ?? [])[0] ?? pair;
    if (!pair || !connect) {
      return undefined;
    }

    return {
      label: host,
      description: `Pair ${pair.port} \u2022 Connect ${connect.port}`,
      selection: {
        pairHost: pair.host,
        pairPort: pair.port,
        connectHost: connect.host,
        connectPort: connect.port,
      },
    };
  }).filter((item): item is {
    label: string;
    description: string;
    selection: PairingSelection;
  } => Boolean(item));

  if (items.length === 0) {
    return pickManualSelection(true, getLastHost);
  }

  const pick = await vscode.window.showQuickPick(
    [
      ...items,
      {
        label: 'Enter endpoint manually',
        description: 'Use the IP and ports shown in Wireless debugging on your phone.',
        selection: undefined,
      },
    ],
    {
      title: 'Select Android device',
      placeHolder: 'Choose a discovered device (IP) to pair',
    }
  );

  if (!pick) {
    return undefined;
  }
  if (!pick.selection) {
    return pickManualSelection(false, getLastHost);
  }
  return pick.selection;
}

async function pickManualSelection(
  showWarning: boolean,
  getLastHost: () => string | undefined
): Promise<PairingSelection | undefined> {
  if (showWarning) {
    await vscode.window.showWarningMessage(
      'No pairing services were discovered automatically. Enter the phone IP and ports shown in Wireless debugging.',
      { modal: false }
    );
  }
  const host = await vscode.window.showInputBox({
    title: 'Device IP address',
    prompt: 'Enter the IP address shown on the device.',
    placeHolder: '192.168.1.42',
    value: getLastHost(),
    ignoreFocusOut: true,
  });
  if (!host?.trim()) {
    return undefined;
  }

  const pairingPortInput = await vscode.window.showInputBox({
    title: 'Pairing port',
    prompt: 'Enter the pairing port shown in "Pair device with pairing code".',
    placeHolder: '37123',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const port = Number.parseInt(value.trim(), 10);
      return Number.isInteger(port) && port > 0 && port <= 65535 ? undefined : 'Enter a valid TCP port number.';
    },
  });
  if (!pairingPortInput?.trim()) {
    return undefined;
  }

  const pairPort = Number.parseInt(pairingPortInput.trim(), 10);
  const connectPortInput = await vscode.window.showInputBox({
    title: 'Connect port',
    prompt: 'Enter the connect/debugging port shown on the main Wireless debugging screen.',
    placeHolder: `${pairPort}`,
    value: `${pairPort}`,
    ignoreFocusOut: true,
    validateInput: (value) => {
      const port = Number.parseInt(value.trim(), 10);
      return Number.isInteger(port) && port > 0 && port <= 65535 ? undefined : 'Enter a valid TCP port number.';
    },
  });
  if (!connectPortInput?.trim()) {
    return undefined;
  }
  const connectPort = Number.parseInt(connectPortInput.trim(), 10);
  return {
    pairHost: host.trim(),
    pairPort,
    connectHost: host.trim(),
    connectPort,
  };
}

async function executePairing(
  deps: PairDeviceDependencies,
  target: PairingTarget,
  connectHost: string,
  connectPort: number
): Promise<boolean> {
  deps.session.beginPairing(target);
  deps.panel.update();

  try {
    await deps.adb.ensureAvailable();
    const beforeDevices = await deps.adb.listDevices();
    await pairWithFallback(deps.adb, target, connectHost);
    let connectOutput = await deps.adb.connect(connectHost, connectPort);
    let afterDevices = await deps.adb.listDevices();
    let serial = resolveConnectedSerial(connectHost, connectPort, connectOutput, beforeDevices, afterDevices);

    if (!isConnectedDeviceSerial(afterDevices, serial)) {
      const endpoints = await deps.adb.discoverWirelessEndpoints();
      const fallbackConnect = endpoints.find(
        (endpoint) => endpoint.host === connectHost && endpoint.kind === 'connect' && endpoint.port !== connectPort
      );

      if (fallbackConnect) {
        connectOutput = await deps.adb.connect(fallbackConnect.host, fallbackConnect.port);
        afterDevices = await deps.adb.listDevices();
        serial = resolveConnectedSerial(
          fallbackConnect.host,
          fallbackConnect.port,
          connectOutput,
          beforeDevices,
          afterDevices
        );
      }
    }

    if (!isConnectedDeviceSerial(afterDevices, serial)) {
      throw new Error('Device is connected but offline. Toggle Wireless debugging on the phone and retry pairing.');
    }

    deps.session.setConnected(serial, connectOutput.trim() || 'Android device connected.');
    deps.panel.update();
    return true;
  } catch (error) {
    const message = toErrorMessage(error);
    deps.session.setFailed(message);
    deps.panel.update();
    await vscode.window.showErrorMessage(message);
    return false;
  }
}

async function pairWithFallback(adb: AdbBridge, target: PairingTarget, connectHost: string): Promise<void> {
  try {
    await adb.pair(target);
    return;
  } catch (error) {
    if (!isAdbPairProtocolFault(error)) {
      throw error;
    }

    const endpoints = await adb.discoverWirelessEndpoints();
    const fallbackPair = endpoints.find(
      (endpoint) => endpoint.host === connectHost && endpoint.kind === 'pairing' && endpoint.port !== target.port
    );

    if (fallbackPair) {
      await adb.pair({
        ...target,
        host: fallbackPair.host,
        port: fallbackPair.port,
      });
      return;
    }

    throw new Error(
      'adb pair failed with a protocol fault. Confirm you entered the Pairing port (not the Connect port), refresh the pairing code on the device, then retry.'
    );
  }
}

function resolveConnectedSerial(
  host: string,
  port: number,
  connectOutput: string,
  beforeDevices: string,
  afterDevices: string
): string {
  const before = parseConnectedTcpSerials(beforeDevices);
  const after = parseConnectedTcpSerials(afterDevices);

  const hostMatch = after.find((serial) => serial.startsWith(`${host}:`));
  if (hostMatch) {
    return hostMatch;
  }

  const newlyAdded = after.find((serial) => !before.includes(serial));
  if (newlyAdded) {
    return newlyAdded;
  }

  if (after.length === 1) {
    return after[0];
  }

  const fromConnect = connectOutput.match(/(?:connected to|already connected to)\s+([^\s]+)/i)?.[1];
  if (fromConnect && after.includes(fromConnect.trim())) {
    return fromConnect.trim();
  }

  return `${host}:${port}`;
}

function parseConnectedTcpSerials(devicesOutput: string): string[] {
  return devicesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length > 1 && parts[1] === 'device')
    .map((parts) => parts[0])
    .filter((serial) => serial.includes(':'));
}

function isConnectedDeviceSerial(devicesOutput: string, serial: string): boolean {
  const entries = devicesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length > 1);

  return entries.some((parts) => parts[0] === serial && parts[1] === 'device');
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return 'Pairing failed. Check the device wireless debugging screen and try again.';
}

function isAdbPairProtocolFault(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /protocol fault|couldn't read status message/i.test(message);
}
