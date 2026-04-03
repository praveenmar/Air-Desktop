// Purpose: Data access layer for User Sessions.
// Prototype Origin: graph-builder.js (getOrCreateSession, updateSessionPointer)
// Changes: Extracted into typed methods.
// Fix: Added mapSessionRow() to translate SQLite snake_case columns to camelCase TypeScript fields.
//      Without this, session.eventCount, session.startedAt, session.lastNodeId etc. all returned
//      undefined, including the new-session detection log in SessionManager.

import { Database } from 'better-sqlite3';
import { Session } from '../../types';

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
  constructor(private db: Database) {}

  public findById(sessionId: string): Session | null {
    if (!sessionId) return null;
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    return mapSessionRow(stmt.get(sessionId));
  }

  public getOrCreate(sessionId: string): Session | null {
    if (!sessionId) return null;

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const existing = mapSessionRow(stmt.get(sessionId));

    if (existing) return existing;

    const insertStmt = this.db.prepare(`
      INSERT INTO sessions (id, project_id, started_at, last_event_at, event_count, status)
      VALUES (?, 'default', ?, ?, 0, 'active')
    `);

    const now = Date.now();
    insertStmt.run(sessionId, now, now);

    // Re-fetch through the mapper so the returned object is correctly shaped
    return mapSessionRow(stmt.get(sessionId));
  }

  public updatePointer(sessionId: string, nodeId: string): void {
    const stmt = this.db.prepare(`
      UPDATE sessions SET last_node_id = ?, last_event_at = ?, event_count = event_count + 1 WHERE id = ?
    `);
    stmt.run(nodeId, Date.now(), sessionId);
  }

  public getLastNode(sessionId: string): string | null {
    const stmt = this.db.prepare('SELECT last_node_id FROM sessions WHERE id = ?');
    const result = stmt.get(sessionId) as { last_node_id: string } | undefined;
    return result?.last_node_id || null;
  }

  public getAll(limit: number = 20): Session[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY last_event_at DESC LIMIT ?');
    return (stmt.all(limit) as any[]).map(mapSessionRow) as Session[];
  }
}
