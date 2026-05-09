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
  private static readonly SPA_ROUTE_DUPLICATE_WINDOW_MS = 5_000;
  private static readonly SEMANTIC_DUPLICATE_NEAR_TIME_MS = 3_000;
  private static readonly STALE_TOLERANCE_MS = 5_000;
  private static readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
  private static readonly DEDUP_KEY_TTL_MS = 48 * 60 * 60 * 1000;
  private sessionManager: SessionManager;
  private baselineHandler: BaselineHandler;
  private actionHandler: ActionHandler;
  private outcomeHandler: OutcomeHandler;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private cleanupTickRunning = false;

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
    return event.type === 'input'
      || event.type === 'submit'
      || event.type === 'custom-control-open'
      || event.type === 'custom-select'
      || event.type === 'custom-menu-select';
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

  private normalizeDedupPart(value: unknown): string {
    if (value == null) return '';
    return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  private normalizeOutcomeSettleType(settleType: unknown): string {
    if (typeof settleType === 'string') {
      return this.normalizeDedupPart(settleType);
    }
    if (settleType && typeof settleType === 'object') {
      const stable = (settleType as Record<string, unknown>).stable;
      const reason = (settleType as Record<string, unknown>).reason;
      return this.normalizeDedupPart(`${stable ?? ''}:${reason ?? ''}`);
    }
    return '';
  }

  private shouldComputeSemanticDedupKey(event: AIREvent): boolean {
    const traceId = typeof event.traceId === 'string' ? event.traceId : '';
    if (traceId.startsWith('baseline-')) {
      return false;
    }

    return ['click', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select', 'outcome', 'spa-route-change'].includes(event.type);
  }

  private isCommittedInputEvent(event: AIREvent): boolean {
    return event.type === 'input' && (event as any).trigger !== 'input:progress';
  }

  private isPointerDependentEvent(event: AIREvent): boolean {
    return event.type === 'click'
      || event.type === 'submit'
      || event.type === 'custom-control-open'
      || event.type === 'custom-select'
      || event.type === 'custom-menu-select'
      || this.isCommittedInputEvent(event);
  }

  private buildSemanticDedupComputation(event: AIREvent, tabId: string): {
    dedupKey: string;
    keyPartsSummary: {
      selectorUsed: string | null;
      attributesHashUsed: string | null;
      normalizedUrl: string | null;
      type: string;
    };
  } | null {
    if (!this.shouldComputeSemanticDedupKey(event)) {
      return null;
    }

    const fingerprint = 'fingerprint' in event ? event.fingerprint : null;
    const selectorUsed = typeof fingerprint?.selector === 'string' ? fingerprint.selector : null;
    const attributesHashUsed = typeof fingerprint?.attributesHash === 'string' ? fingerprint.attributesHash : null;
    const normalizedUrl = typeof event.normalizedUrl === 'string' ? event.normalizedUrl : null;

    const baseParts = [
      'v1',
      `session:${this.normalizeDedupPart(event.sessionId)}`,
      `tab:${this.normalizeDedupPart(tabId)}`,
      `trace:${this.normalizeDedupPart(event.traceId)}`,
      `type:${this.normalizeDedupPart(event.type)}`,
      `url:${this.normalizeDedupPart(normalizedUrl)}`,
    ];

    const eventSpecificParts: string[] = [];

    if (event.type === 'click' || event.type === 'submit') {
      eventSpecificParts.push(
        `selector:${this.normalizeDedupPart(selectorUsed)}`,
        `attributesHash:${this.normalizeDedupPart(attributesHashUsed)}`,
      );

      if (event.type === 'submit') {
        eventSpecificParts.push(
          `form:${this.normalizeDedupPart((event.meta as Record<string, unknown> | undefined)?.formId)}`,
          `eventType:${this.normalizeDedupPart((event.meta as Record<string, unknown> | undefined)?.eventType)}`,
        );
      } else {
        eventSpecificParts.push(
          `parent:${this.normalizeDedupPart(fingerprint?.parentSelector)}`,
        );
      }
    } else if (event.type === 'custom-select' || event.type === 'custom-menu-select') {
      const customSelectEvent = event as any;
      eventSpecificParts.push(
        `selector:${this.normalizeDedupPart(selectorUsed)}`,
        `attributesHash:${this.normalizeDedupPart(attributesHashUsed)}`,
        `value:${this.normalizeDedupPart(customSelectEvent.selection?.value)}`,
        `label:${this.normalizeDedupPart(customSelectEvent.selection?.label)}`,
      );
    } else if (event.type === 'custom-control-open') {
      eventSpecificParts.push(
        `selector:${this.normalizeDedupPart(selectorUsed)}`,
        `attributesHash:${this.normalizeDedupPart(attributesHashUsed)}`,
        `family:${this.normalizeDedupPart((event as any).controlFamily)}`,
      );
    } else if (event.type === 'outcome') {
      eventSpecificParts.push(
        `after:${this.normalizeDedupPart((event.meta as Record<string, unknown> | undefined)?.urlAfter || normalizedUrl)}`,
        `settle:${this.normalizeOutcomeSettleType((event.meta as Record<string, unknown> | undefined)?.settleType)}`,
      );
    } else if (event.type === 'spa-route-change') {
      const spaEvent = event as any;
      eventSpecificParts.push(
        `from:${this.normalizeDedupPart(spaEvent.navigation?.from)}`,
        `to:${this.normalizeDedupPart(spaEvent.navigation?.to)}`,
        `change:${this.normalizeDedupPart(spaEvent.changeType)}`,
      );
    }

    const rawKey = [...baseParts, ...eventSpecificParts].join('|');
    const dedupKey = crypto.createHash('sha256').update(rawKey).digest('hex');

    return {
      dedupKey,
      keyPartsSummary: {
        selectorUsed,
        attributesHashUsed,
        normalizedUrl,
        type: event.type,
      },
    };
  }

  private async recordSemanticDedupShadowSignal(event: AIREvent, traceId: string, tabId: string): Promise<void> {
    const computed = this.buildSemanticDedupComputation(event, tabId);
    if (!computed) {
      return;
    }

    const inserted = await this.eventRepo.insertDedupKeyIfAbsent({
      dedupKey: computed.dedupKey,
      eventId: event.id,
      sessionId: event.sessionId ?? null,
      traceId: traceId ?? null,
      eventType: event.type,
      originalTimestamp: Number.isFinite(event.timestamp) ? event.timestamp : null,
      createdAt: Date.now(),
    });

    if (inserted) {
      return;
    }

    const existing = await this.eventRepo.findDedupKeyByKey(computed.dedupKey);
    const previousEventTimestamp = Number.isFinite(existing?.originalTimestamp)
      ? Number(existing?.originalTimestamp)
      : null;
    const originalTimestamp = Number.isFinite(event.timestamp) ? event.timestamp : null;
    const deltaMs =
      originalTimestamp != null && previousEventTimestamp != null
        ? Math.abs(originalTimestamp - previousEventTimestamp)
        : null;
    const duplicateTimingClass =
      deltaMs != null && deltaMs < GraphBuilder.SEMANTIC_DUPLICATE_NEAR_TIME_MS
        ? 'near_time_possible_double_click'
        : 'delayed_replay_candidate';

    await this.logWithContext('info', 'SEMANTIC_DUPLICATE_DETECTED', {
      eventId: event.id,
      previousEventId: existing?.eventId ?? null,
      originalTimestamp,
      previousEventTimestamp,
      deltaMs,
      duplicateTimingClass,
      keyPartsSummary: computed.keyPartsSummary,
      dedupKey: computed.dedupKey,
      tabId,
    }, event.sessionId ?? null, traceId ?? null);
  }

  private async shouldSuppressSpaSyntheticOutcome(
    event: AIREvent,
    traceId: string,
    tabId: string,
  ): Promise<{
    suppress: boolean;
    latestOutcomeTimestamp: number | null;
    latestOutcomeEventId: string | null;
  }> {
    const sessionId = event.sessionId ?? null;
    if (!sessionId || !traceId) {
      return {
        suppress: false,
        latestOutcomeTimestamp: null,
        latestOutcomeEventId: null,
      };
    }

    const latestOutcome = await this.eventRepo.findLatestOutcomeByTraceSessionAndTab(
      traceId,
      sessionId,
      tabId,
    );

    if (!latestOutcome) {
      return {
        suppress: false,
        latestOutcomeTimestamp: null,
        latestOutcomeEventId: null,
      };
    }

    const routeTimestamp = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
    const suppress =
      latestOutcome.timestamp < routeTimestamp &&
      (routeTimestamp - latestOutcome.timestamp) <= GraphBuilder.SPA_ROUTE_DUPLICATE_WINDOW_MS;

    return {
      suppress,
      latestOutcomeTimestamp: latestOutcome.timestamp,
      latestOutcomeEventId: latestOutcome.id,
    };
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
        const isCustomControlOpen = normalizedEvent.type === 'custom-control-open';
        const isCustomSelect = normalizedEvent.type === 'custom-select' || normalizedEvent.type === 'custom-menu-select';
        const isPointerDependentEvent = this.isPointerDependentEvent(normalizedEvent);
        const usesEventLocalSnapshotPolicy = isInput || isSubmit || isCustomControlOpen || isCustomSelect;
        const tabState = await this.sessionManager.getTabState(normalizedEvent.sessionId, effectiveTabId);
        const lastNodeId = tabState?.lastNodeId ?? null;
        const pointerTimestamp = tabState?.lastEventAt ?? null;
        const eventTimestamp = Number.isFinite(normalizedEvent.timestamp) ? normalizedEvent.timestamp : null;
        const isStalePointerEvent = !!(
          isPointerDependentEvent &&
          eventTimestamp != null &&
          pointerTimestamp != null &&
          eventTimestamp < (pointerTimestamp - GraphBuilder.STALE_TOLERANCE_MS)
        );
        const effectiveLastNodeId = isStalePointerEvent ? null : lastNodeId;
        const hasSessionAndTrace =
          typeof event.sessionId === 'string' &&
          event.sessionId.length > 0 &&
          typeof event.traceId === 'string' &&
          event.traceId.length > 0;

        const fallbackDecision = usesEventLocalSnapshotPolicy
          ? this.evaluateEventLocalSnapshotFallback(normalizedEvent, effectiveLastNodeId, hasSessionAndTrace)
          : { eligible: false, reason: 'not_event_local_snapshot_type', snapshotSource: null as null };

        const eventForGraph = fallbackDecision.eligible
          ? this.withEventLocalFallbackMetadata(normalizedEvent)
          : normalizedEvent;

        const intent = IntentDetector.detectIntent(eventForGraph);
        const intentRaw = IntentDetector.getRawIntent(eventForGraph);
        const slimPayload = { ...eventForGraph } as any;
        // Keep interactionContext in payload for D3.5 diagnostics.
        // Keep input/submit/custom-control snapshots as event-local truth; trim large node-resolution snapshots elsewhere.
        if (!this.shouldRetainEventSnapshotsInPayload(eventForGraph)) {
          delete slimPayload.pageSnapshot;
          delete slimPayload.pageState;
        }
        const inserted = await this.eventRepo.insertIfAbsent(slimPayload as AIREvent, intent, intentRaw);
        if (!inserted) {
          await this.logWithContext('warn', 'Event stage: duplicate event ID detected - skipping graph work', {
            eventId: safeEventId,
            type: event.type,
          }, sessionId ?? null, traceId ?? null);
          await this.logGraphResult(
            'warn',
            event,
            safeEventId,
            traceId ?? null,
            effectiveTabId,
            null,
            { success: true, stage: 'duplicate_skipped', duplicate: true }
          );
          return { success: true, eventId: safeEventId, duplicate: true, stage: 'duplicate_skipped', traceId };
        }
        await this.recordSemanticDedupShadowSignal(eventForGraph, traceId, effectiveTabId);
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
        } else if (['click', 'custom', 'outcome', 'scroll', 'custom-control-open', 'custom-select', 'custom-menu-select', 'spa-route-change'].includes(eventForGraph.type)) {
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
        const shouldBypassPointerForStaleEvent = isStalePointerEvent && isPointerDependentEvent;

        if (eventForGraph.sessionId && currentNodeId) {
          if (shouldBypassPointerForStaleEvent) {
            const deltaMs =
              eventTimestamp != null && pointerTimestamp != null
                ? pointerTimestamp - eventTimestamp
                : null;
            await this.logWithContext('warn', 'STALE_EVENT_POINTER_BYPASS', {
              eventType: eventForGraph.type,
              eventTimestamp,
              pointerTimestamp,
              deltaMs,
              traceId,
              tabId: effectiveTabId,
              sessionId: eventForGraph.sessionId,
            }, eventForGraph.sessionId ?? null, traceId ?? null);

            await this.sessionManager.updatePointer(eventForGraph.sessionId, effectiveTabId, currentNodeId, eventForGraph.timestamp);
            await this.logGraphResult(
              'warn',
              eventForGraph,
              safeEventId,
              traceId,
              effectiveTabId,
              currentNodeId,
              { success: true, stage: 'stale_pointer_bypassed' }
            );
            return { success: true, stage: 'stale_pointer_bypassed', nodeId: currentNodeId, traceId };
          }

          if (['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select'].includes(eventForGraph.type) && !isHeartbeat) {
            await this.actionHandler.handleAction(eventForGraph, traceId, currentNodeId, effectiveLastNodeId, effectiveTabId);
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
            const suppression = await this.shouldSuppressSpaSyntheticOutcome(
              eventForGraph,
              traceId,
              effectiveTabId,
            );

            if (suppression.suppress) {
              await this.logWithContext('info', 'SPA_ROUTE_OBSERVATIONAL_SUPPRESSED_DUPLICATE_OUTCOME', {
                eventId: safeEventId,
                type: eventForGraph.type,
                nodeId: currentNodeId,
                traceId,
                tabId: effectiveTabId,
                latestOutcomeEventId: suppression.latestOutcomeEventId,
                latestOutcomeTimestamp: suppression.latestOutcomeTimestamp,
                duplicateWindowMs: GraphBuilder.SPA_ROUTE_DUPLICATE_WINDOW_MS,
              }, eventForGraph.sessionId ?? null, traceId ?? null);

              await this.sessionManager.updatePointer(eventForGraph.sessionId, effectiveTabId, currentNodeId, eventForGraph.timestamp);
              await this.logGraphResult(
                'info',
                eventForGraph,
                safeEventId,
                traceId,
                effectiveTabId,
                currentNodeId,
                { success: true, stage: 'spa_route_observational' }
              );
              return { success: true, stage: 'spa_route_observational', nodeId: currentNodeId, traceId };
            }

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

    void this.runCleanupTick();

    const interval = setInterval(() => {
      void this.runCleanupTick();
    }, GraphBuilder.CLEANUP_INTERVAL_MS);
    interval.unref?.();
    this.cleanupInterval = interval;
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
    const compositeAnchors = Array.isArray(snapshot.compositeAnchors)
      ? snapshot.compositeAnchors.filter(
          (anchor): anchor is Record<string, unknown> =>
            !!anchor && typeof anchor === 'object' && typeof (anchor as Record<string, unknown>).descriptor === 'string',
        )
      : [];
    const metrics = snapshot.metrics && typeof snapshot.metrics === 'object'
      ? snapshot.metrics as Record<string, unknown>
      : null;

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
        persistenceReason: persistedRow.persistenceReason,
        controlSignatureMissing: persistedRow.controlSignatureMissing,
        controlSignatureReason: persistedRow.controlSignatureReason ?? null,
        flatAnchorCount: anchors.length,
        compositeAnchorCount: compositeAnchors.length,
        compositeSample: compositeAnchors.slice(0, 3).map((anchor) => anchor.descriptor),
        droppedCompositeCount:
          typeof metrics?.droppedCompositeCount === 'number' ? metrics.droppedCompositeCount : 0,
        inspectedContainerCount:
          typeof metrics?.inspectedContainerCount === 'number' ? metrics.inspectedContainerCount : 0,
        skippedCompositeReason:
          typeof metrics?.skippedCompositeReason === 'string' ? metrics.skippedCompositeReason : null,
      }, event.sessionId ?? null, event.traceId ?? null);
    } catch (error) {
      await this.logWithContext('warn', 'Interaction context persistence failed - event pipeline continues', {
        eventId: event.id,
        error: (error as Error).message,
      }, event.sessionId ?? null, event.traceId ?? null);
    }
  }

  private async runCleanupTick(): Promise<void> {
    if (this.cleanupTickRunning) {
      return;
    }

    this.cleanupTickRunning = true;
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

      try {
        const dedupCutoffMs = Date.now() - GraphBuilder.DEDUP_KEY_TTL_MS;
        const deletedDedupRows = await this.eventRepo.cleanupExpiredDedupKeys(dedupCutoffMs);
        if (deletedDedupRows > 0) {
          await this.logWithContext('info', 'DEDUP_TTL_CLEANUP', {
            deletedRowCount: deletedDedupRows,
            cutoffTimestamp: dedupCutoffMs,
            ttlMs: GraphBuilder.DEDUP_KEY_TTL_MS,
          }, null, null);
        } else {
          await this.logWithContext('debug', 'DEDUP_TTL_CLEANUP_NOOP', {
            cutoffTimestamp: dedupCutoffMs,
            ttlMs: GraphBuilder.DEDUP_KEY_TTL_MS,
          }, null, null);
        }
      } catch (error) {
        await this.logWithContext('warn', 'DEDUP_TTL_CLEANUP_FAILED', {
          error: (error as Error).message,
        }, null, null);
      }
    } catch (error) {
      await this.logWithContext('error', 'Cleanup tick failed', { error: (error as Error).message }, null, null);
    } finally {
      this.cleanupTickRunning = false;
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
