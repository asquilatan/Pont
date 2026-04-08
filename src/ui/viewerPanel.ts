import * as vscode from 'vscode';
import type { DeviceSessionSnapshot } from '../types';

/**
 * Manages the device viewer webview panel lifecycle.
 *
 * The viewer panel is a singleton that can be revealed rather than
 * creating duplicate panels. It shows loading, disconnected, and error
 * states and accepts live frame data from the mirror session.
 */
export class ViewerPanel {
  private static instance: ViewerPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private onDisposeCallback?: () => void;

  private constructor(
    context: vscode.ExtensionContext,
    snapshot: DeviceSessionSnapshot
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'androidWirelessDebugging.viewer',
      'Android Device Viewer',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      }
    );

    this.panel.webview.html = this.getWebviewContent();
    this.updateContent(snapshot);

    this.panel.onDidDispose(() => this.cleanup(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message),
      null,
      this.disposables
    );

    context.subscriptions.push(this);
  }

  /**
   * Creates a new viewer panel or reveals the existing one.
   *
   * @param context - The extension context
   * @param snapshot - The current device session snapshot
   * @returns The viewer panel instance
   */
  public static createOrReveal(
    context: vscode.ExtensionContext,
    snapshot: DeviceSessionSnapshot
  ): ViewerPanel {
    if (ViewerPanel.instance) {
      ViewerPanel.instance.panel.reveal(vscode.ViewColumn.One);
      ViewerPanel.instance.updateContent(snapshot);
      return ViewerPanel.instance;
    }

    ViewerPanel.instance = new ViewerPanel(context, snapshot);
    return ViewerPanel.instance;
  }

  /**
   * Updates the viewer content based on the device session state.
   *
   * @param snapshot - The current device session snapshot
   */
  public updateContent(snapshot: DeviceSessionSnapshot): void {
    if (!this.panel) {
      return;
    }

    const state = this.mapSessionStateToViewerState(snapshot);
    void this.panel.webview.postMessage({
      type: 'state-update',
      state: state.viewerState,
      error: state.error
    });
  }

  public postFrameData(dataUrl: string): void {
    if (!this.panel) {
      return;
    }

    void this.panel.webview.postMessage({
      type: 'frame-data',
      dataUrl,
    });
  }

  /**
   * Sets a callback to be invoked when the panel is disposed.
   *
   * @param callback - Function to call on panel dispose
   */
  public onDispose(callback: () => void): void {
    this.onDisposeCallback = callback;
  }

  /**
   * Maps the device session state to viewer state.
   */
  private mapSessionStateToViewerState(snapshot: DeviceSessionSnapshot): {
    viewerState: 'loading' | 'connected' | 'disconnected' | 'error';
    error?: string;
  } {
    switch (snapshot.state) {
      case 'pairing':
        return { viewerState: 'loading' };
      case 'connected':
        return { viewerState: 'connected' };
      case 'failed':
        return { viewerState: 'error', error: snapshot.message };
      case 'disconnected':
      default:
        return { viewerState: 'disconnected' };
    }
  }

  /**
   * Handles messages from the webview.
   */
  private handleMessage(message: unknown): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    const msg = message as { type?: string };

    switch (msg.type) {
      // Future: handle viewer-specific messages (e.g., input events)
      default:
        break;
    }
  }

  /**
   * Returns the HTML content for the webview.
   */
  private getWebviewContent(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Android Device Viewer</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --panel: var(--vscode-sideBar-background);
      --text: var(--vscode-foreground);
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-button-background);
      --accent-text: var(--vscode-button-foreground);
      --border: var(--vscode-widget-border, transparent);
      --error: var(--vscode-errorForeground);
      --success: var(--vscode-testing-iconPassed, var(--vscode-terminal-ansiGreen));
      --warning: var(--vscode-editorWarning-foreground, var(--vscode-terminal-ansiYellow));
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family);
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .viewer-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }

    .viewer-canvas {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
      max-width: 100%;
      max-height: 100%;
      display: none;
    }

    .viewer-canvas.visible {
      display: block;
    }

    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      text-align: center;
      max-width: 480px;
    }

    .placeholder.hidden {
      display: none;
    }

    .placeholder-icon {
      font-size: 64px;
      opacity: 0.5;
    }

    .placeholder-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0;
    }

    .placeholder-body {
      font-size: 13px;
      line-height: 1.5;
      color: var(--muted);
      margin: 0;
    }

    .status-badge {
      padding: 6px 14px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid currentColor;
    }

    .tone-neutral { color: var(--muted); }
    .tone-warning { color: var(--warning); }
    .tone-success { color: var(--success); }
    .tone-error { color: var(--error); }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="viewer-container">
    <!-- Canvas for rendering the device screen (hidden by default) -->
    <canvas id="viewer-canvas" class="viewer-canvas"></canvas>

    <!-- Placeholder states -->
    <div id="placeholder-loading" class="placeholder hidden">
      <div class="loading-spinner"></div>
      <h2 class="placeholder-title">Connecting to device...</h2>
      <p class="placeholder-body">Setting up the screen viewer.</p>
    </div>

    <div id="placeholder-disconnected" class="placeholder">
      <div class="placeholder-icon">📱</div>
      <h2 class="placeholder-title">Android Device Viewer</h2>
      <p class="placeholder-body">
        No device connected. Pair a device using <strong>Android: Pair Device</strong> to view its screen here.
      </p>
      <span class="status-badge tone-neutral">Disconnected</span>
    </div>

    <div id="placeholder-error" class="placeholder hidden">
      <div class="placeholder-icon">⚠️</div>
      <h2 class="placeholder-title">Connection Error</h2>
      <p class="placeholder-body" id="error-message">Unable to connect to the device. Check the connection and try again.</p>
      <span class="status-badge tone-error">Error</span>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();

    const canvas = document.getElementById('viewer-canvas');
    const placeholderLoading = document.getElementById('placeholder-loading');
    const placeholderDisconnected = document.getElementById('placeholder-disconnected');
    const placeholderError = document.getElementById('placeholder-error');
    const errorMessage = document.getElementById('error-message');

    /**
     * Show a specific placeholder state.
     * @param {'loading' | 'disconnected' | 'error'} state
     * @param {string} [message] - Error message if state is 'error'
     */
    function showPlaceholder(state, message) {
      canvas.classList.remove('visible');
      placeholderLoading.classList.add('hidden');
      placeholderDisconnected.classList.add('hidden');
      placeholderError.classList.add('hidden');

      switch (state) {
        case 'loading':
          placeholderLoading.classList.remove('hidden');
          break;
        case 'disconnected':
          placeholderDisconnected.classList.remove('hidden');
          break;
        case 'error':
          if (message) {
            errorMessage.textContent = message;
          }
          placeholderError.classList.remove('hidden');
          break;
      }
    }

    /**
     * Show the canvas for rendering the device screen.
     */
    function showCanvas() {
      placeholderLoading.classList.add('hidden');
      placeholderDisconnected.classList.add('hidden');
      placeholderError.classList.add('hidden');
      canvas.classList.add('visible');
    }

    function renderFrame(dataUrl) {
      const image = new Image();
      image.onload = () => {
        const context = canvas.getContext('2d');
        if (!context) {
          return;
        }
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        showCanvas();
      };
      image.src = dataUrl;
    }

    // Handle messages from the extension
    window.addEventListener('message', (event) => {
      const message = event.data;

      switch (message.type) {
        case 'state-update':
          handleStateUpdate(message.state, message.error);
          break;
        case 'frame-data':
          if (message.dataUrl) {
            renderFrame(message.dataUrl);
          }
          break;
      }
    });

    /**
     * Handle state updates from the extension.
     * @param {'loading' | 'connected' | 'disconnected' | 'error'} state
     * @param {string} [error]
     */
    function handleStateUpdate(state, error) {
      switch (state) {
        case 'loading':
          showPlaceholder('loading');
          break;
        case 'connected':
          showCanvas();
          break;
        case 'disconnected':
          showPlaceholder('disconnected');
          break;
        case 'error':
          showPlaceholder('error', error);
          break;
      }
    }

    // Initialize with disconnected state
    showPlaceholder('disconnected');
  </script>
</body>
</html>`;
  }

  /**
   * Disposes the viewer panel and cleans up resources.
   */
  public dispose(): void {
    this.panel.dispose();
    this.cleanup();
  }

  private cleanup(): void {
    ViewerPanel.instance = undefined;
    
    // Invoke the dispose callback if set
    if (this.onDisposeCallback) {
      this.onDisposeCallback();
      this.onDisposeCallback = undefined;
    }
    
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}
