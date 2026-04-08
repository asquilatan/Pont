import * as vscode from 'vscode';

/**
 * Resolves and validates the scrcpy executable path.
 *
 * This service implements a layered resolution strategy:
 * 1. User-configured path from settings
 * 2. PATH environment variable
 *
 * Scrcpy is an external dependency that must be installed by the user.
 * This extension does not bundle scrcpy binaries due to platform-specific
 * requirements and licensing considerations.
 *
 * Installation guide for users:
 * - Windows: scoop install scrcpy OR choco install scrcpy
 * - macOS: brew install scrcpy
 * - Linux: apt install scrcpy OR snap install scrcpy
 *
 * @see https://github.com/Genymobile/scrcpy
 */
export class ScrcpyLocator {
  /**
   * Resolves the scrcpy executable path from configuration or PATH.
   *
   * @returns The resolved path to the scrcpy executable
   * @throws Error if scrcpy cannot be found or executed
   */
  public async resolveScrcpyPath(): Promise<string> {
    // Check user-configured path first
    const configuredPath = vscode.workspace
      .getConfiguration('androidWirelessDebugging')
      .get<string>('scrcpyPath');

    if (configuredPath) {
      const isValid = await this.validateScrcpyPath(configuredPath);
      if (isValid) {
        return configuredPath;
      }
      throw new Error(
        `Configured scrcpy path is invalid: ${configuredPath}\n\n` +
        'Please verify the path in your settings or remove it to use the system PATH.'
      );
    }

    // Fall back to PATH
    const pathScrcpy = 'scrcpy';
    const isValid = await this.validateScrcpyPath(pathScrcpy);
    if (isValid) {
      return pathScrcpy;
    }

    // Not found - provide clear setup guidance
    throw new Error(
      'scrcpy is not installed or not in your PATH.\n\n' +
      'To use the Pont Viewer, install scrcpy:\n' +
      '• Windows: scoop install scrcpy OR choco install scrcpy\n' +
      '• macOS: brew install scrcpy\n' +
      '• Linux: apt install scrcpy OR snap install scrcpy\n\n' +
      'Alternatively, set "androidWirelessDebugging.scrcpyPath" in your settings to point to the scrcpy executable.'
    );
  }

  /**
   * Validates that a scrcpy path is executable and reports version info.
   *
   * @param path - The path to validate
   * @returns True if the path is a valid scrcpy executable
   */
  private async validateScrcpyPath(path: string): Promise<boolean> {
    try {
      const { execa } = await import('execa');

      // Run scrcpy --version to verify it's executable and is actually scrcpy
      const result = await execa(path, ['--version'], {
        timeout: 5000,
        reject: false
      });

      // scrcpy --version returns exit code 0 and prints version info
      if (result.exitCode === 0 && result.stdout.includes('scrcpy')) {
        return true;
      }

      return false;
    } catch {
      // Not executable or not found
      return false;
    }
  }
}

/**
 * Convenience function to resolve the scrcpy path.
 *
 * @returns The resolved scrcpy executable path
 * @throws Error if scrcpy cannot be found
 */
export async function resolveScrcpyPath(): Promise<string> {
  const locator = new ScrcpyLocator();
  return locator.resolveScrcpyPath();
}
