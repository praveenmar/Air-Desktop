import { describe, expect, it } from 'vitest';
import { EventRepository } from '../db/repositories/event.repository';

type DedupRow = {
  dedup_key: string;
  event_id: string;
  session_id: string | null;
  trace_id: string | null;
  event_type: string;
  original_timestamp: number | null;
  created_at: number;
};

function createFakeDb(initialRows: DedupRow[] = []) {
  const rows = [...initialRows];

  return {
    prepare(sql: string) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      return {
        async run(...params: any[]) {
          if (normalizedSql.includes('insert or ignore into event_dedup_keys')) {
            const [dedupKey, eventId, sessionId, traceId, eventType, originalTimestamp, createdAt] = params;
            const existing = rows.find((row) => row.dedup_key === dedupKey);
            if (existing) {
              return { changes: 0 };
            }
            rows.push({
              dedup_key: dedupKey,
              event_id: eventId,
              session_id: sessionId,
              trace_id: traceId,
              event_type: eventType,
              original_timestamp: originalTimestamp,
              created_at: createdAt,
            });
            return { changes: 1 };
          }

          if (normalizedSql.includes('delete from event_dedup_keys')) {
            const [cutoffMs] = params;
            const before = rows.length;
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              if (rows[index].created_at < cutoffMs) {
                rows.splice(index, 1);
              }
            }
            return { changes: before - rows.length };
          }

          throw new Error(`Unsupported run SQL in fake DB: ${sql}`);
        },
        async get(...params: any[]) {
          if (normalizedSql.includes('from event_dedup_keys where dedup_key = ?')) {
            const [dedupKey] = params;
            const existing = rows.find((row) => row.dedup_key === dedupKey);
            if (!existing) return undefined;
            return {
              dedupKey: existing.dedup_key,
              eventId: existing.event_id,
              sessionId: existing.session_id,
              traceId: existing.trace_id,
              eventType: existing.event_type,
              originalTimestamp: existing.original_timestamp,
              createdAt: existing.created_at,
            };
          }

          throw new Error(`Unsupported get SQL in fake DB: ${sql}`);
        },
      };
    },
    rows,
  };
}

describe('EventRepository dedup key cleanup', () => {
  it('deletes old rows and preserves newer rows', async () => {
    const fakeDb = createFakeDb([
      {
        dedup_key: 'old-key',
        event_id: 'evt-old',
        session_id: 'session-1',
        trace_id: 'trace-1',
        event_type: 'click',
        original_timestamp: 1_000,
        created_at: 1_000,
      },
      {
        dedup_key: 'new-key',
        event_id: 'evt-new',
        session_id: 'session-1',
        trace_id: 'trace-1',
        event_type: 'click',
        original_timestamp: 5_000,
        created_at: 5_000,
      },
    ]);

    const repo = new EventRepository(fakeDb as any);
    const deleted = await repo.cleanupExpiredDedupKeys(3_000);

    expect(deleted).toBe(1);
    expect(fakeDb.rows.map((row) => row.dedup_key)).toEqual(['new-key']);
  });
});
