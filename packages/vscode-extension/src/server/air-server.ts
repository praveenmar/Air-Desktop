import * as http from 'http';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { IncomingEvent, IncomingEventSchema } from '../types/event-schema';

const log = {
  info:  (scope: string, msg: string, meta?: unknown) => console.log(`[${scope}] ${msg}`, meta ?? ''),
  warn:  (scope: string, msg: string, meta?: unknown) => console.warn(`[${scope}] ${msg}`, meta ?? ''),
  error: (scope: string, msg: string, err?: unknown, meta?: unknown) => console.error(`[${scope}] ${msg}`, err ?? '', meta ?? ''),
};

export interface ServerOptions {
  dbPath: string;
  getActiveSessionId: () => string | null;
  maxQueueSize?: number;
  maxPayloadBytes?: number;
  maxRequestsPerSecond?: number;
  maxEventsPerMinutePerSession?: number;
}

export class AIRServer {
  private static readonly SCOPE = 'AIRServer';
  private server: http.Server;
  private port = 0;
  private db: Database.Database;
  private eventQueue: IncomingEvent[] = [];
  private isProcessing = false;
  private maxQueueSize: number;
  private maxPayloadBytes: number;
  private getActiveSessionId: () => string | null;
  private maxRequestsPerSecond: number;
  private maxEventsPerMinutePerSession: number;
  private reqWindowStartMs = Date.now();
  private reqCountInWindow = 0;
  private sessionMinuteCounters = new Map<string, { windowStartMs: number; count: number }>();

