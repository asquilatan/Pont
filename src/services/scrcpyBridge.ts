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

export type ScrcpyLaunchErrorCode =
  | 'missing_dependency'
  | 'device_unavailable'
  | 'startup_exit'
  | 'unknown';

export class ScrcpyLaunchError extends Error {
  constructor(
    message: string,
    public readonly code: ScrcpyLaunchErrorCode,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ScrcpyLaunchError';
  }
}

export class ScrcpyBridge implements vscode.Disposable {
  private readonly stateEmitter = new vscode.EventEmitter<BridgeStateChange>();
  private readonly frameEmitter = new vscode.EventEmitter<BridgeFrameData>();
  private disposed = false;
  private serial: string | undefined;
  private adb: AdbBridge | undefined;
  private process: any;
  private readonly startupHealthCheckMs = 1200;
  private readonly stopWaitMs = 900;
  private frameLoopGeneration = 0;
  private frameIntervalMs = 300;

  public readonly onDidChangeState = this.stateEmitter.event;
  public readonly onDidFrameData = this.frameEmitter.event;

  public async start(serial: string): Promise<void> {
    if (this.process) {
      throw new Error('Mirror process is already running');
    }

    this.emitState({ status: 'starting' });
    this.serial = serial;
    this.disposed = false;

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
    this.frameIntervalMs = Math.max(150, config.get<number>('frameIntervalMs') ?? 300);
    const windowX = config.get<number>('scrcpyWindowX');
    const windowY = config.get<number>('scrcpyWindowY');
    const windowWidth = config.get<number>('scrcpyWindowWidth');
    const windowHeight = config.get<number>('scrcpyWindowHeight');
    const alwaysOnTop = config.get<boolean>('scrcpyAlwaysOnTop') ?? true;
    const args = ['-s', activeSerial, '--no-audio', '--no-window'];
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
    let startupSettled = false;

    process.then((result) => {
      if (this.disposed) {
        return;
      }
      this.process = undefined;
      if (result.exitCode === 0) {
        if (!startupSettled) {
          return;
        }
        this.emitState({ status: 'stopped' });
        return;
      }
      const output = (result.all ?? result.stdout ?? result.stderr ?? '').toString();
      const launchError = this.mapLaunchError(output);
      if (!startupSettled) {
        return;
      }
      this.emitState({ status: 'error', error: launchError.message });
    }).catch((error: unknown) => {
      if (this.disposed) {
        return;
      }
      this.process = undefined;
      const message = error instanceof Error ? error.message : String(error);
      const launchError = this.mapLaunchError(message);
      if (!startupSettled) {
        return;
      }
      this.emitState({ status: 'error', error: launchError.message });
    });

    try {
      const startupHealth = await this.awaitStartupHealth(process);
      startupSettled = true;
      if (startupHealth === 'disposed' || this.disposed) {
        return;
      }
      await this.captureAndEmitFrame(activeSerial);
      this.emitState({ status: 'running' });
      this.startFrameLoop(activeSerial);
    } catch (error) {
      startupSettled = true;
      this.process = undefined;
      const launchError = this.toLaunchError(error);
      this.emitState({ status: 'error', error: launchError.message });
      throw launchError;
    }
  }

  public async stop(emitStopped = true): Promise<void> {
    this.disposed = true;
    this.frameLoopGeneration += 1;
    this.serial = undefined;

    if (this.process) {
      const activeProcess = this.process;
      let exited = false;
      const exitPromise = activeProcess
        .then(() => {
          exited = true;
        })
        .catch(() => {
          exited = true;
        });
      activeProcess.kill('SIGTERM');
      await Promise.race([
        exitPromise,
        this.delay(this.stopWaitMs),
      ]);
      if (!exited) {
        activeProcess.kill('SIGKILL');
        await Promise.race([
          exitPromise,
          this.delay(this.stopWaitMs),
        ]);
      }
      this.process = undefined;
    }

    if (emitStopped) {
      this.emitState({ status: 'stopped' });
    }
  }

