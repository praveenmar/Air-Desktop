// Purpose: The main orchestrator connecting Handlers, DB Repositories, and the Event Stream.
// Prototype Origin: graph-builder.js (Main class body, processEvent, getStats, startCleanupService)
// Changes: Strictly typed Dependency Injection container.

import crypto from 'crypto';
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
    private nodeRepo: NodeRepository,
    private edgeRepo: EdgeRepository,
    private eventRepo: EventRepository,
    private sessionRepo: SessionRepository,
    private outcomeRepo: OutcomeRepository,
    private pendingRepo: PendingActionRepository,
    private stateEngine: typeof StateEngine,
    private logger: DebugLogger
  ) {
    this.sessionManager = new SessionManager(this.sessionRepo, this.logger);
    this.baselineHandler = new BaselineHandler(this.nodeRepo, this.logger, this.stateEngine);
    this.actionHandler = new ActionHandler(this.pendingRepo, this.edgeRepo, this.outcomeRepo, this.logger);
    this.outcomeHandler = new OutcomeHandler(this.edgeRepo, this.outcomeRepo, this.eventRepo, this.pendingRepo, this.logger);
  }

  public getStats(): GraphStats {
    try {
      // For performance in SQLite, we do simple counts. 
      // In a real repo structure, we'd add count() methods.
      const db = (this.nodeRepo as any).db; // Accessing underlying DB instance for bulk stats
      
      const nodes = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
      const edges = db.prepare('SELECT COUNT(*) as count FROM edges').get().count;
      const events = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
      const outcomes = db.prepare('SELECT COUNT(*) as count FROM outcomes').get().count;
      const sessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
      const pendingActions = db.prepare("SELECT COUNT(*) as count FROM pending_actions WHERE status = 'pending'").get().count;
      
      return { nodes, edges, events, outcomes, sessions, pendingActions, timestamp: Date.now() };
    } catch (error) {
      this.logger.log('GraphBuilder', 'error', 'Failed to get stats', { error: (error as Error).message });
      return { nodes: 0, edges: 0, events: 0, outcomes: 0, sessions: 0, pendingActions: 0, error: (error as Error).message };
    }
  }

  public processEvent(event: AIREvent): ProcessResult {

    const safeEventId = event.id || crypto.randomUUID();
    event.id = safeEventId; // Reassign so downstream functions use the same ID
    const traceId = event.traceId || crypto.randomUUID();
    this.logger.log('GraphBuilder', 'info', 'Processing event', { type: event.type, sessionId: event.sessionId, traceId }, event.sessionId, traceId);

    // Fallback sessionId just in case it's missing too
    const safeSessionId = event.sessionId || 'unknown'; 
    event.sessionId = safeSessionId;

    // 0. ENSURE SESSION EXISTS
    this.sessionManager.getOrCreateSession(event.sessionId);

    // 1. DEDUPLICATION
    try {
      const existing = this.eventRepo.findById(event.id);
      if (existing) {
        this.logger.log('GraphBuilder', 'warn', 'Duplicate event detected', { eventId: safeEventId });
        return { success: true, eventId: safeEventId, duplicate: true };
      }
    } catch (error) {
      this.logger.log('GraphBuilder', 'error', 'Failed to check for duplicate', { error: (error as Error).message });
    }

    // 2. INSERT EVENT
    try {
      const intent = IntentDetector.detectIntent(event);
      const intentRaw = IntentDetector.getRawIntent(event);

      // Strip heavy snapshot data from stored payload inside repo
      const slimPayload = { ...event } as any;
      delete slimPayload.pageSnapshot;
      delete slimPayload.pageState;

      // Cast back to standard event shape for insertion
      this.eventRepo.insert(slimPayload as AIREvent, intent, intentRaw);
    } catch (error) {
      this.logger.log('GraphBuilder', 'error', 'Failed to insert event', { error: (error as Error).message });
      return { success: false, error: (error as Error).message };
    }

    // 3. RESOLVE CURRENT NODE (State)
    let currentNodeId: string | null = null;
    const isInput = event.type === 'input';
    const hasSnapshot = !!(('pageState' in event && event.pageState) || ('pageSnapshot' in event && (event as any).pageSnapshot));
    const lastNodeId = this.sessionManager.getLastNode(event.sessionId);

    if (isInput && !hasSnapshot && lastNodeId) {
      currentNodeId = lastNodeId;
      this.logger.log('GraphBuilder', 'info', 'Anchoring Input event to existing node', { nodeId: currentNodeId });
    } else if (['click', 'input', 'custom', 'outcome', 'scroll'].includes(event.type)) {
      currentNodeId = this.baselineHandler.upsertNode(event);
    }

    // 3.5 UPDATE event with resolved node_id
    if (currentNodeId) {
      this.eventRepo.updateNodeId(event.id, currentNodeId);
    }

    // 4. GRAPH LINKING LOGIC
    if (event.sessionId && currentNodeId) {

      // --- BRANCH A: USER ACTIONS (click/input/submit) ---
      if (['click', 'input', 'submit'].includes(event.type)) {
        this.actionHandler.handleAction(event, traceId, currentNodeId, lastNodeId);
        this.sessionManager.updatePointer(event.sessionId, currentNodeId);
        return { success: true, stage: 'action_recorded', nodeId: currentNodeId, traceId };
      }

      // --- BRANCH B: OUTCOMES (The Result) ---
      if (event.type === 'outcome') {
        const parsedOutcome = OutcomeEventSchema.parse(event);
        this.outcomeHandler.handleOutcome(parsedOutcome, traceId, currentNodeId);
        this.sessionManager.updatePointer(event.sessionId, currentNodeId);
        return { success: true, stage: 'edge_finalized', nodeId: currentNodeId, traceId };
      }
    }

    this.logger.log('GraphBuilder', 'info', 'Event processed (No graph update)', { eventId: safeEventId, nodeId: currentNodeId });
    return { success: true, eventId: safeEventId
      , nodeId: currentNodeId, traceId };
  }

  public startCleanupService(): void {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    
    this.cleanupInterval = setInterval(() => {
      const cutoffMs = Date.now() - 120000;
      const deletedCount = this.pendingRepo.cleanupStale(cutoffMs);
      
      if (deletedCount > 0) {
        this.logger.log('GraphBuilder', 'warn', `Cleaned up ${deletedCount} stale pending action(s)`);
      }
    }, 15000);
  }
}