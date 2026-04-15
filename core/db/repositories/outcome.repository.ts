// Purpose: Data access layer for Probabilistic Outcomes.
// Prototype Origin: graph-builder.js (updateOutcomeProbability, DB inserts)
// Changes: Extracted into typed methods, directly porting the Laplace smoothing math.
// Fix: Added mapOutcomeRow() to translate SQLite snake_case columns to camelCase TypeScript fields.
//      Without this, outcome.edgeId, outcome.targetNodeId, outcome.decayedCount etc. all returned
//      undefined. The Laplace smoothing internal query already used explicit snake_case column
//      aliases so it was unaffected, but findByEdge() returned broken Outcome objects.

import { Outcome } from '../../types';
import { AsyncSQLiteDatabase } from '../sqlite-adapter';

// Translates every snake_case SQLite column to its camelCase TypeScript equivalent.
function mapOutcomeRow(row: any): Outcome | null {
  if (!row) return null;
  return {
    id:           row.id,
    edgeId:       row.edge_id,
    targetNodeId: row.target_node_id,
    probability:  row.probability,
    decayedCount: row.decayed_count,
    lastObserved: row.last_observed,
  };
}

export class OutcomeRepository {
  constructor(private db: AsyncSQLiteDatabase) {}

  public async insert(id: string, edgeId: string, targetNodeId: string, timestamp: number): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO outcomes (id, edge_id, target_node_id, probability, decayed_count, last_observed) 
      VALUES (?, ?, ?, 1.0, 1.0, ?)
    `);
    await stmt.run(id, edgeId, targetNodeId, timestamp);
  }

  public async findByEdge(edgeId: string): Promise<Outcome[]> {
    const stmt = this.db.prepare('SELECT * FROM outcomes WHERE edge_id = ?');
    return ((await stmt.all(edgeId)) as any[]).map(mapOutcomeRow) as Outcome[];
  }

  /** Ported directly from prototype: Laplace Smoothing probability recalculation */
  public async updateProbability(edgeId: string, targetNodeId: string): Promise<void> {
    const now = Date.now();

    // 1. Increment observation count for the specific outcome
    await this.db.prepare(`
      UPDATE outcomes SET decayed_count = decayed_count + 1, last_observed = ? 
      WHERE edge_id = ? AND target_node_id = ?
    `).run(now, edgeId, targetNodeId);

    // 2. Fetch all outcomes for this edge to recalculate probabilities
    // NOTE: These columns are fetched with explicit aliases so the Laplace math
    // below accesses them safely without needing the row mapper.
    const outcomes = await this.db.prepare(`
      SELECT id, decayed_count, target_node_id FROM outcomes WHERE edge_id = ?
    `).all(edgeId) as { id: string, decayed_count: number, target_node_id: string }[];

    const K = outcomes.length;
    const totalObservations = outcomes.reduce((sum, o) => sum + o.decayed_count, 0);

    const updateStmt = this.db.prepare(`UPDATE outcomes SET probability = ? WHERE id = ?`);

    // 3. Recalculate and update each outcome with Laplace smoothing
    for (const outcome of outcomes) {
      const numerator   = outcome.decayed_count + 1;
      const denominator = totalObservations + K;
      const probability = numerator / denominator;

      await updateStmt.run(probability, outcome.id);
    }
  }
}
