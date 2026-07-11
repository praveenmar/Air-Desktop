export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

export function getSharedStyles(): string {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 20px;
      margin: 0;
    }
    h2 { margin: 0 0 4px 0; font-size: 15px; }
    .subtitle { margin: 0 0 16px 0; font-size: 12px; opacity: 0.7; }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .toolbar .spacer { flex: 1 1 auto; }
    input[type="text"], select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 12px;
      outline: none;
      font-family: inherit;
    }
    input[type="text"] { min-width: 220px; }
    input[type="text"]::placeholder { color: var(--vscode-input-placeholderForeground); }
    button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 5px 12px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.danger {
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-foreground);
    }
    button.chip {
      background: transparent;
      border: 1px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
      opacity: 0.75;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11px;
    }
    button.chip.active {
      opacity: 1;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-color: transparent;
    }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: middle; }
    th { font-weight: 600; font-size: 11px; text-transform: uppercase; opacity: 0.65; letter-spacing: 0.03em; user-select: none; }
    th.sortable { cursor: pointer; }
    th.sortable:hover { opacity: 1; }
    th.checkbox-col, td.checkbox-col { width: 30px; }
    td.actions-col { white-space: nowrap; text-align: right; }
    td.actions-col button { margin-left: 6px; }
    .id-cell { display: flex; align-items: center; gap: 10px; }
    .id-text { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; word-break: break-all; }
    .copy-btn.copied { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .badge { padding: 2px 9px; border-radius: 10px; font-size: 11px; white-space: nowrap; }
    .badge.active { background: rgba(80,200,120,0.18); color: #4ec9b0; }
    .badge.ended { background: rgba(150,150,150,0.18); color: var(--vscode-descriptionForeground); }
    .badge.info { background: rgba(60,140,220,0.18); color: #6cb6ff; }
    .badge.warn { background: rgba(220,170,60,0.18); color: #e0af5a; }
    .badge.error { background: rgba(220,80,80,0.2); color: #f14c4c; }
    .empty, .error-state, .loading-state {
      opacity: 0.85;
      padding: 48px 0;
      text-align: center;
      font-size: 13px;
    }
    .error-state { color: var(--vscode-errorForeground, #f14c4c); }
    .error-state .error-detail { opacity: 0.75; font-size: 12px; margin-top: 6px; color: var(--vscode-foreground); }
    .loading-state .spinner, .spinner-inline {
      width: 22px; height: 22px; margin: 0 auto 12px auto;
      border: 2px solid var(--vscode-panel-border);
      border-top-color: var(--vscode-focusBorder, #3794ff);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .spinner-inline { width: 12px; height: 12px; margin: 0; display: inline-block; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .selection-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 12px;
      opacity: 0.9;
    }
    tr.selected-row { background: var(--vscode-list-inactiveSelectionBackground); }

    .tab-bar {
      display: flex;
      gap: 2px;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin-bottom: 14px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--vscode-foreground);
      opacity: 0.65;
      padding: 8px 14px;
      font-size: 12px;
      border-radius: 0;
      cursor: pointer;
    }
    .tab-btn:hover { opacity: 0.9; background: transparent; }
    .tab-btn.active {
      opacity: 1;
      border-bottom-color: var(--vscode-focusBorder, #3794ff);
      font-weight: 600;
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    .panel-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px 14px;
      margin-bottom: 14px;
      background: var(--vscode-editorWidget-background, transparent);
    }
    .panel-card h3 {
      margin: 0 0 10px 0;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      opacity: 0.7;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 14px;
      font-size: 12px;
    }
    .kv-grid .k { opacity: 0.65; }
    .kv-grid .v { font-family: var(--vscode-editor-font-family, monospace); word-break: break-all; }

    pre.code-block, .json-view {
      background: var(--vscode-textCodeBlock-background, rgba(127,127,127,0.1));
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 10px 12px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 420px;
      overflow: auto;
      margin: 0;
    }
    .log-line { display: flex; gap: 10px; padding: 4px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; }
    .log-line .ts { opacity: 0.55; white-space: nowrap; font-family: var(--vscode-editor-font-family, monospace); }
    .log-line .src { flex-shrink: 0; }
    .log-line .msg { font-family: var(--vscode-editor-font-family, monospace); word-break: break-word; }
    .event-line { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px 10px; margin-bottom: 8px; }
    .event-line .event-head { display: flex; justify-content: space-between; font-size: 11px; opacity: 0.7; margin-bottom: 6px; }
    .list-item { padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); font-size: 12px; }
    .list-item:last-child { border-bottom: none; }
    .muted { opacity: 0.65; }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .status-line { font-size: 12px; padding: 6px 0; }
    .status-line.ok { color: #4ec9b0; }
    .status-line.fail { color: #f14c4c; }
  `;
}

export function renderDocumentShell(title: string, subtitle: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>${getSharedStyles()}</style>
</head>
<body>
  <h2>${escapeHtml(title)}</h2>
  <p class="subtitle">${escapeHtml(subtitle)}</p>
  ${bodyHtml}
</body>
</html>`;
}

export function renderTabBar(tabs: Array<{ id: string; label: string }>, activeTab: string): string {
  return `
    <div class="tab-bar" id="tabBar">
      ${tabs
        .map(
          (t) =>
            `<button class="tab-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}">${escapeHtml(t.label)}</button>`,
        )
        .join('')}
    </div>
  `;
}

export function renderTabScript(defaultTab: string): string {
  return `
    (function() {
      function activateTab(tabId) {
        document.querySelectorAll('.tab-btn').forEach((btn) => {
          btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
        });
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.classList.toggle('active', panel.getAttribute('data-tab-panel') === tabId);
        });
        window.__airActiveTab = tabId;
        if (typeof window.__airOnTabActivated === 'function') {
          window.__airOnTabActivated(tabId);
        }
      }
      document.querySelectorAll('.tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
      });
      activateTab(${JSON.stringify(defaultTab)});
    })();
  `;
}
