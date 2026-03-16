// Purpose: Handles "Branch B" logic (Outcomes) and Explicit Edge creation.
// Prototype Origin: graph-builder.js (Branch B block, createExplicitEdge, updateOutcomeProbability)
// Changes: Coordinates via Repositories.

import crypto from 'crypto';
import { EdgeRepository } from '../../db/repositories/edge.repository';
import { OutcomeRepository } from '../../db/repositories/outcome.repository';
import { EventRepository } from '../../db/repositories/event.repository';
import { PendingActionRepository } from '../../db/repositories/pending-action.repository';
import { DebugLogger } from '../../logger/debug-logger';
import { OutcomeEventSchema, PendingAction, OutcomeType } from '../../types';
import { z } from 'zod';

type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;

/**
 * Normalises a URL for comparison by stripping hash fragments, query strings,
 * and trailing slashes. Prevents false navigation detections caused by:
 *   - Analytics params:  /page?utm_source=email  → /page
 *   - Hash anchors:      /page#section           → /page
 *   - Trailing slashes:  /dashboard/             → /dashboard
 *
 * Returns null for null/undefined input so callers can guard against missing URLs.
 */
function normalizeUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Keep only origin + pathname, strip trailing slash (except root /)
    const pathname = parsed.pathname.replace(/\/$/, '') || '/';
    return parsed.origin + pathname;
  } catch {
    // Unparseable URL — compare as-is to avoid silently swallowing errors
    return url;
  }
}

export class OutcomeHandler {
  constructor(
    private edgeRepo: EdgeRepository,
    private outcomeRepo: OutcomeRepository,
    private eventRepo: EventRepository,
    private pendingRepo: PendingActionRepository,
    private logger: DebugLogger
  ) {}

  public handleOutcome(event: OutcomeEvent, traceId: string, currentNodeId: string): void {
    const pending = this.pendingRepo.find(traceId);

    if (pending) {
      this.logger.log('OutcomeHandler', 'decision', 'Found PENDING ACTION for outcome', { 
        traceId, 
        fromNode: pending.fromNodeId, 
        toNode: currentNodeId 
      });

      // Create EXPLICIT Edge
      this.createExplicitEdge(pending.fromNodeId, currentNodeId, pending, event);

      // Mark pending as resolved
      this.pendingRepo.resolve(traceId);
    } else {
      // Fix (Bug #5): Baseline outcomes naturally have no preceding pending action —
      // captureBaseline() fires on every session init with traceId: 'baseline-<uuid>'.
      // Logging a warning for these polluted logs and obscured real orphan problems.
      // Silently return for baseline, warn only for genuinely unexpected orphans.
      if (traceId.startsWith('baseline-')) {
        return;
      }
      this.logger.log('OutcomeHandler', 'warn', 'Orphaned OUTCOME event — No pending action found', { traceId });
    }
  }

  public createExplicitEdge(fromNodeId: string, toNodeId: string, pendingAction: PendingAction, outcomeEvent: OutcomeEvent): void {
    // ── outcomeType determination — three-tier priority chain ────────────────
    //
    // Tier 1: Trust the interceptor's explicit settleType signal first.
    //   checkPendingOutcome() and _monitorSPARoutes() both set settleType='navigation'
    //   only when they are certain a real navigation occurred. This is the most
    //   reliable signal and must take priority over URL comparison.
    //
    // Tier 2: If no explicit signal, compare normalised URLs from the trigger event.
    //   normalizeUrl strips hash/query/trailing-slash so minor URL differences
    //   (analytics params, hash anchors) don't produce false navigation detections.
    //
    // Tier 3: If trigger event missing AND no explicit signal, default to state_refresh.
    //   This is the safe fallback — avoids false 'navigation' labels on SPA modals
    //   or drawers where nodes differ but URL did not change. A false navigation label
    //   would cause the Playwright code generator to emit waitForURL() that never fires.
    //
    let outcomeType: OutcomeType = 'state_refresh';

    // Fetch the original trigger event for URL comparison (Tier 2)
    const triggerEventRow = this.eventRepo.findById(pendingAction.triggerEventId);

    if (outcomeEvent.meta?.settleType === 'navigation') {
      // Tier 1: Explicit navigation signal from interceptor — trust it unconditionally
      outcomeType = 'navigation';
    } else if (triggerEventRow) {
      // Tier 2: Calculate from normalised URL comparison
      const normalizedTriggerUrl = normalizeUrl(triggerEventRow.page_url);
      const normalizedOutcomeUrl = normalizeUrl(outcomeEvent.meta?.urlAfter);

      if (normalizedOutcomeUrl && normalizedTriggerUrl !== normalizedOutcomeUrl) {
        outcomeType = 'navigation';
      } else if (fromNodeId === toNodeId) {
        outcomeType = 'no_change';
      }
      // else: URLs match, nodes differ (modal/drawer/SPA state change) → state_refresh
    } else {
      // Tier 3: No trigger event AND no explicit signal — safe default
      this.logger.log('OutcomeHandler', 'warn',
        'Trigger event missing and no explicit settleType — defaulting to state_refresh to prevent false Playwright navigation waits',
        { traceId: pendingAction.traceId }
      );
    }

    // This guarantees fpHash is a strict string, never null
    const fpHash = pendingAction.fingerprintHash || 'unknown';

    // Check existing explicit edge
    const existingEdge = this.edgeRepo.findByFingerprint(fromNodeId, toNodeId, fpHash);

    if (existingEdge) {
      // Stamp the resolved outcomeType — does NOT touch sample_size or decayed_count
      this.edgeRepo.resolveOutcome(existingEdge.id, outcomeType);
      this.logger.log('OutcomeHandler', 'decision', 'Resolved existing edge outcome', { edgeId: existingEdge.id, fpHash });
      return;
    }

    const edgeId = crypto.randomUUID();
    try {
      this.edgeRepo.insert({
        id: edgeId,
        fromNodeId,
        toNodeId,
        triggerEventId: pendingAction.triggerEventId,
        fingerprintHash: fpHash,
        outcomeType,
        lastUpdated: Date.now()
      });

      const outcomeId = crypto.randomUUID();
      this.outcomeRepo.insert(outcomeId, edgeId, toNodeId, Date.now());

      this.logger.log('OutcomeHandler', 'decision', 'Created new EXPLICIT edge', { edgeId, outcomeType, fpHash, from: fromNodeId, to: toNodeId });
      
      this.updateOutcomeProbability(edgeId, toNodeId);
    } catch (e) {
      this.logger.log('OutcomeHandler', 'error', 'Failed to create explicit edge', { error: (e as Error).message });
    }
  }

  public updateOutcomeProbability(edgeId: string, targetNodeId: string): void {
    this.outcomeRepo.updateProbability(edgeId, targetNodeId);
  }
}