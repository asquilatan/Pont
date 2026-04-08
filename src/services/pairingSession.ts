import * as vscode from 'vscode';
import type { ConnectionState, DeviceSessionSnapshot, PairingTarget } from '../types';

const defaultSnapshot = (): DeviceSessionSnapshot => ({
  state: 'disconnected',
  message: 'No Android device connected.',
  updatedAt: Date.now(),
});

export class PairingSession implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<DeviceSessionSnapshot>();
  private snapshot: DeviceSessionSnapshot = defaultSnapshot();

  public readonly onDidChange = this.emitter.event;

  public get current(): DeviceSessionSnapshot {
    return this.snapshot;
  }

  public beginPairing(target: PairingTarget): void {
    this.update({
      state: 'pairing',
      message: `Pairing ${target.host}:${target.port}...`,
      target,
      serial: undefined,
    });
  }

  public setConnected(serial: string, message = 'Android device connected.'): void {
    this.update({
      state: 'connected',
      message,
      serial,
    });
  }

  public setDisconnected(message = 'Android device disconnected.'): void {
    this.update({
      state: 'disconnected',
      message,
      serial: undefined,
    });
  }

  public setFailed(message: string): void {
    this.update({
      state: 'failed',
      message,
    });
  }

  public setMessage(message: string): void {
    this.update({ message });
  }

  public reset(): void {
    this.snapshot = defaultSnapshot();
    this.emitter.fire(this.snapshot);
  }

  public isState(state: ConnectionState): boolean {
    return this.snapshot.state === state;
  }

  public dispose(): void {
    this.emitter.dispose();
  }

  private update(patch: Partial<DeviceSessionSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      updatedAt: Date.now(),
    };
    this.emitter.fire(this.snapshot);
  }
}
