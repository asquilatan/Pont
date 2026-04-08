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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new PairingSession();
  let adb: AdbBridge | undefined;
  const lastHostKey = 'androidWirelessDebugging.lastHost';

  const pairDevice = async (): Promise<void> => {
    await runPairDeviceFlow({
      adb: await getAdb(),
      session,
      panel,
      getLastHost: () => context.globalState.get<string>(lastHostKey),
      setLastHost: (host: string) => context.globalState.update(lastHostKey, host),
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

  const panel = new StatusPanelController(context, () => session.current, {
    onPairRequested: async () => {
      await pairDevice();
    },
    onOpenViewerRequested: async () => {
      await openViewerCommand({ context, session, mirrorSession });
    },
    onDisconnectRequested: async () => {
      const snapshot = session.current;
      if (snapshot.serial) {
        const currentAdb = await getAdb();
        await currentAdb.disconnect(snapshot.serial);
      }
      session.setDisconnected('Android device disconnected.');
      panel.update();
    },
  });

  const sidebar = new StatusSidebarProvider(context, () => session.current, {
    onPairRequested: async () => {
      await pairDevice();
      sidebar.update();
    },
    onOpenViewerRequested: async () => {
      await openViewerCommand({ context, session, mirrorSession });
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
    },
  });

  // Wire device state changes to mirror session
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(StatusSidebarProvider.viewType, sidebar),
    session.onDidChange((snapshot) => {
      void mirrorSession.handleDeviceStateChange(snapshot);
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
      await openViewerCommand({ context, session, mirrorSession });
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.disconnectDevice', async () => {
      const snapshot = session.current;
      if (snapshot.serial) {
        const currentAdb = await getAdb();
        await currentAdb.disconnect(snapshot.serial);
      }
      session.setDisconnected('Android device disconnected.');
      panel.update();
    })
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}
