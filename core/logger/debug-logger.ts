// Purpose: Core debugging and execution trace logger.
// Prototype Origin: logger.js (and routes.js for getRecent/clear)
// Changes: Converted to a class-based service with Dependency Injection for the database. 
// Added getRecent and clear methods as requested by Prompt 4 specifications.

import crypto from 'crypto';
import { Database } from 'better-sqlite3';

export interface DebugLog {
  id: string;
  timestamp: number;
  component: string;
  level: 'info' | 'warn' | 'error' | 'decision';
  message: string;
  data: Record<string, unknown>;
  sessionId: string;
  traceId: string;
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
    traceId: string | null = null
  ): DebugLog {
    const logId = crypto.randomUUID();
    const timestamp = Date.now();
    const resolvedTraceId = traceId || crypto.randomUUID();
    
    const colors: Record<string, string> = { 
      info: '🔵', 
      warn: '🟡', 
      error: '🔴', 
      decision: '🟢' 
    };
    
    console.log(`${colors[level] || '⚪'} [${component}] ${message}`, data);
    
    try {
      const stmt = this.db.prepare(`
        INSERT INTO debug_logs (id, timestamp, component, level, message, data, session_id, trace_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        logId, 
        timestamp, 
        component, 
        level, 
        message, 
        JSON.stringify(data), 
        sessionId, 
        resolvedTraceId
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
      sessionId: sessionId || '',
      traceId: resolvedTraceId
    };
  }

  /**
   * Retrieves the most recent debug logs.
   */
  public getRecent(limit: number = 100): DebugLog[] {
    try {
      const stmt = this.db.prepare('SELECT * FROM debug_logs ORDER BY timestamp DESC LIMIT ?');
      const rows = stmt.all(limit) as any[];
      
      return rows.map(row => ({
        id: row.id,
        timestamp: row.timestamp,
        component: row.component,
        level: row.level as 'info' | 'warn' | 'error' | 'decision',
        message: row.message,
        data: row.data ? JSON.parse(row.data) : {},
        sessionId: row.session_id,
        traceId: row.trace_id
      }));
    } catch (err) {
      console.error('Failed to retrieve debug logs:', err);
      return [];
    }
  }

  /**
   * Clears all debug logs from the database.
   */
  public clear(): void {
    try {
      this.db.prepare('DELETE FROM debug_logs').run();
    } catch (err) {
      console.error('Failed to clear debug logs:', err);
    }
  }
}