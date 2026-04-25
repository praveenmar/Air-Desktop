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

  private buildEventLogFields(
    event: Pick<AIREvent, 'type' | 'sessionId'>,
    eventId: string,
    traceId: string | null,
    tabId: string | null,
    nodeId: string | null = null,
    extra: Record<string, unknown> = {}
  ): Record<string, unknown> {
    return {
      eventId,
      type: event.type,
      sessionId: event.sessionId ?? null,
      traceId,
      tabId,
      nodeId,
      ...extra,
    };
  }

  private async logGraphResult(
    level: 'info' | 'warn' | 'error',
    event: Pick<AIREvent, 'type' | 'sessionId'>,
    eventId: string,
    traceId: string | null,
    tabId: string | null,
    nodeId: string | null,
    result: Record<string, unknown>
  ): Promise<void> {
    await this.logWithContext(
      level,
      'EVENT_GRAPH_RESULT',
      this.buildEventLogFields(event, eventId, traceId, tabId, nodeId, result),
      event.sessionId ?? null,
      traceId
    );
  }

  private shouldRetainEventSnapshotsInPayload(event: AIREvent): boolean {
    return event.type === 'input' || event.type === 'submit' || event.type === 'custom-select';
  }

  private getSnapshotCandidate(event: AIREvent): {
    source: 'pageState' | 'pageSnapshot' | null;
    snapshot: Record<string, unknown> | null;
  } {
    const pageState = (event as any).pageState;
    if (pageState && typeof pageState === 'object') {
      return { source: 'pageState', snapshot: pageState as Record<string, unknown> };
    }

    const pageSnapshot = (event as any).pageSnapshot;
    if (pageSnapshot && typeof pageSnapshot === 'object') {
      return { source: 'pageSnapshot', snapshot: pageSnapshot as Record<string, unknown> };
    }

    return { source: null, snapshot: null };
  }

  private isSnapshotHtmlParseable(html: string): { parseable: boolean; reason: string } {
    const trimmed = html.trim();
    if (!trimmed) return { parseable: false, reason: 'empty_html' };
    if (!trimmed.includes('<') || !trimmed.includes('>')) {
      return { parseable: false, reason: 'missing_tag_delimiters' };
    }
    if ((trimmed.match(/</g)?.length ?? 0) !== (trimmed.match(/>/g)?.length ?? 0)) {
      return { parseable: false, reason: 'mismatched_angle_brackets' };
    }
    if (/<[^>]*$/.test(trimmed)) {
      return { parseable: false, reason: 'truncated_tag' };
    }

    const voidTags = new Set([
      'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
      'meta', 'param', 'source', 'track', 'wbr',
    ]);
    const stack: string[] = [];
    const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(?:\s[^<>]*)?>/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(trimmed)) !== null) {
      const fullTag = match[0];
      const tagName = match[1].toLowerCase();

      if (fullTag.startsWith('</')) {
        if (voidTags.has(tagName)) continue;
        const openTag = stack.pop();
        if (openTag !== tagName) {
          return { parseable: false, reason: 'tag_mismatch' };
        }
        continue;
      }

      if (voidTags.has(tagName) || fullTag.endsWith('/>')) continue;
      stack.push(tagName);
    }

    if (stack.length > 0) {
      return { parseable: false, reason: 'unclosed_tags' };
    }

    return { parseable: true, reason: 'ok' };
  }

  private evaluateEventLocalSnapshotFallback(
    event: AIREvent,
    lastNodeId: string | null,
    hasSessionAndTrace: boolean
  ): {
    eligible: boolean;
    reason: string;
    snapshotSource: 'pageState' | 'pageSnapshot' | null;
  } {
    if (lastNodeId) {
      return { eligible: false, reason: 'existing_current_node', snapshotSource: null };
    }
    if (!hasSessionAndTrace) {
      return { eligible: false, reason: 'missing_session_or_trace', snapshotSource: null };
    }

    const candidate = this.getSnapshotCandidate(event);
    if (!candidate.snapshot) {
      return { eligible: false, reason: 'missing_snapshot', snapshotSource: candidate.source };
    }

    const html = candidate.snapshot.html;
    if (typeof html !== 'string' || html.trim().length === 0) {
      return { eligible: false, reason: 'invalid_snapshot_html', snapshotSource: candidate.source };
    }

    const parseResult = this.isSnapshotHtmlParseable(html);
    if (!parseResult.parseable) {
      return {
        eligible: false,
        reason: `unparseable_snapshot_${parseResult.reason}`,
        snapshotSource: candidate.source,
      };
    }

    return { eligible: true, reason: 'eligible', snapshotSource: candidate.source };
  }

  private withEventLocalFallbackMetadata(event: AIREvent): AIREvent {
    const existingMeta =
      (event as any).meta && typeof (event as any).meta === 'object'
        ? ((event as any).meta as Record<string, unknown>)
        : {};

    return {
      ...(event as any),
      meta: {
        ...existingMeta,
        nodePromotionSource: 'event_local_fallback',
        nodePromotionReason: 'missing_current_node',
      },
    } as AIREvent;
  }

  private getEffectiveTabId(event: AIREvent): string {
    return typeof event.tabId === 'string' && event.tabId.length > 0
      ? event.tabId
      : 'tab-legacy';
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
      await this.logGraphResult(
        'error',
        event,
        safeEventId,
        traceId ?? null,
        null,
        null,
        { success: false, stage: 'missing_session_rejected', error: 'Missing sessionId' }
      );
      return { success: false, error: 'Missing sessionId' };
    }

    try {
      const existing = await this.eventRepo.findById(safeEventId);
      if (existing) {
        await this.logWithContext('warn', 'Event stage: duplicate event ID detected - skipping graph work', {
          eventId: safeEventId,
          type: event.type,
        }, sessionId ?? null, traceId ?? null);
        await this.logGraphResult(
          'warn',
          event,
          safeEventId,
          traceId ?? null,
          event.tabId ?? 'tab-legacy',
          existing.node_id ?? null,
          { success: true, stage: 'duplicate_skipped', duplicate: true }
        );
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
    const effectiveTabId = this.getEffectiveTabId(normalizedEvent);

    try {
      return await this.db.transaction(async (): Promise<ProcessResult> => {
        await this.sessionManager.getOrCreateSession(normalizedEvent.sessionId);
        if (effectiveTabId === 'tab-legacy') {
          await this.logWithContext('info', 'TAB_LEGACY_FALLBACK_USED', {
            eventId: safeEventId,
            type: normalizedEvent.type,
            tabId: effectiveTabId,
            reason: 'missing_tab_id_on_event',
          }, normalizedEvent.sessionId ?? null, traceId ?? null);
        }

        const isInput = normalizedEvent.type === 'input';
        const isScroll = normalizedEvent.type === 'scroll';
        const isSubmit = normalizedEvent.type === 'submit';
        const isCustomSelect = normalizedEvent.type === 'custom-select';
        const usesEventLocalSnapshotPolicy = isInput || isSubmit || isCustomSelect;
        const lastNodeId = await this.sessionManager.getLastNode(normalizedEvent.sessionId, effectiveTabId);
        const hasSessionAndTrace =
          typeof event.sessionId === 'string' &&
          event.sessionId.length > 0 &&
          typeof event.traceId === 'string' &&
          event.traceId.length > 0;

        const fallbackDecision = usesEventLocalSnapshotPolicy
          ? this.evaluateEventLocalSnapshotFallback(normalizedEvent, lastNodeId, hasSessionAndTrace)
          : { eligible: false, reason: 'not_event_local_snapshot_type', snapshotSource: null as null };

        const eventForGraph = fallbackDecision.eligible
          ? this.withEventLocalFallbackMetadata(normalizedEvent)
          : normalizedEvent;

        const intent = IntentDetector.detectIntent(eventForGraph);
        const intentRaw = IntentDetector.getRawIntent(eventForGraph);
        const slimPayload = { ...eventForGraph } as any;
        // Keep interactionContext in payload for D3.5 diagnostics.
        // Keep input/submit/custom-select snapshots as event-local truth; trim large node-resolution snapshots elsewhere.
        if (!this.shouldRetainEventSnapshotsInPayload(eventForGraph)) {
          delete slimPayload.pageSnapshot;
          delete slimPayload.pageState;
        }
        await this.eventRepo.insert(slimPayload as AIREvent, intent, intentRaw);
        await this.logWithContext(
          'info',
          'EVENT_PERSISTED',
          this.buildEventLogFields(eventForGraph, safeEventId, traceId, effectiveTabId, null, {
            intent,
            intentRaw,
          }),
          eventForGraph.sessionId ?? null,
          traceId ?? null
        );
        await this.persistInteractionContext(eventForGraph);

        let currentNodeId: string | null = null;
        const hasSnapshot = !!(
          ('pageState' in eventForGraph && (eventForGraph as any).pageState) ||
          ('pageSnapshot' in eventForGraph && (eventForGraph as any).pageSnapshot)
        );

        if (usesEventLocalSnapshotPolicy) {
          if (lastNodeId) {
            currentNodeId = lastNodeId;
            await this.logWithContext('info', 'CONTROL_EVENT_ANCHORED_EXISTING_NODE', {
              eventId: safeEventId,
              type: eventForGraph.type,
              nodeId: currentNodeId,
              traceId,
              tabId: effectiveTabId,
            }, eventForGraph.sessionId ?? null, traceId ?? null);
          } else if (fallbackDecision.eligible) {
            currentNodeId = await this.baselineHandler.upsertNode(eventForGraph);
            if (currentNodeId) {
              await this.logWithContext('info', 'CONTROL_EVENT_EVENT_LOCAL_FALLBACK_PROMOTED', {
                eventId: safeEventId,
                type: eventForGraph.type,
                nodeId: currentNodeId,
                traceId,
                snapshotSource: fallbackDecision.snapshotSource,
                nodePromotionSource: 'event_local_fallback',
                nodePromotionReason: 'missing_current_node',
                tabId: effectiveTabId,
              }, eventForGraph.sessionId ?? null, traceId ?? null);
            } else {
              await this.logWithContext('warn', 'CONTROL_EVENT_UNLINKED_NO_VALID_SNAPSHOT', {
                eventId: safeEventId,
                type: eventForGraph.type,
                traceId,
                reason: 'fallback_upsert_failed',
                snapshotSource: fallbackDecision.snapshotSource,
                tabId: effectiveTabId,
              }, eventForGraph.sessionId ?? null, traceId ?? null);
            }
          } else {
            await this.logWithContext('warn', 'CONTROL_EVENT_UNLINKED_NO_VALID_SNAPSHOT', {
              eventId: safeEventId,
              type: eventForGraph.type,
              traceId,
              reason: fallbackDecision.reason,
              snapshotSource: fallbackDecision.snapshotSource,
              tabId: effectiveTabId,
            }, eventForGraph.sessionId ?? null, traceId ?? null);
          }
        } else if (isScroll && !hasSnapshot && lastNodeId) {
          currentNodeId = lastNodeId;
          await this.logWithContext('info', 'Anchoring Scroll event to existing node', {
            nodeId: currentNodeId,
            tabId: effectiveTabId,
          }, eventForGraph.sessionId ?? null, traceId ?? null);
        } else if (['click', 'custom', 'outcome', 'scroll', 'custom-select', 'spa-route-change'].includes(eventForGraph.type)) {
          currentNodeId = await this.baselineHandler.upsertNode(eventForGraph);
        }

        if (currentNodeId) {
          await this.eventRepo.updateNodeId(safeEventId, currentNodeId);
          await this.logWithContext(
            'info',
            'EVENT_NODE_LINKED',
            this.buildEventLogFields(eventForGraph, safeEventId, traceId, effectiveTabId, currentNodeId),
            eventForGraph.sessionId ?? null,
            traceId ?? null
          );
        }

        const isHeartbeat = eventForGraph.type === 'input' && (eventForGraph as any).trigger === 'input:progress';

        if (eventForGraph.sessionId && currentNodeId) {
          if (['click', 'input', 'submit', 'custom-select'].includes(eventForGraph.type) && !isHeartbeat) {
            await this.actionHandler.handleAction(eventForGraph, traceId, currentNodeId, lastNodeId, effectiveTabId);
            await this.sessionManager.updatePointer(eventForGraph.sessionId, effectiveTabId, currentNodeId, eventForGraph.timestamp);
            await this.logWithContext('info', 'Event stage: action recorded, pending action registered', {
              eventId: safeEventId,
              type: eventForGraph.type,
              nodeId: currentNodeId,
              traceId,
              tabId: effectiveTabId,
            }, eventForGraph.sessionId ?? null, traceId ?? null);
            await this.logGraphResult(
              'info',
              eventForGraph,
              safeEventId,
              traceId,
              effectiveTabId,
              currentNodeId,
              { success: true, stage: 'action_recorded' }
            );
            return { success: true, stage: 'action_recorded', nodeId: currentNodeId, traceId };
          }

          if (eventForGraph.type === 'outcome') {
            const parsedOutcome = OutcomeEventSchema.parse(eventForGraph);
            await this.outcomeHandler.handleOutcome(parsedOutcome, traceId, currentNodeId, effectiveTabId);
            await this.sessionManager.updatePointer(eventForGraph.sessionId, effectiveTabId, currentNodeId, eventForGraph.timestamp);
            await this.logWithContext('info', 'Event stage: outcome processed, edge created or updated', {
              eventId: safeEventId,
              type: eventForGraph.type,
              nodeId: currentNodeId,
              traceId,
              tabId: effectiveTabId,
            }, eventForGraph.sessionId ?? null, traceId ?? null);
            await this.logGraphResult(
              'info',
              eventForGraph,
              safeEventId,
              traceId,
              effectiveTabId,
              currentNodeId,
              { success: true, stage: 'edge_finalized' }
            );
            return { success: true, stage: 'edge_finalized', nodeId: currentNodeId, traceId };
          }

          if (eventForGraph.type === 'spa-route-change') {
            const spaEvent = eventForGraph as any;
            try {
              const syntheticOutcome = OutcomeEventSchema.parse({
                ...eventForGraph,
                type: 'outcome',
                meta: {
                  settleType: spaEvent.changeType || 'navigation',
                  urlAfter: spaEvent.navigation?.to || (eventForGraph as any).pageUrl,
                },
              });
              await this.outcomeHandler.handleOutcome(syntheticOutcome, traceId, currentNodeId, effectiveTabId);
            } catch (e) {
              await this.logWithContext('warn', 'Failed to parse synthetic outcome for spa-route-change', {
                error: (e as Error).message,
                tabId: effectiveTabId,
              }, eventForGraph.sessionId ?? null, traceId ?? null);
            }

            await this.sessionManager.updatePointer(eventForGraph.sessionId, effectiveTabId, currentNodeId, eventForGraph.timestamp);
            await this.logWithContext('info', 'Event stage: SPA route transition processed as synthetic outcome', {
              eventId: safeEventId,
              type: eventForGraph.type,
              nodeId: currentNodeId,
              traceId,
              tabId: effectiveTabId,
            }, eventForGraph.sessionId ?? null, traceId ?? null);
            await this.logGraphResult(
              'info',
              eventForGraph,
              safeEventId,
              traceId,
              effectiveTabId,
              currentNodeId,
              { success: true, stage: 'spa_navigation_recorded' }
            );
            return { success: true, stage: 'spa_navigation_recorded', nodeId: currentNodeId, traceId };
          }
        }

        let stage = 'event processed but no graph change';
        if (isHeartbeat) stage = 'ignored input heartbeat';
        else if (!currentNodeId) stage = 'no node resolved - event not linked';
        else if (!eventForGraph.sessionId) stage = 'missing session - rejected';

        await this.logWithContext('info', `Event stage: ${stage}`, {
          eventId: safeEventId,
          nodeId: currentNodeId,
          type: eventForGraph.type,
          traceId,
          tabId: effectiveTabId,
        }, eventForGraph.sessionId ?? null, traceId ?? null);
        await this.logGraphResult(
          'info',
          eventForGraph,
          safeEventId,
          traceId,
          effectiveTabId,
          currentNodeId,
          { success: true, stage }
        );

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
      await this.logGraphResult(
        'error',
        normalizedEvent,
        safeEventId,
        traceId,
        effectiveTabId,
        null,
        { success: false, stage: 'transaction_failed', error: (error as Error).message }
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
