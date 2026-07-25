import * as vscode from 'vscode';
import * as fs from 'fs';
import { spawn } from 'child_process';
import {
  escapeHtml,
  safeJsonForScript,
  getSharedStyles,
  renderTabBar,
  renderTabScript,
} from './webview-shared';

export type DevConsoleTab = 'inspector' | 'events' | 'logs' | 'mcp';

export interface LogEntry {
  timestamp: number | string;
  source: 'extension' | 'server' | 'browser' | 'interceptor' | string;
  level?: string;
  message: string;
  data?: unknown;
}

export interface McpConfigVariant {
  label: string;
  command: string;
  args: string[];
  available: boolean;
  unavailableReason?: string;
}

export interface DevConsoleCallbacks {
  getBaseUrl: () => Promise<string>;
  onLog?: (message: string, data?: unknown) => void;
  onError?: (message: string, error: unknown) => void;
  getExtensionLogs: () => LogEntry[];
  clearExtensionLogs: () => void;
  getProductionMcpConfig: () => McpConfigVariant;
  getDevelopmentMcpConfig: () => McpConfigVariant;
}

interface SessionOption {
  id: string;
  startedAt: number | string;
  endedAt: number | string | null;
}

type WebviewInboundMessage =
  | { type: 'clipboardCopy'; text: string }
  | { type: 'inspector:selectSession'; sessionId: string }
  | { type: 'inspector:refreshSessions' }
  | { type: 'events:start' }
  | { type: 'events:pause' }
  | { type: 'events:resume' }
  | { type: 'events:clear' }
  | { type: 'events:refresh' }
  | { type: 'logs:refresh' }
  | { type: 'logs:clear' }
  | { type: 'logs:download'; content: string; filename: string }
  | { type: 'mcp:validate'; variant: 'production' | 'development' }
  | { type: 'mcp:testConnection'; variant: 'production' | 'development' };

const SCOPE = 'DevConsole';
const EVENTS_POLL_MS = 2000;
const EVENTS_LIMIT = 200;
const LOGS_LIMIT = 300;
const TEST_CONNECTION_TIMEOUT_MS = 4000;

function keyForEntry(entry: unknown, index: number): string {
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    if (typeof obj.id === 'string' || typeof obj.id === 'number') {
      return `id:${obj.id}`;
    }
    if (obj.timestamp !== undefined) {
      return `ts:${String(obj.timestamp)}:${index}`;
    }
  }
  try {
    return `json:${JSON.stringify(entry)}`;
  } catch {
    return `idx:${index}`;
  }
}

function classifyLogSource(entry: LogEntry): 'extension' | 'server' | 'browser' | 'interceptor' {
  if (entry.source === 'extension') return 'extension';
  const raw = String(entry.source || '').toLowerCase();
  if (raw.includes('browser')) return 'browser';
  if (raw.includes('intercept')) return 'interceptor';
  return 'server';
}

