import * as vscode from 'vscode';
import type { ViewerPanel } from '../ui/viewerPanel';
import type { ViewerInputMessage } from '../ui/viewerPanel';
import type { DeviceSessionSnapshot } from '../types';
import type { ScrcpyBridge } from './scrcpyBridge';
import { ScrcpyLaunchError } from './scrcpyBridge';
import { AdbBridge } from './adbBridge';

/**
 * Manages the lifecycle of a single active mirror session.
 *
 * The mirror session coordinates the device connection state with the
 * scrcpy helper process. It ensures:
 * - Mirror starts only when a device is connected
 * - Mirror stops when the viewer closes or device disconnects
 * - Panel state reflects the mirror state
 *
 * v1 constraint: single active session at a time.
 */
export class MirrorSession implements vscode.Disposable {
  private bridge: ScrcpyBridge | undefined;
  private panel: ViewerPanel | undefined;
  private currentSerial: string | undefined;
  private disposables: vscode.Disposable[] = [];
  private operationQueue: Promise<void> = Promise.resolve();
  private readonly maxStartAttempts = 2;
  private readonly transientRetryDelayMs = 600;
  private adb: AdbBridge | undefined;
  private displaySizeCache:
    | { serial: string; width: number; height: number; capturedAt: number }
    | undefined;
  private readonly displaySizeCacheTtlMs = 10000;

  constructor(
    private readonly bridgeFactory: () => ScrcpyBridge,
    private readonly context: vscode.ExtensionContext
  ) {}

  /**
   * Attaches a viewer panel to this mirror session.
   *
   * The panel can be attached before a device is connected so the session
   * can start automatically when the connection becomes available.
   */
  public attachViewer(panel: ViewerPanel): void {
    this.panel = panel;
    panel.onInput((input) => this.handleViewerInput(input));
  }

  /**
   * Starts the mirror session for the given device.
   *
   * @param snapshot - Current device session snapshot
   * @param panel - The viewer panel to update
   */
  public async start(snapshot: DeviceSessionSnapshot, panel: ViewerPanel): Promise<void> {
    await this.runExclusive(async () => {
      await this.startInternal(snapshot, panel, { reason: 'start' });
    });
  }

  /**
   * Relaunches the active mirror session deterministically.
   *
   * This path is used by Open Viewer to guarantee stop -> start behavior
   * with current scrcpy placement settings while preserving single-session
   * semantics.
   */
  public async relaunch(snapshot: DeviceSessionSnapshot, panel: ViewerPanel): Promise<void> {
    await this.runExclusive(async () => {
      await this.stopInternal(false);
      await this.startInternal(snapshot, panel, { reason: 'relaunch' });
    });
  }

  private async startInternal(
    snapshot: DeviceSessionSnapshot,
    panel: ViewerPanel,
    options: { reason: 'start' | 'relaunch' | 'device-change' }
  ): Promise<void> {
    // Validate device is connected
    if (snapshot.state !== 'connected' || !snapshot.serial) {
      throw new Error('Cannot start mirror: no device connected');
    }

    // Stop any existing session first
    await this.stopInternal(false);

    this.panel = panel;
    this.currentSerial = snapshot.serial;

    try {
      await this.startWithRetry(snapshot.serial, options.reason);
      this.updatePanelState('connected', undefined);
    } catch (error) {
      const message = this.formatStartErrorMessage(error);
      this.clearBridgeState();
      this.updatePanelState('error', message);
      throw new Error(message);
    }
  }

  /**
   * Stops the active mirror session.
   *
   * @param detachViewer - When true, clears the attached viewer panel reference.
   */
  public async stop(detachViewer = true): Promise<void> {
    await this.runExclusive(async () => {
      await this.stopInternal(detachViewer);
    });
  }

  private async stopInternal(detachViewer = true): Promise<void> {
    if (this.bridge) {
      await this.bridge.stop(false);
      this.bridge.dispose();
      this.bridge = undefined;
    }

    this.currentSerial = undefined;
    this.displaySizeCache = undefined;
    
    // Clear disposables
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }

