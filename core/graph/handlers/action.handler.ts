import crypto from 'crypto';
import { PendingActionRepository } from '../../db/repositories/pending-action.repository';
import { EdgeRepository } from '../../db/repositories/edge.repository';
import { OutcomeRepository } from '../../db/repositories/outcome.repository';
import { DebugLogger } from '../../logger/debug-logger';
import { AIREvent } from '../../types';

export class ActionHandler {
  constructor(
    private pendingRepo: PendingActionRepository,
    private edgeRepo: EdgeRepository,
    private outcomeRepo: OutcomeRepository,
    private logger: DebugLogger
  ) {}

  public handleAction(event: AIREvent, traceId: string, currentNodeId: string, lastNodeId: string | null): void {
    const fpHash = this.computeFingerprintHash(event);

    // The Fix: Guarantee a string ID using a safe fallback
    const safeEventId = event.id || crypto.randomUUID();

    // 1. Register PENDING ACTION in DB (for future Outcome to resolve)
    this.registerPendingAction(traceId, event.sessionId || '', currentNodeId, safeEventId, event.type, fpHash);
    this.logger.log('ActionHandler', 'info', 'Registered PENDING ACTION in DB', { traceId, type: event.type });

    // 2. RESTORED: Self-Loop Fix (Ensure immediate actions still create edges)
    if (lastNodeId) {
      this.createEdge(lastNodeId, currentNodeId, event, fpHash);
    }
  }

  public registerPendingAction(traceId: string, sessionId: string, fromNodeId: string, triggerEventId: string, actionType: string, fingerprintHash: string): void {
    try {
      this.pendingRepo.register(traceId, sessionId, fromNodeId, triggerEventId, actionType, fingerprintHash);
    } catch (e) {
      this.logger.log('ActionHandler', 'error', 'Failed to register pending action', { error: (e as Error).message });
    }
  }

  public computeFingerprintHash(event: AIREvent): string {
    if (!('fingerprint' in event) || !event.fingerprint) return 'no_fingerprint';
    
    const fp = event.fingerprint;
    const raw = [
      fp.selector || '',
      fp.textExcerpt || '',
      fp.attributesHash || '',
      event.type || ''
    ].join('|');
    
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Speculative/Immediate Edge creation (Handles Self-Loop Fix)
   */
  public createEdge(fromNodeId: string, toNodeId: string, event: AIREvent, fpHash: string): string | null {
    const existingEdge = this.edgeRepo.findByFingerprint(fromNodeId, toNodeId, fpHash);

    if (existingEdge) {
      this.edgeRepo.upsert({
        ...existingEdge,
        id: existingEdge.id,
        fromNodeId: existingEdge.fromNodeId,
        toNodeId: existingEdge.toNodeId,
        triggerEventId: existingEdge.triggerEventId,
        fingerprintHash: fpHash, // Overrides string | null to strict string for TS
        lastUpdated: Date.now()
      });
      this.outcomeRepo.updateProbability(existingEdge.id, toNodeId);
      return existingEdge.id;
    }

    const edgeId = crypto.randomUUID();
    try {
      this.edgeRepo.upsert({
        id: edgeId,
        fromNodeId: fromNodeId,
        toNodeId: toNodeId,
        triggerEventId: event.id || crypto.randomUUID(), // Safe fallback for SQLite NOT NULL
        fingerprintHash: fpHash,
        lastUpdated: Date.now()
      });
      
      const outcomeId = crypto.randomUUID();
      this.outcomeRepo.insert(outcomeId, edgeId, toNodeId, event.timestamp);
      this.outcomeRepo.updateProbability(edgeId, toNodeId);
      
      return edgeId;
    } catch (e) {
      this.logger.log('ActionHandler', 'error', 'Failed to create edge', { error: (e as Error).message });
      return null;
    }
  }
}