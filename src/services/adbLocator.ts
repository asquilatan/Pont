import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

function adbExecutableName(): string {
  return process.platform === 'win32' ? 'adb.exe' : 'adb';
}

function candidatePaths(): string[] {
  const executable = adbExecutableName();
  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA;
  const androidHome = process.env.ANDROID_HOME;
  const androidSdkRoot = process.env.ANDROID_SDK_ROOT;

  return [
    androidHome ? path.join(androidHome, 'platform-tools', executable) : undefined,
    androidSdkRoot ? path.join(androidSdkRoot, 'platform-tools', executable) : undefined,
    localAppData ? path.join(localAppData, 'Android', 'Sdk', 'platform-tools', executable) : undefined,
    path.join(home, 'AppData', 'Local', 'Android Studio', 'platform-tools', executable),
    path.join(home, 'Android', 'Sdk', 'platform-tools', executable),
    path.join(home, 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', executable),
    process.platform === 'darwin' ? '/Applications/Android Studio.app/Contents/sdk/platform-tools/adb' : undefined,
  ].filter((value): value is string => Boolean(value));
}

async function isWorkingAdb(executable: string): Promise<boolean> {
  try {
    const { execa } = await import('execa');
    await execa(executable, ['version']);
    return true;
  } catch {
    return false;
  }
}

export async function resolveAdbPath(): Promise<string> {
  const configured = vscode.workspace.getConfiguration('androidWirelessDebugging').get<string>('adbPath')?.trim();
  if (configured) {
    if (await isWorkingAdb(configured)) {
      return configured;
    }
    throw new Error(`Unable to run adb at "${configured}". Install Android platform-tools or update androidWirelessDebugging.adbPath.`);
  }

  for (const candidate of candidatePaths()) {
    if (candidate && fs.existsSync(candidate) && (await isWorkingAdb(candidate))) {
      return candidate;
    }
  }

  if (await isWorkingAdb('adb')) {
    return 'adb';
  }

  const browse = await vscode.window.showErrorMessage(
    'Unable to find adb. Install Android platform-tools or choose your adb executable.',
    'Browse for adb'
  );

  if (browse !== 'Browse for adb') {
    throw new Error(
      'Unable to find adb. Install Android platform-tools or set "androidWirelessDebugging.adbPath" to your adb executable.'
    );
  }

  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    openLabel: 'Use selected adb executable',
    filters: process.platform === 'win32' ? { 'Executable files': ['exe'] } : undefined,
  });

  const adbPath = selected?.[0]?.fsPath;
  if (!adbPath || !(await isWorkingAdb(adbPath))) {
    throw new Error(
      'Unable to find a working adb executable. Install Android platform-tools or set "androidWirelessDebugging.adbPath".'
    );
  }

  const target = vscode.workspace.workspaceFolders?.length ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('androidWirelessDebugging').update('adbPath', adbPath, target);

  return adbPath;
}
