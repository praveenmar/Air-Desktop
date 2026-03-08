// Purpose: Data access layer for UI State Nodes.
// Prototype Origin: graph-builder.js (_upsertStateNode, _upsertFallbackNode, getNodes)
// Changes: Ported into a strict class with dependency injection.

import { Database } from 'better-sqlite3';
import { GraphNode } from '../../types';

export class NodeRepository {
  constructor(private db: Database) {}

  public findById(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    return (stmt.get(id) as GraphNode) || null;
  }

  public findByHash(projectId: string, canonicalHash: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE project_id = ? AND canonical_hash = ?');
    return (stmt.get(projectId, canonicalHash) as GraphNode) || null;
  }

  public getAll(limit: number = 100): GraphNode[] {
    const stmt = this.db.prepare('SELECT * FROM nodes ORDER BY last_observed_at DESC LIMIT ?');
    return stmt.all(limit) as GraphNode[];
  }

  public upsert(node: Partial<GraphNode> & { id: string, canonicalHash: string, projectId: string }): string {
    const existing = this.findByHash(node.projectId, node.canonicalHash);

    if (existing) {
      this.updateObservation(
        existing.id,
        node.lastObservedAt || Date.now(),
        node.metadata || null,
        node.stateSource || null,
        node.anchors || null,
        node.pageUrl || null,
        node.viewportWidth || null,
        node.viewportHeight || null
      );
      return existing.id;
    }

    const stmt = this.db.prepare(`
      INSERT INTO nodes (
        id, project_id, canonical_hash, page_url, page_title, context_tokens, 
        snapshot_html, anchors, metadata, created_at, last_observed_at, 
        state_source, viewport_width, viewport_height
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      node.id,
      node.projectId,
      node.canonicalHash,
      node.pageUrl || null,
      node.pageTitle || null,
      node.contextTokens || null,
      node.snapshotHtml || null,
      node.anchors || null,
      node.metadata || null,
      node.createdAt || Date.now(),
      node.lastObservedAt || Date.now(),
      node.stateSource || null,
      node.viewportWidth || null,
      node.viewportHeight || null
    );

    return node.id;
  }

  public updateObservation(
    id: string, 
    timestamp: number, 
    metadata: string | null, 
    stateSource: string | null,
    anchors: string | null,
    pageUrl: string | null,
    viewportWidth: number | null,
    viewportHeight: number | null
  ): void {
    const stmt = this.db.prepare(`
      UPDATE nodes 
      SET last_observed_at = ?, observation_count = observation_count + 1, 
          metadata = ?, state_source = ?, anchors = COALESCE(anchors, ?),
          page_url = COALESCE(page_url, ?), viewport_width = COALESCE(viewport_width, ?), viewport_height = COALESCE(viewport_height, ?)
      WHERE id = ?
    `);

    stmt.run(timestamp, metadata, stateSource, anchors, pageUrl, viewportWidth, viewportHeight, id);
  }
}