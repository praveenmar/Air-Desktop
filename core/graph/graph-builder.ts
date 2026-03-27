// Purpose: The main orchestrator connecting Handlers, DB Repositories, and the Event Stream.
// Prototype Origin: graph-builder.js (Main class body, processEvent, getStats, startCleanupService)
// Changes: Strictly typed Dependency Injection container.
// Fix (Bug #3): All write steps inside processEvent are now wrapped in a single db.transaction().
//   Before this fix, a crash between any of the 9 sequential writes (insert event → upsert node →
//   update node_id → register pending → upsert edge → insert outcome → update probability →
//   update session pointer) would leave the database in a partially written, inconsistent state.
//   Now any failure in any step automatically rolls back the entire sequence.
//   The deduplication check (pure read) intentionally stays outside the transaction.

import crypto from 'crypto';
import { Database } from 'better-sqlite3';
import { NodeRepository } from '../db/repositories/node.repository';
import { EdgeRepository } from '../db/repositories/edge.repository';
import { EventRepository } from '../db/repositories/event.repository';
import { SessionRepository } from '../db/repositories/session.repository';
import { OutcomeRepository } from '../db/repositories/outcome.repository';
import { PendingActionRepository } from '../db/repositories/pending-action.repository';
import { DebugLogger } from '../logger/debug-logger';
import { StateEngine } from './state-engine';

import { SessionManager } from './session-manager';
import { BaselineHandler } from './handlers/baseline.handler';
import { ActionHandler } from './handlers/action.handler';
import { OutcomeHandler } from './handlers/outcome.handler';
import { IntentDetector } from './intent-detector';
import { AIREvent, OutcomeEventSchema, GraphStats } from '../types';

export interface ProcessResult {
  success: boolean;
  eventId?: string;
  duplicate?: boolean;
  stage?: string;
  nodeId?: string | null;
  traceId?: string;
  error?: string;
}

