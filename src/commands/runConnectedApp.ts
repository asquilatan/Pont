import * as vscode from 'vscode';
import type { PairingSession } from '../services/pairingSession';

interface RunConnectedAppDeps {
  session: PairingSession;
}

export async function runConnectedAppCommand(deps: RunConnectedAppDeps): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('Open your Android project workspace first.');
    return;
  }

  const snapshot = deps.session.current;
  if (snapshot.state !== 'connected' || !snapshot.serial) {
    await vscode.window.showErrorMessage('Connect a device first, then run the app command.');
    return;
  }

  const gradleTask = vscode.workspace
    .getConfiguration('androidWirelessDebugging')
    .get<string>('gradleInstallTask')
    ?.trim() || 'installDebug';

  const command = process.platform === 'win32' ? `.\\gradlew.bat ${gradleTask}` : `./gradlew ${gradleTask}`;

  const terminal = vscode.window.createTerminal({
    name: 'Android Run',
    cwd: workspaceFolder.uri.fsPath,
    env: { ANDROID_SERIAL: snapshot.serial },
  });
  terminal.show(true);
  terminal.sendText(command, true);
}
