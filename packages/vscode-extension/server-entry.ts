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

function matchSessionRoute(currentUrl: string): { sessionId: string; action?: string } | null {
  const match = currentUrl.match(/\/api\/sessions\/([^/]+)(?:\/([^/]+))?$/);
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

async function handleExtensionRoutes(req: http.IncomingMessage, res: http.ServerResponse): Promise<boolean> {
  const currentUrl = req.url || '';

  if (req.method === 'GET' && currentUrl === '/api/sessions') {
    const sessions = await listSessions();
    json(res, 200, sessions);
    return true;
  }

  if (req.method === 'GET' && currentUrl === '/api/debug/events') {
    const data = await debugRecentEvents(5);
    json(res, 200, data);
    return true;
  }

  const sessionRoute = matchSessionRoute(currentUrl);
  if (!sessionRoute) {
    return false;
  }

  const { sessionId, action } = sessionRoute;

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
    } catch (error) {
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
    const logger = new DebugLogger(db);

    graphBuilder = new GraphBuilder(
      db,
      nodeRepo,
      edgeRepo,
      eventRepo,
      sessionRepo,
      outcomeRepo,
      pendingRepo,
      StateEngine,
      logger
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
