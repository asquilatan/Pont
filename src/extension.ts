import * as vscode from 'vscode';
import { resolveAdbPath } from './services/adbLocator';
import { AdbBridge } from './services/adbBridge';
import { PairingSession } from './services/pairingSession';
import { MirrorSession } from './services/mirrorSession';
import { ScrcpyBridge } from './services/scrcpyBridge';
import { StatusPanelController } from './ui/statusPanel';
import { runPairDeviceFlow } from './commands/pairDevice';
import { openViewerCommand } from './commands/openViewer';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const session = new PairingSession();
  const adbPath = await resolveAdbPath();
  const adb = new AdbBridge(adbPath);

  // Create mirror session that manages the scrcpy lifecycle
  const mirrorSession = new MirrorSession(
    () => new ScrcpyBridge(),
    context
  );

  const panel = new StatusPanelController(context, () => session.current, {
    onPairRequested: async () => {
      await runPairDeviceFlow({ adb, session, panel });
    },
    onOpenViewerRequested: async () => {
      await openViewerCommand({ context, session, mirrorSession });
    },
  });

  // Wire device state changes to mirror session
  context.subscriptions.push(
    session.onDidChange((snapshot) => {
      void mirrorSession.handleDeviceStateChange(snapshot);
    })
  );

  context.subscriptions.push(
    panel,
    session,
    mirrorSession,
    vscode.commands.registerCommand('androidWirelessDebugging.pairDevice', async () => {
      await runPairDeviceFlow({ adb, session, panel });
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.openStatusPanel', () => {
      panel.show();
    }),
    vscode.commands.registerCommand('androidWirelessDebugging.openDeviceViewer', async () => {
      await openViewerCommand({ context, session, mirrorSession });
    })
  );
}

export function deactivate(): void {
  // VS Code disposes subscriptions automatically.
}