function renderInspectorTab(sessions: SessionOption[]): string {
  return `
    <div class="tab-panel active" data-tab-panel="inspector">
      <div class="toolbar">
        <select id="insp-session">
          <option value="">Select a session&hellip;</option>
          ${sessions
            .map(
              (s) =>
                `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} — ${
                  s.endedAt ? 'Ended' : 'Active'
                }</option>`,
            )
            .join('')}
        </select>
        <input type="text" id="insp-search" placeholder="Search snapshot&hellip;" />
        <div class="spacer"></div>
        <button id="insp-refresh-sessions">Refresh Sessions</button>
        <button id="insp-copy-json" class="primary">Copy JSON</button>
      </div>
      <div id="insp-status" class="muted" style="margin-bottom:10px;">No session selected.</div>
      <div id="insp-content" class="stack"></div>
    </div>
    <script>
      (function() {
        const vscode = window.__airVscode;
        let inspSnapshot = null;

        function fmtVal(v) {
          if (v === null || v === undefined) return String(v);
          if (typeof v === 'object') return JSON.stringify(v);
          return String(v);
        }

        function collectByKeyPattern(obj, pattern, path, out) {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            obj.forEach((item, i) => collectByKeyPattern(item, pattern, path + '[' + i + ']', out));
            return;
          }
          for (const key of Object.keys(obj)) {
            const val = obj[key];
            const nextPath = path ? path + '.' + key : key;
            if (pattern.test(key) && (typeof val === 'string' || typeof val === 'number')) {
              out.push({ path: nextPath, value: val });
            }
            if (val && typeof val === 'object') {
              collectByKeyPattern(val, pattern, nextPath, out);
            }
          }
        }

        function findTimelineEntries(snapshot) {
          const candidates = [];
          const arrays = ['interactionContexts', 'nodes', 'edges', 'outcomes', 'pendingActions', 'recentLogs'];
          arrays.forEach((key) => {
            const arr = snapshot[key];
            if (Array.isArray(arr)) {
              arr.forEach((item) => {
                const ts = item && (item.capturedAt || item.timestamp || item.occurredAt || item.createdAt);
                candidates.push({ group: key, ts: ts || null, item });
              });
            }
          });
          candidates.sort((a, b) => {
            if (a.ts && b.ts) return new Date(a.ts).getTime() - new Date(b.ts).getTime();
            if (a.ts) return -1;
            if (b.ts) return 1;
            return 0;
          });
          return candidates;
        }

        function renderMetadata(snapshot) {
          const rows = [];
          for (const key of Object.keys(snapshot)) {
            const val = snapshot[key];
            if (Array.isArray(val)) {
              rows.push('<div class="k">' + key + '</div><div class="v">' + val.length + ' item(s)</div>');
            } else if (val && typeof val === 'object') {
              rows.push('<div class="k">' + key + '</div><div class="v">' + fmtVal(val) + '</div>');
            } else {
              rows.push('<div class="k">' + key + '</div><div class="v">' + fmtVal(val) + '</div>');
            }
          }
          return '<div class="panel-card"><h3>Metadata</h3><div class="kv-grid">' + rows.join('') + '</div></div>';
        }

        function renderTimeline(entries, query) {
          const filtered = entries.filter((e) => {
            if (!query) return true;
            return JSON.stringify(e.item).toLowerCase().includes(query);
          });
          if (filtered.length === 0) {
            return '<div class="panel-card"><h3>Timeline</h3><div class="muted">No timeline entries.</div></div>';
          }
          const rowsHtml = filtered.map((e) => {
            const label = e.ts ? new Date(e.ts).toLocaleString() : 'n/a';
            return (
              '<div class="list-item">' +
                '<div class="row"><span class="badge info">' + e.group + '</span>' +
                '<span class="muted">' + label + '</span></div>' +
                '<div class="v" style="margin-top:4px;">' + escapeAttr(fmtVal(e.item)) + '</div>' +
              '</div>'
            );
          }).join('');
          return '<div class="panel-card"><h3>Timeline (' + filtered.length + ')</h3>' + rowsHtml + '</div>';
        }

        function renderSelectors(snapshot, query) {
          const out = [];
          collectByKeyPattern(snapshot, /xpath/i, '', out);
          collectByKeyPattern(snapshot, /selector/i, '', out);
          const filtered = out.filter((e) => !query || (e.path + ' ' + e.value).toLowerCase().includes(query));
          if (filtered.length === 0) {
            return '<div class="panel-card"><h3>XPath &amp; Selectors</h3><div class="muted">None found in this snapshot.</div></div>';
          }
          const rowsHtml = filtered.map((e, i) => {
            return (
              '<div class="list-item">' +
                '<div class="muted">' + escapeAttr(e.path) + '</div>' +
                '<div class="row" style="margin-top:4px;">' +
                  '<span class="v" style="flex:1;">' + escapeAttr(String(e.value)) + '</span>' +
                  '<button class="copy-selector-btn" data-value="' + escapeAttr(String(e.value)) + '">Copy</button>' +
                '</div>' +
              '</div>'
            );
          }).join('');
          return '<div class="panel-card"><h3>XPath &amp; Selectors (' + filtered.length + ')</h3>' + rowsHtml + '</div>';
        }

        function escapeAttr(s) {
          const div = document.createElement('div');
          div.textContent = s;
          return div.innerHTML;
        }

        function renderJsonView(snapshot, query) {
          let text = JSON.stringify(snapshot, null, 2);
          return (
            '<div class="panel-card"><h3>Raw JSON</h3><pre class="json-view" id="insp-json-pre">' +
            escapeAttr(text) +
            '</pre></div>'
          );
        }

        function renderAll() {
          const content = document.getElementById('insp-content');
          if (!inspSnapshot) {
            content.innerHTML = '';
            return;
          }
          const query = (document.getElementById('insp-search').value || '').trim().toLowerCase();
          const timeline = findTimelineEntries(inspSnapshot);
          content.innerHTML =
            renderMetadata(inspSnapshot) +
            renderTimeline(timeline, query) +
            renderSelectors(inspSnapshot, query) +
            renderJsonView(inspSnapshot, query);

          content.querySelectorAll('.copy-selector-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              vscode.postMessage({ type: 'clipboardCopy', text: btn.getAttribute('data-value') });
            });
          });
        }

        document.getElementById('insp-session').addEventListener('change', (e) => {
          const sessionId = e.target.value;
          const status = document.getElementById('insp-status');
          if (!sessionId) {
            inspSnapshot = null;
            document.getElementById('insp-content').innerHTML = '';
            status.textContent = 'No session selected.';
            return;
          }
          status.innerHTML = '<span class="spinner-inline"></span> Loading snapshot&hellip;';
          vscode.postMessage({ type: 'inspector:selectSession', sessionId });
        });

        document.getElementById('insp-search').addEventListener('input', renderAll);
        document.getElementById('insp-refresh-sessions').addEventListener('click', () => {
          vscode.postMessage({ type: 'inspector:refreshSessions' });
        });
        document.getElementById('insp-copy-json').addEventListener('click', () => {
          if (!inspSnapshot) return;
          vscode.postMessage({ type: 'clipboardCopy', text: JSON.stringify(inspSnapshot, null, 2) });
        });

        window.__airInspectorReceive = function(snapshot, error) {
          const status = document.getElementById('insp-status');
          if (error) {
            inspSnapshot = null;
            status.textContent = 'Failed to load: ' + error;
            document.getElementById('insp-content').innerHTML = '';
            return;
          }
          inspSnapshot = snapshot;
          status.textContent = 'Snapshot loaded.';
          renderAll();
        };

        window.__airInspectorSessionsReceive = function(sessions) {
          const select = document.getElementById('insp-session');
          const current = select.value;
          select.innerHTML = '<option value="">Select a session&hellip;</option>' + sessions.map((s) =>
            '<option value="' + s.id + '">' + s.id + ' — ' + (s.endedAt ? 'Ended' : 'Active') + '</option>'
          ).join('');
          if (sessions.some((s) => s.id === current)) {
            select.value = current;
          }
        };
      })();
    </script>
  `;
}

