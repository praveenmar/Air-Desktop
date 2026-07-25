import { PendingAction } from '../../types';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

// The Magic Fix: Translates SQLite snake_case to TypeScript camelCase
function mapPendingActionRow(row: any): PendingAction | null {
  if (!row) return null;
  return {
    traceId: row.trace_id,
    sessionId: row.session_id,
    tabId: row.tab_id ?? 'tab-legacy',
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
  private readonly indexReady: Promise<void>;

  constructor(private db: AsyncSQLiteDatabase) {
    this.indexReady = this.ensureIndexes();
  }

  private async ensureIndexes(): Promise<void> {
    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pending_session_tab_trace
      ON pending_actions(session_id, tab_id, trace_id)
    `);
  }

  private async ensureReady(): Promise<void> {
    await this.indexReady;
  }

  public async register(traceId: string, sessionId: string, tabId: string, fromNodeId: string, triggerEventId: string, actionType: string, fingerprintHash: string): Promise<void> {
    await this.ensureReady();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pending_actions 
      (trace_id, session_id, tab_id, from_node_id, trigger_event_id, action_type, fingerprint_hash, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `);
    await stmt.run(traceId, sessionId, tabId, fromNodeId, triggerEventId, actionType, fingerprintHash, Date.now());
  }

  public async findByTraceSessionAndTab(traceId: string, sessionId: string, tabId: string): Promise<PendingAction | null> {
    await this.ensureReady();
    const stmt = this.db.prepare(`
      SELECT *
      FROM pending_actions
      WHERE trace_id = ?
        AND session_id = ?
        AND status = ?
        AND (tab_id = ? OR (tab_id IS NULL AND ? = 'tab-legacy'))
    `);
    const row = await stmt.get(traceId, sessionId, 'pending', tabId, tabId);
    return mapPendingActionRow(row); // Run the row through the mapper before returning
  }

  public async findByTraceAndSessionAnyTab(traceId: string, sessionId: string): Promise<PendingAction | null> {
    await this.ensureReady();
    const stmt = this.db.prepare(`
      SELECT *
      FROM pending_actions
      WHERE trace_id = ?
        AND session_id = ?
        AND status = 'pending'
      LIMIT 1
    `);
    const row = await stmt.get(traceId, sessionId);
    return mapPendingActionRow(row);
  }

  public async findRecentPendingForSessionAndTab(
    sessionId: string,
    tabId: string,
    createdAfterMs: number,
    limit: number = 2
  ): Promise<PendingAction[]> {
    await this.ensureReady();
    const safeLimit = Math.max(1, Math.floor(limit));
    const stmt = this.db.prepare(`
      SELECT * FROM pending_actions
      WHERE session_id = ?
        AND (tab_id = ? OR (tab_id IS NULL AND ? = 'tab-legacy'))
        AND status = 'pending'
        AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = await stmt.all(sessionId, tabId, tabId, createdAfterMs, safeLimit);
    return rows
      .map(row => mapPendingActionRow(row))
      .filter((row): row is PendingAction => !!row);
  }

  public async resolve(traceId: string, sessionId: string, tabId: string): Promise<number> {
    await this.ensureReady();
    const stmt = this.db.prepare(`
      UPDATE pending_actions
      SET status = ?, resolved_at = ?
      WHERE trace_id = ?
        AND session_id = ?
        AND status = 'pending'
        AND (tab_id = ? OR (tab_id IS NULL AND ? = 'tab-legacy'))
    `);
    const result = await stmt.run('resolved', Date.now(), traceId, sessionId, tabId, tabId);
    return result.changes;
  }

  public async cleanupStale(cutoffMs: number): Promise<number> {
    await this.ensureReady();
    const stmt = this.db.prepare(`DELETE FROM pending_actions WHERE status = 'pending' AND created_at < ?`);
    const result = await stmt.run(cutoffMs);
    return result.changes;
  }
}
