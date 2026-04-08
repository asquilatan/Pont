import * as vscode from 'vscode';
import { AdbBridge } from './adbBridge';
import { resolveScrcpyPath } from './scrcpyLocator';

export interface BridgeStateChange {
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
}

export interface BridgeFrameData {
  dataUrl: string;
}

export class ScrcpyBridge implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<BridgeStateChange>();
  private readonly frameEmitter = new vscode.EventEmitter<BridgeFrameData>();
  private disposed = false;
  private serial: string | undefined;
  private adb: AdbBridge | undefined;
  private process: any;

  public readonly onDidChangeState = this.stateEmitter.event;
  public readonly onDidFrameData = this.frameEmitter.event;

  public async start(serial: string): Promise<void> {
    if (this.process) {
      throw new Error('Mirror process is already running');
    }

    this.emitState({ status: 'starting' });
    this.serial = serial;
    this.disposed = false;

    // Validate scrcpy availability so the user gets a clear setup error.
    await resolveScrcpyPath();

    const adbPath = vscode.workspace.getConfiguration('androidWirelessDebugging').get<string>('adbPath') ?? 'adb';
    this.adb = new AdbBridge(adbPath);
    this.serial = await this.resolveUsableSerial(this.serial);
    const activeSerial = this.serial;
    if (!activeSerial) {
      throw new Error('No connected Android device is available for scrcpy.');
    }

    const scrcpyPath = await resolveScrcpyPath();
    const { execa } = await import('execa');
    const config = vscode.workspace.getConfiguration('androidWirelessDebugging');
    const windowX = config.get<number>('scrcpyWindowX');
    const windowY = config.get<number>('scrcpyWindowY');
    const windowWidth = config.get<number>('scrcpyWindowWidth');
    const windowHeight = config.get<number>('scrcpyWindowHeight');
    const alwaysOnTop = config.get<boolean>('scrcpyAlwaysOnTop') ?? true;
    const args = ['-s', activeSerial, '--no-audio', '--window-title', `Android Device Viewer (${activeSerial})`];
    if (alwaysOnTop) {
      args.push('--always-on-top');
    }
    if (typeof windowX === 'number') {
      args.push('--window-x', `${Math.floor(windowX)}`);
    }
    if (typeof windowY === 'number') {
      args.push('--window-y', `${Math.floor(windowY)}`);
    }
    if (typeof windowWidth === 'number' && windowWidth > 0) {
      args.push('--window-width', `${Math.floor(windowWidth)}`);
    }
    if (typeof windowHeight === 'number' && windowHeight > 0) {
      args.push('--window-height', `${Math.floor(windowHeight)}`);
    }
    const process = execa(
      scrcpyPath,
      args,
      { all: true, reject: false, windowsHide: false }
    );
    this.process = process;

    this.emitState({ status: 'running' });
    process.then((result) => {
      if (this.disposed) {
        return;
      }
      this.process = undefined;
      if (result.exitCode === 0) {
        this.emitState({ status: 'stopped' });
        return;
      }
      const output = (result.all ?? result.stdout ?? result.stderr ?? '').toString();
      this.emitState({ status: 'error', error: this.formatError(output) });
    }).catch((error: unknown) => {
      if (this.disposed) {
        return;
      }
      this.process = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.emitState({ status: 'error', error: this.formatError(message) });
    });
  }

  public stop(emitStopped = true): void {
    this.disposed = true;
    this.serial = undefined;

    if (this.process) {
      this.process.kill('SIGTERM', { forceKillAfterTimeout: 2000 });
      this.process = undefined;
    }

    if (emitStopped) {
      this.emitState({ status: 'stopped' });
    }
  }

  private formatError(message: string): string {
    if (message.includes('scrcpy')) {
      return message;
    }

    if (message.includes('ENOENT') || message.includes('not found')) {
      return 'adb or scrcpy executable not found. Check androidWirelessDebugging.adbPath and androidWirelessDebugging.scrcpyPath.';
    }

    if (message.includes('device') || message.includes('offline')) {
      return 'Device not available. Check wireless debugging and try again.';
    }

    return message;
  }

  private async resolveUsableSerial(serial: string | undefined): Promise<string | undefined> {
    if (!this.adb) {
      return serial;
    }

    try {
      const output = await this.adb.listDevices();
      const devices = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('List of devices attached'))
        .map((line) => line.split(/\s+/))
        .filter((parts) => parts.length > 1 && parts[1] === 'device')
        .map((parts) => parts[0]);

      if (serial && devices.includes(serial)) {
        return serial;
      }

      const tcpDevices = devices.filter((value) => value.includes(':'));
      if (tcpDevices.length === 1) {
        return tcpDevices[0];
      }

      if (devices.length === 1) {
        return devices[0];
      }
    } catch {
      return serial;
    }

    return serial;
  }

  private emitState(state: BridgeStateChange): void {
    this.stateEmitter.fire(state);
  }

  public dispose(): void {
    this.stop();
    this.stateEmitter.dispose();
    this.frameEmitter.dispose();
  }
}
