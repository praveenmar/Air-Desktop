// Purpose: Data access layer for User Sessions.
// Prototype Origin: graph-builder.js (getOrCreateSession, updateSessionPointer)
// Changes: Extracted into typed methods.
// Fix: Added mapSessionRow() to translate SQLite snake_case columns to camelCase TypeScript fields.
//      Without this, session.eventCount, session.startedAt, session.lastNodeId etc. all returned
//      undefined, including the new-session detection log in SessionManager.

import { Session } from '../../types';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

// Translates every snake_case SQLite column to its camelCase TypeScript equivalent.
function mapSessionRow(row: any): Session | null {
  if (!row) return null;
  return {
    id:           row.id,
    projectId:    row.project_id,
    startedAt:    row.started_at,
    lastEventAt:  row.last_event_at,
    lastNodeId:   row.last_node_id,
    eventCount:   row.event_count,
    status:       row.status,
    metadata:     row.metadata,
  };
}

export class SessionRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async getTabState(sessionId: string, tabId: string): Promise<{ lastNodeId: string | null; lastEventAt: number | null } | null> {
    const stmt = this.db.prepare(`
      SELECT last_node_id, last_event_at
      FROM session_tab_state
      WHERE session_id = ? AND tab_id = ?
      LIMIT 1
    `);
    const result = await stmt.get(sessionId, tabId) as
      | { last_node_id: string | null; last_event_at: number | null }
      | undefined;
    if (!result) {
      return null;
    }
    return {
      lastNodeId: result.last_node_id || null,
      lastEventAt: typeof result.last_event_at === 'number' ? result.last_event_at : null,
    };
  }

  public async findById(sessionId: string): Promise<Session | null> {
    if (!sessionId) return null;
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return mapSessionRow(await stmt.get(sessionId));
  }

  public async getOrCreate(sessionId: string): Promise<Session | null> {
    if (!sessionId) return null;

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const existing = mapSessionRow(await stmt.get(sessionId));

    if (existing) return existing;

    const insertStmt = this.db.prepare(`
      INSERT INTO sessions (id, project_id, started_at, last_event_at, event_count, status)
      VALUES (?, 'default', ?, ?, 0, 'active')
    `);

    const now = Date.now();
    await insertStmt.run(sessionId, now, now);

    // Re-fetch through the mapper so the returned object is correctly shaped
    return mapSessionRow(await stmt.get(sessionId));
  }

  public async updatePointerForTab(
    sessionId: string,
    tabId: string,
    nodeId: string,
    eventTimestamp: number
  ): Promise<void> {
    const safeEventTimestamp = Number.isFinite(eventTimestamp) ? eventTimestamp : Date.now();
    const tabStateStmt = this.db.prepare(`
      INSERT INTO session_tab_state (session_id, tab_id, last_node_id, last_event_at, event_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(session_id, tab_id) DO UPDATE SET
        event_count = session_tab_state.event_count + 1,
        last_node_id = CASE
          WHEN session_tab_state.last_event_at IS NULL OR session_tab_state.last_event_at <= excluded.last_event_at
          THEN excluded.last_node_id
          ELSE session_tab_state.last_node_id
        END,
        last_event_at = CASE
          WHEN session_tab_state.last_event_at IS NULL OR session_tab_state.last_event_at <= excluded.last_event_at
          THEN excluded.last_event_at
          ELSE session_tab_state.last_event_at
        END
    `);
    await tabStateStmt.run(sessionId, tabId, nodeId, safeEventTimestamp);

    const sessionStmt = this.db.prepare(`
      UPDATE sessions
      SET
        last_event_at = CASE
          WHEN last_event_at IS NULL OR last_event_at <= ?
          THEN ?
          ELSE last_event_at
        END,
        event_count = event_count + 1
      WHERE id = ?
    `);
    // Note: sessions.last_node_id is legacy/observability only and must not be used
    // as GraphBuilder source of truth in tab-aware flow.
    await sessionStmt.run(safeEventTimestamp, safeEventTimestamp, sessionId);
  }

  public async getLastNodeForTab(sessionId: string, tabId: string): Promise<string | null> {
    const state = await this.getTabState(sessionId, tabId);
    return state?.lastNodeId || null;
  }

  public async getAll(limit: number = 20): Promise<Session[]> {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT ?');
    return ((await stmt.all(limit)) as any[]).map(mapSessionRow) as Session[];
  }

  public async markEnded(sessionId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET status = 'ended', last_event_at = ?
      WHERE id = ?
    `);
    await stmt.run(Date.now(), sessionId);
  }
}
