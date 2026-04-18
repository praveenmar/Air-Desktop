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

    // Baseline outcomes naturally have no pending action.
    if (traceId.startsWith('baseline-')) {
      return;
    }

    await this.logWithContext('warn', 'Orphaned OUTCOME event - no pending action found', {}, event.sessionId ?? null, traceId ?? null);
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
