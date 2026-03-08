// Purpose: Data access layer for User Sessions.
// Prototype Origin: graph-builder.js (getOrCreateSession, updateSessionPointer)
// Changes: Extracted into typed methods.

import { Database } from 'better-sqlite3';
import { Session } from '../../types';

export class SessionRepository {
  constructor(private db: Database) {}

  public getOrCreate(sessionId: string): Session | null {
    if (!sessionId) return null;

    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const existing = stmt.get(sessionId) as Session | undefined;

    if (existing) return existing;

    const insertStmt = this.db.prepare(`
      INSERT INTO sessions (id, project_id, started_at, last_event_at, event_count, status)
      VALUES (?, 'default', ?, ?, 0, 'active')
    `);
    
    const now = Date.now();
    insertStmt.run(sessionId, now, now);

    return stmt.get(sessionId) as Session;
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
    return stmt.all(limit) as Session[];
  }
}