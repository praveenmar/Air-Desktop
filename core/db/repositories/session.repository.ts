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

  public async updatePointer(sessionId: string, nodeId: string): Promise<void> {
    const stmt = this.db.prepare(`
      UPDATE sessions SET last_node_id = ?, last_event_at = ?, event_count = event_count + 1 WHERE id = ?
    `);
    await stmt.run(nodeId, Date.now(), sessionId);
  }

  public async getLastNode(sessionId: string): Promise<string | null> {
    const stmt = this.db.prepare('SELECT last_node_id FROM sessions WHERE id = ?');
    const result = await stmt.get(sessionId) as { last_node_id: string } | undefined;
    return result?.last_node_id || null;
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