    // Update panel to disconnected state if panel still exists
    if (this.panel) {
      this.updatePanelState('disconnected', undefined);
      if (detachViewer) {
        this.panel = undefined;
      }
    }
  }

  /**
   * Handles device session changes.
   *
   * When the device disconnects, the mirror session must stop.
   *
   * @param snapshot - Updated device session snapshot
   */
  public async handleDeviceStateChange(snapshot: DeviceSessionSnapshot): Promise<void> {
    await this.runExclusive(async () => {
      // If device disconnected and we have an active session, stop it
      if (snapshot.state !== 'connected' && this.bridge) {
        await this.stopInternal(false);
      }

      if (snapshot.state === 'connected' && snapshot.serial && this.panel) {
        if (!this.bridge) {
          await this.startInternal(snapshot, this.panel, { reason: 'device-change' });
          return;
        }

        if (this.currentSerial && snapshot.serial !== this.currentSerial) {
          await this.stopInternal(false);
          await this.startInternal(snapshot, this.panel, { reason: 'device-change' });
        }
      }
    });
  }

  /**
   * Returns whether a mirror session is currently active.
   */
  public get isActive(): boolean {
    return this.bridge !== undefined;
  }

  /**
   * Handles bridge state changes and updates the panel accordingly.
   */
  private handleBridgeStateChange(state: {
    status: 'starting' | 'running' | 'stopped' | 'error';
    error?: string;
  }): void {
    switch (state.status) {
      case 'starting':
        this.updatePanelState('loading', undefined);
        break;
      case 'running':
        this.updatePanelState('connected', undefined);
        break;
      case 'stopped':
        this.clearBridgeState();
        this.updatePanelState('disconnected', undefined);
        break;
      case 'error':
        this.clearBridgeState();
        this.updatePanelState('error', state.error ?? 'Screen mirror failed');
        break;
    }
  }

  private clearBridgeState(): void {
    this.bridge = undefined;
    this.currentSerial = undefined;
    this.displaySizeCache = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  /**
   * Updates the viewer panel state.
   */
  private updatePanelState(
    viewerState: 'loading' | 'connected' | 'disconnected' | 'error',
    error?: string
  ): void {
    if (!this.panel) {
      return;
    }

    // Create a snapshot that reflects the mirror state
    const snapshot: DeviceSessionSnapshot = {
      state: this.mapViewerStateToConnectionState(viewerState),
      message: error ?? this.getDefaultMessage(viewerState),
      serial: this.currentSerial,
      updatedAt: Date.now()
    };

    this.panel.updateContent(snapshot);
  }

  /**
   * Maps viewer state to connection state for panel updates.
   */
  private mapViewerStateToConnectionState(
    viewerState: 'loading' | 'connected' | 'disconnected' | 'error'
  ): 'disconnected' | 'pairing' | 'connected' | 'failed' {
    switch (viewerState) {
      case 'loading':
        return 'pairing';
      case 'connected':
        return 'connected';
      case 'error':
        return 'failed';
      case 'disconnected':
      default:
        return 'disconnected';
    }
  }

  /**
   * Returns a default message for each viewer state.
   */
  private getDefaultMessage(viewerState: 'loading' | 'connected' | 'disconnected' | 'error'): string {
    switch (viewerState) {
      case 'loading':
        return 'Relaunching native scrcpy window...';
      case 'connected':
        return 'Native scrcpy control ready';
      case 'error':
        return 'Failed to start native scrcpy control';
      case 'disconnected':
      default:
        return 'Screen mirror disconnected';
    }
  }

  public dispose(): void {
    void this.stop();
  }

  public async handleViewerInput(input: ViewerInputMessage): Promise<void> {
    const serial = this.currentSerial;
    if (!serial || !this.bridge) {
      return;
    }

    if (input.type === 'tap') {
      const { width, height } = await this.getDisplaySize(serial);
      const x = Math.max(0, Math.min(width - 1, Math.round(width * input.xRatio)));
      const y = Math.max(0, Math.min(height - 1, Math.round(height * input.yRatio)));
      const adb = this.getAdb();
      await adb.inputTap(serial, x, y);
      return;
    }

    const adb = this.getAdb();
    const keyCode = this.mapKeyToAndroidCode(input.key, input.code);
    if (keyCode !== undefined) {
      await adb.inputKeyEvent(serial, keyCode);
      return;
    }

    const normalizedText = this.normalizeInputText(input.key);
    if (normalizedText.length > 0) {
      await adb.inputText(serial, normalizedText);
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const operationResult = this.operationQueue.then(operation, operation);
    this.operationQueue = operationResult.then(
      () => undefined,
      () => undefined
    );
    return operationResult;
  }

  private async startWithRetry(serial: string, reason: 'start' | 'relaunch' | 'device-change'): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxStartAttempts; attempt += 1) {
      this.currentSerial = serial;
      this.updatePanelState('loading', this.getLoadingMessage(reason, attempt));
      try {
        await this.startBridge(serial);
        return;
      } catch (error) {
        lastError = error;
        this.clearBridgeState();
        const canRetry = attempt < this.maxStartAttempts && this.shouldRetryStart(error);
        if (!canRetry) {
          break;
        }
        await this.delay(this.transientRetryDelayMs);
      }
    }

    throw lastError ?? new Error('Unknown mirror startup failure');
  }

  private async startBridge(serial: string): Promise<void> {
    this.bridge = this.bridgeFactory();
    this.disposables.push(
      this.bridge.onDidChangeState((state) => {
        this.handleBridgeStateChange(state);
      })
    );
    this.disposables.push(
      this.bridge.onDidFrameData((frame) => {
        if (this.panel) {
          this.panel.postFrameData(frame.dataUrl);
        }
      })
    );
    await this.bridge.start(serial);
  }

  private shouldRetryStart(error: unknown): boolean {
    if (error instanceof ScrcpyLaunchError) {
      return error.retryable;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('offline')
      || message.includes('temporarily unavailable')
      || message.includes('startup');
  }

  private formatStartErrorMessage(error: unknown): string {
    if (error instanceof ScrcpyLaunchError) {
      return error.message;
    }

    return error instanceof Error ? error.message : String(error);
  }

  private getLoadingMessage(reason: 'start' | 'relaunch' | 'device-change', attempt: number): string {
    if (reason === 'relaunch') {
      return attempt === 1
        ? 'Relaunching native scrcpy window...'
        : 'Retrying native scrcpy startup...';
    }

    if (reason === 'device-change') {
      return attempt === 1
        ? 'Switching native scrcpy to the active device...'
        : 'Retrying native scrcpy startup for the active device...';
    }

    return attempt === 1
      ? 'Starting native scrcpy control...'
      : 'Retrying native scrcpy startup...';
  }

  private async delay(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private getAdb(): AdbBridge {
    if (!this.adb) {
      const adbPath = vscode.workspace
        .getConfiguration('androidWirelessDebugging')
        .get<string>('adbPath') ?? 'adb';
      this.adb = new AdbBridge(adbPath);
    }
    return this.adb;
  }

  private async getDisplaySize(serial: string): Promise<{ width: number; height: number }> {
    if (
      this.displaySizeCache
      && this.displaySizeCache.serial === serial
      && Date.now() - this.displaySizeCache.capturedAt < this.displaySizeCacheTtlMs
    ) {
      return {
        width: this.displaySizeCache.width,
        height: this.displaySizeCache.height,
      };
    }

    const size = await this.getAdb().getDisplaySize(serial);
    this.displaySizeCache = {
      serial,
      width: size.width,
      height: size.height,
      capturedAt: Date.now(),
    };
    return size;
  }

  private mapKeyToAndroidCode(key: string, code?: string): number | undefined {
    const byCode = code ? this.keyCodeFromKeyboardCode[code] : undefined;
    if (typeof byCode === 'number') {
      return byCode;
    }

    return this.keyCodeFromKey[key];
  }

  private normalizeInputText(key: string): string {
    if (key.length !== 1) {
      return '';
    }

    if (key === ' ') {
      return '%s';
    }

    if (/^[a-zA-Z0-9]$/.test(key)) {
      return key;
    }

    return '';
  }

  private readonly keyCodeFromKey: Record<string, number> = {
    Enter: 66,
    Backspace: 67,
    Escape: 4,
    Tab: 61,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Delete: 112,
  };

  private readonly keyCodeFromKeyboardCode: Record<string, number> = {
    Enter: 66,
    NumpadEnter: 66,
    Backspace: 67,
    Escape: 4,
    Tab: 61,
    ArrowUp: 19,
    ArrowDown: 20,
    ArrowLeft: 21,
    ArrowRight: 22,
    Delete: 112,
  };
}
