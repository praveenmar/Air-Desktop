import { PendingAction } from '../../types';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

// The Magic Fix: Translates SQLite snake_case to TypeScript camelCase
function mapPendingActionRow(row: any): PendingAction | null {
  if (!row) return null;
  return {
    traceId: row.trace_id,
    sessionId: row.session_id,
    fromNodeId: row.from_node_id,
    triggerEventId: row.trigger_event_id, // Translates to exact camelCase TS expects
    actionType: row.action_type,
    fingerprintHash: row.fingerprint_hash,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    status: row.status
  };
}

export class PendingActionRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async register(traceId: string, sessionId: string, fromNodeId: string, triggerEventId: string, actionType: string, fingerprintHash: string): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pending_actions 
      (trace_id, session_id, from_node_id, trigger_event_id, action_type, fingerprint_hash, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    await stmt.run(traceId, sessionId, fromNodeId, triggerEventId, actionType, fingerprintHash, Date.now());
  }

  public async find(traceId: string): Promise<PendingAction | null> {
    const stmt = this.db.prepare('SELECT * FROM pending_actions WHERE trace_id = ? AND status = ?');
    const row = await stmt.get(traceId, 'pending');
    return mapPendingActionRow(row); // Run the row through the mapper before returning
  }

  public async resolve(traceId: string): Promise<void> {
    const stmt = this.db.prepare('UPDATE pending_actions SET status = ?, resolved_at = ? WHERE trace_id = ?');
    await stmt.run('resolved', Date.now(), traceId);
  }

  public async cleanupStale(cutoffMs: number): Promise<number> {
    const stmt = this.db.prepare(`DELETE FROM pending_actions WHERE status = 'pending' AND created_at < ?`);
    const result = await stmt.run(cutoffMs);
    return result.changes;
  }
}
