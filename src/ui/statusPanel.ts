import * as vscode from 'vscode';
import { getStatusViewModel } from '../services/sessionStatus';
import type { DeviceSessionSnapshot } from '../types';

interface StatusPanelCallbacks {
  onPairRequested: () => Promise<void> | void;
  onOpenViewerRequested: () => void;
  onDisconnectRequested: () => Promise<void> | void;
  onResetRequested: () => Promise<void> | void;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class StatusPanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly panelDisposables: vscode.Disposable[] = [];

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getSnapshot: () => DeviceSessionSnapshot,
    private readonly callbacks: StatusPanelCallbacks
  ) {}

  public show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'androidWirelessDebugging.status',
      'Android Device',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => this.disposePanel(), null, this.panelDisposables);
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        if (!message || typeof message !== 'object') {
          return;
        }

        switch (message.type) {
          case 'pair-request':
            await this.callbacks.onPairRequested();
            return;
          case 'open-viewer-request':
            this.callbacks.onOpenViewerRequested();
            return;
          case 'disconnect-request':
            await this.callbacks.onDisconnectRequested();
            return;
          case 'refresh-request':
            this.update();
            return;
          case 'reset-request':
            await this.callbacks.onResetRequested();
            return;
        }
      },
      null,
      this.panelDisposables
    );

    this.panel.webview.html = this.renderHtml(this.getSnapshot());
  }

  public update(): void {
    if (!this.panel) {
      return;
    }

    this.panel.webview.html = this.renderHtml(this.getSnapshot());
  }

  public dispose(): void {
    this.panel?.dispose();
    this.disposePanel();
  }

  private disposePanel(): void {
    this.panel = undefined;
    while (this.panelDisposables.length > 0) {
      this.panelDisposables.pop()?.dispose();
    }
  }

  private renderHtml(snapshot: DeviceSessionSnapshot): string {
    const viewModel = getStatusViewModel(snapshot);
    const body = escapeHtml(viewModel.body);
    const title = escapeHtml(viewModel.title);
    const state = escapeHtml(snapshot.state);
    const serial = escapeHtml(snapshot.serial ?? '-');
    const disconnectDisabled = snapshot.state !== 'connected' ? 'disabled' : '';

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Android Device</title>
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

    body {
      margin: 0;
      padding: 24px;
      font-family: var(--vscode-font-family);
      background: var(--bg);
      color: var(--text);
    }

    .shell {
      max-width: 720px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }

    .status-card {
      border: 1px solid var(--border);
      background: var(--panel);
      border-radius: 8px;
      padding: 20px;
      display: grid;
      gap: 12px;
    }

    .status-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .status-title {
      font-size: 16px;
      font-weight: 600;
      margin: 0;
    }

    .status-badge {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid currentColor;
    }

    .tone-neutral { color: var(--muted); }
    .tone-warning { color: var(--warning); }
    .tone-success { color: var(--success); }
    .tone-error { color: var(--error); }

    .body {
      font-size: 13px;
      line-height: 1.5;
      color: var(--text);
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    button {
      appearance: none;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font: inherit;
      cursor: pointer;
      background: transparent;
      color: var(--text);
    }

    button.primary {
      background: var(--accent);
      color: var(--accent-text);
      border-color: transparent;
    }

    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    .meta {
      font-size: 12px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="status-card" aria-label="Connection status card">
      <div class="status-header">
        <h1 class="status-title">Android Device</h1>
        <span class="status-badge tone-${viewModel.tone}">${title}</span>
      </div>
      <div class="body">${body}</div>
      <div class="actions">
        <button class="primary" id="pair">Pair Android Device</button>
        <button id="viewer">Open Device Viewer</button>
        <button id="disconnect" ${disconnectDisabled}>Disconnect</button>
        <button id="reset">Reset Extension</button>
      </div>
      <div class="meta">Current state: ${state} · Device: ${serial}</div>
    </section>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('pair').addEventListener('click', () => vscode.postMessage({ type: 'pair-request' }));
    document.getElementById('viewer').addEventListener('click', () => vscode.postMessage({ type: 'open-viewer-request' }));
    document.getElementById('disconnect').addEventListener('click', () => vscode.postMessage({ type: 'disconnect-request' }));
    document.getElementById('reset').addEventListener('click', () => vscode.postMessage({ type: 'reset-request' }));
    window.addEventListener('message', (event) => {
      if (!event.data || event.data.type !== 'session-update') {
        return;
      }
      window.location.reload();
    });
  </script>
</body>
</html>`;
  }
}
