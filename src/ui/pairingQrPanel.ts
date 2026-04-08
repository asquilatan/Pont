import * as vscode from 'vscode';
import QRCode from 'qrcode';
import type { PairingTarget } from '../types';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function showPairingQrPanel(target: PairingTarget): Promise<void> {
  const payload = `android-wireless-debugging://pair?host=${target.host}&port=${target.port}&code=${target.code}`;
  const qrSvg = await QRCode.toString(payload, { type: 'svg' });

  const panel = vscode.window.createWebviewPanel(
    'androidWirelessDebugging.pairingQr',
    'Android Pair QR',
    vscode.ViewColumn.Beside,
    {
      enableScripts: false,
      retainContextWhenHidden: true,
    }
  );

  panel.webview.html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Android Pair QR</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      margin: 0;
      padding: 24px;
    }
    .shell {
      max-width: 480px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
      text-align: center;
    }
    .card {
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 8px;
      padding: 20px;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    svg {
      width: 256px;
      height: 256px;
      margin: 0 auto;
      display: block;
      background: white;
      padding: 12px;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card">
      <h1>Scan to pair</h1>
      <div>${qrSvg}</div>
      <p>Open Wireless debugging on your phone and scan this code.</p>
      <p class="meta">Endpoint: ${escapeHtml(target.host)}:${target.port}</p>
    </section>
  </main>
</body>
</html>`;
}
