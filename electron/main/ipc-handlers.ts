// Purpose: Maps IPC channels to underlying business logic.
// Prototype Origin: routes.js (REST endpoints converted to IPC).
// Changes: Exposes UI layer functions bridging to GraphBuilder and Repositories.

import { ipcMain } from 'electron';
import { WindowManager } from './window-manager';
import { CDPBridge } from './cdp-bridge';
import { GraphBuilder } from '../../core/graph/graph-builder';
import { NodeRepository } from '../../core/db/repositories/node.repository';
import { EdgeRepository } from '../../core/db/repositories/edge.repository';
import { SessionRepository } from '../../core/db/repositories/session.repository';
import { DatabaseService } from '../../core/db/database';
import { EventServer } from '../main/event-server';
import { browserManager } from './browser-manager';

export function registerIpcHandlers(
  windowManager: WindowManager,
  cdpBridge: CDPBridge,
  graphBuilder: GraphBuilder,
  nodeRepo: NodeRepository,
  edgeRepo: EdgeRepository,
  sessionRepo: SessionRepository,
  dbService: DatabaseService,
  serverPort: number
): void {
  
 // Start Recording
  ipcMain.handle('recording:start', async (_, url: string) => {
    try {
      
      // Launch Playwright! and // Get the live port our local Node server is listening on
      await browserManager.startRecording(url, serverPort);
      
      return { success: true };
    } catch (error) {
      console.error('Failed to start Playwright recording:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Stop Recording
  ipcMain.handle('recording:stop', async () => {
    try {
      await browserManager.stopRecording();
      return { success: true };
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
    
    const nodeIds = db.prepare(`SELECT DISTINCT node_id FROM events WHERE session_id = ? AND node_id IS NOT NULL`)
      .all(sessionId)
      .map((r: any) => r.node_id);

    if (nodeIds.length === 0) return { nodes: [], edges: [] };

    const placeholders = nodeIds.map(() => '?').join(',');
    const nodes = db.prepare(`SELECT * FROM nodes WHERE id IN (${placeholders})`).all(...nodeIds);
    
    // CHANGED: We now pull ev.payload instead of ev.fingerprint
    const rawEdges = nodeIds.length > 1 
      ? db.prepare(`
          SELECT 
            e.*, 
            ev.type as action_type, 
            ev.payload as raw_payload 
          FROM edges e
          LEFT JOIN events ev ON e.trigger_event_id = ev.id
          WHERE e.from_node_id IN (${placeholders}) AND e.to_node_id IN (${placeholders})
        `).all(...nodeIds, ...nodeIds)
      : [];

    const edges = rawEdges.map((e: any) => {
      let extractedFingerprint = null;
      let selector = e.fingerprint_hash; 
      let actionType = e.action_type || 'click';

      // Parse the 'payload' column to extract the rich SDET data
      if (e.raw_payload) {
        try {
          const parsedPayload = JSON.parse(e.raw_payload);
          
          // Depending on how the interceptor sends it, the fingerprint is usually 
          // at payload.fingerprint or payload.meta.fingerprint
          extractedFingerprint = parsedPayload.fingerprint || parsedPayload.meta?.fingerprint || {};
          
          selector = extractedFingerprint.selector || selector;

          // If it's an input action, let's grab the actual text you typed so it shows in the UI!
          if (parsedPayload.type === 'input' && parsedPayload.meta?.value) {
            extractedFingerprint.textExcerpt = parsedPayload.meta.value;
            actionType = 'input';
          }

        } catch (err) {
          console.error('Failed to parse payload for edge:', e.id);
        }
      }

      return {
        ...e, 
        action_type: actionType, 
        fingerprint: extractedFingerprint,
        selector: selector 
      };
    });

    return { nodes, edges };
  });

  // --- RESET ---
  ipcMain.handle('db:reset', () => {
    const db = dbService.getInstance();
    try {
      // Order matters: children before parents (FK constraints)
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