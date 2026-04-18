// Fix (Bug #3): Inner try/catch blocks now re-throw errors after logging so the
//   GraphBuilder transaction rolls back cleanly on any failure.
// Fix (Bug #9): computeFingerprintHash() switched from DJB2 to crypto.createHash('sha256').
//   DJB2 produces a 32-bit integer (~4 billion values). As a deduplication key on the
//   edges table this collision space is too small -- two different interactions with
//   similar attributes could hash to the same value and be silently merged into one edge.
//   SHA-256 produces a 256-bit hash, making collisions effectively impossible and
//   aligning with state-engine.ts which already uses SHA-256 for all other hashing.
//   MIGRATION NOTE: existing edges have DJB2 hashes stored in fingerprint_hash.
//   migrations.ts nullifies these so they get re-deduped cleanly on next recording
//   instead of accumulating duplicate edges.
// Fix (Bug #10c): Removed updateProbability() call after insert() on new edges.
//   insert() sets decayed_count = 1.0. Calling updateProbability() immediately after
//   incremented it to 2.0 before any real second observation occurred, corrupting the
//   Laplace smoothing math for the entire lifetime of that edge. updateProbability()
//   is now only called on the existing-edge path, where the row already exists and a
//   genuine repeat observation needs to be recorded.
// Fix (Bug #10d): Simplified the existing-edge upsert spread. EdgeRepository now returns
//   proper camelCase GraphEdge objects (Bug #1 fix), so only the fields actually being
//   changed need to be listed. fingerprintHash must still be explicit because
//   GraphEdge.fingerprintHash is string | null but upsert() requires string.

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
      'ActionHandler',
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

  public async handleAction(event: AIREvent, traceId: string, currentNodeId: string, lastNodeId: string | null): Promise<void> {
    const fpHash    = this.computeFingerprintHash(event);
    const safeEventId = event.id || crypto.randomUUID();

    const shouldRegisterPending = ['click', 'submit', 'custom-select'].includes(event.type);

    // 1. Register PENDING ACTION in DB (for future Outcome to resolve)
    if (shouldRegisterPending) {
      await this.registerPendingAction(traceId, event.sessionId, currentNodeId, safeEventId, event.type, fpHash);
      await this.logWithContext('info', 'Registered PENDING ACTION in DB', { type: event.type }, event.sessionId ?? null, traceId ?? null);
    }

    // 2. Self-Loop Fix: Ensure immediate actions still create edges
    if (lastNodeId) {
      await this.createEdge(lastNodeId, currentNodeId, event, fpHash);
    }
  }

  public async registerPendingAction(
    traceId: string,
    sessionId: string,
    fromNodeId: string,
    triggerEventId: string,
    actionType: string,
    fingerprintHash: string
  ): Promise<void> {
    try {
      await this.pendingRepo.register(traceId, sessionId, fromNodeId, triggerEventId, actionType, fingerprintHash);
    } catch (e) {
      await this.logWithContext('error', 'Failed to register pending action', { error: (e as Error).message }, sessionId ?? null, traceId ?? null);
      throw e; // FIX: re-throw so GraphBuilder's transaction rolls back
    }
  }

  public computeFingerprintHash(event: AIREvent): string {
    if (!('fingerprint' in event) || !event.fingerprint) return 'no_fingerprint';

    const fp  = event.fingerprint;

    // Build a deterministic string from the four most stable fingerprint fields.
    // Pipe-delimited to prevent accidental cross-field collisions
    // (e.g. selector="ab|cd" + text="" vs selector="ab" + text="cd").
    const raw = [
      fp.selector       || '',
      fp.textExcerpt    || '',
      fp.attributesHash || '',
      event.type        || '',
    ].join('|');

    // FIX (Bug #9): Use SHA-256 instead of DJB2.
    // DJB2 produced an 8-char hex string (~4B values) — too small for a dedup key.
    // SHA-256 produces a 64-char hex string — collision-resistant and consistent
    // with how state-engine.ts hashes everything else in the system.
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Speculative / Immediate Edge creation (handles the Self-Loop Fix).
   */
  public async createEdge(fromNodeId: string, toNodeId: string, event: AIREvent, fpHash: string): Promise<string | null> {
    const existingEdge = await this.edgeRepo.findByFingerprint(fromNodeId, toNodeId, fpHash);

    try {
      if (existingEdge) {
        // Genuine repeat observation -- increment count and recalculate probability.
        // fingerprintHash must be explicit: GraphEdge.fingerprintHash is string | null
        // but upsert() requires string. All other required fields come from the spread.
        await this.edgeRepo.incrementObservation(existingEdge.id);
        await this.outcomeRepo.updateProbability(existingEdge.id, toNodeId);
        return existingEdge.id;
      }

      const edgeId    = crypto.randomUUID();
      const outcomeId = crypto.randomUUID();

      // REPLACE with:
      await this.edgeRepo.insert({
        id: edgeId,
        fromNodeId,
        toNodeId,
        triggerEventId: event.id || crypto.randomUUID(),
        fingerprintHash: fpHash,
        outcomeType: 'immediate_action',  // ← Bug A fix
        lastUpdated: Date.now(),
      });

      // FIX (Bug #10c): insert() already sets decayed_count = 1.0 and probability = 1.0.
      // Do NOT call updateProbability() here -- it would immediately increment decayed_count
      // to 2.0 before any real second observation, corrupting the Laplace smoothing math
      // for the lifetime of this edge. updateProbability() is reserved for re-observations.
      await this.outcomeRepo.insert(outcomeId, edgeId, toNodeId, event.timestamp);

      return edgeId;
    } catch (e) {
      await this.logWithContext('error', 'Failed to create edge', { error: (e as Error).message }, event.sessionId ?? null, event.traceId ?? null);
      throw e; // FIX: re-throw so GraphBuilder's transaction rolls back
    }
  }
}