function renderEventsTab(): string {
  return `
    <div class="tab-panel" data-tab-panel="events">
      <div class="toolbar">
        <input type="text" id="ev-search" placeholder="Search events&hellip;" />
        <select id="ev-filter">
          <option value="all">All types</option>
        </select>
        <label class="row" style="font-size:12px;"><input type="checkbox" id="ev-autoscroll" checked /> Auto-scroll</label>
        <div class="spacer"></div>
        <button id="ev-pause">Pause</button>
        <button id="ev-clear">Clear</button>
      </div>
      <div id="ev-status" class="muted" style="margin-bottom:8px;">Streaming live events&hellip;</div>
      <div id="ev-list"></div>
      <div id="ev-empty" class="empty" style="display:none;">No events yet.</div>
    </div>
    <script>
      (function() {
        const vscode = window.__airVscode;
        let allEvents = [];
        let paused = false;
        let knownTypes = new Set(['all']);

        function fmtTs(v) {
          try { return new Date(v).toLocaleTimeString(); } catch { return String(v); }
        }

        function eventType(e) {
          return (e && (e.type || e.eventType || e.name)) || 'event';
        }

        function refreshTypeFilter() {
          const select = document.getElementById('ev-filter');
          const current = select.value;
          const types = new Set(['all']);
          allEvents.forEach((e) => types.add(eventType(e)));
          select.innerHTML = Array.from(types).map((t) =>
            '<option value="' + t + '">' + (t === 'all' ? 'All types' : t) + '</option>'
          ).join('');
          select.value = types.has(current) ? current : 'all';
        }

        function render() {
          const query = (document.getElementById('ev-search').value || '').trim().toLowerCase();
          const typeFilter = document.getElementById('ev-filter').value;
          const list = document.getElementById('ev-list');
          const empty = document.getElementById('ev-empty');

          const filtered = allEvents.filter((e) => {
            if (typeFilter !== 'all' && eventType(e) !== typeFilter) return false;
            if (!query) return true;
            return JSON.stringify(e).toLowerCase().includes(query);
          });

          if (filtered.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
          }
          empty.style.display = 'none';

          list.innerHTML = filtered.map((e) => {
            const ts = e && (e.timestamp || e.receivedAt || e.createdAt);
            const div = document.createElement('div');
            div.textContent = JSON.stringify(e, null, 2);
            return (
              '<div class="event-line">' +
                '<div class="event-head"><span class="badge info">' + eventType(e) + '</span>' +
                '<span>' + (ts ? fmtTs(ts) : '') + '</span></div>' +
                '<pre class="json-view" style="max-height:180px;">' + div.innerHTML + '</pre>' +
              '</div>'
            );
          }).join('');

          if (document.getElementById('ev-autoscroll').checked) {
            list.scrollTop = list.scrollHeight;
          }
        }

        document.getElementById('ev-search').addEventListener('input', render);
        document.getElementById('ev-filter').addEventListener('change', render);
        document.getElementById('ev-pause').addEventListener('click', () => {
          paused = !paused;
          document.getElementById('ev-pause').textContent = paused ? 'Resume' : 'Pause';
          document.getElementById('ev-status').textContent = paused ? 'Paused.' : 'Streaming live events…';
          vscode.postMessage({ type: paused ? 'events:pause' : 'events:resume' });
        });
        document.getElementById('ev-clear').addEventListener('click', () => {
          allEvents = [];
          render();
          vscode.postMessage({ type: 'events:clear' });
        });

        window.__airEventsReceive = function(events, replace) {
          if (replace) {
            allEvents = events.slice();
          } else {
            allEvents = allEvents.concat(events);
          }
          if (allEvents.length > 500) {
            allEvents = allEvents.slice(allEvents.length - 500);
          }
          refreshTypeFilter();
          render();
        };

        window.__airEventsError = function(message) {
          document.getElementById('ev-status').textContent = 'Error: ' + message;
        };

        vscode.postMessage({ type: 'events:start' });
      })();
    </script>
  `;
}

