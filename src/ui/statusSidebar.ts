import * as vscode from 'vscode';
import { getStatusViewModel } from '../services/sessionStatus';
import type { DeviceSessionSnapshot } from '../types';

interface StatusSidebarCallbacks {
  onPairRequested: () => Promise<void> | void;
  onOpenViewerRequested: () => Promise<void> | void;
  onDisconnectRequested: () => Promise<void> | void;
  onRunAppRequested: () => Promise<void> | void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class StatusSidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'androidWirelessDebugging.sidebar';

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getSnapshot: () => DeviceSessionSnapshot,
    private readonly callbacks: StatusSidebarCallbacks
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage(
      async (message: unknown) => {
        if (!message || typeof message !== 'object') {
          return;
        }
        const msg = message as { type?: string };
        switch (msg.type) {
          case 'pair-request':
            await this.callbacks.onPairRequested();
            break;
          case 'open-viewer-request':
            await this.callbacks.onOpenViewerRequested();
            break;
          case 'disconnect-request':
            await this.callbacks.onDisconnectRequested();
            break;
          case 'run-app-request':
            await this.callbacks.onRunAppRequested();
            break;
        }
      },
      undefined,
      this.disposables
    );

    this.update();
  }

  public update(): void {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.renderHtml(this.getSnapshot());
  }

  public dispose(): void {
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private renderHtml(snapshot: DeviceSessionSnapshot): string {
    const vm = getStatusViewModel(snapshot);
    const title = escapeHtml(vm.title);
    const body = escapeHtml(vm.body);
    const serial = escapeHtml(snapshot.serial ?? '-');
    const disconnectDisabled = snapshot.state !== 'connected' ? 'disabled' : '';
    const controlGuidance = snapshot.state === 'connected'
      ? 'Interaction runs in the native scrcpy window. Open Viewer relaunches and repositions it using your configured placement.'
      : 'Pair a device, then use Open Viewer to launch the native scrcpy control window.';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
    .card { border: 1px solid var(--vscode-widget-border, #444); border-radius: 8px; padding: 12px; display: grid; gap: 10px; }
    .title { font-size: 13px; font-weight: 700; }
    .meta { font-size: 12px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
    .actions { display: grid; gap: 8px; }
    button {
      border: 1px solid var(--vscode-widget-border, #444);
      border-radius: 6px;
      padding: 6px 8px;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      font: inherit;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }
    button:disabled { opacity: .5; cursor: not-allowed; }
  </style>
</head>
<body>
  <section class="card">
    <div class="title">${title}</div>
    <div class="meta">${body}</div>
    <div class="meta">Device: ${serial}</div>
    <div class="meta">${escapeHtml(controlGuidance)}</div>
    <div class="actions">
      <button class="primary" id="pair">Pair Device</button>
      <button id="viewer">Open Viewer (Relaunch scrcpy)</button>
      <button id="disconnect" ${disconnectDisabled}>Disconnect</button>
      <button id="run-app" ${disconnectDisabled}>Run App</button>
    </div>
  </section>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('pair').addEventListener('click', () => vscode.postMessage({ type: 'pair-request' }));
    document.getElementById('viewer').addEventListener('click', () => vscode.postMessage({ type: 'open-viewer-request' }));
    document.getElementById('disconnect').addEventListener('click', () => vscode.postMessage({ type: 'disconnect-request' }));
    document.getElementById('run-app').addEventListener('click', () => vscode.postMessage({ type: 'run-app-request' }));
  </script>
</body>
</html>`;
  }
}
