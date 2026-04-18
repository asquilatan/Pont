import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { PairingSession } from '../services/pairingSession';
import { formatError } from '../utils/androidUtils';

let installAppOutput: vscode.OutputChannel | undefined;

interface InstallConnectedAppDeps {
  session: PairingSession;
  adbPath: string;
}

export async function installConnectedAppCommand(deps: InstallConnectedAppDeps): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('Open your Android project workspace first.');
    return;
  }

  const snapshot = deps.session.current;
  if (snapshot.state !== 'connected' || !snapshot.serial) {
    await vscode.window.showErrorMessage('Connect a device first, then install the app.');
    return;
  }

  const gradleTask = vscode.workspace
    .getConfiguration('androidWirelessDebugging')
    .get<string>('gradleInstallTask')
    ?.trim() || 'installDebug';

  const output = getInstallAppOutputChannel();
  output.show(true);
  output.appendLine(`Running Gradle task: ${gradleTask}`);

  const installSucceeded = await runGradleInstall(workspaceFolder.uri.fsPath, gradleTask, snapshot.serial, output);
  if (installSucceeded) {
    await vscode.window.showInformationMessage('App installed on connected device.');
  } else {
    await vscode.window.showErrorMessage('Gradle install failed. Check Pont: Install App output for details.');
  }
}

function getInstallAppOutputChannel(): vscode.OutputChannel {
  if (!installAppOutput) {
    installAppOutput = vscode.window.createOutputChannel('Pont: Install App');
  }
  return installAppOutput;
}

async function runGradleInstall(
  workspaceRoot: string,
  gradleTask: string,
  serial: string,
  output: vscode.OutputChannel
): Promise<boolean> {
  const gradlewPath = path.join(workspaceRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

  try {
    await fs.access(gradlewPath);
  } catch {
    output.appendLine(`Gradle wrapper not found at ${gradlewPath}`);
    return false;
  }

  try {
    const { execa } = await import('execa');
    const args = gradleTask.split(' ').filter(Boolean);
    args.push('--info', '--stacktrace');

    const subprocess = execa(gradlewPath, args, {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        ANDROID_SERIAL: serial,
      },
      all: true,
    });

    subprocess.all?.on('data', (chunk) => {
      output.append(chunk.toString());
    });

    await subprocess;
    output.appendLine('\nGradle install completed successfully.');
    return true;
  } catch (error) {
    output.appendLine(`\nGradle install failed: ${formatError(error)}`);
    return false;
  }
}