function renderLogsTab(initialLogs: LogEntry[]): string {
  return `
    <div class="tab-panel" data-tab-panel="logs">
      <div class="toolbar">
        <input type="text" id="log-search" placeholder="Search logs&hellip;" />
        <button class="chip active" data-source="all">All</button>
        <button class="chip" data-source="extension">Extension</button>
        <button class="chip" data-source="server">Server</button>
        <button class="chip" data-source="browser">Browser</button>
        <button class="chip" data-source="interceptor">Interceptor</button>
        <div class="spacer"></div>
        <button id="log-refresh">Refresh</button>
        <button id="log-download">Download</button>
        <button id="log-copy">Copy</button>
        <button class="danger" id="log-clear">Clear</button>
      </div>
      <div id="log-list"></div>
      <div id="log-empty" class="empty" style="display:none;">No log entries.</div>
    </div>
    <script>
      (function() {
        const vscode = window.__airVscode;
        let allLogs = ${safeJsonForScript(initialLogs)};
        let sourceFilter = 'all';

        function classify(entry) {
          if (entry.source === 'extension') return 'extension';
          const raw = String(entry.source || '').toLowerCase();
          if (raw.indexOf('browser') !== -1) return 'browser';
          if (raw.indexOf('intercept') !== -1) return 'interceptor';
          return 'server';
        }

        function fmtTs(v) {
          try { return new Date(v).toLocaleString(); } catch { return String(v); }
        }

        function getFiltered() {
          const query = (document.getElementById('log-search').value || '').trim().toLowerCase();
          return allLogs.filter((e) => {
            if (sourceFilter !== 'all' && classify(e) !== sourceFilter) return false;
            if (!query) return true;
            const hay = (e.message + ' ' + (e.level || '') + ' ' + JSON.stringify(e.data || '')).toLowerCase();
            return hay.includes(query);
          });
        }

        function render() {
          const filtered = getFiltered();
          const list = document.getElementById('log-list');
          const empty = document.getElementById('log-empty');
          if (filtered.length === 0) {
            list.innerHTML = '';
            empty.style.display = 'block';
            return;
          }
          empty.style.display = 'none';
          list.innerHTML = filtered.map((e) => {
            const div = document.createElement('div');
            div.textContent = e.message;
            const cls = classify(e);
            const dataStr = e.data !== undefined ? ' ' + JSON.stringify(e.data) : '';
            const dataDiv = document.createElement('div');
            dataDiv.textContent = dataStr;
            return (
              '<div class="log-line">' +
                '<span class="ts">' + fmtTs(e.timestamp) + '</span>' +
                '<span class="src badge ' + (cls === 'extension' ? 'info' : cls === 'interceptor' ? 'warn' : cls === 'browser' ? 'error' : '') + '">' + cls + '</span>' +
                '<span class="msg">' + div.innerHTML + dataDiv.innerHTML + '</span>' +
              '</div>'
            );
          }).join('');
        }

        document.querySelectorAll('.chip').forEach((btn) => {
          btn.addEventListener('click', () => {
            document.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            sourceFilter = btn.getAttribute('data-source');
            render();
          });
        });

        document.getElementById('log-search').addEventListener('input', render);
        document.getElementById('log-refresh').addEventListener('click', () => {
          vscode.postMessage({ type: 'logs:refresh' });
        });
        document.getElementById('log-clear').addEventListener('click', () => {
          vscode.postMessage({ type: 'logs:clear' });
        });
        document.getElementById('log-copy').addEventListener('click', () => {
          const text = getFiltered().map((e) => fmtTs(e.timestamp) + ' [' + classify(e) + '] ' + e.message + (e.data !== undefined ? ' ' + JSON.stringify(e.data) : '')).join('\\n');
          vscode.postMessage({ type: 'clipboardCopy', text });
        });
        document.getElementById('log-download').addEventListener('click', () => {
          const text = getFiltered().map((e) => fmtTs(e.timestamp) + ' [' + classify(e) + '] ' + e.message + (e.data !== undefined ? ' ' + JSON.stringify(e.data) : '')).join('\\n');
          vscode.postMessage({ type: 'logs:download', content: text, filename: 'air-logs-' + Date.now() + '.log' });
        });

        window.__airLogsReceive = function(logs) {
          allLogs = logs;
          render();
        };

        render();
      })();
    </script>
  `;
}

