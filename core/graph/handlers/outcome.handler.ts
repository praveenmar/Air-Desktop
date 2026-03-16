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
 * Normalises a URL string for reliable same-page vs navigation comparison.
 * Returns null for absent or completely unparseable input -- callers fall back to 'state_refresh'.
 *
 * Normalisation applied:
 *   - URL constructor lowercases scheme and host automatically
 *   - Trailing slash stripped from non-root pathnames  (/foo/ -> /foo)
 *   - Query params sorted by key                       (?b=2&a=1 -> ?a=1&b=2)
 *
 * Hash/fragment is preserved deliberately -- SPA hash routing (#/home -> #/about)
 * is real in-app navigation and must not be erased before comparing.
 *
 * @param base  Optional absolute URL used to resolve relative inputs like '/dashboard'.
 *              Without this, new URL('/dashboard') throws into the catch block which
 *              returns the raw string -- meaning an absolute trigger URL and a relative
 *              outcome URL for the same page would never match, producing a false
 *              'navigation' edge. Pass the other side's URL as base so relative paths
 *              are resolved to the same absolute form before comparison.
 */
function normalizeUrl(raw: string | null | undefined, base?: string | null): string | null {
  if (!raw) return null;
  try {
    let u: URL;
    try {
      u = new URL(raw);                             // succeeds for absolute URLs
    } catch {
      if (!base) return raw.trim().toLowerCase();   // no base to resolve against -- best effort
      u = new URL(raw, base);                       // resolves '/dashboard' against 'https://app.com/'
    }
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    u.searchParams.sort();
    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
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
        toNode:   currentNodeId,
      });

      // Create EXPLICIT Edge — any error here will propagate up to the transaction
      this.createExplicitEdge(pending.fromNodeId, currentNodeId, pending, event);

      // Mark pending as resolved
      this.pendingRepo.resolve(traceId);
    } else {
      // FIX (Bug #5): Silently ignore baseline outcomes since they naturally have no preceding action.
      if (traceId.includes('baseline')) {
        return; 
      }
      
      this.logger.log('OutcomeHandler', 'warn', 'Orphaned OUTCOME event — No pending action found', { traceId });
    }
  }
  
  public createExplicitEdge(
    fromNodeId: string,
    toNodeId: string,
    pendingAction: PendingAction,
    outcomeEvent: OutcomeEvent
  ): void {
    let outcomeType: OutcomeType = 'state_refresh';

    // Determine outcome type by comparing pre/post URLs
    const triggerEventRow = this.eventRepo.findById(pendingAction.triggerEventId);

    if (!triggerEventRow) {
      this.logger.log('OutcomeHandler', 'warn', 'Trigger event not found; cannot determine navigation', {
        traceId: pendingAction.traceId,
      });
      // safe fallback -- state_refresh is the most conservative choice
    } else {
      const urlBefore = normalizeUrl(triggerEventRow.page_url);
      const urlAfter  = normalizeUrl(outcomeEvent.meta?.urlAfter, triggerEventRow.page_url);

      if (urlBefore === null || urlAfter === null) {
        // One or both URLs absent/unparseable -- can't determine, stay at state_refresh
      } else if (urlBefore !== urlAfter) {
        outcomeType = 'navigation';
      } else if (fromNodeId === toNodeId) {
        outcomeType = 'no_change';
      }
      // else outcomeType remains 'state_refresh'
    }

    const fpHash       = pendingAction.fingerprintHash || 'unknown';
    const existingEdge = this.edgeRepo.findByFingerprint(fromNodeId, toNodeId, fpHash);

    try {
      if (existingEdge) {
        // FIX (Bug #10b): spread existingEdge directly -- EdgeRepository now returns
        // proper camelCase GraphEdge objects (Bug #1 fix) so no manual re-mapping needed.
        // fingerprintHash must be overridden explicitly: GraphEdge.fingerprintHash is
        // string | null but upsert() requires string. fpHash is already guaranteed
        // non-null ('unknown' fallback above), so this both satisfies the type and
        // ensures we always write the canonical hash, never a stale null.
        this.edgeRepo.upsert({
          ...existingEdge,
          fingerprintHash: fpHash,
          outcomeType,
          lastUpdated: Date.now(),
        });
        this.updateOutcomeProbability(existingEdge.id, toNodeId);
        this.logger.log('OutcomeHandler', 'decision', 'Boosted existing EXPLICIT edge', {
          edgeId: existingEdge.id, fpHash,
        });
        return;
      }

      const edgeId    = crypto.randomUUID();
      const outcomeId = crypto.randomUUID();

      this.edgeRepo.upsert({
        id:             edgeId,
        fromNodeId,
        toNodeId,
        triggerEventId: pendingAction.triggerEventId,
        fingerprintHash: fpHash,
        outcomeType,
        lastUpdated:    Date.now(),
      });

      this.outcomeRepo.insert(outcomeId, edgeId, toNodeId, Date.now());
      this.logger.log('OutcomeHandler', 'decision', 'Created new EXPLICIT edge', {
        edgeId, outcomeType, fpHash, from: fromNodeId, to: toNodeId,
      });

      this.updateOutcomeProbability(edgeId, toNodeId);

    } catch (e) {
      this.logger.log('OutcomeHandler', 'error', 'Failed to create explicit edge', { error: (e as Error).message });
      throw e; // re-throw so GraphBuilder's transaction rolls back
    }
  }

  public updateOutcomeProbability(edgeId: string, targetNodeId: string): void {
    this.outcomeRepo.updateProbability(edgeId, targetNodeId);
  }
}