export class GraphBuilder {
  private sessionManager: SessionManager;
  private baselineHandler: BaselineHandler;
  private actionHandler: ActionHandler;
  private outcomeHandler: OutcomeHandler;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    private db: Database,             // FIX: injected directly to enable db.transaction()
    private nodeRepo: NodeRepository,
    private edgeRepo: EdgeRepository,
    private eventRepo: EventRepository,
    private sessionRepo: SessionRepository,
    private outcomeRepo: OutcomeRepository,
    private pendingRepo: PendingActionRepository,
    private stateEngine: typeof StateEngine,
    private logger: DebugLogger
  ) {
    this.sessionManager  = new SessionManager(this.sessionRepo, this.logger);
    this.baselineHandler = new BaselineHandler(this.nodeRepo, this.logger, this.stateEngine);
    this.actionHandler   = new ActionHandler(this.pendingRepo, this.edgeRepo, this.outcomeRepo, this.logger);
    this.outcomeHandler  = new OutcomeHandler(this.edgeRepo, this.outcomeRepo, this.eventRepo, this.pendingRepo, this.logger);
  }

  public getStats(): GraphStats {
    try {
      const nodes          = this.db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number };
      const edges          = this.db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
      const events         = this.db.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
      const outcomes       = this.db.prepare('SELECT COUNT(*) as count FROM outcomes').get() as { count: number };
      const sessions       = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
      const pendingActions = this.db.prepare("SELECT COUNT(*) as count FROM pending_actions WHERE status = 'pending'").get() as { count: number };

      return {
        nodes:          nodes.count,
        edges:          edges.count,
        events:         events.count,
        outcomes:       outcomes.count,
        sessions:       sessions.count,
        pendingActions: pendingActions.count,
        timestamp:      Date.now(),
      };
    } catch (error) {
      this.logger.log('GraphBuilder', 'error', 'Failed to get stats', { error: (error as Error).message });
      return { nodes: 0, edges: 0, events: 0, outcomes: 0, sessions: 0, pendingActions: 0, error: (error as Error).message };
    }
  }

  public processEvent(event: AIREvent): ProcessResult {
    // --- NORMALISATION (no DB calls) ---
    const safeEventId  = event.id        || crypto.randomUUID();
    const traceId      = event.traceId   || crypto.randomUUID();
    const safeSessionId = event.sessionId || 'unknown';

    // Reassign so all downstream code within this call uses the same values
    event.id        = safeEventId;
    event.traceId   = traceId;
    event.sessionId = safeSessionId;

    this.logger.log('GraphBuilder', 'info', 'Processing event',
      { type: event.type, sessionId: safeSessionId, traceId },
      safeSessionId, traceId
    );

    // --- DEDUPLICATION (pure read — intentionally outside the transaction) ---
    try {
      const existing = this.eventRepo.findById(safeEventId);
      if (existing) {
        this.logger.log('GraphBuilder', 'warn', 'Duplicate event detected', { eventId: safeEventId });
        return { success: true, eventId: safeEventId, duplicate: true };
      }
    } catch (error) {
      this.logger.log('GraphBuilder', 'error', 'Failed to check for duplicate', { error: (error as Error).message });
    }

    // --- ALL WRITES — wrapped in a single atomic transaction ---
    // Any exception thrown by any step (including re-throws from ActionHandler /
    // OutcomeHandler) will cause better-sqlite3 to automatically roll back every
    // write in this block, leaving the DB in a clean state.
    try {
      return this.db.transaction((ev: AIREvent): ProcessResult => {

        // STEP 0: Ensure session exists
        this.sessionManager.getOrCreateSession(ev.sessionId);

        // STEP 1: Insert event (slim — strip heavy snapshot fields)
        const intent    = IntentDetector.detectIntent(ev);
        const intentRaw = IntentDetector.getRawIntent(ev);
        const slimPayload = { ...ev } as any;
        delete slimPayload.pageSnapshot;
        delete slimPayload.pageState;
        this.eventRepo.insert(slimPayload as AIREvent, intent, intentRaw);

        // STEP 2: Resolve current node
        let currentNodeId: string | null = null;
        const isInput     = ev.type === 'input';
        const isScroll    = ev.type === 'scroll';
        const hasSnapshot = !!(('pageState' in ev && ev.pageState) || ('pageSnapshot' in ev && (ev as any).pageSnapshot));
        const lastNodeId  = this.sessionManager.getLastNode(ev.sessionId!);

        if (isInput && !hasSnapshot && lastNodeId) {
          currentNodeId = lastNodeId;
          this.logger.log('GraphBuilder', 'info', 'Anchoring Input event to existing node', { nodeId: currentNodeId });
        } else if (isScroll && !hasSnapshot && lastNodeId) {
          currentNodeId = lastNodeId;
          this.logger.log('GraphBuilder', 'info', 'Anchoring Scroll event to existing node', { nodeId: currentNodeId });
        } else if (['click', 'input', 'custom', 'outcome', 'scroll', 'custom-select', 'spa-route-change'].includes(ev.type)) {
          currentNodeId = this.baselineHandler.upsertNode(ev);
        }

        // STEP 3: Link event → node
        if (currentNodeId) {
          this.eventRepo.updateNodeId(ev.id!, currentNodeId);
        }

        const isHeartbeat = ev.type === 'input' && (ev as any).trigger === 'input:progress';

        // STEP 4: Graph linking
        if (ev.sessionId && currentNodeId) {

          // BRANCH A: User actions
          if (['click', 'input', 'submit', 'custom-select'].includes(ev.type) && !isHeartbeat) {
            this.actionHandler.handleAction(ev, traceId, currentNodeId, lastNodeId);
            this.sessionManager.updatePointer(ev.sessionId, currentNodeId);
            return { success: true, stage: 'action_recorded', nodeId: currentNodeId, traceId };
          }

          // BRANCH B: Outcomes
          if (ev.type === 'outcome') {
            const parsedOutcome = OutcomeEventSchema.parse(ev);
            this.outcomeHandler.handleOutcome(parsedOutcome, traceId, currentNodeId);
            this.sessionManager.updatePointer(ev.sessionId, currentNodeId);
            return { success: true, stage: 'edge_finalized', nodeId: currentNodeId, traceId };
          }
          if (ev.type === 'spa-route-change') {
            const spaEvent = ev as any;
            try {
              const syntheticOutcome = OutcomeEventSchema.parse({
                ...ev,
                type: 'outcome', // Cast it so Zod accepts it
                meta: {
                  settleType: spaEvent.changeType || 'navigation',
                  urlAfter: spaEvent.navigation?.to || (ev as any).pageUrl,
                }
              });
              this.outcomeHandler.handleOutcome(syntheticOutcome, traceId, currentNodeId);
            } catch (e) {
              this.logger.log('GraphBuilder', 'warn', 'Failed to parse synthetic outcome for spa-route-change', { error: (e as Error).message });
            }
            
            this.sessionManager.updatePointer(ev.sessionId!, currentNodeId);
            return { success: true, stage: 'spa_navigation_recorded', nodeId: currentNodeId, traceId };
          }
        }

        this.logger.log('GraphBuilder', 'info', 'Event processed (No graph update)',
          { eventId: safeEventId, nodeId: currentNodeId }
        );
        return { success: true, eventId: safeEventId, nodeId: currentNodeId, traceId };

      })(event); // immediately invoke the transaction with the normalised event

    } catch (error) {
      // The transaction has already been rolled back at this point by better-sqlite3.
      this.logger.log('GraphBuilder', 'error', 'Transaction failed — all writes rolled back',
        { error: (error as Error).message, eventId: safeEventId, traceId },
        safeSessionId, traceId
      );
      return { success: false, error: (error as Error).message };
    }
  }

  public startCleanupService(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);

    this.cleanupInterval = setInterval(() => {
      // 1. Purge stale pending actions (older than 2 minutes)
      const cutoffMs     = Date.now() - 120_000;
      const deletedCount = this.pendingRepo.cleanupStale(cutoffMs);
      if (deletedCount > 0) {
        this.logger.log('GraphBuilder', 'warn', `Cleaned up ${deletedCount} stale pending action(s)`);
      }

      // 2. FIX (Bug #8b): Prune debug_logs older than 24 hours so the table
      //    doesn't grow unbounded. Piggybacks on the existing 15-second tick —
      //    no extra interval needed.
      const prunedLogs = this.logger.pruneOldLogs(86_400_000);
      if (prunedLogs > 0) {
        this.logger.log('GraphBuilder', 'info', `Pruned ${prunedLogs} old debug log(s)`);
      }
    }, 15000);
  }

  /**
   * Tears down the cleanup interval before the database connection is closed.
   *
   * MUST be called before DatabaseService.close() on app exit or DB reset.
   * If the interval fires after db.close(), every pending_actions and debug_logs
   * query inside the tick throws "The database connection is not open" — an
   * unhandled error on a background timer that Node cannot surface cleanly.
   *
   * Wiring (Electron main entry):
   *   app.on('before-quit', () => {
   *     graphBuilder.close();   // ← stop interval first
   *     dbService.close();      // ← then close the connection
   *   });
   */
  public close(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.log('GraphBuilder', 'info', 'Cleanup service stopped');
    }
  }
}