function renderMcpTab(production: McpConfigVariant, development: McpConfigVariant): string {
  return `
    <div class="tab-panel" data-tab-panel="mcp">
      <div class="toolbar">
        <select id="mcp-variant">
          <option value="production">Production (NPX)</option>
          <option value="development"${development.available ? '' : ' disabled'}>Development${development.available ? '' : ' (unavailable)'}</option>
        </select>
        <div class="spacer"></div>
        <button id="mcp-validate">Validate</button>
        <button id="mcp-test">Test Connection</button>
        <button id="mcp-copy" class="primary">Copy</button>
      </div>
      <div class="panel-card">
        <h3>Preview</h3>
        <pre class="json-view" id="mcp-preview"></pre>
      </div>
      <div id="mcp-validate-result"></div>
      <div id="mcp-test-result"></div>
    </div>
    <script>
      (function() {
        const vscode = window.__airVscode;
        const configs = {
          production: ${safeJsonForScript(production)},
          development: ${safeJsonForScript(development)},
        };

        function currentVariant() {
          return document.getElementById('mcp-variant').value;
        }

        function buildConfigObject(variant) {
          const c = configs[variant];
          return { 'air-desktop': { command: c.command, args: c.args } };
        }

        function renderPreview() {
          const variant = currentVariant();
          const c = configs[variant];
          document.getElementById('mcp-preview').textContent = c.available
            ? JSON.stringify(buildConfigObject(variant), null, 2)
            : 'Unavailable: ' + (c.unavailableReason || 'not available in this environment');
          document.getElementById('mcp-validate-result').innerHTML = '';
          document.getElementById('mcp-test-result').innerHTML = '';
        }

        document.getElementById('mcp-variant').addEventListener('change', renderPreview);

        document.getElementById('mcp-copy').addEventListener('click', () => {
          const variant = currentVariant();
          if (!configs[variant].available) return;
          vscode.postMessage({ type: 'clipboardCopy', text: JSON.stringify(buildConfigObject(variant), null, 2) });
        });

        document.getElementById('mcp-validate').addEventListener('click', () => {
          document.getElementById('mcp-validate-result').innerHTML = '<div class="status-line"><span class="spinner-inline"></span> Validating&hellip;</div>';
          vscode.postMessage({ type: 'mcp:validate', variant: currentVariant() });
        });

        document.getElementById('mcp-test').addEventListener('click', () => {
          document.getElementById('mcp-test-result').innerHTML = '<div class="status-line"><span class="spinner-inline"></span> Testing connection&hellip;</div>';
          vscode.postMessage({ type: 'mcp:testConnection', variant: currentVariant() });
        });

        window.__airMcpValidateResult = function(ok, messages) {
          const html = '<div class="status-line ' + (ok ? 'ok' : 'fail') + '">' +
            (ok ? 'Validation passed.' : 'Validation failed.') + '</div>' +
            messages.map((m) => '<div class="muted" style="margin-left:4px;">- ' + m + '</div>').join('');
          document.getElementById('mcp-validate-result').innerHTML = html;
        };

        window.__airMcpTestResult = function(ok, message) {
          document.getElementById('mcp-test-result').innerHTML =
            '<div class="status-line ' + (ok ? 'ok' : 'fail') + '">' + (ok ? 'Connection OK: ' : 'Connection failed: ') + message + '</div>';
        };

        renderPreview();
      })();
    </script>
  `;
}

