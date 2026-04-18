/**
 * Background server entry point for the AIR VS Code Extension.
 * Uses canonical pipeline: EventServer -> GraphBuilder -> core schema.
 */

import * as path from 'path';
import * as http from 'http';
import { writeFile } from 'fs/promises';
import { DatabaseService } from '../../core/db/database';
import { NodeRepository } from '../../core/db/repositories/node.repository';
import { EdgeRepository } from '../../core/db/repositories/edge.repository';
import { EventRepository } from '../../core/db/repositories/event.repository';
import { SessionRepository } from '../../core/db/repositories/session.repository';
import { OutcomeRepository } from '../../core/db/repositories/outcome.repository';
import { PendingActionRepository } from '../../core/db/repositories/pending-action.repository';
import { InteractionContextRepository } from '../../core/db/repositories/interaction-context.repository';
import { DebugLogger } from '../../core/logger/debug-logger';
import { StateEngine } from '../../core/graph/state-engine';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { EventServer } from '../../electron/main/event-server';

const dbPath = process.env.AIR_DB_PATH;
if (!dbPath) {
  console.error('[AIR-Server] FATAL: AIR_DB_PATH environment variable is missing.');
  process.exit(1);
}

let currentSessionId: string | null = null;
let dbService: DatabaseService | null = null;
let graphBuilder: GraphBuilder | null = null;
let eventServer: EventServer | null = null;
let sessionRepo: SessionRepository | null = null;
let debugLogger: DebugLogger | null = null;

process.on('uncaughtException', (error) => {
  console.error('[AIR-Server] Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[AIR-Server] Unhandled rejection', reason);
});

process.on('message', (msg: any) => {
  if (msg?.type === 'SET_SESSION') {
    if (typeof msg.sessionId === 'string' || msg.sessionId === null) {
      currentSessionId = msg.sessionId;
      console.log('[AIR-Server] Session updated', { sessionId: currentSessionId });
    } else {
      console.warn('[AIR-Server] Invalid SET_SESSION payload received.');
    }
  }
});

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

async function listSessions(): Promise<Array<{ id: string; startedAt: number; endedAt: number | null }>> {
  const repo = sessionRepo;
  if (!repo) return [];

  const sessions = await repo.getAll(200);
  return sessions.map((session) => ({
    id: session.id,
    startedAt: session.startedAt,
    endedAt: session.status === 'active' ? null : (session.lastEventAt ?? null),
  }));
}

async function markSessionEnded(sessionId: string): Promise<void> {
  if (!sessionRepo) {
    throw new Error('Session repository not initialized');
  }
  await sessionRepo.markEnded(sessionId);
  console.log('[AIR-Server] Session marked ended', { sessionId });
}

async function deleteSession(sessionId: string): Promise<{ deletedEvents: number; deletedSessions: number }> {
  if (!dbService) {
    throw new Error('Database service not initialized');
  }

  return dbService.getInstance().transaction(async () => {
    await dbService!.getInstance().prepare('DELETE FROM pending_actions WHERE session_id = ?').run(sessionId);
    await dbService!.getInstance().prepare('DELETE FROM interaction_contexts WHERE session_id = ?').run(sessionId);

    await dbService!.getInstance().prepare(`
      DELETE FROM outcomes
      WHERE edge_id IN (
        SELECT id FROM edges
        WHERE trigger_event_id IN (
          SELECT id FROM events WHERE session_id = ?
        )
      )
    `).run(sessionId);

    await dbService!.getInstance().prepare(`
      DELETE FROM edges
      WHERE trigger_event_id IN (
        SELECT id FROM events WHERE session_id = ?
      )
    `).run(sessionId);

    const deleteEvents = await dbService!.getInstance().prepare('DELETE FROM events WHERE session_id = ?').run(sessionId);
    const deleteSessionResult = await dbService!.getInstance().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

    const result = {
      deletedEvents: deleteEvents.changes,
      deletedSessions: deleteSessionResult.changes,
    };

    console.log('[AIR-Server] Session deleted', { sessionId, ...result });
    return result;
  });
}

