// Purpose: Maps IPC channels to underlying business logic.
// Prototype Origin: routes.js (REST endpoints converted to IPC).
// Changes: Exposes UI layer functions bridging to GraphBuilder and Repositories.
// Fix (Bug #2): session:get-graph maps raw SQLite rows to camelCase before sending to renderer.
// Fix (Bug #4): session:get-graph uses JOIN/subquery instead of IN spread to avoid SQLite 999-var limit.
// Fix (Bug #7): Added two missing IPC channels related to the live server port:
//   - 'get-interceptor-config' (sync): interceptor_preload.ts calls this via sendSync to get
//     the real ephemeral port. Without this handler the call returned undefined and the
//     preload always fell back to port 3000, meaning __AIR_CONFIG.eventServerPort was always
//     wrong and the interceptor pointed at the wrong server.
//   - 'server:get-port' (async): lets the renderer read the real live port if it needs to
//     display it in the UI (replaces the stale eventServerPort in settings_store).

import { ipcMain } from 'electron';
import { WindowManager } from './window-manager';
import { CDPBridge } from './cdp-bridge';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { NodeRepository } from '../../core/db/repositories/node.repository';
import { EdgeRepository } from '../../core/db/repositories/edge.repository';
import { SessionRepository } from '../../core/db/repositories/session.repository';
import { DatabaseService } from '../../core/db/database';
import { browserManager } from './browser-manager';

// --- Row mappers for the session:get-graph raw SQL path ---

function mapNodeRow(row: any) {
  if (!row) return null;
  return {
    id:               row.id,
    projectId:        row.project_id,
    canonicalHash:    row.canonical_hash,
    pageUrl:          row.page_url,
    pageTitle:        row.page_title,
    snapshotHtml:     row.snapshot_html,
    contextTokens:    row.context_tokens,
    anchors:          row.anchors,
    stateSource:      row.state_source,
    viewportWidth:    row.viewport_width,
    viewportHeight:   row.viewport_height,
    createdAt:        row.created_at,
    lastObservedAt:   row.last_observed_at,
    observationCount: row.observation_count,
    metadata:         row.metadata,
  };
}

function mapEdgeRow(row: any) {
  if (!row) return null;
  return {
    id:              row.id,
    fromNodeId:      row.from_node_id,
    toNodeId:        row.to_node_id,
    triggerEventId:  row.trigger_event_id,
    fingerprintHash: row.fingerprint_hash,
    seekStrategy:    row.seek_strategy || null,
    sampleSize:      row.sample_size,
    lastUpdated:     row.last_updated,
    outcomeType:     row.outcome_type || null,
  };
}

