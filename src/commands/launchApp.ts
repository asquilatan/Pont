import * as vscode from 'vscode';
import type { PairingSession } from '../services/pairingSession';
import { findPackageAndActivity, launchWithRetry, listInstalledPackageCandidates } from '../utils/androidUtils';

const LAUNCH_MAX_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 5000;

let launchAppOutput: vscode.OutputChannel | undefined;

interface LaunchConnectedAppDeps {
  session: PairingSession;
  adbPath: string;
}

export async function launchConnectedAppCommand(deps: LaunchConnectedAppDeps): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    await vscode.window.showErrorMessage('Open your Android project workspace first.');
    return;
  }

  const snapshot = deps.session.current;
  if (snapshot.state !== 'connected' || !snapshot.serial) {
    await vscode.window.showErrorMessage('Connect a device first, then launch the app.');
    return;
  }

  const output = getLaunchAppOutputChannel();
  output.show(true);

  // Step: Launch the app (with bounded retries to handle delayed package availability on device)
  const packageInfo = await findPackageAndActivity(workspaceFolder.uri.fsPath);
  if (packageInfo) {
    output.appendLine(`Detected package: ${packageInfo.packageName}`);
    if (packageInfo.mainActivity) {
      output.appendLine(`Detected main activity: ${packageInfo.mainActivity}`);
    } else {
      output.appendLine('Main activity not detected from project files. Launch fallback will be used.');
    }

    const packageCandidates = await listInstalledPackageCandidates(
      deps.adbPath,
      snapshot.serial,
      packageInfo.packageName
    );
    output.appendLine(`Installed package candidates on device: ${packageCandidates.join(', ')}`);

    const launched = await launchWithRetry(
      deps.adbPath,
      snapshot.serial,
      packageInfo,
      output,
      LAUNCH_MAX_ATTEMPTS,
      LAUNCH_RETRY_DELAY_MS,
      packageCandidates
    );
    if (!launched) {
      await vscode.window.showErrorMessage(
        `Launch failed after ${LAUNCH_MAX_ATTEMPTS} attempts. Check Pont: Launch App output.`
      );
      return;
    }

    await vscode.window.showInformationMessage('App launched on connected device.');
  } else {
    output.appendLine('Warning: Could not find package name and main activity.');
    const manualPackageName = await vscode.window.showInputBox({
      prompt: 'Pont could not auto-detect your app package. Enter package name to launch manually.',
      placeHolder: 'com.example.app',
      ignoreFocusOut: true,
      validateInput: (value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return 'Package name is required.';
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(trimmed)) {
          return 'Enter a valid Android package name (e.g., com.example.app).';
        }
        return undefined;
      },
    });

    if (!manualPackageName) {
      await vscode.window.showWarningMessage('Launch cancelled. Package name was not provided.');
      return;
    }

    const packageCandidates = await listInstalledPackageCandidates(
      deps.adbPath,
      snapshot.serial,
      manualPackageName
    );
    output.appendLine(`Manual package input: ${manualPackageName}`);
    output.appendLine(`Installed package candidates on device: ${packageCandidates.join(', ')}`);

    const launched = await launchWithRetry(
      deps.adbPath,
      snapshot.serial,
      { packageName: manualPackageName },
      output,
      LAUNCH_MAX_ATTEMPTS,
      LAUNCH_RETRY_DELAY_MS,
      packageCandidates
    );

    if (!launched) {
      await vscode.window.showErrorMessage(
        `Launch failed after ${LAUNCH_MAX_ATTEMPTS} attempts. Check Pont: Launch App output.`
      );
      return;
    }

    await vscode.window.showInformationMessage('App launched on connected device.');
  }
}

function getLaunchAppOutputChannel(): vscode.OutputChannel {
  if (!launchAppOutput) {
    launchAppOutput = vscode.window.createOutputChannel('Pont: Launch App');
  }
  return launchAppOutput;
}
