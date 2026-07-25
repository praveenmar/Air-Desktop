import * as path from 'path';

import * as http from 'http';

import { writeFile } from 'fs/promises';

import { DatabaseService } from './db/database';

import { NodeRepository } from './db/repositories/node.repository';

import { EdgeRepository } from './db/repositories/edge.repository';

import { EventRepository } from './db/repositories/event.repository';

import { SessionRepository } from './db/repositories/session.repository';

import { OutcomeRepository } from './db/repositories/outcome.repository';

import { PendingActionRepository } from './db/repositories/pending-action.repository';

import { InteractionContextRepository } from './db/repositories/interaction-context.repository';

import { DebugLogger } from './logger/debug-logger';

import { StateEngine } from './graph/state-engine';

import { GraphBuilder } from './graph/graph-builder';

import { EventServer } from './event-server';

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });

  res.end(JSON.stringify(body));
}

function parseRequestUrl(req: http.IncomingMessage): URL {
  return new URL(req.url || '/', 'http://127.0.0.1');
}

function parseLimit(rawValue: string | null, fallback: number, max: number): number {
  if (!rawValue) return fallback;

  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed)) return fallback;

  return Math.max(1, Math.min(Math.floor(parsed), max));
}

function parseJsonText(raw: string | null): unknown {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function matchSessionRoute(pathname: string): { sessionId: string; action?: string } | null {
  const match = pathname.match(/\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);

  if (!match) return null;

  return { sessionId: decodeURIComponent(match[1]), action: match[2] };
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));

    req.on('error', reject);

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');

        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function normalizeDebugLogLevel(level: unknown): 'debug' | 'info' | 'warn' | 'error' | 'decision' {
  switch (level) {
    case 'debug':

    case 'info':

    case 'warn':

    case 'error':

    case 'decision':
      return level;

    default:
      return 'info';
  }
}

