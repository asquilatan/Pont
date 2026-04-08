import type { DeviceSessionSnapshot } from '../types';

export interface StatusViewModel {
  title: string;
  body: string;
  tone: 'neutral' | 'warning' | 'success' | 'error';
  primaryActionLabel: string;
  secondaryActionLabel: string;
  showSecondaryAction: boolean;
}

export function getStatusViewModel(snapshot: DeviceSessionSnapshot): StatusViewModel {
  switch (snapshot.state) {
    case 'pairing':
      return {
        title: 'Pairing',
        body: snapshot.message || 'Pairing Android device...',
        tone: 'warning',
        primaryActionLabel: 'Pair Device',
        secondaryActionLabel: 'Open Pont Viewer',
        showSecondaryAction: true,
      };
    case 'connected':
      return {
        title: 'Connected',
        body: snapshot.message || 'Android device connected.',
        tone: 'success',
        primaryActionLabel: 'Pair Device',
        secondaryActionLabel: 'Open Pont Viewer',
        showSecondaryAction: true,
      };
    case 'failed':
      return {
        title: 'Failed',
        body: snapshot.message || 'Pairing failed. Check the device and try again.',
        tone: 'error',
        primaryActionLabel: 'Pair Device',
        secondaryActionLabel: 'Open Pont Viewer',
        showSecondaryAction: true,
      };
    case 'disconnected':
    default:
      return {
        title: 'Disconnected',
        body: snapshot.message || 'No Android device connected.',
        tone: 'neutral',
        primaryActionLabel: 'Pair Device',
        secondaryActionLabel: 'Open Pont Viewer',
        showSecondaryAction: true,
      };
  }
}