function renderShellScript(defaultTab: DevConsoleTab): string {
  return `
    <script>
      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || typeof msg.type !== 'string') return;
        switch (msg.type) {
          case 'inspector:data':
            if (typeof window.__airInspectorReceive === 'function') window.__airInspectorReceive(msg.snapshot, null);
            break;
          case 'inspector:error':
            if (typeof window.__airInspectorReceive === 'function') window.__airInspectorReceive(null, msg.message);
            break;
          case 'inspector:sessions':
            if (typeof window.__airInspectorSessionsReceive === 'function') window.__airInspectorSessionsReceive(msg.sessions);
            break;
          case 'events:data':
            if (typeof window.__airEventsReceive === 'function') window.__airEventsReceive(msg.events, msg.replace);
            break;
          case 'events:error':
            if (typeof window.__airEventsError === 'function') window.__airEventsError(msg.message);
            break;
          case 'logs:data':
            if (typeof window.__airLogsReceive === 'function') window.__airLogsReceive(msg.logs);
            break;
          case 'mcp:validateResult':
            if (typeof window.__airMcpValidateResult === 'function') window.__airMcpValidateResult(msg.ok, msg.messages);
            break;
          case 'mcp:testResult':
            if (typeof window.__airMcpTestResult === 'function') window.__airMcpTestResult(msg.ok, msg.message);
            break;
          default:
            break;
        }
      });
    </script>
    <script>${renderTabScript(defaultTab)}</script>
  `;
}

function renderShell(tab: DevConsoleTab, parts: {
  inspector: string;
  events: string;
  logs: string;
  mcp: string;
}): string {
  const tabs = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'events', label: 'Events' },
    { id: 'logs', label: 'Logs' },
    { id: 'mcp', label: 'MCP' },
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>${getSharedStyles()}</style>
</head>
<body>
  <h2>AIR Developer Console</h2>
  <p class="subtitle">Inspect sessions, stream events, review logs, and manage MCP configuration.</p>
  <script>
    // Each tab's inline script captures this bridge during initialisation. It must
    // exist before those scripts run or a selection leaves the Inspector stuck on
    // its loading state after attempting to post its message.
    window.__airVscode = acquireVsCodeApi();
  </script>
  ${renderTabBar(tabs, tab)}
  ${parts.inspector}
  ${parts.events}
  ${parts.logs}
  ${parts.mcp}
  ${renderShellScript(tab)}
