export type ConnectionState = 'disconnected' | 'pairing' | 'connected' | 'failed';

export type PairingMethod = 'pairing-code';

export interface PairingTarget {
  method: PairingMethod;
  host: string;
  port: number;
  code: string;
}

export interface DeviceSessionSnapshot {
  state: ConnectionState;
  message: string;
  target?: PairingTarget;
  serial?: string;
  updatedAt: number;
}
