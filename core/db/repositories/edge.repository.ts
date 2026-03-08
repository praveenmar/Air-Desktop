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

  public upsert(edge: Partial<GraphEdge> & { id: string, fromNodeId: string, toNodeId: string, triggerEventId: string, fingerprintHash: string }): string {
    const existing = this.findByFingerprint(edge.fromNodeId, edge.toNodeId, edge.fingerprintHash);

    if (existing) {
      const stmt = this.db.prepare(`UPDATE edges SET sample_size = sample_size + 1, last_updated = ? WHERE id = ?`);
      stmt.run(Date.now(), existing.id);
      return existing.id;
    }

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
}