  private async awaitStartupHealth(process: any): Promise<'running' | 'disposed'> {
    const startupTimer = new Promise<'running'>((resolve) => {
      setTimeout(() => resolve('running'), this.startupHealthCheckMs);
    });
    const earlyExit = process.then((result: any) => {
      if (this.disposed) {
        return 'disposed';
      }
      const output = (result.all ?? result.stdout ?? result.stderr ?? '').toString();
      throw this.mapLaunchError(output || 'scrcpy exited before becoming interactive');
    }).catch((error: unknown) => {
      if (this.disposed) {
        return 'disposed';
      }
      const message = error instanceof Error ? error.message : String(error);
      throw this.mapLaunchError(message);
    });

    return Promise.race([startupTimer, earlyExit]);
  }

  private toLaunchError(error: unknown): ScrcpyLaunchError {
    if (error instanceof ScrcpyLaunchError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    return this.mapLaunchError(message);
  }

  private mapLaunchError(message: string): ScrcpyLaunchError {
    const lower = message.toLowerCase();

    if (
      lower.includes('enoent')
      || lower.includes('not found')
      || lower.includes('cannot find')
      || lower.includes('is not recognized')
    ) {
      return new ScrcpyLaunchError(
        'adb or scrcpy executable not found. Check androidWirelessDebugging.adbPath and androidWirelessDebugging.scrcpyPath.',
        'missing_dependency',
        false
      );
    }

    if (
      lower.includes('offline')
      || lower.includes('device not found')
      || lower.includes('no devices/emulators found')
      || lower.includes('device') && lower.includes('unavailable')
      || lower.includes('connection reset')
      || lower.includes('closed')
    ) {
      return new ScrcpyLaunchError(
        'Device is temporarily unavailable. Ensure wireless debugging is on and run Open Viewer again.',
        'device_unavailable',
        true
      );
    }

    if (lower.includes('exited') || lower.includes('terminated')) {
      return new ScrcpyLaunchError(
        'scrcpy exited during startup. Verify the device connection, then relaunch Open Viewer.',
        'startup_exit',
        true
      );
    }

    return new ScrcpyLaunchError(message, 'unknown', false);
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

  private startFrameLoop(serial: string): void {
    const generation = this.frameLoopGeneration + 1;
    this.frameLoopGeneration = generation;
    void this.runFrameLoop(generation, serial);
  }

  private async runFrameLoop(generation: number, serial: string): Promise<void> {
    while (
      generation === this.frameLoopGeneration
      && !this.disposed
      && this.process
      && this.serial === serial
    ) {
      try {
        await this.captureAndEmitFrame(serial);
      } catch (error) {
        const launchError = this.toLaunchError(error);
        this.emitState({ status: 'error', error: launchError.message });
        return;
      }
      await this.delay(this.frameIntervalMs);
    }
  }

  private async captureAndEmitFrame(serial: string): Promise<void> {
    if (!this.adb) {
      throw new Error('ADB bridge is not initialized for frame capture.');
    }
    const pngBuffer = await this.adb.captureScreenshot(serial);
    if (!this.looksLikePng(pngBuffer)) {
      throw new Error('Received malformed frame payload from device screenshot capture.');
    }
    this.frameEmitter.fire({
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
    });
  }

  private looksLikePng(buffer: Buffer): boolean {
    if (buffer.length < 8) {
      return false;
    }
    return (
      buffer[0] === 0x89
      && buffer[1] === 0x50
      && buffer[2] === 0x4E
      && buffer[3] === 0x47
      && buffer[4] === 0x0D
      && buffer[5] === 0x0A
      && buffer[6] === 0x1A
      && buffer[7] === 0x0A
    );
  }

  public dispose(): void {
    void this.stop();
    this.stateEmitter.dispose();
    this.frameEmitter.dispose();
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
