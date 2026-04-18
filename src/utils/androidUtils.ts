import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';

export interface PackageInfo {
  packageName: string;
  mainActivity?: string;
}

async function findFilesRecursive(
  rootDir: string,
  targetFileNames: Set<string>,
  maxDepth: number
): Promise<string[]> {
  const matches: string[] = [];
  const ignoredDirs = new Set([
    '.git',
    '.hg',
    '.svn',
    '.idea',
    '.vscode',
    'node_modules',
    'dist',
    'build',
    'binary',
    '.planning',
  ]);

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true, encoding: 'utf8' });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirs.has(entry.name)) {
          await walk(entryPath, depth + 1);
        }
        continue;
      }

      if (entry.isFile() && targetFileNames.has(entry.name)) {
        matches.push(entryPath);
      }
    }
  }

  await walk(rootDir, 0);
  return matches;
}

export async function findPackageAndActivity(workspaceRoot: string): Promise<PackageInfo | null> {
  // Try to find AndroidManifest.xml and build.gradle files
  try {
    const preferredManifestLocations = [
      path.join(workspaceRoot, 'app', 'src', 'main', 'AndroidManifest.xml'),
      path.join(workspaceRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
      path.join(workspaceRoot, 'src', 'main', 'AndroidManifest.xml'),
      path.join(workspaceRoot, 'AndroidManifest.xml'),
    ];
    const discoveredManifestLocations = await findFilesRecursive(
      workspaceRoot,
      new Set(['AndroidManifest.xml']),
      5
    );
    const manifestCandidates = Array.from(
      new Set([...preferredManifestLocations, ...discoveredManifestLocations])
    );

    let manifestPath: string | null = null;
    for (const location of manifestCandidates) {
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

export async function findPackageNameFromGradle(workspaceRoot: string): Promise<string | undefined> {
  const preferredGradleFiles = [
    path.join(workspaceRoot, 'app', 'build.gradle.kts'),
    path.join(workspaceRoot, 'app', 'build.gradle'),
    path.join(workspaceRoot, 'android', 'app', 'build.gradle.kts'),
    path.join(workspaceRoot, 'android', 'app', 'build.gradle'),
    path.join(workspaceRoot, 'android', 'build.gradle.kts'),
    path.join(workspaceRoot, 'android', 'build.gradle'),
    path.join(workspaceRoot, 'build.gradle.kts'),
    path.join(workspaceRoot, 'build.gradle'),
  ];
  const discoveredGradleFiles = await findFilesRecursive(
    workspaceRoot,
    new Set(['build.gradle.kts', 'build.gradle']),
    4
  );
  const gradleFiles = Array.from(new Set([...preferredGradleFiles, ...discoveredGradleFiles]));

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

export function normalizeActivityName(packageName: string, activityName: string): string {
  if (activityName.startsWith('.')) {
    return packageName + activityName;
  }
  if (!activityName.includes('.')) {
    return `${packageName}.${activityName}`;
  }
  return activityName;
}

export async function launchWithRetry(
  adbPath: string,
  serial: string,
  packageInfo: PackageInfo,
  output: vscode.OutputChannel,
  maxAttempts: number = 5,
  retryDelayMs: number = 5000,
  packageCandidates?: string[]
): Promise<boolean> {
  const { execa } = await import('execa');
  const launchPackages = (packageCandidates && packageCandidates.length > 0)
    ? packageCandidates
    : [packageInfo.packageName];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    output.appendLine(`Launch attempt ${attempt}/${maxAttempts}...`);

    for (const candidatePackage of launchPackages) {
      const component = packageInfo.mainActivity
        ? `${candidatePackage}/${packageInfo.mainActivity}`
        : undefined;
      output.appendLine(`Trying package: ${candidatePackage}`);

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
          output.appendLine(`Launch succeeded via am start (${candidatePackage}).`);
          return true;
        }

        output.appendLine(`Direct activity launch failed for ${candidatePackage}; trying package launcher fallback...`);
      } else {
        output.appendLine(`Main activity not detected; trying package launcher fallback for ${candidatePackage}...`);
      }

      const monkeyResult = await execa(
        adbPath,
        ['-s', serial, 'shell', 'monkey', '-p', candidatePackage, '-c', 'android.intent.category.LAUNCHER', '1'],
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
        output.appendLine(`Launch succeeded via package fallback (${candidatePackage}).`);
        return true;
      }
    }

    if (attempt < maxAttempts) {
      output.appendLine(`Launch failed; waiting ${retryDelayMs / 1000}s before retry...`);
      await delay(retryDelayMs);
    }
  }

  return false;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function listInstalledPackageCandidates(
  adbPath: string,
  serial: string,
  packageName: string
): Promise<string[]> {
  const { execa } = await import('execa');
  const result = await execa(
    adbPath,
    ['-s', serial, 'shell', 'pm', 'list', 'packages', packageName],
    {
      all: true,
      reject: false,
    }
  );

  if (result.exitCode !== 0) {
    return [packageName];
  }

  const output = (result.all ?? result.stdout ?? '').toString();
  const discovered = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('package:'))
    .map((line) => line.replace(/^package:/, '').trim())
    .filter(Boolean);

  if (discovered.length === 0) {
    return [packageName];
  }

  const uniq = Array.from(new Set(discovered));
  uniq.sort((a, b) => {
    if (a === packageName) {
      return -1;
    }
    if (b === packageName) {
      return 1;
    }
    if (a.startsWith(packageName) && !b.startsWith(packageName)) {
      return -1;
    }
    if (b.startsWith(packageName) && !a.startsWith(packageName)) {
      return 1;
    }
    return a.localeCompare(b);
  });
  return uniq;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
