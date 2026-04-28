// Purpose: Data access layer for RAW interceptor events.
// Prototype Origin: graph-builder.js (processEvent database inserts)
// Changes: Extracted into typed methods.

import { AIREvent } from '../../types';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

export class EventRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async insertDedupKeyIfAbsent(input: {
    dedupKey: string;
    eventId: string;
    sessionId: string | null;
    traceId: string | null;
    eventType: string;
    originalTimestamp: number | null;
    createdAt: number;
  }): Promise<boolean> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO event_dedup_keys (
        dedup_key,
        event_id,
        session_id,
        trace_id,
        event_type,
        original_timestamp,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = await stmt.run(
      input.dedupKey,
      input.eventId,
      input.sessionId,
      input.traceId,
      input.eventType,
      input.originalTimestamp,
      input.createdAt,
    );

    return (result?.changes ?? 0) > 0;
  }

  public async findDedupKeyByKey(dedupKey: string): Promise<{
    dedupKey: string;
    eventId: string;
    sessionId: string | null;
    traceId: string | null;
    eventType: string;
    originalTimestamp: number | null;
    createdAt: number;
  } | null> {
    const stmt = this.db.prepare(`
      SELECT
        dedup_key AS dedupKey,
        event_id AS eventId,
        session_id AS sessionId,
        trace_id AS traceId,
        event_type AS eventType,
        original_timestamp AS originalTimestamp,
        created_at AS createdAt
      FROM event_dedup_keys
      WHERE dedup_key = ?
      LIMIT 1
    `);

    const row = await stmt.get(dedupKey) as
      | {
          dedupKey: string;
          eventId: string;
          sessionId: string | null;
          traceId: string | null;
          eventType: string;
          originalTimestamp: number | null;
          createdAt: number;
        }
      | undefined;
    return row ?? null;
  }

  public async cleanupExpiredDedupKeys(cutoffMs: number): Promise<number> {
    const stmt = this.db.prepare(`
      DELETE FROM event_dedup_keys
      WHERE created_at < ?
    `);
    const result = await stmt.run(cutoffMs);
    return result?.changes ?? 0;
  }

  public async findLatestOutcomeByTraceSessionAndTab(
    traceId: string,
    sessionId: string,
    tabId: string,
  ): Promise<{ id: string; timestamp: number; traceId: string | null; sessionId: string; tabId: string | null } | null> {
    const stmt = this.db.prepare(`
      SELECT
        id,
        timestamp,
        trace_id AS traceId,
        session_id AS sessionId,
        json_extract(payload, '$.tabId') AS tabId
      FROM events
      WHERE type = 'outcome'
        AND trace_id = ?
        AND session_id = ?
        AND (
          json_extract(payload, '$.tabId') = ?
          OR (json_extract(payload, '$.tabId') IS NULL AND ? = 'tab-legacy')
        )
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    const row = await stmt.get(traceId, sessionId, tabId, tabId) as
      | { id: string; timestamp: number; traceId: string | null; sessionId: string; tabId: string | null }
      | undefined;
    return row ?? null;
  }

  public async insertIfAbsent(event: AIREvent, intent: string, intentRaw: string | null): Promise<boolean> {
    const payloadStr = JSON.stringify(event);

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, type, timestamp, session_id, trace_id, page_url, payload, processed, intent, intent_raw
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `);

    const result = await stmt.run(
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

    return (result?.changes ?? 0) > 0;
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
