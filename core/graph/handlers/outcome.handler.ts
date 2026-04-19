// Purpose: Handles Branch B logic (Outcomes) and explicit edge creation.

import crypto from 'crypto';
import { z } from 'zod';
import { normalizeUrl } from '@air/shared';
import { EdgeRepository } from '../../db/repositories/edge.repository';
import { OutcomeRepository } from '../../db/repositories/outcome.repository';
import { EventRepository } from '../../db/repositories/event.repository';
import { PendingActionRepository } from '../../db/repositories/pending-action.repository';
import { DebugLogger } from '../../logger/debug-logger';
import { OutcomeEventSchema, PendingAction, OutcomeType } from '../../types';

type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;
const BASELINE_TRACE_PREFIX = 'baseline-';
const FALLBACK_PENDING_LOOKBACK_MS = 15_000;
const FALLBACK_PENDING_MAX_CANDIDATES = 2;

export class OutcomeHandler {
  constructor(
    private edgeRepo: EdgeRepository,
    private outcomeRepo: OutcomeRepository,
    private eventRepo: EventRepository,
    private pendingRepo: PendingActionRepository,
    private logger: DebugLogger
  ) {}

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
      'OutcomeHandler',
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

  public async handleOutcome(event: OutcomeEvent, traceId: string, currentNodeId: string): Promise<void> {
    const pending = await this.pendingRepo.find(traceId);

    if (pending) {
      await this.logWithContext('decision', 'Found PENDING ACTION for outcome', {
        fromNode: pending.fromNodeId,
        toNode: currentNodeId,
      }, pending.sessionId ?? event.sessionId ?? null, traceId ?? null);

      await this.createExplicitEdge(pending.fromNodeId, currentNodeId, pending, event);
      await this.pendingRepo.resolve(traceId);
      return;
    }

    const recovered = await this.tryRecoverPendingForCrossContextOutcome(event, traceId, currentNodeId);
    if (recovered) {
      return;
    }

    // Baseline outcomes naturally may have no pending action.
    if (traceId.startsWith(BASELINE_TRACE_PREFIX)) {
      return;
    }

    await this.logWithContext('warn', 'Orphaned OUTCOME event - no pending action found', {}, event.sessionId ?? null, traceId ?? null);
  }

  private getOutcomeUrl(event: OutcomeEvent): string | null {
    return event.normalizedUrl || event.meta?.urlAfter || event.pageUrl || null;
  }

  private isExplicitNavigationOutcome(event: OutcomeEvent): boolean {
    const settleType = event.meta?.settleType;
    return typeof settleType === 'string' && settleType.toLowerCase() === 'navigation';
  }

  private async tryRecoverPendingForCrossContextOutcome(
    event: OutcomeEvent,
    traceId: string,
    currentNodeId: string
  ): Promise<boolean> {
    const sessionId = event.sessionId ?? null;
    if (!sessionId) return false;

    const eventTimestamp = Number.isFinite(event.timestamp) ? event.timestamp : Date.now();
    const createdAfterMs = eventTimestamp - FALLBACK_PENDING_LOOKBACK_MS;
    const recentPending = await this.pendingRepo.findRecentPendingForSession(
      sessionId,
      createdAfterMs,
      FALLBACK_PENDING_MAX_CANDIDATES
    );

    if (recentPending.length === 0) {
      return false;
    }

    if (recentPending.length > 1) {
      await this.logWithContext('warn', 'Skipped fallback pending recovery due to ambiguity', {
        candidates: recentPending.map(candidate => candidate.traceId),
      }, sessionId, traceId ?? null);
      return false;
    }

    const candidate = recentPending[0];
    const triggerEventRow = await this.eventRepo.findById(candidate.triggerEventId);
    const triggerUrl = triggerEventRow?.page_url || null;
    const outcomeUrl = this.getOutcomeUrl(event);
    const normalizedTriggerUrl = triggerUrl ? normalizeUrl(triggerUrl) : null;
    const normalizedOutcomeUrl = outcomeUrl ? normalizeUrl(outcomeUrl) : null;
    const explicitNavigation = this.isExplicitNavigationOutcome(event);
    const urlChanged = !!(
      normalizedTriggerUrl &&
      normalizedOutcomeUrl &&
      normalizedTriggerUrl !== normalizedOutcomeUrl
    );

    if (!explicitNavigation && !urlChanged) {
      await this.logWithContext('debug', 'Skipped fallback pending recovery - not a cross-context outcome', {
        candidateTraceId: candidate.traceId,
        normalizedTriggerUrl,
        normalizedOutcomeUrl,
      }, sessionId, traceId ?? null);
      return false;
    }

    await this.logWithContext('decision', 'Recovered pending action for cross-context outcome', {
      fallbackTraceId: candidate.traceId,
      fromNode: candidate.fromNodeId,
      toNode: currentNodeId,
      normalizedTriggerUrl,
      normalizedOutcomeUrl,
      explicitNavigation,
      urlChanged,
    }, sessionId, traceId ?? null);

    await this.createExplicitEdge(candidate.fromNodeId, currentNodeId, candidate, event);
    await this.pendingRepo.resolve(candidate.traceId);
    return true;
  }

