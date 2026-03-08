// Purpose: Data access layer for RAW interceptor events.
// Prototype Origin: graph-builder.js (processEvent database inserts)
// Changes: Extracted into typed methods.

import { Database } from 'better-sqlite3';
import { AIREvent } from '../../types';

export class EventRepository {
  constructor(private db: Database) {}

  public insert(event: AIREvent, intent: string, intentRaw: string | null): void {
    const payloadStr = JSON.stringify(event);

    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, type, timestamp, session_id, trace_id, page_url, payload, processed, intent, intent_raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    stmt.run(
      event.id,
      event.type,
      event.timestamp,
      event.sessionId || null,
      event.traceId,
      event.pageUrl,
      payloadStr,
      intent,
      intentRaw
    );
  }

  public findById(id: string): any | null {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    return stmt.get(id) || null;
  }

  public findBySession(sessionId: string): any[] {
    const stmt = this.db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY timestamp');
    return stmt.all(sessionId) as any[];
  }

  public getRecent(limit: number = 100): any[] {
    const stmt = this.db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?');
    return stmt.all(limit) as any[];
  }

  public updateNodeId(eventId: string, nodeId: string): void {
    const stmt = this.db.prepare('UPDATE events SET node_id = ? WHERE id = ?');
    stmt.run(nodeId, eventId);
  }
}