// Purpose: Core debugging and execution trace logger.
// Prototype Origin: logger.js (and routes.js for getRecent/clear)
// Changes: Converted to a class-based service with Dependency Injection for the database.

import crypto from 'crypto';
import { AsyncSQLiteDatabase } from '../db/sqlite-adapter';

export interface DebugLog {
  id: string;
  timestamp: number;
  component: string;
  level: 'debug' | 'info' | 'warn' | 'error' | 'decision';
  message: string;
  data: Record<string, unknown>;
  sessionId: string | null;
  traceId: string | null;
}

export class DebugLogger {
  constructor(private db: AsyncSQLiteDatabase) {}

  /**
   * Logs a debug event to the console and persists it to the database.
   */
  public async log(
    component: string,
    level: 'debug' | 'info' | 'warn' | 'error' | 'decision',
    message: string,
    data: Record<string, unknown> = {},
    sessionId: string | null = null,
    traceId: string | null = null
  ): Promise<DebugLog> {
    const logId = crypto.randomUUID();
    const timestamp = Date.now();

    const colors: Record<string, string> = {
      debug: '[debug]',
      info: '[info]',
      warn: '[warn]',
      error: '[error]',
      decision: '[decision]',
    };

    console.log(`${colors[level] || '[log]'} [${component}] ${message}`, data);

    try {
      await this.db.prepare(`
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
        traceId
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
  public async getRecent(limit: number = 100): Promise<DebugLog[]> {
    try {
      const rows = await this.db.prepare(
        'SELECT * FROM debug_logs ORDER BY timestamp DESC LIMIT ?'
      ).all(limit) as any[];

      return rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        component: row.component,
        level: row.level as DebugLog['level'],
        message: row.message,
        data: row.data ? JSON.parse(row.data) : {},
        sessionId: row.session_id,
        traceId: row.trace_id,
      }));
    } catch (err) {
      console.error('Failed to retrieve debug logs:', err);
      return [];
    }
  }

  /**
   * Deletes log entries older than maxAgeMs milliseconds.
   */
  public async pruneOldLogs(maxAgeMs: number = 86_400_000): Promise<number> {
    try {
      const cutoff = Date.now() - maxAgeMs;
      const result = await this.db.prepare(
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
  public async clear(): Promise<void> {
    try {
      await this.db.prepare('DELETE FROM debug_logs').run();
    } catch (err) {
      console.error('Failed to clear debug logs:', err);
    }
  }
}
