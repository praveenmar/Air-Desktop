import { Database } from 'better-sqlite3';
import { GraphEdge } from '../../types';

// The Magic Fix: Translates SQLite snake_case to TypeScript camelCase
function mapEdgeRow(row: any): GraphEdge | null {
  if (!row) return null;
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    triggerEventId: row.trigger_event_id,
    fingerprintHash: row.fingerprint_hash,
    seekStrategy: row.seek_strategy || null,
    sampleSize: row.sample_size,
    lastUpdated: row.last_updated,
    outcomeType: row.outcome_type || null,
  };
}

export class EdgeRepository {
  constructor(private db: Database) {}

  public findByFingerprint(fromNodeId: string, toNodeId: string, fingerprintHash: string): GraphEdge | null {
    const stmt = this.db.prepare(`
      SELECT * FROM edges 
      WHERE from_node_id = ? AND to_node_id = ? AND fingerprint_hash = ?
    `);
    return mapEdgeRow(stmt.get(fromNodeId, toNodeId, fingerprintHash));
  }

  public findByNodes(fromNodeId: string, toNodeId: string): GraphEdge[] {
    const stmt = this.db.prepare(`
      SELECT * FROM edges WHERE from_node_id = ? AND to_node_id = ?
    `);
    return stmt.all(fromNodeId, toNodeId).map(mapEdgeRow) as GraphEdge[];
  }

  public getAll(limit: number = 100): GraphEdge[] {
    const stmt = this.db.prepare(`
      SELECT * FROM edges ORDER BY last_updated DESC LIMIT ?
    `);
    return stmt.all(limit).map(mapEdgeRow) as GraphEdge[];
  }

  /**
   * INSERT a brand new edge row.
   * Called by:
   *   - ActionHandler.createEdge()    → new speculative edge, outcomeType='immediate_action'
   *   - OutcomeHandler.createExplicitEdge() → new explicit edge with resolved outcomeType
   * Never increments sample_size (starts at 1 per schema default).
   */
  public insert(edge: {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    triggerEventId: string;
    fingerprintHash: string;
    outcomeType?: string | null;
    lastUpdated?: number;
  }): string {
    const stmt = this.db.prepare(`
      INSERT INTO edges (
        id, from_node_id, to_node_id, trigger_event_id, fingerprint_hash, outcome_type, sample_size, last_updated
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);

    stmt.run(
      edge.id,
      edge.fromNodeId,
      edge.toNodeId,
      edge.triggerEventId,
      edge.fingerprintHash,
      edge.outcomeType || null,
      edge.lastUpdated || Date.now()
    );

    return edge.id;
  }

  /**
   * Record a repeat observation of an existing edge — user clicked the same
   * element again. Increments sample_size only. Does NOT touch outcome_type
   * so a previously resolved type (navigation, no_change) is never overwritten
   * by a subsequent speculative click.
   * Called by: ActionHandler.createEdge() when findByFingerprint returns a hit.
   */
  public incrementObservation(edgeId: string): void {
    this.db.prepare(`
      UPDATE edges SET sample_size = sample_size + 1, last_updated = ? WHERE id = ?
    `).run(Date.now(), edgeId);
  }

  /**
   * Stamp the resolved outcome type onto an existing edge after the page settles.
   * Does NOT touch sample_size — resolving an outcome is not a new observation,
   * it is the completion of one that ActionHandler already counted.
   * Called by: OutcomeHandler.createExplicitEdge() when findByFingerprint returns a hit.
   */
  public resolveOutcome(edgeId: string, outcomeType: string): void {
    this.db.prepare(`
      UPDATE edges SET outcome_type = ?, last_updated = ? WHERE id = ?
    `).run(outcomeType, Date.now(), edgeId);
  }
}