  constructor(options: ServerOptions) {
    this.getActiveSessionId = options.getActiveSessionId;
    this.maxQueueSize = options.maxQueueSize ?? 2000;
    this.maxPayloadBytes = options.maxPayloadBytes ?? 10_000_000;
    this.maxRequestsPerSecond = options.maxRequestsPerSecond ?? 100;
    this.maxEventsPerMinutePerSession = options.maxEventsPerMinutePerSession ?? 1000;
    this.db = new Database(options.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.ensureTables();
    this.server = http.createServer(this.handleRequest.bind(this));
    log.info(AIRServer.SCOPE, 'Server constructed', {
      maxQueueSize: this.maxQueueSize,
      maxPayloadBytes: this.maxPayloadBytes,
      maxRequestsPerSecond: this.maxRequestsPerSecond,
      maxEventsPerMinutePerSession: this.maxEventsPerMinutePerSession,
    });
  }

  private ensureTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        metadata TEXT
      );
      CREATE TABLE IF NOT EXISTS raw_events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        trace_id TEXT,
        page_id TEXT,
        frame_id TEXT,
        sequence INTEGER,
        page_url TEXT,
        payload TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY(session_id) REFERENCES sessions(id)
      );
      CREATE INDEX IF NOT EXISTS idx_raw_events_session ON raw_events(session_id);
      CREATE INDEX IF NOT EXISTS idx_raw_events_trace ON raw_events(trace_id);
    `);
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', (error) => {
        log.error(AIRServer.SCOPE, 'Failed to start HTTP server', error);
        reject(error);
      });
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as any;
        this.port = addr.port;
        log.info(AIRServer.SCOPE, 'Listening', { url: `http://127.0.0.1:${this.port}` });
        resolve(this.port);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => {
        if (err) {
          log.error(AIRServer.SCOPE, 'Failed to stop HTTP server', err);
          reject(err);
          return;
        }
        log.info(AIRServer.SCOPE, 'HTTP server stopped');
        resolve();
      });
    });
  }

  public getPort(): number {
    return this.port;
  }

  public listSessions(limit: number = 50): { id: string; startedAt: number; endedAt: number | null }[] {
    const rows = this.db.prepare(`
      SELECT id, started_at, ended_at
      FROM sessions
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit) as Array<{ id: string; started_at: number; ended_at: number | null }>;
    return rows.map((row) => ({ id: row.id, startedAt: row.started_at, endedAt: row.ended_at }));
  }

  public markSessionEnded(sessionId: string): void {
    this.db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(Date.now(), sessionId);
    log.info(AIRServer.SCOPE, 'Session marked ended', { sessionId });
  }

  public deleteSession(sessionId: string): { deletedEvents: number; deletedSessions: number } {
    const deleteEvents = this.db.prepare('DELETE FROM raw_events WHERE session_id = ?').run(sessionId);
    const deleteSession = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    const result = { deletedEvents: deleteEvents.changes, deletedSessions: deleteSession.changes };
    log.info(AIRServer.SCOPE, 'Session deleted', { sessionId, ...result });
    return result;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    const requestId = randomUUID().slice(0, 8);
    const startedAt = Date.now();
    this.setCorsHeaders(res, req.headers.origin as string | undefined);
    if (!this.allowRequestRate()) {
      log.warn(AIRServer.SCOPE, '[RATE_LIMIT] Exceeded (log-only)', { requestId, method: req.method, url: req.url });
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', port: this.port, activeSessionId: this.getActiveSessionId(), version: 1 }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ activeSessionId: this.getActiveSessionId() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/events') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (Buffer.byteLength(body) > this.maxPayloadBytes) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Payload too large' }));
          return;
        }
        try {
          const parsed = JSON.parse(body);
          const rawEvents = Array.isArray(parsed) ? parsed : (parsed.events || [parsed]);
          const events: IncomingEvent[] = [];
          for (const rawEvent of rawEvents) {
            const result = IncomingEventSchema.safeParse(rawEvent);
            if (!result.success) {
              log.error(AIRServer.SCOPE, '[SCHEMA_FAIL] Incoming event failed validation', result.error, { requestId, event: rawEvent });
              continue;
            }
            events.push(result.data);
          }
          log.info(AIRServer.SCOPE, '[EVENT_RECEIVED]', {
            requestId,
            count: rawEvents.length,
            acceptedForQueue: events.length,
            droppedBySchema: rawEvents.length - events.length,
            sessionId: events[0]?.sessionId ?? null,
          });
          const activeSessionId = this.getActiveSessionId();
          if (activeSessionId && events.some((ev) => ev.sessionId !== activeSessionId)) {
            log.warn(AIRServer.SCOPE, '[SESSION_MISMATCH] (log-only)', {
              requestId,
              activeSessionId,
              incomingSessionIds: Array.from(new Set(events.map((event) => event.sessionId))),
            });
          }
          if (!this.allowEventsPerSession(events)) {
            log.warn(AIRServer.SCOPE, '[RATE_LIMIT] Events per session exceeded (log-only)', {
              requestId,
              eventCount: events.length,
              sessionId: events[0]?.sessionId ?? null,
            });
          }
          for (const ev of events) {
            this.enqueueEvent(ev);
          }
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, queued: events.length, received: rawEvents.length }));
          log.info(AIRServer.SCOPE, 'Events accepted', {
            requestId,
            queued: events.length,
            queueDepth: this.eventQueue.length,
            elapsedMs: Date.now() - startedAt,
          });
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
          log.warn(AIRServer.SCOPE, 'Rejected invalid JSON payload', {
            requestId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  }

  private setCorsHeaders(res: http.ServerResponse, origin?: string) {
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private enqueueEvent(event: any) {
    if (this.eventQueue.length >= this.maxQueueSize) {
      log.warn(AIRServer.SCOPE, 'Queue full; dropping oldest event', { maxQueueSize: this.maxQueueSize });
      this.eventQueue.shift();
    }
    this.eventQueue.push(event);
    void this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing || this.eventQueue.length === 0) return;
    this.isProcessing = true;
    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      try {
        await this.storeEvent(event as IncomingEvent);
      } catch (err) {
        log.error(AIRServer.SCOPE, 'Failed to store event', err, {
          eventId: (event as IncomingEvent | undefined)?.id,
          sessionId: (event as IncomingEvent | undefined)?.sessionId,
          type: (event as IncomingEvent | undefined)?.type,
        });
      }
    }
    this.isProcessing = false;
  }

  private async storeEvent(event: IncomingEvent) {
    const sessionId = event.sessionId;
    if (!sessionId) throw new Error('Missing sessionId');

    this.db.prepare('INSERT OR IGNORE INTO sessions (id, started_at) VALUES (?, ?)').run(sessionId, Date.now());

    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO raw_events (
        id, session_id, type, timestamp, trace_id, page_id, frame_id, sequence, page_url, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const eventId = event.id || randomUUID();
    let result: Database.RunResult;
    try {
      result = insert.run(
        eventId,
        sessionId,
        event.type,
        event.timestamp,
        event.traceId || null,
        event.pageId || null,
        event.frameId || null,
        event.sequence ?? null,
        event.pageUrl || null,
        JSON.stringify(event)
      );
    } catch (err) {
      log.error(AIRServer.SCOPE, '[DB_INSERT_FAIL]', err, { event });
      throw err;
    }
    if (result.changes === 0) {
      log.warn(AIRServer.SCOPE, 'Duplicate event ignored by primary key', { eventId, sessionId });
      return;
    }
    log.info(AIRServer.SCOPE, '[EVENT_STORED]', { id: eventId, type: event.type, sessionId, sequence: event.sequence ?? null });
    log.info(AIRServer.SCOPE, '[PIPELINE_OK]', { eventId, type: event.type });
  }

  public async exportSession(sessionId: string, outputPath: string): Promise<void> {
    const rows = this.db.prepare(`
      SELECT * FROM raw_events WHERE session_id = ? ORDER BY sequence ASC, timestamp ASC
    `).all(sessionId) as any[];
    const fs = await import('fs/promises');
    await fs.writeFile(outputPath, JSON.stringify(rows, null, 2));
    log.info(AIRServer.SCOPE, 'Session exported', { sessionId, outputPath, eventCount: rows.length });
  }

  public debugRecentEvents(limit: number = 5): Array<{ id: string; type: string; sequence: number | null; sessionId: string }> {
    const rows = this.db.prepare(`
      SELECT id, type, sequence, session_id
      FROM raw_events
      ORDER BY rowid DESC
      LIMIT ?
    `).all(limit) as Array<{ id: string; type: string; sequence: number | null; session_id: string }>;
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      sequence: row.sequence,
      sessionId: row.session_id,
    }));
  }

  private allowRequestRate(): boolean {
    const now = Date.now();
    if (now - this.reqWindowStartMs >= 1000) {
      this.reqWindowStartMs = now;
      this.reqCountInWindow = 0;
    }
    this.reqCountInWindow += 1;
    return this.reqCountInWindow <= this.maxRequestsPerSecond;
  }

  private allowEventsPerSession(events: IncomingEvent[]): boolean {
    const now = Date.now();
    for (const event of events) {
      const current = this.sessionMinuteCounters.get(event.sessionId);
      if (!current || now - current.windowStartMs >= 60_000) {
        this.sessionMinuteCounters.set(event.sessionId, { windowStartMs: now, count: 1 });
        continue;
      }
      current.count += 1;
      if (current.count > this.maxEventsPerMinutePerSession) {
        return false;
      }
    }
    return true;
  }
}