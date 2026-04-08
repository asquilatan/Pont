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
  private timer: NodeJS.Timeout | undefined;
  private disposed = false;
  private serial: string | undefined;
  private adb: AdbBridge | undefined;

  public readonly onDidChangeState = this.stateEmitter.event;
  public readonly onDidFrameData = this.frameEmitter.event;

  public async start(serial: string): Promise<void> {
    if (this.timer) {
      throw new Error('Mirror process is already running');
    }

    this.emitState({ status: 'starting' });
    this.serial = serial;
    this.disposed = false;

    // Validate scrcpy availability so the user gets a clear setup error.
    await resolveScrcpyPath();

    const adbPath = vscode.workspace.getConfiguration('androidWirelessDebugging').get<string>('adbPath') ?? 'adb';
    this.adb = new AdbBridge(adbPath);

    this.emitState({ status: 'running' });
    void this.captureLoop();
  }

  public stop(emitStopped = true): void {
    this.disposed = true;
    this.serial = undefined;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    if (emitStopped) {
      this.emitState({ status: 'stopped' });
    }
  }

  private async captureLoop(): Promise<void> {
    if (this.disposed || !this.serial || !this.adb) {
      return;
    }

    try {
      const screenshot = await this.adb.captureScreenshot(this.serial);
      if (this.disposed) {
        return;
      }
      const dataUrl = `data:image/png;base64,${Buffer.from(screenshot).toString('base64')}`;
      this.frameEmitter.fire({ dataUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitState({ status: 'error', error: this.formatError(message) });
      this.stop(false);
      return;
    }

    if (this.disposed) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.captureLoop();
    }, 800);
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

  private emitState(state: BridgeStateChange): void {
    this.stateEmitter.fire(state);
  }

  public dispose(): void {
    this.stop();
    this.stateEmitter.dispose();
    this.frameEmitter.dispose();
  }
}