async function exportSession(sessionId: string, outputPath: string): Promise<void> {
  if (!dbService) {
    throw new Error('Database service not initialized');
  }

  const rows = await dbService.getInstance().prepare(`
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
  `).all(sessionId) as Array<{
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

async function debugRecentEvents(limit = 5): Promise<Array<{ id: string; type: string; sequence: number | null; sessionId: string }>> {
  if (!dbService) {
    throw new Error('Database service not initialized');
  }

  const rows = await dbService.getInstance().prepare(`
    SELECT id, type, session_id
    FROM events
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; type: string; session_id: string }>;

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    sequence: null,
    sessionId: row.session_id,
  }));
}

async function debugRecentLogs(limit = 100): Promise<unknown[]> {
  if (!debugLogger) {
    return [];
  }
  return debugLogger.getRecent(limit);
}

async function inspectSession(sessionId: string): Promise<Record<string, unknown>> {
  if (!dbService) {
    throw new Error('Database service not initialized');
  }

  const db = dbService.getInstance();

  const sessionRow = await db.prepare(`
    SELECT id, started_at, last_event_at, last_node_id, event_count, status, metadata
    FROM sessions
    WHERE id = ?
    LIMIT 1
  `).get<{
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

  const eventCountRow = await db.prepare('SELECT COUNT(*) AS count FROM events WHERE session_id = ?').get<{ count: number }>(sessionId);
  const edgeCountRow = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM edges
    WHERE trigger_event_id IN (
      SELECT id FROM events WHERE session_id = ?
    )
  `).get<{ count: number }>(sessionId);
  const outcomeCountRow = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM outcomes
    WHERE edge_id IN (
      SELECT e.id FROM edges e
      JOIN events ev ON ev.id = e.trigger_event_id
      WHERE ev.session_id = ?
    )
  `).get<{ count: number }>(sessionId);
  const pendingCountRow = await db.prepare('SELECT COUNT(*) AS count FROM pending_actions WHERE session_id = ?').get<{ count: number }>(sessionId);
  const interactionContextCountRow = await db
    .prepare('SELECT COUNT(*) AS count FROM interaction_contexts WHERE session_id = ?')
    .get<{ count: number }>(sessionId);
  const nodeCountRow = await db.prepare(`
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
  `).get<{ count: number }>(sessionId, sessionId, sessionId);

  const recentEvents = await db.prepare(`
    SELECT id, type, timestamp, trace_id, node_id, page_url, payload, intent, intent_raw
    FROM events
    WHERE session_id = ?
    ORDER BY timestamp DESC
    LIMIT 250
  `).all<{
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

  const nodes = await db.prepare(`
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
  `).all(sessionId, sessionId, sessionId);

  const edges = await db.prepare(`
    SELECT e.id, e.from_node_id, e.to_node_id, e.trigger_event_id,
           e.fingerprint_hash, e.seek_strategy, e.sample_size,
           e.last_updated, e.outcome_type
    FROM edges e
    JOIN events ev ON ev.id = e.trigger_event_id
    WHERE ev.session_id = ?
    ORDER BY e.last_updated DESC
    LIMIT 250
  `).all(sessionId);

  const outcomes = await db.prepare(`
    SELECT o.id, o.edge_id, o.target_node_id, o.probability, o.decayed_count, o.last_observed
    FROM outcomes o
    JOIN edges e ON e.id = o.edge_id
    JOIN events ev ON ev.id = e.trigger_event_id
    WHERE ev.session_id = ?
    ORDER BY o.last_observed DESC
    LIMIT 250
  `).all(sessionId);

  const pendingActions = await db.prepare(`
    SELECT trace_id, session_id, from_node_id, trigger_event_id,
           action_type, fingerprint_hash, created_at, resolved_at, status
    FROM pending_actions
    WHERE session_id = ?
    ORDER BY created_at DESC
    LIMIT 250
  `).all(sessionId);

  const interactionContexts = await db.prepare(`
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
  `).all<{
    id: string;
    normalized_url: string;
    control_signature: string;
    is_stable: number;
    captured_at: number;
    viewport_width: number | null;
    viewport_height: number | null;
    snapshot_size: number | null;
  }>(sessionId);

  const recentLogs = await db.prepare(`
    SELECT id, timestamp, component, level, message, data, session_id, trace_id
    FROM debug_logs
    WHERE session_id = ?
    ORDER BY timestamp DESC
    LIMIT 300
  `).all<{
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

async function handleExtensionRoutes(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const requestUrl = parseRequestUrl(req);
  const pathname = requestUrl.pathname;

  if (req.method === 'GET' && pathname === '/api/sessions') {
    const sessions = await listSessions();
    json(res, 200, sessions);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/debug/events') {
    const limit = parseLimit(requestUrl.searchParams.get('limit'), 5, 200);
    const data = await debugRecentEvents(limit);
    json(res, 200, data);
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/debug/logs') {
    const limit = parseLimit(requestUrl.searchParams.get('limit'), 100, 500);
    const logs = await debugRecentLogs(limit);
    json(res, 200, logs);
    return true;
  }

  const sessionRoute = matchSessionRoute(pathname);
  if (!sessionRoute) {
    return false;
  }

  const { sessionId, action } = sessionRoute;

  if (req.method === 'GET' && action === 'inspect') {
    try {
      const snapshot = await inspectSession(sessionId);
      json(res, 200, snapshot);
    } catch (error) {
      const message = (error as Error).message || 'Inspect failed';
      const status = message === 'Session not found' ? 404 : 500;
      json(res, status, { success: false, error: message });
    }
    return true;
  }

  if (req.method === 'POST' && action === 'end') {
    await markSessionEnded(sessionId);
    json(res, 200, { success: true });
    return true;
  }

  if (req.method === 'DELETE' && !action) {
    const result = await deleteSession(sessionId);
    json(res, 200, result);
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

    await exportSession(sessionId, body.outputPath);
    json(res, 200, { success: true });
    return true;
  }

  json(res, 404, { success: false, error: 'Unknown session route' });
  return true;
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log('[AIR-Server] Shutdown started', { signal });

  try {
    if (eventServer) {
      await eventServer.stop();
    }
    if (graphBuilder) {
      await graphBuilder.close();
    }
    if (dbService) {
      await dbService.close();
    }
    console.log('[AIR-Server] Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[AIR-Server] Shutdown failed', error);
    process.exit(1);
  }
}

async function bootstrap() {
  console.log('[AIR-Server] Starting background process...');
  console.log('[AIR-Server] Initializing SQLite', { dbPath });

  try {
    dbService = await DatabaseService.create(dbPath as string);
    const db = dbService.getInstance();

    const nodeRepo = new NodeRepository(db);
    const edgeRepo = new EdgeRepository(db);
    const eventRepo = new EventRepository(db);
    sessionRepo = new SessionRepository(db);
    const outcomeRepo = new OutcomeRepository(db);
    const pendingRepo = new PendingActionRepository(db);
    const interactionContextRepo = new InteractionContextRepository(db);
    debugLogger = new DebugLogger(db);

    graphBuilder = new GraphBuilder(
      db,
      nodeRepo,
      edgeRepo,
      eventRepo,
      sessionRepo,
      outcomeRepo,
      pendingRepo,
      interactionContextRepo,
      StateEngine,
      debugLogger
    );

    graphBuilder.startCleanupService();

    eventServer = new EventServer(graphBuilder, {
      getActiveSessionId: () => currentSessionId,
      extraHandler: handleExtensionRoutes,
    });

    const port = await eventServer.start();

    console.log(`AIR_SERVER_PORT:${port}`);
    console.log('[AIR-Server] Startup sequence complete.');
  } catch (error) {
    console.error('[AIR-Server] Critical failure during bootstrap:', error);
    process.exit(1);
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('disconnect', () => { void shutdown('disconnect'); });

bootstrap();