export function registerIpcHandlers(
  windowManager: WindowManager,
  cdpBridge: CDPBridge,
  graphBuilder: GraphBuilder,
  nodeRepo: NodeRepository,
  edgeRepo: EdgeRepository,
  sessionRepo: SessionRepository,
  dbService: DatabaseService,
  serverPort: number             // the real OS-assigned ephemeral port
): void {
  
  // Fix: hoist currentSessionId into the registerIpcHandlers closure (same pattern as
  // serverPort). Birth it exactly once in 'recording:start' (user-initiated, single-fire).
  // Return the SAME value from every 'get-interceptor-config' call for that recording.
  // Clear it in 'recording:stop' so the next recording gets a fresh ID.
  let currentSessionId: string | null = null;

  // --- SERVER ---

  // FIX (Bug #7a): interceptor_preload.ts calls this synchronously via ipcRenderer.sendSync
  // to get the live port before injecting the interceptor. Without this handler the call
  // returned undefined and __AIR_CONFIG.eventServerPort was always 3000 (wrong).
  ipcMain.on('get-interceptor-config', (event) => {
    event.returnValue = {
      eventServerPort: serverPort,
      // Return the stable session ID birthed in recording:start.
      // Fallback generates a one-off ID only if the preload fires before recording:start
      // (e.g. a cold window open) — those orphaned events will carry a consistent ID
      // at least within that preload execution cycle.
      sessionId: currentSessionId ?? `session-fallback-${Date.now()}`,
    };
  });

  // FIX (Bug #7b): Async channel so the renderer can read the real live port if needed
  // (e.g. to display in a debug panel). Replaces the stale eventServerPort in settings_store.
  ipcMain.handle('server:get-port', () => serverPort);

  // --- RECORDING ---

  ipcMain.handle('recording:start', async (_, url: string) => {
    try {
      // Birth the session ID here — once per recording, before the browser opens.
      // This ID is returned by every subsequent 'get-interceptor-config' call
      // for the duration of this recording, keeping all interceptor events in one
      // DB session regardless of how many times the preload script re-executes.
      currentSessionId = `session-${Date.now()}`;

      await browserManager.startRecording(url, serverPort);
      return { success: true, sessionId: currentSessionId };
    } catch (error) {
      console.error('Failed to start Playwright recording:', error);
      currentSessionId = null; // don't leave a stale ID if launch failed
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('recording:stop', async () => {
    try {
      await browserManager.stopRecording();
      const completedSessionId = currentSessionId;
      currentSessionId = null; // clear so the next recording gets a fresh ID
      return { success: true, sessionId: completedSessionId };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle('recording:status', () => {
    const isRecording = windowManager.getRecordingWindow() !== null;
    return { isRecording };
  });

  // --- GRAPH DATA ---

  ipcMain.handle('graph:get-stats', () => {
    return graphBuilder.getStats();
  });

  ipcMain.handle('graph:get-nodes', (_, limit: number = 100) => {
    return nodeRepo.getAll(limit);
  });

  ipcMain.handle('graph:get-edges', (_, limit: number = 100) => {
    return edgeRepo.getAll(limit);
  });

  // --- SESSIONS ---

  ipcMain.handle('session:list', (_, limit: number = 20) => {
    return sessionRepo.getAll(limit);
  });

  ipcMain.handle('session:get-graph', (_, sessionId: string) => {
    const db = dbService.getInstance();

    // Nodes: JOIN to events to scope by session — no nodeId array needed.
    const nodes = db.prepare(`
      SELECT DISTINCT n.*
      FROM nodes n
      INNER JOIN events e ON e.node_id = n.id
      WHERE e.session_id = ?
    `).all(sessionId).map(mapNodeRow);

    if (nodes.length === 0) return { nodes: [], edges: [] };

    // Edges: correlated subqueries — sessionId bound exactly twice, no variable limit.
    const rawEdges = db.prepare(`
      SELECT
        e.*,
        ev.type    AS action_type,
        ev.payload AS raw_payload,
        ev.intent  AS semantic_intent
      FROM edges e
      LEFT JOIN events ev ON e.trigger_event_id = ev.id
      WHERE e.from_node_id IN (
              SELECT DISTINCT node_id FROM events
              WHERE session_id = ? AND node_id IS NOT NULL
            )
        AND e.to_node_id IN (
              SELECT DISTINCT node_id FROM events
              WHERE session_id = ? AND node_id IS NOT NULL
            )
    `).all(sessionId, sessionId) as any[];

    const edges = rawEdges.map((e: any) => {
      const mappedEdge = mapEdgeRow(e);

      let extractedFingerprint = null;
      let selector   = e.fingerprint_hash;
      let actionType = e.action_type || 'click';

      if (e.raw_payload) {
        try {
          const parsedPayload = JSON.parse(e.raw_payload);
          extractedFingerprint = parsedPayload.fingerprint || parsedPayload.meta?.fingerprint || {};
          selector = extractedFingerprint.selector || selector;

          if (parsedPayload.type === 'input' && parsedPayload.meta?.value) {
            extractedFingerprint.textExcerpt = parsedPayload.meta.value;
            actionType = 'input';
          }
        } catch (err) {
          console.error('Failed to parse payload for edge:', e.id);
        }
      }

      return {
        ...mappedEdge,
        action_type: actionType,
        fingerprint: extractedFingerprint,
        selector,
        intent: e.semantic_intent || actionType,
      };
    });

    return { nodes, edges };
  });

  // --- RESET ---

  ipcMain.handle('db:reset', () => {
    const db = dbService.getInstance();
    try {
      const tables = ['pending_actions', 'outcomes', 'edges', 'events', 'nodes', 'sessions', 'debug_logs'];
      db.exec('BEGIN TRANSACTION');
      for (const table of tables) {
        db.prepare(`DELETE FROM ${table}`).run();
      }
      db.exec('COMMIT');
      return { success: true };
    } catch (error) {
      db.exec('ROLLBACK');
      return { success: false, error: (error as Error).message };
    }
  });
}