function clampDebugString(value: unknown, maxLength = 300): string | null {
  if (typeof value !== 'string') return null;

  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength)}...`;
}

function sanitizeDebugLogData(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated-depth]';

  if (typeof value === 'string') {
    return clampDebugString(value, 300);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map((entry) => sanitizeDebugLogData(entry, depth + 1));
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};

    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] = sanitizeDebugLogData(entry, depth + 1);
    }

    return sanitized;
  }

  return value === undefined ? null : String(value);
}

export class PlatformServer {
  private currentSessionId: string | null = null;

  private dbService: DatabaseService | null = null;

  private graphBuilder: GraphBuilder | null = null;

  private eventServer: EventServer | null = null;

  private sessionRepo: SessionRepository | null = null;

  private debugLogger: DebugLogger | null = null;

  private shuttingDown = false;

  public setActiveSessionId(sessionId: string | null) {
    this.currentSessionId = sessionId;

    console.log('[AIR-Server] Session updated', { sessionId: this.currentSessionId });
  }

  public async start(dbPath: string): Promise<number> {
    console.log('[AIR-Server] Starting background process...');

    console.log('[AIR-Server] Initializing SQLite', { dbPath });

    try {
      this.dbService = await DatabaseService.create(dbPath);

      const db = this.dbService.getInstance();

      const nodeRepo = new NodeRepository(db);

      const edgeRepo = new EdgeRepository(db);

      const eventRepo = new EventRepository(db);

      this.sessionRepo = new SessionRepository(db);

      const outcomeRepo = new OutcomeRepository(db);

      const pendingRepo = new PendingActionRepository(db);

      const interactionContextRepo = new InteractionContextRepository(db);

      this.debugLogger = new DebugLogger(db);

      this.graphBuilder = new GraphBuilder(
        db,

        nodeRepo,

        edgeRepo,

        eventRepo,

        this.sessionRepo,

        outcomeRepo,

        pendingRepo,

        interactionContextRepo,

        StateEngine,

        this.debugLogger
      );

      this.graphBuilder.startCleanupService();

      this.eventServer = new EventServer(this.graphBuilder, {
        getActiveSessionId: () => this.currentSessionId,

        extraHandler: this.handleExtensionRoutes.bind(this),
      });

      const port = await this.eventServer.start();

      console.log(`AIR_SERVER_PORT:${port}`);

      console.log('[AIR-Server] Startup sequence complete.');

      return port;
    } catch (error) {
      console.error('[AIR-Server] Critical failure during bootstrap:', error);

      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.shuttingDown) return;

    this.shuttingDown = true;

    console.log('[AIR-Server] Shutdown started');

    try {
      if (this.eventServer) {
        await this.eventServer.stop();
      }

      if (this.graphBuilder) {
        await this.graphBuilder.close();
      }

      if (this.dbService) {
        await this.dbService.close();
      }

      console.log('[AIR-Server] Shutdown complete');
    } catch (error) {
      console.error('[AIR-Server] Shutdown failed', error);

      throw error;
    }
  }

  private async persistInterceptorDiagnostic(body: any): Promise<void> {
    if (!this.debugLogger) {
      throw new Error('Debug logger not initialized');
    }

    const message = clampDebugString(body?.message, 120);

    if (!message) {
      throw new Error('Missing diagnostic message');
    }

    const componentSuffix = clampDebugString(body?.component, 40);

    const component = componentSuffix ? `Interceptor:${componentSuffix}` : 'Interceptor';

    const level = normalizeDebugLogLevel(body?.level);

    const sessionId = clampDebugString(body?.sessionId, 120);

    const traceId = clampDebugString(body?.traceId, 120);

    const sanitizedData = sanitizeDebugLogData(body?.data ?? {});

    const data =
      sanitizedData && typeof sanitizedData === 'object' && !Array.isArray(sanitizedData)
        ? (sanitizedData as Record<string, unknown>)
        : { value: sanitizedData };

    await this.debugLogger.log(component, level, message, data, sessionId, traceId);
  }

  private async listSessions(): Promise<
    Array<{ id: string; startedAt: number; endedAt: number | null }>
  > {
    const repo = this.sessionRepo;

    if (!repo) return [];

    const sessions = await repo.getAll(200);

    return sessions.map((session) => ({
      id: session.id,

      startedAt: session.startedAt,

      endedAt: session.status === 'active' ? null : (session.lastEventAt ?? null),
    }));
  }

  private async markSessionEnded(sessionId: string): Promise<void> {
    if (!this.sessionRepo) {
      throw new Error('Session repository not initialized');
    }

    await this.sessionRepo.markEnded(sessionId);

    console.log('[AIR-Server] Session marked ended', { sessionId });
  }

  private async deleteSession(
    sessionId: string
  ): Promise<{ deletedEvents: number; deletedSessions: number }> {
    if (!this.dbService) {
      throw new Error('Database service not initialized');
    }

    return this.dbService.getInstance().transaction(async () => {
      await this.dbService!.getInstance()
        .prepare('DELETE FROM pending_actions WHERE session_id = ?')
        .run(sessionId);

      await this.dbService!.getInstance()
        .prepare('DELETE FROM interaction_contexts WHERE session_id = ?')
        .run(sessionId);

      await this.dbService!.getInstance()
        .prepare('DELETE FROM session_tab_state WHERE session_id = ?')
        .run(sessionId);

      await this.dbService!.getInstance()
        .prepare(
          `

        DELETE FROM outcomes

        WHERE edge_id IN (

          SELECT id FROM edges

          WHERE trigger_event_id IN (

            SELECT id FROM events WHERE session_id = ?

          )

        )

      `
        )
        .run(sessionId);

      await this.dbService!.getInstance()
        .prepare(
          `

        DELETE FROM edges

        WHERE trigger_event_id IN (

          SELECT id FROM events WHERE session_id = ?

        )

      `
        )
        .run(sessionId);

      const deleteEvents = await this.dbService!.getInstance()
        .prepare('DELETE FROM events WHERE session_id = ?')
        .run(sessionId);

      const deleteSessionResult = await this.dbService!.getInstance()
        .prepare('DELETE FROM sessions WHERE id = ?')
        .run(sessionId);

      const result = {
        deletedEvents: deleteEvents.changes,

        deletedSessions: deleteSessionResult.changes,
      };

      console.log('[AIR-Server] Session deleted', { sessionId, ...result });

      return result;
    });
  }

  private async exportSession(sessionId: string, outputPath: string): Promise<void> {
    if (!this.dbService) {
      throw new Error('Database service not initialized');
    }

    const rows = (await this.dbService
      .getInstance()
      .prepare(
        `

      SELECT

        id,

        session_id,

        type,

        timestamp,

        trace_id,

        page_url,

        payload

      FROM events

      WHERE session_id = ?

      ORDER BY timestamp ASC

    `
      )
      .all(sessionId)) as Array<{
      id: string;

      session_id: string;

      type: string;

      timestamp: number;

      trace_id: string | null;

      page_url: string | null;

      payload: string;
    }>;

    const exportedRows = rows.map((row) => ({
      id: row.id,

      session_id: row.session_id,

      type: row.type,

      timestamp: row.timestamp,

      trace_id: row.trace_id,

      page_id: null,

      frame_id: null,

      sequence: null,

      page_url: row.page_url,

      payload: row.payload,

      created_at: row.timestamp,
    }));

    const resolvedPath = path.resolve(outputPath);

    await writeFile(resolvedPath, JSON.stringify(exportedRows, null, 2), 'utf8');

    console.log('[AIR-Server] Session exported', {
      sessionId,

      outputPath: resolvedPath,

      eventCount: exportedRows.length,
    });
  }

  private async debugRecentEvents(
    limit = 5
  ): Promise<Array<{ id: string; type: string; sequence: number | null; sessionId: string }>> {
    if (!this.dbService) {
      throw new Error('Database service not initialized');
    }

    const rows = (await this.dbService
      .getInstance()
      .prepare(
        `

      SELECT id, type, session_id

      FROM events

      ORDER BY timestamp DESC

      LIMIT ?

    `
      )
      .all(limit)) as Array<{ id: string; type: string; session_id: string }>;

    return rows.map((row) => ({
      id: row.id,

      type: row.type,

      sequence: null,

      sessionId: row.session_id,
    }));
  }

  private async debugRecentLogs(limit = 100): Promise<unknown[]> {
    if (!this.debugLogger) {
      return [];
    }

    return this.debugLogger.getRecent(limit);
  }

  private async inspectSession(sessionId: string): Promise<Record<string, unknown>> {
    if (!this.dbService) {
      throw new Error('Database service not initialized');
    }

    const db = this.dbService.getInstance();

    const sessionRow = await db
      .prepare(
        `

      SELECT id, started_at, last_event_at, last_node_id, event_count, status, metadata

      FROM sessions

      WHERE id = ?

      LIMIT 1

    `
      )
      .get<{
        id: string;

        started_at: number;

        last_event_at: number | null;

        last_node_id: string | null;

        event_count: number;

        status: string;

        metadata: string | null;
      }>(sessionId);

    if (!sessionRow) {
      throw new Error('Session not found');
    }

    const eventCountRow = await db
      .prepare('SELECT COUNT(*) AS count FROM events WHERE session_id = ?')
      .get<{ count: number }>(sessionId);

    const edgeCountRow = await db
      .prepare(
        `

      SELECT COUNT(*) AS count

      FROM edges

      WHERE trigger_event_id IN (

        SELECT id FROM events WHERE session_id = ?

      )

    `
      )
      .get<{ count: number }>(sessionId);

    const outcomeCountRow = await db
      .prepare(
        `

      SELECT COUNT(*) AS count

      FROM outcomes

      WHERE edge_id IN (

        SELECT e.id FROM edges e

        JOIN events ev ON ev.id = e.trigger_event_id

        WHERE ev.session_id = ?

      )

    `
      )
      .get<{ count: number }>(sessionId);

    const pendingCountRow = await db
      .prepare('SELECT COUNT(*) AS count FROM pending_actions WHERE session_id = ?')
      .get<{ count: number }>(sessionId);

    const interactionContextCountRow = await db

      .prepare('SELECT COUNT(*) AS count FROM interaction_contexts WHERE session_id = ?')

      .get<{ count: number }>(sessionId);

    const nodeCountRow = await db
      .prepare(
        `

      SELECT COUNT(*) AS count FROM nodes

      WHERE id IN (

        SELECT node_id FROM events WHERE session_id = ? AND node_id IS NOT NULL

        UNION

        SELECT from_node_id FROM edges e

        JOIN events ev ON ev.id = e.trigger_event_id

        WHERE ev.session_id = ? AND from_node_id IS NOT NULL

        UNION

        SELECT to_node_id FROM edges e

        JOIN events ev ON ev.id = e.trigger_event_id

        WHERE ev.session_id = ? AND to_node_id IS NOT NULL

      )

    `
      )
      .get<{ count: number }>(sessionId, sessionId, sessionId);

    const recentEvents = await db
      .prepare(
        `

      SELECT id, type, timestamp, trace_id, node_id, page_url, payload, intent, intent_raw

      FROM events

      WHERE session_id = ?

      ORDER BY timestamp DESC

      LIMIT 250

    `
      )
      .all<{
        id: string;

        type: string;

        timestamp: number;

        trace_id: string | null;

        node_id: string | null;

        page_url: string | null;

        payload: string;

        intent: string | null;

        intent_raw: string | null;
      }>(sessionId);

    const nodes = await db
      .prepare(
        `

      SELECT DISTINCT n.id, n.page_url, n.normalized_url, n.page_title, n.state_source,

                      n.control_signature, n.canonical_hash, n.created_at,

                      n.last_observed_at, n.observation_count

      FROM nodes n

      WHERE n.id IN (

        SELECT node_id FROM events WHERE session_id = ? AND node_id IS NOT NULL

        UNION

        SELECT from_node_id FROM edges e

        JOIN events ev ON ev.id = e.trigger_event_id

        WHERE ev.session_id = ? AND from_node_id IS NOT NULL

        UNION

        SELECT to_node_id FROM edges e

        JOIN events ev ON ev.id = e.trigger_event_id

        WHERE ev.session_id = ? AND to_node_id IS NOT NULL

      )

      ORDER BY n.last_observed_at DESC

      LIMIT 250

    `
      )
      .all(sessionId, sessionId, sessionId);

    const edges = await db
      .prepare(
        `

      SELECT e.id, e.from_node_id, e.to_node_id, e.trigger_event_id,

             e.fingerprint_hash, e.seek_strategy, e.sample_size,

             e.last_updated, e.outcome_type

      FROM edges e

      JOIN events ev ON ev.id = e.trigger_event_id

      WHERE ev.session_id = ?

      ORDER BY e.last_updated DESC

      LIMIT 250

    `
      )
      .all(sessionId);

    const outcomes = await db
      .prepare(
        `

      SELECT o.id, o.edge_id, o.target_node_id, o.probability, o.decayed_count, o.last_observed

      FROM outcomes o

      JOIN edges e ON e.id = o.edge_id

      JOIN events ev ON ev.id = e.trigger_event_id

      WHERE ev.session_id = ?

      ORDER BY o.last_observed DESC

      LIMIT 250

    `
      )
      .all(sessionId);

    const pendingActions = await db
      .prepare(
        `

      SELECT trace_id, session_id, from_node_id, trigger_event_id,

             action_type, fingerprint_hash, created_at, resolved_at, status

      FROM pending_actions

      WHERE session_id = ?

      ORDER BY created_at DESC

      LIMIT 250

    `
      )
      .all(sessionId);

    const interactionContexts = await db
      .prepare(
        `

      SELECT

        id,

        normalized_url,

        control_signature,

        is_stable,

        captured_at,

        viewport_width,

        viewport_height,

        LENGTH(snapshot_html) AS snapshot_size

      FROM interaction_contexts

      WHERE session_id = ?

      ORDER BY is_stable DESC, captured_at DESC

      LIMIT 250

    `
      )
      .all<{
        id: string;

        normalized_url: string;

        control_signature: string;

        is_stable: number;

        captured_at: number;

        viewport_width: number | null;

        viewport_height: number | null;

        snapshot_size: number | null;
      }>(sessionId);

    const recentLogs = await db
      .prepare(
        `

      SELECT id, timestamp, component, level, message, data, session_id, trace_id

      FROM debug_logs

      WHERE session_id = ?

      ORDER BY timestamp DESC

      LIMIT 300

    `
      )
      .all<{
        id: string;

        timestamp: number;

        component: string;

        level: string;

        message: string;

        data: string | null;

        session_id: string | null;

        trace_id: string | null;
      }>(sessionId);

    return {
      session: {
        id: sessionRow.id,

        startedAt: sessionRow.started_at,

        lastEventAt: sessionRow.last_event_at,

        lastNodeId: sessionRow.last_node_id,

        eventCount: sessionRow.event_count,

        status: sessionRow.status,

        metadata: parseJsonText(sessionRow.metadata),
      },

      counts: {
        events: eventCountRow?.count ?? 0,

        nodes: nodeCountRow?.count ?? 0,

        edges: edgeCountRow?.count ?? 0,

        outcomes: outcomeCountRow?.count ?? 0,

        pendingActions: pendingCountRow?.count ?? 0,

        interactionContexts: interactionContextCountRow?.count ?? 0,

        debugLogs: recentLogs.length,
      },

      recentEvents: recentEvents.map((row) => ({
        id: row.id,

        type: row.type,

        timestamp: row.timestamp,

        traceId: row.trace_id,

        nodeId: row.node_id,

        pageUrl: row.page_url,

        intent: row.intent,

        intentRaw: row.intent_raw,

        payload: parseJsonText(row.payload),
      })),

      nodes,

      edges,

      outcomes,

      pendingActions,

      interactionContexts: interactionContexts.map((row) => ({
        id: row.id,

        normalizedUrl: row.normalized_url,

        controlSignature: row.control_signature,

        isStable: row.is_stable === 1,

        capturedAt: row.captured_at,

        viewport: {
          width: row.viewport_width,

          height: row.viewport_height,
        },

        snapshotSize: row.snapshot_size ?? 0,
      })),

      recentLogs: recentLogs.map((row) => ({
        id: row.id,

        timestamp: row.timestamp,

        component: row.component,

        level: row.level,

        message: row.message,

        data: parseJsonText(row.data),

        sessionId: row.session_id,

        traceId: row.trace_id,
      })),
    };
  }

  private async handleExtensionRoutes(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<boolean> {
    const requestUrl = parseRequestUrl(req);

    const pathname = requestUrl.pathname;

    if (req.method === 'GET' && pathname === '/api/sessions') {
      const sessions = await this.listSessions();

      json(res, 200, sessions);

      return true;
    }

    if (req.method === 'GET' && pathname === '/api/debug/events') {
      const limit = parseLimit(requestUrl.searchParams.get('limit'), 5, 200);

      const data = await this.debugRecentEvents(limit);

      json(res, 200, data);

      return true;
    }

    if (req.method === 'GET' && pathname === '/api/debug/logs') {
      const limit = parseLimit(requestUrl.searchParams.get('limit'), 100, 500);

      const logs = await this.debugRecentLogs(limit);

      json(res, 200, logs);

      return true;
    }

    if (req.method === 'POST' && pathname === '/api/debug/logs/interceptor') {
      let body: any;

      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, { success: false, error: 'Invalid JSON body' });

        return true;
      }

      try {
        await this.persistInterceptorDiagnostic(body);

        json(res, 200, { success: true });
      } catch (error) {
        json(res, 400, {
          success: false,

          error: (error as Error).message || 'Failed to persist interceptor diagnostic',
        });
      }

      return true;
    }

    const sessionRoute = matchSessionRoute(pathname);

    if (!sessionRoute) {
      return false;
    }

    const { sessionId, action } = sessionRoute;

    if (req.method === 'GET' && action === 'inspect') {
      try {
        const snapshot = await this.inspectSession(sessionId);

        json(res, 200, snapshot);
      } catch (error) {
        const message = (error as Error).message || 'Inspect failed';

        const status = message === 'Session not found' ? 404 : 500;

        json(res, status, { success: false, error: message });
      }

      return true;
    }

    if (req.method === 'POST' && action === 'end') {
      await this.markSessionEnded(sessionId);

      json(res, 200, { success: true });

      return true;
    }

    if (req.method === 'DELETE' && !action) {
      try {
        const result = await this.deleteSession(sessionId);

        json(res, 200, result);
      } catch (error) {
        const message = (error as Error).message || 'Delete failed';

        console.error('[AIR-Server] Session delete failed', { sessionId, error: message });

        json(res, 500, { success: false, error: message });
      }

      return true;
    }

    if (req.method === 'POST' && action === 'export') {
      let body: any;

      try {
        body = await readJsonBody(req);
      } catch {
        json(res, 400, { success: false, error: 'Invalid JSON body' });

        return true;
      }

      if (!body?.outputPath || typeof body.outputPath !== 'string') {
        json(res, 400, { success: false, error: 'Missing outputPath' });

        return true;
      }

      await this.exportSession(sessionId, body.outputPath);

      json(res, 200, { success: true });

      return true;
    }

    json(res, 404, { success: false, error: 'Unknown session route' });

    return true;
  }
}
