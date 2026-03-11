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
      this.logger.log('OutcomeHandler', 'warn', 'Orphaned OUTCOME event - No pending action found', { traceId });
    }
  }

  public createExplicitEdge(fromNodeId: string, toNodeId: string, pendingAction: PendingAction, outcomeEvent: OutcomeEvent): void {
    let outcomeType: OutcomeType = 'state_refresh';
    
    // Fetch the original trigger event to compare URLs
    const triggerEventRow = this.eventRepo.findById(pendingAction.triggerEventId);

    if (!triggerEventRow) {
      // Log the issue, then set a safe fallback and skip URL comparison
      this.logger.log('OutcomeHandler', 'warn', 'Trigger event not found; cannot determine navigation', { traceId: pendingAction.traceId });
      outcomeType = 'state_refresh'; // or maybe 'no_change'? state_refresh is a safe bet
    } else {
      
    // Normal logic using triggerEventRow
    if (triggerEventRow.page_url !== outcomeEvent.meta?.urlAfter) {
    outcomeType = 'navigation';
  } else if (fromNodeId === toNodeId) {
    outcomeType = 'no_change';
  }
  // else outcomeType remains 'state_refresh'
}

    // This guarantees fpHash is a strict string, never null
    const fpHash = pendingAction.fingerprintHash || 'unknown';

    // Check existing explicit edge
    const existingEdge = this.edgeRepo.findByFingerprint(fromNodeId, toNodeId, fpHash);

    if (existingEdge) {
      // Explicitly map the required fields to satisfy EdgeRepository.upsert's strict signature
      this.edgeRepo.upsert({
        ...existingEdge,
        id: existingEdge.id,
        fromNodeId: existingEdge.fromNodeId,
        toNodeId: existingEdge.toNodeId,
        triggerEventId: existingEdge.triggerEventId,
        fingerprintHash: fpHash, // Overrides the string | null from existingEdge
       outcomeType: outcomeType,
        lastUpdated: Date.now()
      });
      this.updateOutcomeProbability(existingEdge.id, toNodeId);
      this.logger.log('OutcomeHandler', 'decision', 'Boosted existing EXPLICIT edge', { edgeId: existingEdge.id, fpHash });
      return;
    }

    const edgeId = crypto.randomUUID();
    try {
      this.edgeRepo.upsert({
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