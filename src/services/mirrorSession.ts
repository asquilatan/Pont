import * as vscode from 'vscode';
import type { ViewerPanel } from '../ui/viewerPanel';
import type { DeviceSessionSnapshot } from '../types';
import type { ScrcpyBridge } from './scrcpyBridge';

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
  }

  /**
   * Starts the mirror session for the given device.
   *
   * @param snapshot - Current device session snapshot
   * @param panel - The viewer panel to update
   */
  public async start(snapshot: DeviceSessionSnapshot, panel: ViewerPanel): Promise<void> {
    // Validate device is connected
    if (snapshot.state !== 'connected' || !snapshot.serial) {
      throw new Error('Cannot start mirror: no device connected');
    }

    // Stop any existing session first
    await this.stop(false);

    this.panel = panel;
    this.currentSerial = snapshot.serial;

    try {
      // Update panel to loading state
      this.updatePanelState('loading', undefined);

      // Create and start the bridge
      this.bridge = this.bridgeFactory();
      
      // Listen for bridge state changes
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

      // Start the scrcpy process
      await this.bridge.start(snapshot.serial);

      // Update panel to connected state
      this.updatePanelState('connected', undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.bridge?.stop(false);
      this.bridge = undefined;
      this.currentSerial = undefined;
      while (this.disposables.length > 0) {
        this.disposables.pop()?.dispose();
      }
      this.updatePanelState('error', message);
      
      throw error;
    }
  }

  /**
   * Stops the active mirror session.
   *
   * @param detachViewer - When true, clears the attached viewer panel reference.
   */
  public async stop(detachViewer = true): Promise<void> {
    if (this.bridge) {
      this.bridge.dispose();
      this.bridge = undefined;
    }

    this.currentSerial = undefined;
    
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
    // If device disconnected and we have an active session, stop it
    if (snapshot.state !== 'connected' && this.bridge) {
      await this.stop(false);
    }

    if (snapshot.state === 'connected' && snapshot.serial && this.panel) {
      if (!this.bridge) {
        await this.start(snapshot, this.panel);
        return;
      }

      if (this.currentSerial && snapshot.serial !== this.currentSerial) {
        await this.stop(false);
        await this.start(snapshot, this.panel);
      }
    }
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
        this.updatePanelState('disconnected', undefined);
        break;
      case 'error':
        this.updatePanelState('error', state.error);
        break;
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
        return 'Starting screen mirror...';
      case 'connected':
        return 'Screen mirror active';
      case 'error':
        return 'Screen mirror failed';
      case 'disconnected':
      default:
        return 'Screen mirror disconnected';
    }
  }

  public dispose(): void {
    void this.stop();
  }
}