</body>
</html>`;
}

export class DevConsolePanel {
  private static instance: DevConsolePanel | null = null;

  private panel: vscode.WebviewPanel | null = null;
  private readonly callbacks: DevConsoleCallbacks;

  private eventsTimer: ReturnType<typeof setInterval> | null = null;
  private eventsPaused = false;
  private knownEventKeys = new Set<string>();

  private constructor(callbacks: DevConsoleCallbacks) {
    this.callbacks = callbacks;
  }

  static getInstance(callbacks: DevConsoleCallbacks): DevConsolePanel {
    if (!DevConsolePanel.instance) {
      DevConsolePanel.instance = new DevConsolePanel(callbacks);
    }
    return DevConsolePanel.instance;
  }

  async show(tab: DevConsoleTab = 'inspector'): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.postActivateTab(tab);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'airDevConsole',
      'AIR Developer Console',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
      void this.handleMessage(message);
    });

    this.panel.onDidDispose(() => {
      this.stopEventsPolling();
      this.panel = null;
    });

    let sessions: SessionOption[] = [];
    try {
      sessions = await this.fetchSessions();
    } catch (error) {
      this.reportError('Failed to load sessions for inspector', error);
    }

    const production = this.callbacks.getProductionMcpConfig();
    const development = this.callbacks.getDevelopmentMcpConfig();

    this.panel.webview.html = renderShell(tab, {
      inspector: renderInspectorTab(sessions),
      events: renderEventsTab(),
      logs: renderLogsTab(this.buildCombinedLogs([])),
      mcp: renderMcpTab(production, development),
    });

    this.startEventsPolling();
    void this.pushLogs();
  }

  dispose(): void {
    this.stopEventsPolling();
    this.panel?.dispose();
    this.panel = null;
  }

  private log(message: string, data?: unknown): void {
    this.callbacks.onLog?.(`[${SCOPE}] ${message}`, data);
  }

  private reportError(message: string, error: unknown): void {
    this.callbacks.onError?.(message, error);
  }

  private postMessage(message: unknown): void {
    void this.panel?.webview.postMessage(message);
  }

  private async postActivateTab(_tab: DevConsoleTab): Promise<void> {
    // Tab switching is handled client-side; nothing to push on reveal beyond a data refresh.
    await this.pushLogs();
  }

  private async fetchSessions(): Promise<SessionOption[]> {
    const baseUrl = await this.callbacks.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/sessions`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const sessions: SessionOption[] = await res.json();
    return Array.isArray(sessions) ? sessions : [];
  }

  private async handleMessage(message: WebviewInboundMessage): Promise<void> {
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'clipboardCopy':
        if (typeof message.text === 'string') {
          await vscode.env.clipboard.writeText(message.text);
          void vscode.window.setStatusBarMessage('AIR: Copied to clipboard', 2000);
        }
        break;

      case 'inspector:selectSession':
        await this.handleInspectSession(message.sessionId);
        break;

      case 'inspector:refreshSessions':
        await this.handleRefreshInspectorSessions();
        break;

      case 'events:start':
        this.eventsPaused = false;
        await this.pollEventsOnce(true);
        this.startEventsPolling();
        break;

      case 'events:pause':
        this.eventsPaused = true;
        this.stopEventsPolling();
        break;

      case 'events:resume':
        this.eventsPaused = false;
        this.startEventsPolling();
        break;

      case 'events:clear':
        this.knownEventKeys.clear();
        break;

      case 'events:refresh':
        await this.pollEventsOnce(true);
        break;

      case 'logs:refresh':
        await this.pushLogs();
        break;

      case 'logs:clear':
        this.callbacks.clearExtensionLogs();
        await this.pushLogs();
        break;

      case 'logs:download':
        if (typeof message.content === 'string') {
          await this.handleDownloadLogs(message.content, message.filename || 'air-logs.log');
        }
        break;

      case 'mcp:validate':
        await this.handleValidate(message.variant);
        break;

      case 'mcp:testConnection':
        await this.handleTestConnection(message.variant);
        break;

      default:
        break;
    }
  }

  private async handleInspectSession(sessionId: string): Promise<void> {
    try {
      const baseUrl = await this.callbacks.getBaseUrl();
      const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/inspect`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const snapshot = await res.json();
      this.postMessage({ type: 'inspector:data', snapshot });
    } catch (error) {
      this.reportError(`Failed to inspect session ${sessionId}`, error);
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({ type: 'inspector:error', message });
    }
  }

  private async handleRefreshInspectorSessions(): Promise<void> {
    try {
      const sessions = await this.fetchSessions();
      this.postMessage({ type: 'inspector:sessions', sessions });
    } catch (error) {
      this.reportError('Failed to refresh inspector session list', error);
    }
  }

  private startEventsPolling(): void {
    if (this.eventsTimer || this.eventsPaused) return;
    this.eventsTimer = setInterval(() => {
      void this.pollEventsOnce(false);
    }, EVENTS_POLL_MS);
  }

  private stopEventsPolling(): void {
    if (this.eventsTimer) {
      clearInterval(this.eventsTimer);
      this.eventsTimer = null;
    }
  }

  private async pollEventsOnce(replace: boolean): Promise<void> {
    if (!this.panel) return;
    try {
      const baseUrl = await this.callbacks.getBaseUrl();
      const res = await fetch(`${baseUrl}/api/debug/events?limit=${EVENTS_LIMIT}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      const events: unknown[] = Array.isArray(data) ? data : Array.isArray((data as any)?.events) ? (data as any).events : [];

      if (replace) {
        this.knownEventKeys.clear();
        events.forEach((e, i) => this.knownEventKeys.add(keyForEntry(e, i)));
        this.postMessage({ type: 'events:data', events, replace: true });
        return;
      }

      const fresh = events.filter((e, i) => {
        const key = keyForEntry(e, i);
        if (this.knownEventKeys.has(key)) return false;
        this.knownEventKeys.add(key);
        return true;
      });

      if (fresh.length > 0) {
        this.postMessage({ type: 'events:data', events: fresh, replace: false });
      }
    } catch (error) {
      this.reportError('Failed to poll debug events', error);
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({ type: 'events:error', message });
    }
  }

  private buildCombinedLogs(serverLogs: LogEntry[]): LogEntry[] {
    const extensionLogs = this.callbacks.getExtensionLogs();
    const combined = [...extensionLogs, ...serverLogs];
    combined.sort((a, b) => new Date(a.timestamp as any).getTime() - new Date(b.timestamp as any).getTime());
    return combined.slice(-LOGS_LIMIT);
  }

  private async pushLogs(): Promise<void> {
    if (!this.panel) return;
    let serverLogs: LogEntry[] = [];
    try {
      const baseUrl = await this.callbacks.getBaseUrl();
      const res = await fetch(`${baseUrl}/api/debug/logs?limit=${LOGS_LIMIT}`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          serverLogs = data.map((row: any) => ({
            timestamp: row.timestamp,
            source: row.component || 'server',
            level: row.level,
            message: row.message,
            data: row.data,
          }));
        }
      }
    } catch (error) {
      this.reportError('Failed to fetch server logs', error);
    }

    this.postMessage({ type: 'logs:data', logs: this.buildCombinedLogs(serverLogs) });
  }

  private async handleDownloadLogs(content: string, filename: string): Promise<void> {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(filename),
        filters: { 'Log files': ['log'], 'All files': ['*'] },
      });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      void vscode.window.showInformationMessage(`AIR: Logs saved to ${uri.fsPath}`);
    } catch (error) {
      this.reportError('Failed to download logs', error);
      void vscode.window.showErrorMessage('AIR: Failed to download logs');
    }
  }

  private getVariantConfig(variant: 'production' | 'development'): McpConfigVariant {
    return variant === 'production'
      ? this.callbacks.getProductionMcpConfig()
      : this.callbacks.getDevelopmentMcpConfig();
  }

  private async handleValidate(variant: 'production' | 'development'): Promise<void> {
    const config = this.getVariantConfig(variant);
    const messages: string[] = [];
    let ok = true;

    if (!config.available) {
      ok = false;
      messages.push(config.unavailableReason || 'Configuration unavailable in this environment.');
      this.postMessage({ type: 'mcp:validateResult', ok, messages });
      return;
    }

    if (!config.command || typeof config.command !== 'string') {
      ok = false;
      messages.push('Command is missing.');
    } else {
      messages.push(`Command resolved: ${config.command}`);
    }

    if (!Array.isArray(config.args)) {
      ok = false;
      messages.push('Args must be an array.');
    } else {
      messages.push(`Args: ${config.args.join(' ') || '(none)'}`);
    }

    if (config.command === 'node' && Array.isArray(config.args) && config.args[0]) {
      const scriptPath = config.args[0];
      if (!fs.existsSync(scriptPath)) {
        ok = false;
        messages.push(`Script not found on disk: ${scriptPath}`);
      } else {
        messages.push('Script file exists on disk.');
      }
    }

    if ((config.command === 'npx' || config.command === 'npx.cmd') && Array.isArray(config.args)) {
      const hasPackageSpec = config.args.some((a) => a.includes('@'));
      if (!hasPackageSpec) {
        ok = false;
        messages.push('No versioned package spec found in args.');
      } else {
        messages.push('Package spec present in args.');
      }
    }

    this.postMessage({ type: 'mcp:validateResult', ok, messages });
  }

  private async handleTestConnection(variant: 'production' | 'development'): Promise<void> {
    const config = this.getVariantConfig(variant);

    if (!config.available) {
      this.postMessage({
        type: 'mcp:testResult',
        ok: false,
        message: config.unavailableReason || 'Configuration unavailable in this environment.',
      });
      return;
    }

    try {
      const result = await this.spawnTestConnection(config.command, config.args);
      this.postMessage({ type: 'mcp:testResult', ok: result.ok, message: result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.postMessage({ type: 'mcp:testResult', ok: false, message });
    }
  }

  private spawnTestConnection(command: string, args: string[]): Promise<{ ok: boolean; message: string }> {
    return new Promise((resolve) => {
      let settled = false;
      let child;

      try {
        child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        resolve({ ok: false, message: `Failed to spawn: ${(error as Error).message}` });
        return;
      }

      const finish = (result: { ok: boolean; message: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolve(result);
      };

      const timer = setTimeout(() => {
        finish({ ok: true, message: 'Process started and stayed alive (timed check, no handshake).' });
      }, TEST_CONNECTION_TIMEOUT_MS);

      child.once('error', (error: Error) => {
        finish({ ok: false, message: error.message });
      });

      child.stdout?.once('data', () => {
        finish({ ok: true, message: 'Process responded on stdout.' });
      });

      child.stderr?.once('data', (chunk: Buffer) => {
        const text = chunk.toString().slice(0, 300);
        finish({ ok: false, message: `Process wrote to stderr: ${text}` });
      });

      child.once('exit', (code: number | null) => {
        if (code !== null && code !== 0) {
          finish({ ok: false, message: `Process exited early with code ${code}` });
        }
      });
    });
  }
}
