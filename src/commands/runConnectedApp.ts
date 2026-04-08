import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import type { PairingSession } from '../services/pairingSession';

const LAUNCH_MAX_ATTEMPTS = 5;
const LAUNCH_RETRY_DELAY_MS = 5000;

let runAppOutput: vscode.OutputChannel | undefined;

interface RunConnectedAppDeps {
  session: PairingSession;
  adbPath: string;
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

  const output = getRunAppOutputChannel();
  output.show(true);
  output.appendLine(`Running Gradle task: ${gradleTask}`);

  const installSucceeded = await runGradleInstall(workspaceFolder.uri.fsPath, gradleTask, snapshot.serial, output);
  if (!installSucceeded) {
    await vscode.window.showErrorMessage('Gradle install failed. Check Pont: Run Connected App output for details.');
    return;
  }

  // Step 2: Launch the app (with bounded retries to handle delayed package availability on device)
  const packageInfo = await findPackageAndActivity(workspaceFolder.uri.fsPath);
  if (packageInfo) {
    output.appendLine(`Attempting launch for ${packageInfo.packageName}/${packageInfo.mainActivity}`);
    const launched = await launchWithRetry(deps.adbPath, snapshot.serial, packageInfo, output);
    if (!launched) {
      await vscode.window.showErrorMessage(
        `App install completed, but launch failed after ${LAUNCH_MAX_ATTEMPTS} attempts. Check Pont: Run Connected App output.`
      );
      return;
    }

    await vscode.window.showInformationMessage('App installed and launched on connected device.');
  } else {
    output.appendLine('Warning: Could not find package name and main activity. App installed but not launched.');
    await vscode.window.showWarningMessage('App installed, but Pont could not detect package/activity to launch automatically.');
  }
}

interface PackageInfo {
  packageName: string;
  mainActivity?: string;
}

async function findPackageAndActivity(workspaceRoot: string): Promise<PackageInfo | null> {
  // Try to find AndroidManifest.xml and build.gradle files
  try {
    // Common Android project locations
    const possibleLocations = [
      path.join(workspaceRoot, 'app', 'src', 'main', 'AndroidManifest.xml'),
      path.join(workspaceRoot, 'src', 'main', 'AndroidManifest.xml'),
      path.join(workspaceRoot, 'AndroidManifest.xml'),
    ];

    let manifestPath: string | null = null;
    for (const location of possibleLocations) {
      try {
        await fs.access(location);
        manifestPath = location;
        break;
      } catch {
        continue;
      }
    }

    const gradlePackageName = await findPackageNameFromGradle(workspaceRoot);
    if (!manifestPath) {
      return gradlePackageName ? { packageName: gradlePackageName } : null;
    }

    const manifestContent = await fs.readFile(manifestPath, 'utf-8');

    // package was removed from many manifests in newer AGP versions, so fall back to Gradle applicationId/namespace.
    const packageMatch = manifestContent.match(/package\s*=\s*["']([^"']+)["']/);
    const packageName = packageMatch?.[1] ?? gradlePackageName;
    if (!packageName) {
      return null;
    }

    // Look for launcher intent in both <activity> and <activity-alias> declarations.
    const launcherEntryRegex = /<(activity|activity-alias)\b[^>]*android:name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/\1>/g;
    let mainActivity: string | undefined;

    let match: RegExpExecArray | null;
    while ((match = launcherEntryRegex.exec(manifestContent)) !== null) {
      const activityName = match[2];
      const activityContent = match[3];

      if (
        activityContent.includes('android.intent.action.MAIN')
        && activityContent.includes('android.intent.category.LAUNCHER')
      ) {
        mainActivity = normalizeActivityName(packageName, activityName);
        break;
      }
    }

    return { packageName, mainActivity };
  } catch {
    return null;
  }
}

async function findPackageNameFromGradle(workspaceRoot: string): Promise<string | undefined> {
  const gradleFiles = [
    path.join(workspaceRoot, 'app', 'build.gradle.kts'),
    path.join(workspaceRoot, 'app', 'build.gradle'),
    path.join(workspaceRoot, 'build.gradle.kts'),
    path.join(workspaceRoot, 'build.gradle'),
  ];

  for (const gradleFile of gradleFiles) {
    try {
      const content = await fs.readFile(gradleFile, 'utf-8');
      const applicationIdMatch = content.match(/applicationId\s*(?:=\s*)?["']([^"']+)["']/);
      if (applicationIdMatch?.[1]) {
        return applicationIdMatch[1];
      }

      const namespaceMatch = content.match(/namespace\s*(?:=\s*)?["']([^"']+)["']/);
      if (namespaceMatch?.[1]) {
        return namespaceMatch[1];
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function normalizeActivityName(packageName: string, activityName: string): string {
  if (activityName.startsWith('.')) {
    return packageName + activityName;
  }
  if (!activityName.includes('.')) {
    return `${packageName}.${activityName}`;
  }
  return activityName;
}

function getRunAppOutputChannel(): vscode.OutputChannel {
  if (!runAppOutput) {
    runAppOutput = vscode.window.createOutputChannel('Pont: Run Connected App');
  }
  return runAppOutput;
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
    const subprocess = execa(gradlewPath, [gradleTask], {
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

async function launchWithRetry(
  adbPath: string,
  serial: string,
  packageInfo: PackageInfo,
  output: vscode.OutputChannel
): Promise<boolean> {
  const { execa } = await import('execa');
  const component = packageInfo.mainActivity
    ? `${packageInfo.packageName}/${packageInfo.mainActivity}`
    : undefined;

  for (let attempt = 1; attempt <= LAUNCH_MAX_ATTEMPTS; attempt += 1) {
    output.appendLine(`Launch attempt ${attempt}/${LAUNCH_MAX_ATTEMPTS}...`);

    if (component) {
      const startResult = await execa(adbPath, ['-s', serial, 'shell', 'am', 'start', '-n', component], {
        all: true,
        reject: false,
      });

      const startOutput = (startResult.all ?? startResult.stdout ?? '').toString();
      if (startOutput.trim().length > 0) {
        output.appendLine(startOutput.trim());
      }

      const startFailed = startResult.exitCode !== 0
        || /(^|\n)\s*Error:|Exception occurred|does not exist/i.test(startOutput);
      if (!startFailed) {
        output.appendLine('Launch succeeded via am start.');
        return true;
      }

      output.appendLine('Direct activity launch failed; trying package launcher fallback...');
    } else {
      output.appendLine('Main activity not detected; trying package launcher fallback...');
    }

    const monkeyResult = await execa(
      adbPath,
      ['-s', serial, 'shell', 'monkey', '-p', packageInfo.packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
      {
        all: true,
        reject: false,
      }
    );

    const monkeyOutput = (monkeyResult.all ?? monkeyResult.stdout ?? '').toString();
    if (monkeyOutput.trim().length > 0) {
      output.appendLine(monkeyOutput.trim());
    }

    const monkeyFailed = monkeyResult.exitCode !== 0
      || /monkey aborted|No activities found to run|(^|\n)\s*Error:/i.test(monkeyOutput);
    if (!monkeyFailed) {
      output.appendLine('Launch succeeded via package fallback.');
      return true;
    }

    if (attempt < LAUNCH_MAX_ATTEMPTS) {
      output.appendLine(`Launch failed; waiting ${LAUNCH_RETRY_DELAY_MS / 1000}s before retry...`);
      await delay(LAUNCH_RETRY_DELAY_MS);
    }
  }

  output.appendLine('Launch failed after maximum retry attempts.');
  return false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
