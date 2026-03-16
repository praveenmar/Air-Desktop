// Purpose: Core debugging and execution trace logger.
// Prototype Origin: logger.js (and routes.js for getRecent/clear)
// Changes: Converted to a class-based service with Dependency Injection for the database.
// Fix (Bug #8a — Orphaned UUIDs): Previously, any log call without a traceId argument
//   generated a fresh crypto.randomUUID() as the stored trace_id. Since only 1 of 22
//   call sites passes a real traceId, nearly every row in debug_logs had a random UUID
//   that linked to nothing — making trace_id useless for filtering. Now defaults to null.
// Fix (Bug #8b — Unbounded growth): debug_logs had no TTL or row cap and grew forever.
//   Added pruneOldLogs(maxAgeMs) which GraphBuilder.startCleanupService() calls on its
//   existing 15-second tick, keeping the last 24 hours of logs by default.

import crypto from 'crypto';
import { Database } from 'better-sqlite3';

export interface DebugLog {
  id: string;
  timestamp: number;
  component: string;
  level: 'info' | 'warn' | 'error' | 'decision';
  message: string;
  data: Record<string, unknown>;
  sessionId: string | null;   // nullable — not every log belongs to a session
  traceId: string | null;     // nullable — not every log belongs to a trace
}

export class DebugLogger {
  constructor(private db: Database) {}

  /**
   * Logs a debug event to the console and persists it to the database.
   */
  public log(
    component: string,
    level: 'info' | 'warn' | 'error' | 'decision',
    message: string,
    data: Record<string, unknown> = {},
    sessionId: string | null = null,
    traceId: string | null = null    // FIX: null stored as-is — no random UUID fallback
  ): DebugLog {
    const logId    = crypto.randomUUID();
    const timestamp = Date.now();

    const colors: Record<string, string> = {
      info:     '🔵',
      warn:     '🟡',
      error:    '🔴',
      decision: '🟢',
    };

    console.log(`${colors[level] || '⚪'} [${component}] ${message}`, data);

    try {
      this.db.prepare(`
        INSERT INTO debug_logs (id, timestamp, component, level, message, data, session_id, trace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        logId,
        timestamp,
        component,
        level,
        message,
        JSON.stringify(data),
        sessionId,
        traceId      // FIX: stored as null when not provided — not as a random UUID
      );
    } catch (err) {
      console.error('Failed to save debug log:', err);
    }

    return {
      id: logId,
      timestamp,
      component,
      level,
      message,
      data,
      sessionId,
      traceId,
    };
  }

  /**
   * Retrieves the most recent debug logs.
   */
  public getRecent(limit: number = 100): DebugLog[] {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM debug_logs ORDER BY timestamp DESC LIMIT ?'
      ).all(limit) as any[];

      return rows.map(row => ({
        id:        row.id,
        timestamp: row.timestamp,
        component: row.component,
        level:     row.level as DebugLog['level'],
        message:   row.message,
        data:      row.data ? JSON.parse(row.data) : {},
        sessionId: row.session_id,
        traceId:   row.trace_id,
      }));
    } catch (err) {
      console.error('Failed to retrieve debug logs:', err);
      return [];
    }
  }

  /**
   * Deletes log entries older than maxAgeMs milliseconds.
   * Called by GraphBuilder.startCleanupService() on its 15-second tick.
   * Default retention: 24 hours (86_400_000 ms).
   *
   * @returns number of rows deleted
   */
  public pruneOldLogs(maxAgeMs: number = 86_400_000): number {
    try {
      const cutoff = Date.now() - maxAgeMs;
      const result = this.db.prepare(
        'DELETE FROM debug_logs WHERE timestamp < ?'
      ).run(cutoff);
      return result.changes;
    } catch (err) {
      console.error('Failed to prune debug logs:', err);
      return 0;
    }
  }

  /**
   * Clears ALL debug logs from the database (used by the UI reset action).
   */
  public clear(): void {
    try {
      this.db.prepare('DELETE FROM debug_logs').run();
    } catch (err) {
      console.error('Failed to clear debug logs:', err);
    }
  }
}