import * as vscode from 'vscode';
import { escapeHtml, safeJsonForScript, getSharedStyles } from './webview-shared';

export interface SessionSummary {
  id: string;
  startedAt: number | string;
  endedAt: number | string | null;
}

export interface SessionManagerCallbacks {
  getBaseUrl: () => Promise<string>;
  onLog?: (message: string, data?: unknown) => void;
  onError?: (message: string, error: unknown) => void;
}

type WebviewInboundMessage =
  | { type: 'refresh' }
  | { type: 'copy'; id: string }
  | { type: 'deleteOne'; id: string }
  | { type: 'bulkDelete'; ids: string[] };

const SCOPE = 'SessionManager';

function renderShell(title: string, subtitle: string, bodyHtml: string, includeClientScript: boolean): string {
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
  ${includeClientScript ? '' : ''}
</body>
</html>`;
}

function renderLoadingBody(): string {
  return `
    <div class="loading-state">
      <div class="spinner"></div>
      <div>Loading sessions&hellip;</div>
    </div>
  `;
}

function renderErrorBody(message: string): string {
  return `
    <div class="error-state">
      <div>Failed to load sessions.</div>
      <div class="error-detail">${escapeHtml(message)}</div>
      <div style="margin-top:14px;">
        <button class="primary" id="retry">Retry</button>
      </div>
    </div>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('retry')?.addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
      });
    </script>
  `;
}

function renderTableBody(sessions: SessionSummary[]): string {
  return `
    <div class="toolbar">
      <input type="text" id="search" placeholder="Search session ID&hellip;" />
      <select id="statusFilter">
        <option value="all">All statuses</option>
        <option value="active">Active</option>
        <option value="ended">Ended</option>
      </select>
      <select id="sortBy">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="id-asc">Session ID (A-Z)</option>
        <option value="id-desc">Session ID (Z-A)</option>
      </select>
      <div class="spacer"></div>
      <button id="refresh">Refresh</button>
    </div>
    <div class="selection-bar" id="selectionBar" style="display:none;">
      <span id="selectionCount">0 selected</span>
      <button class="danger" id="bulkDelete">Delete Selected</button>
      <button id="clearSelection">Clear</button>
    </div>
    <div id="tableWrap"></div>
    <div id="emptyState" class="empty" style="display:none;">No sessions match your filters.</div>
    <script>
      const vscode = acquireVsCodeApi();
      const ALL_SESSIONS = ${safeJsonForScript(sessions)};
      const selectedIds = new Set();

      function formatStarted(value) {
        try { return new Date(value).toLocaleString(); } catch { return String(value); }
      }

      function isEnded(session) {
        return session.endedAt !== null && session.endedAt !== undefined;
      }

      function getFiltered() {
        const query = (document.getElementById('search').value || '').trim().toLowerCase();
        const statusFilter = document.getElementById('statusFilter').value;
        const sortBy = document.getElementById('sortBy').value;

        let rows = ALL_SESSIONS.filter((s) => {
          if (query && !s.id.toLowerCase().includes(query)) return false;
          if (statusFilter === 'active' && isEnded(s)) return false;
          if (statusFilter === 'ended' && !isEnded(s)) return false;
          return true;
        });

        rows = rows.slice().sort((a, b) => {
          if (sortBy === 'newest') return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
          if (sortBy === 'oldest') return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
          if (sortBy === 'id-asc') return a.id.localeCompare(b.id);
          if (sortBy === 'id-desc') return b.id.localeCompare(a.id);
          return 0;
        });

        return rows;
      }

      function updateSelectionBar() {
        const bar = document.getElementById('selectionBar');
        const count = selectedIds.size;
        document.getElementById('selectionCount').textContent = count + ' selected';
        bar.style.display = count > 0 ? 'flex' : 'none';
      }

      function render() {
        const rows = getFiltered();
        const wrap = document.getElementById('tableWrap');
        const emptyState = document.getElementById('emptyState');

        for (const id of Array.from(selectedIds)) {
          if (!ALL_SESSIONS.some((s) => s.id === id)) selectedIds.delete(id);
        }

        if (rows.length === 0) {
          wrap.style.display = 'none';
          emptyState.style.display = 'block';
          updateSelectionBar();
          return;
        }

        wrap.style.display = 'block';
        emptyState.style.display = 'none';

        const allVisibleSelected = rows.every((s) => selectedIds.has(s.id));

        const rowsHtml = rows.map((s) => {
          const ended = isEnded(s);
          const checked = selectedIds.has(s.id) ? 'checked' : '';
          const rowClass = selectedIds.has(s.id) ? 'selected-row' : '';
          return (
            '<tr class="' + rowClass + '" data-id="' + s.id + '">' +
              '<td class="checkbox-col"><input type="checkbox" class="row-check" data-id="' + s.id + '" ' + checked + ' /></td>' +
              '<td class="id-cell">' +
                '<span class="id-text">' + s.id + '</span>' +
                '<button class="copy-btn" data-id="' + s.id + '">Copy</button>' +
              '</td>' +
              '<td>' + formatStarted(s.startedAt) + '</td>' +
              '<td><span class="badge ' + (ended ? 'ended' : 'active') + '">' + (ended ? 'Ended' : 'Active') + '</span></td>' +
              '<td class="actions-col">' +
                '<button class="danger delete-btn" data-id="' + s.id + '">Delete</button>' +
              '</td>' +
            '</tr>'
          );
        }).join('');

        wrap.innerHTML =
          '<table>' +
            '<thead><tr>' +
              '<th class="checkbox-col"><input type="checkbox" id="selectAll" ' + (allVisibleSelected ? 'checked' : '') + ' /></th>' +
              '<th>Session ID</th><th>Started</th><th>Status</th><th></th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml + '</tbody>' +
          '</table>';

        wrap.querySelectorAll('.copy-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            vscode.postMessage({ type: 'copy', id });
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = original; btn.classList.remove('copied'); }, 1200);
          });
        });

        wrap.querySelectorAll('.delete-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            vscode.postMessage({ type: 'deleteOne', id: btn.getAttribute('data-id') });
          });
        });

        wrap.querySelectorAll('.row-check').forEach((cb) => {
          cb.addEventListener('change', () => {
            const id = cb.getAttribute('data-id');
            if (cb.checked) selectedIds.add(id); else selectedIds.delete(id);
            render();
          });
        });

        document.getElementById('selectAll')?.addEventListener('change', (e) => {
          const checked = e.target.checked;
          rows.forEach((s) => { if (checked) selectedIds.add(s.id); else selectedIds.delete(s.id); });
          render();
        });

        updateSelectionBar();
      }

      document.getElementById('search').addEventListener('input', render);
      document.getElementById('statusFilter').addEventListener('change', render);
      document.getElementById('sortBy').addEventListener('change', render);
      document.getElementById('refresh').addEventListener('click', () => {
        vscode.postMessage({ type: 'refresh' });
      });
      document.getElementById('bulkDelete').addEventListener('click', () => {
        vscode.postMessage({ type: 'bulkDelete', ids: Array.from(selectedIds) });
      });
      document.getElementById('clearSelection').addEventListener('click', () => {
        selectedIds.clear();
        render();
      });

      render();
    </script>
  `;
}

export class SessionManagerPanel {
  private static instance: SessionManagerPanel | null = null;

  private panel: vscode.WebviewPanel | null = null;
  private readonly callbacks: SessionManagerCallbacks;

  private constructor(callbacks: SessionManagerCallbacks) {
    this.callbacks = callbacks;
  }

  static getInstance(callbacks: SessionManagerCallbacks): SessionManagerPanel {
    if (!SessionManagerPanel.instance) {
      SessionManagerPanel.instance = new SessionManagerPanel(callbacks);
    }
    return SessionManagerPanel.instance;
  }

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      await this.refresh();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'airSessionManager',
      'AIR Session Manager',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.html = renderShell(
      'AIR Session Manager',
      'Loading sessions…',
      renderLoadingBody(),
      false,
    );

    this.panel.webview.onDidReceiveMessage((message: WebviewInboundMessage) => {
      void this.handleMessage(message);
    });

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    await this.refresh();
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }

  async refreshIfOpen(): Promise<void> {
    if (this.panel) {
      await this.refresh();
    }
  }

  private reportError(message: string, error: unknown): void {
    this.callbacks.onError?.(message, error);
  }

  private async fetchSessions(): Promise<SessionSummary[]> {
    const baseUrl = await this.callbacks.getBaseUrl();
    const res = await fetch(`${baseUrl}/api/sessions`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const sessions: SessionSummary[] = await res.json();
    return Array.isArray(sessions) ? sessions : [];
  }

  private async refresh(): Promise<void> {
    if (!this.panel) return;

    try {
      const sessions = await this.fetchSessions();
      const sorted = sessions
        .slice()
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

      const subtitle = `${sorted.length} session${sorted.length === 1 ? '' : 's'} recorded`;
      this.panel.webview.html = renderShell(
        'AIR Session Manager',
        subtitle,
        renderTableBody(sorted),
        true,
      );
    } catch (error) {
      this.reportError('Failed to load sessions', error);
      const message = error instanceof Error ? error.message : String(error);
      this.panel.webview.html = renderShell(
        'AIR Session Manager',
        'Unable to load sessions',
        renderErrorBody(message),
        true,
      );
    }
  }

  private async handleMessage(message: WebviewInboundMessage): Promise<void> {
    if (!message || typeof message.type !== 'string') return;

    switch (message.type) {
      case 'refresh':
        await this.refresh();
        break;

      case 'copy':
        if (typeof message.id === 'string') {
          await vscode.env.clipboard.writeText(message.id);
          void vscode.window.setStatusBarMessage(`AIR: Copied session ID ${message.id}`, 2500);
        }
        break;

      case 'deleteOne':
        if (typeof message.id === 'string') {
          await this.deleteSessions([message.id]);
        }
        break;

      case 'bulkDelete':
        if (Array.isArray(message.ids) && message.ids.length > 0) {
          await this.deleteSessions(message.ids.filter((id) => typeof id === 'string'));
        }
        break;

      default:
        break;
    }
  }

  private async deleteSessions(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const confirmMessage =
      ids.length === 1
        ? `Delete session ${ids[0]}?`
        : `Delete ${ids.length} selected sessions?`;

    const confirm = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, 'Delete');
    if (confirm !== 'Delete') return;

    try {
      const baseUrl = await this.callbacks.getBaseUrl();
      const failures: string[] = [];

      for (const sessionId of ids) {
        try {
          const delRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`, {
            method: 'DELETE',
          });
          if (!delRes.ok) {
            throw new Error(`HTTP ${delRes.status}`);
          }
        } catch (error) {
          failures.push(sessionId);
          this.reportError(`Failed to delete session ${sessionId}`, error);
        }
      }

      const successCount = ids.length - failures.length;
      if (failures.length === 0) {
        void vscode.window.showInformationMessage(
          successCount === 1 ? 'Deleted.' : `Deleted ${successCount} session(s).`,
        );
      } else {
        void vscode.window.showWarningMessage(
          `Deleted ${successCount}/${ids.length} session(s). Failed: ${failures.join(', ')}`,
        );
      }
    } catch (error) {
      this.reportError('Delete failed', error);
      void vscode.window.showErrorMessage('AIR: Delete failed');
    } finally {
      await this.refresh();
    }
  }
}