import * as vscode from 'vscode';
import { ViewerPanel } from '../ui/viewerPanel';
import type { PairingSession } from '../services/pairingSession';
import type { MirrorSession } from '../services/mirrorSession';

interface OpenViewerDependencies {
  context: vscode.ExtensionContext;
  session: PairingSession;
  mirrorSession: MirrorSession;
}

/**
 * Opens or reveals the device viewer panel.
 *
 * The viewer panel is reusable: if it already exists, it will be revealed
 * rather than creating a duplicate panel.
 *
 * When a device is connected, this command starts the mirror session.
 *
 * @param deps - Dependencies required to open the viewer
 */
export async function openViewerCommand(deps: OpenViewerDependencies): Promise<void> {
  const snapshot = deps.session.current;

  // Create or reveal the viewer panel
  const panel = ViewerPanel.createOrReveal(deps.context, snapshot);
  deps.mirrorSession.attachViewer(panel);

  // Set up cleanup callback to stop mirror when panel closes
  panel.onDispose(() => {
    void deps.mirrorSession.stop();
  });

  // If no device is connected, show informational message
  if (snapshot.state !== 'connected') {
    void vscode.window.showInformationMessage(
      'No device connected. Pair a device first using "Android: Pair Device".'
    );
    return;
  }

  // Start the mirror session for the connected device
  try {
    // Force deterministic relaunch/reposition each time Open Viewer is invoked.
    await deps.mirrorSession.stop(false);
    await deps.mirrorSession.start(snapshot, panel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(
      `Failed to start screen mirror: ${message}`
    );
  }
}