  public async createExplicitEdge(
    fromNodeId: string,
    toNodeId: string,
    pendingAction: PendingAction,
    outcomeEvent: OutcomeEvent
  ): Promise<void> {
    let outcomeType: OutcomeType = 'state_refresh';
    let outcomeReason = 'state refresh (URL unchanged while node changed)';

    const triggerEventRow = await this.eventRepo.findById(pendingAction.triggerEventId);
    const triggerUrl = triggerEventRow?.page_url || null;
    const outcomeUrl = outcomeEvent.normalizedUrl || outcomeEvent.meta?.urlAfter || outcomeEvent.pageUrl || null;
    const normalizedTriggerUrl = triggerUrl ? normalizeUrl(triggerUrl) : null;
    const normalizedOutcomeUrl = outcomeUrl ? normalizeUrl(outcomeUrl) : null;

    if (outcomeEvent.meta?.settleType === 'navigation') {
      // Tier 1: explicit signal from interceptor.
      outcomeType = 'navigation';
      outcomeReason = 'explicit navigation settleType from interceptor';
    } else if (triggerEventRow) {
      // Tier 2: normalized URL comparison.
      if (normalizedOutcomeUrl && normalizedTriggerUrl !== normalizedOutcomeUrl) {
        outcomeType = 'navigation';
        outcomeReason = 'normalized URL changed between trigger and outcome';
      } else if (fromNodeId === toNodeId) {
        outcomeType = 'no_change';
        outcomeReason = 'resolved to same node and same URL';
      }
    } else {
      // Tier 3: conservative fallback.
      outcomeReason = 'trigger event missing; defaulting to state_refresh';
      await this.logWithContext(
        'warn',
        'Trigger event missing and no explicit settleType - defaulting to state_refresh',
        {},
        pendingAction.sessionId ?? outcomeEvent.sessionId ?? null,
        pendingAction.traceId ?? null
      );
    }

    const fpHash = pendingAction.fingerprintHash || 'unknown';
    const existingEdge = await this.edgeRepo.findByFingerprint(fromNodeId, toNodeId, fpHash);

    if (existingEdge) {
      await this.edgeRepo.resolveOutcome(existingEdge.id, outcomeType);
      await this.logWithContext('decision', `Resolved existing edge outcome: ${outcomeType} - ${outcomeReason}`, {
        edgeId: existingEdge.id,
        fpHash,
        from: fromNodeId,
        to: toNodeId,
        normalizedTriggerUrl,
        normalizedOutcomeUrl,
      }, pendingAction.sessionId ?? outcomeEvent.sessionId ?? null, pendingAction.traceId ?? null);
      return;
    }

    const edgeId = crypto.randomUUID();
    try {
      await this.edgeRepo.insert({
        id: edgeId,
        fromNodeId,
        toNodeId,
        triggerEventId: pendingAction.triggerEventId,
        fingerprintHash: fpHash,
        outcomeType,
        lastUpdated: Date.now(),
      });

      const outcomeId = crypto.randomUUID();
      await this.outcomeRepo.insert(outcomeId, edgeId, toNodeId, Date.now());

      await this.logWithContext('decision', `Edge created: ${outcomeType} - ${outcomeReason}`, {
        edgeId,
        fpHash,
        from: fromNodeId,
        to: toNodeId,
        normalizedTriggerUrl,
        normalizedOutcomeUrl,
      }, pendingAction.sessionId ?? outcomeEvent.sessionId ?? null, pendingAction.traceId ?? null);
    } catch (e) {
      await this.logWithContext('error', 'Failed to create explicit edge', { error: (e as Error).message }, pendingAction.sessionId ?? outcomeEvent.sessionId ?? null, pendingAction.traceId ?? null);
      throw e;
    }
  }

  public async updateOutcomeProbability(edgeId: string, targetNodeId: string): Promise<void> {
    await this.outcomeRepo.updateProbability(edgeId, targetNodeId);
  }
}
