// Purpose: Data access layer for RAW interceptor events.
// Prototype Origin: graph-builder.js (processEvent database inserts)
// Changes: Extracted into typed methods.

import { AIREvent } from '../../types';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

export class EventRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async insert(event: AIREvent, intent: string, intentRaw: string | null): Promise<void> {
    const payloadStr = JSON.stringify(event);

    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, type, timestamp, session_id, trace_id, page_url, payload, processed, intent, intent_raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    await stmt.run(
      event.id,
      event.type,
      event.timestamp,
      event.sessionId,
      event.traceId,
      event.pageUrl,
      payloadStr,
      intent,
      intentRaw
    );
  }

  public async findById(id: string): Promise<any | null> {
    const stmt = this.db.prepare('SELECT * FROM events WHERE id = ?');
    return (await stmt.get(id)) || null;
  }

  public async findBySession(sessionId: string): Promise<any[]> {
    const stmt = this.db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY timestamp');
    return await stmt.all(sessionId) as any[];
  }

  public async getRecent(limit: number = 100): Promise<any[]> {
    const stmt = this.db.prepare('SELECT * FROM events ORDER BY timestamp DESC LIMIT ?');
    return await stmt.all(limit) as any[];
  }

  public async updateNodeId(eventId: string, nodeId: string): Promise<void> {
    const stmt = this.db.prepare('UPDATE events SET node_id = ? WHERE id = ?');
    await stmt.run(nodeId, eventId);
  }
}
