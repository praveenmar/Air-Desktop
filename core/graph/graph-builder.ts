// Purpose: The main orchestrator connecting Handlers, DB Repositories, and the Event Stream.

import crypto from 'crypto';
import { NodeRepository } from '../db/repositories/node.repository';
import { EdgeRepository } from '../db/repositories/edge.repository';
import { EventRepository } from '../db/repositories/event.repository';
import { SessionRepository } from '../db/repositories/session.repository';
import { OutcomeRepository } from '../db/repositories/outcome.repository';
import { PendingActionRepository } from '../db/repositories/pending-action.repository';
import { InteractionContextRepository } from '../db/repositories/interaction-context.repository';
import { AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { DebugLogger } from '../logger/debug-logger';
import { StateEngine } from './state-engine';
import { SessionManager } from './session-manager';
import { BaselineHandler } from './handlers/baseline.handler';
import { ActionHandler } from './handlers/action.handler';
import { OutcomeHandler } from './handlers/outcome.handler';
import { IntentDetector } from './intent-detector';
import { AIREvent, OutcomeEventSchema, GraphStats } from '../types';
import { normalizeUrl } from '@air/shared';

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
    private db: AsyncSQLiteDatabase,
    private nodeRepo: NodeRepository,
    private edgeRepo: EdgeRepository,
    private eventRepo: EventRepository,
    private sessionRepo: SessionRepository,
    private outcomeRepo: OutcomeRepository,
    private pendingRepo: PendingActionRepository,
    private interactionContextRepo: InteractionContextRepository,
    private stateEngine: typeof StateEngine,
    private logger: DebugLogger
  ) {
    this.sessionManager = new SessionManager(this.sessionRepo, this.logger);
    this.baselineHandler = new BaselineHandler(this.nodeRepo, this.logger, this.stateEngine);
    this.actionHandler = new ActionHandler(this.pendingRepo, this.edgeRepo, this.outcomeRepo, this.logger);
    this.outcomeHandler = new OutcomeHandler(this.edgeRepo, this.outcomeRepo, this.eventRepo, this.pendingRepo, this.logger);
  }

  private async logWithContext(
    level: 'debug' | 'info' | 'warn' | 'error' | 'decision',
    message: string,
    data: Record<string, unknown> = {},
    sessionId: string | null = null,
    traceId: string | null = null
  ): Promise<void> {
    const resolvedSessionId = sessionId ?? null;
    const resolvedTraceId = traceId ?? null;
    await this.logger.log(
      'GraphBuilder',
      level,
      message,
      {
        ...data,
        sessionId: resolvedSessionId,
        traceId: resolvedTraceId,
      },
      resolvedSessionId,
      resolvedTraceId
    );
  }

  public async getStats(): Promise<GraphStats> {
    try {
      const nodes = await this.db.prepare('SELECT COUNT(*) as count FROM nodes').get<{ count: number }>();
      const edges = await this.db.prepare('SELECT COUNT(*) as count FROM edges').get<{ count: number }>();
      const events = await this.db.prepare('SELECT COUNT(*) as count FROM events').get<{ count: number }>();
      const outcomes = await this.db.prepare('SELECT COUNT(*) as count FROM outcomes').get<{ count: number }>();
      const sessions = await this.db.prepare('SELECT COUNT(*) as count FROM sessions').get<{ count: number }>();
      const pendingActions = await this.db
        .prepare("SELECT COUNT(*) as count FROM pending_actions WHERE status = 'pending'")
        .get<{ count: number }>();

      return {
        nodes: nodes?.count ?? 0,
        edges: edges?.count ?? 0,
        events: events?.count ?? 0,
        outcomes: outcomes?.count ?? 0,
        sessions: sessions?.count ?? 0,
        pendingActions: pendingActions?.count ?? 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      await this.logWithContext('error', 'Failed to get stats', { error: (error as Error).message }, null, null);
      return {
        nodes: 0,
        edges: 0,
        events: 0,
        outcomes: 0,
        sessions: 0,
        pendingActions: 0,
        error: (error as Error).message,
      };
    }
  }

  public async processEvent(event: AIREvent): Promise<ProcessResult> {
    const safeEventId = event.id || crypto.randomUUID();
    const traceId = event.traceId || crypto.randomUUID();
    const sessionId = event.sessionId;

    if (!sessionId) {
      await this.logWithContext('error', 'Event stage: missing session - rejected before persistence', {
        eventId: safeEventId,
        type: event.type,
      }, null, traceId ?? null);
      return { success: false, error: 'Missing sessionId' };
    }

    try {
      const existing = await this.eventRepo.findById(safeEventId);
      if (existing) {
        await this.logWithContext('warn', 'Event stage: duplicate event ID detected - skipping graph work', {
          eventId: safeEventId,
          type: event.type,
        }, sessionId ?? null, traceId ?? null);
        return { success: true, eventId: safeEventId, duplicate: true };
      }
    } catch (error) {
      await this.logWithContext('error', 'Failed to check for duplicate', { error: (error as Error).message }, sessionId ?? null, traceId ?? null);
    }

    const normalizedEvent = {
      ...event,
      id: safeEventId,
      traceId: event.traceId || traceId,
    } as AIREvent;

    try {
      return await this.db.transaction(async (): Promise<ProcessResult> => {
        await this.sessionManager.getOrCreateSession(normalizedEvent.sessionId);

        const intent = IntentDetector.detectIntent(normalizedEvent);
        const intentRaw = IntentDetector.getRawIntent(normalizedEvent);
        const slimPayload = { ...normalizedEvent } as any;
        // Keep interactionContext in payload for D3.5 diagnostics; trim only large node-resolution snapshots.
        delete slimPayload.pageSnapshot;
        delete slimPayload.pageState;
        await this.eventRepo.insert(slimPayload as AIREvent, intent, intentRaw);
        await this.persistInteractionContext(normalizedEvent);

        let currentNodeId: string | null = null;
        const isInput = normalizedEvent.type === 'input';
        const isScroll = normalizedEvent.type === 'scroll';
        const isSubmit = normalizedEvent.type === 'submit';
        const hasSnapshot = !!(
          ('pageState' in normalizedEvent && normalizedEvent.pageState) ||
          ('pageSnapshot' in normalizedEvent && (normalizedEvent as any).pageSnapshot)
        );
        const lastNodeId = await this.sessionManager.getLastNode(normalizedEvent.sessionId);

        if (isInput && !hasSnapshot && lastNodeId) {
          currentNodeId = lastNodeId;
          await this.logWithContext('info', 'Anchoring Input event to existing node', { nodeId: currentNodeId }, normalizedEvent.sessionId ?? null, traceId ?? null);
        } else if (isScroll && !hasSnapshot && lastNodeId) {
          currentNodeId = lastNodeId;
          await this.logWithContext('info', 'Anchoring Scroll event to existing node', { nodeId: currentNodeId }, normalizedEvent.sessionId ?? null, traceId ?? null);
        } else if (isSubmit && !hasSnapshot && lastNodeId) {
          currentNodeId = lastNodeId;
          await this.logWithContext('info', 'Anchoring Submit event to existing node', { nodeId: currentNodeId }, normalizedEvent.sessionId ?? null, traceId ?? null);
        } else if (['click', 'input', 'custom', 'outcome', 'scroll', 'custom-select', 'spa-route-change'].includes(normalizedEvent.type)) {
          currentNodeId = await this.baselineHandler.upsertNode(normalizedEvent);
        }

        if (currentNodeId) {
          await this.eventRepo.updateNodeId(safeEventId, currentNodeId);
        }

        const isHeartbeat = normalizedEvent.type === 'input' && (normalizedEvent as any).trigger === 'input:progress';

        if (normalizedEvent.sessionId && currentNodeId) {
          if (['click', 'input', 'submit', 'custom-select'].includes(normalizedEvent.type) && !isHeartbeat) {
            await this.actionHandler.handleAction(normalizedEvent, traceId, currentNodeId, lastNodeId);
            await this.sessionManager.updatePointer(normalizedEvent.sessionId, currentNodeId);
            await this.logWithContext('info', 'Event stage: action recorded, pending action registered', {
              eventId: safeEventId,
              type: normalizedEvent.type,
              nodeId: currentNodeId,
              traceId,
            }, normalizedEvent.sessionId ?? null, traceId ?? null);
            return { success: true, stage: 'action_recorded', nodeId: currentNodeId, traceId };
          }

          if (normalizedEvent.type === 'outcome') {
            const parsedOutcome = OutcomeEventSchema.parse(normalizedEvent);
            await this.outcomeHandler.handleOutcome(parsedOutcome, traceId, currentNodeId);
            await this.sessionManager.updatePointer(normalizedEvent.sessionId, currentNodeId);
            await this.logWithContext('info', 'Event stage: outcome processed, edge created or updated', {
              eventId: safeEventId,
              type: normalizedEvent.type,
              nodeId: currentNodeId,
              traceId,
            }, normalizedEvent.sessionId ?? null, traceId ?? null);
            return { success: true, stage: 'edge_finalized', nodeId: currentNodeId, traceId };
          }

          if (normalizedEvent.type === 'spa-route-change') {
            const spaEvent = normalizedEvent as any;
            try {
              const syntheticOutcome = OutcomeEventSchema.parse({
                ...normalizedEvent,
                type: 'outcome',
                meta: {
                  settleType: spaEvent.changeType || 'navigation',
                  urlAfter: spaEvent.navigation?.to || (normalizedEvent as any).pageUrl,
                },
              });
              await this.outcomeHandler.handleOutcome(syntheticOutcome, traceId, currentNodeId);
            } catch (e) {
              await this.logWithContext('warn', 'Failed to parse synthetic outcome for spa-route-change', {
                error: (e as Error).message,
              }, normalizedEvent.sessionId ?? null, traceId ?? null);
            }

            await this.sessionManager.updatePointer(normalizedEvent.sessionId, currentNodeId);
            await this.logWithContext('info', 'Event stage: SPA route transition processed as synthetic outcome', {
              eventId: safeEventId,
              type: normalizedEvent.type,
              nodeId: currentNodeId,
              traceId,
            }, normalizedEvent.sessionId ?? null, traceId ?? null);
            return { success: true, stage: 'spa_navigation_recorded', nodeId: currentNodeId, traceId };
          }
        }

        let stage = 'event processed but no graph change';
        if (isHeartbeat) stage = 'ignored input heartbeat';
        else if (!currentNodeId) stage = 'no node resolved - event not linked';
        else if (!normalizedEvent.sessionId) stage = 'missing session - rejected';

        await this.logWithContext('info', `Event stage: ${stage}`, {
          eventId: safeEventId,
          nodeId: currentNodeId,
          type: normalizedEvent.type,
          traceId,
        }, normalizedEvent.sessionId ?? null, traceId ?? null);

        return { success: true, eventId: safeEventId, nodeId: currentNodeId, traceId };
      });
    } catch (error) {
      await this.logWithContext(
        'error',
        'Transaction failed - all writes rolled back',
        { error: (error as Error).message, eventId: safeEventId, traceId },
        sessionId,
        traceId
      );
      return { success: false, error: (error as Error).message };
    }
  }

  public startCleanupService(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    this.cleanupInterval = setInterval(() => {
      void this.runCleanupTick();
    }, 15000);
  }

  private async persistInteractionContext(event: AIREvent): Promise<void> {
    const raw = (event as any).interactionContext;
    if (!raw || typeof raw !== 'object') return;

    const snapshot = raw as Record<string, unknown>;
    const normalizedUrl =
      (typeof snapshot.normalizedUrl === 'string' && snapshot.normalizedUrl.length > 0
        ? snapshot.normalizedUrl
        : null) ||
      (typeof event.normalizedUrl === 'string' && event.normalizedUrl.length > 0
        ? event.normalizedUrl
        : null) ||
      (typeof event.pageUrl === 'string' && event.pageUrl.length > 0
        ? normalizeUrl(event.pageUrl)
        : null);

    if (!normalizedUrl) {
      await this.logWithContext('debug', 'Interaction context skipped - missing normalized URL', {
        eventId: event.id,
        type: event.type,
      }, event.sessionId ?? null, event.traceId ?? null);
      return;
    }

    const anchors = Array.isArray(snapshot.anchors)
      ? snapshot.anchors.filter((anchor): anchor is string => typeof anchor === 'string')
      : [];

    const viewport = snapshot.viewport && typeof snapshot.viewport === 'object'
      ? snapshot.viewport as Record<string, unknown>
      : null;

    try {
      const persistedRow = await this.interactionContextRepo.upsert({
        sessionId: event.sessionId,
        normalizedUrl,
        controlSignature:
          typeof snapshot.controlSignature === 'string'
            ? snapshot.controlSignature
            : '',
        snapshotHtml:
          typeof snapshot.html === 'string'
            ? snapshot.html
            : '',
        anchors,
        isStable: snapshot.isStable === false ? false : true,
        viewportWidth:
          viewport && typeof viewport.width === 'number'
            ? viewport.width
            : null,
        viewportHeight:
          viewport && typeof viewport.height === 'number'
            ? viewport.height
            : null,
        capturedAt:
          typeof snapshot.timestamp === 'number'
            ? snapshot.timestamp
            : Date.now(),
      });

      await this.logWithContext('debug', 'Interaction context persisted', {
        eventId: event.id,
        normalizedUrl,
        controlSignature:
          typeof snapshot.controlSignature === 'string'
            ? snapshot.controlSignature.slice(0, 12)
            : '',
        isStable: snapshot.isStable === false ? false : true,
        persistedIsStable: persistedRow.isStable,
      }, event.sessionId ?? null, event.traceId ?? null);
    } catch (error) {
      await this.logWithContext('warn', 'Interaction context persistence failed - event pipeline continues', {
        eventId: event.id,
        error: (error as Error).message,
      }, event.sessionId ?? null, event.traceId ?? null);
    }
  }

  private async runCleanupTick(): Promise<void> {
    try {
      const cutoffMs = Date.now() - 120_000;
      const deletedCount = await this.pendingRepo.cleanupStale(cutoffMs);
      if (deletedCount > 0) {
        await this.logWithContext('warn', `Cleaned up ${deletedCount} stale pending action(s)`, {}, null, null);
      }

      const prunedLogs = await this.logger.pruneOldLogs(86_400_000);
      if (prunedLogs > 0) {
        await this.logWithContext('info', `Pruned ${prunedLogs} old debug log(s)`, {}, null, null);
      }
    } catch (error) {
      await this.logWithContext('error', 'Cleanup tick failed', { error: (error as Error).message }, null, null);
    }
  }

  public async close(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      await this.logWithContext('info', 'Cleanup service stopped', {}, null, null);
    }
  }
}
