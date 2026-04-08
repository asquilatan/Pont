import * as vscode from 'vscode';
import { resolveAdbPath } from './services/adbLocator';
import { AdbBridge } from './services/adbBridge';
import { PairingSession } from './services/pairingSession';
import { MirrorSession } from './services/mirrorSession';
import { ScrcpyBridge } from './services/scrcpyBridge';
import { StatusPanelController } from './ui/statusPanel';
import { StatusSidebarProvider } from './ui/statusSidebar';
import { runPairDeviceFlow } from './commands/pairDevice';
import { openViewerCommand } from './commands/openViewer';
import { runConnectedAppCommand } from './commands/runConnectedApp';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new PairingSession();
  let adb: AdbBridge | undefined;
  const lastHostKey = 'androidWirelessDebugging.lastHost';

  const pairDevice = async (showPanel = true): Promise<void> => {
    await runPairDeviceFlow({
      adb: await getAdb(),
      session,
      panel,
      getLastHost: () => context.globalState.get<string>(lastHostKey),
      setLastHost: (host: string) => context.globalState.update(lastHostKey, host),
      showPanel,
      onPaired: async () => {
        await openViewer();
      },
    });
  };

  const getAdb = async (): Promise<AdbBridge> => {
    if (!adb) {
      adb = new AdbBridge(await resolveAdbPath());
    }

    return adb;
  };

  // Create mirror session that manages the scrcpy lifecycle
  const mirrorSession = new MirrorSession(
    () => new ScrcpyBridge(),
    context
  );
  let sidebar: StatusSidebarProvider;

  const openViewer = async (): Promise<void> => {
    sidebar.setInteractionHealth('relaunching');
    const result = await openViewerCommand({ context, session, mirrorSession });
    if (result.status === 'started') {
      sidebar.setInteractionHealth('ready');
      return;
    }

    if (result.status === 'failed') {
      sidebar.setInteractionHealth('failed', result.error);
      return;
    }

    sidebar.setInteractionHealth('idle');
  };

  const panel = new StatusPanelController(context, () => session.current, {
    onPairRequested: async () => {
      await pairDevice();
    },
    onOpenViewerRequested: async () => {
      await openViewer();
    },
    onDisconnectRequested: async () => {
      const snapshot = session.current;
      if (snapshot.serial) {
        const currentAdb = await getAdb();
        await currentAdb.disconnect(snapshot.serial);
      }
      session.setDisconnected('Android device disconnected.');
      panel.update();
      sidebar.setInteractionHealth('idle');
    },
  });

  sidebar = new StatusSidebarProvider(context, () => session.current, {
    onPairRequested: async () => {
      await pairDevice(false);
      sidebar.update();
    },
    onOpenViewerRequested: async () => {
      await openViewer();
      sidebar.update();
    },
    onDisconnectRequested: async () => {
      const snapshot = session.current;
      if (snapshot.serial) {
        const currentAdb = await getAdb();
        await currentAdb.disconnect(snapshot.serial);
      }
      session.setDisconnected('Android device disconnected.');
      panel.update();
      sidebar.update();
      sidebar.setInteractionHealth('idle');
    },
    onRunAppRequested: async () => {
      await runConnectedAppCommand({ session });
    },
  });

  // Wire device state changes to mirror session
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(StatusSidebarProvider.viewType, sidebar),
    session.onDidChange((snapshot) => {
      void mirrorSession.handleDeviceStateChange(snapshot);
      if (snapshot.state !== 'connected') {
        sidebar.setInteractionHealth('idle');
      }
      sidebar.update();
      panel.update();
    })
  );

  context.subscriptions.push(
    panel,
    sidebar,
    session,
    mirrorSession,
    vscode.commands.registerCommand('androidWirelessDebugging.pairDevice', async () => {
      await pairDevice();
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.openStatusPanel', () => {
      panel.show();
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.openDeviceViewer', async () => {
      await openViewer();
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.disconnectDevice', async () => {
      const snapshot = session.current;
      if (snapshot.serial) {
        const currentAdb = await getAdb();
        await currentAdb.disconnect(snapshot.serial);
      }
      session.setDisconnected('Android device disconnected.');
      panel.update();
      sidebar.setInteractionHealth('idle');
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.runConnectedApp', async () => {
      await runConnectedAppCommand({ session });
    })
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}
