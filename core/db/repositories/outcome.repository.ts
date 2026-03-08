// Purpose: Data access layer for Probabilistic Outcomes.
// Prototype Origin: graph-builder.js (updateOutcomeProbability, DB inserts)
// Changes: Extracted into typed methods, directly porting the Laplace smoothing math.

import { Database } from 'better-sqlite3';
import { Outcome } from '../../types';

export class OutcomeRepository {
  constructor(private db: Database) {}

  public insert(id: string, edgeId: string, targetNodeId: string, timestamp: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO outcomes (id, edge_id, target_node_id, probability, decayed_count, last_observed) 
      VALUES (?, ?, ?, 1.0, 1.0, ?)
    `);
    stmt.run(id, edgeId, targetNodeId, timestamp);
  }

  public findByEdge(edgeId: string): Outcome[] {
    const stmt = this.db.prepare('SELECT * FROM outcomes WHERE edge_id = ?');
    return stmt.all(edgeId) as Outcome[];
  }

  /** Ported directly from prototype: Laplace Smoothing probability recalculation */
  public updateProbability(edgeId: string, targetNodeId: string): void {
    const now = Date.now();
      
    // 1. Increment observation count for the specific outcome
    this.db.prepare(`
      UPDATE outcomes SET decayed_count = decayed_count + 1, last_observed = ? 
      WHERE edge_id = ? AND target_node_id = ?
    `).run(now, edgeId, targetNodeId);

    // 2. Fetch all outcomes for this edge to recalculate probabilities
    const outcomes = this.db.prepare(`
      SELECT id, decayed_count, target_node_id FROM outcomes WHERE edge_id = ?
    `).all(edgeId) as { id: string, decayed_count: number, target_node_id: string }[];
    
    const K = outcomes.length;
    const totalObservations = outcomes.reduce((sum, o) => sum + o.decayed_count, 0);

    const updateStmt = this.db.prepare(`UPDATE outcomes SET probability = ? WHERE id = ?`);
    
    // 3. Recalculate and update
    outcomes.forEach((outcome) => {
      const numerator = outcome.decayed_count + 1;
      const denominator = totalObservations + K;
      const probability = numerator / denominator;
      
      updateStmt.run(probability, outcome.id);
    });
  }
}