// Purpose: Data access layer for UI State Nodes.
// Prototype Origin: graph-builder.js (_upsertStateNode, _upsertFallbackNode, getNodes)
// Changes: Ported into a strict class with dependency injection.
// Fix: Added mapNodeRow() to translate SQLite snake_case columns to camelCase TypeScript fields.
//      Without this, every field access on a returned GraphNode (e.g. node.canonicalHash,
//      node.pageUrl, node.lastObservedAt) silently returned undefined at runtime.

import { Database } from 'better-sqlite3';
import { GraphNode } from '../../types';

export interface NodeUpdate {
  lastObservedAt?: number;
  metadata?: string | null;
  stateSource?: string | null;
  anchors?: string | null;
  pageUrl?: string | null;
  viewportWidth?: number | null;
  viewportHeight?: number | null;
}

// Mirrors the pattern in EdgeRepository and PendingActionRepository.
// Translates every snake_case SQLite column to its camelCase TypeScript equivalent.
function mapNodeRow(row: any): GraphNode | null {
  if (!row) return null;
  return {
    id:               row.id,
    projectId:        row.project_id,
    canonicalHash:    row.canonical_hash,
    pageUrl:          row.page_url,
    pageTitle:        row.page_title,
    snapshotHtml:     row.snapshot_html,
    contextTokens:    row.context_tokens,
    anchors:          row.anchors,
    stateSource:      row.state_source,
    viewportWidth:    row.viewport_width,
    viewportHeight:   row.viewport_height,
    createdAt:        row.created_at,
    lastObservedAt:   row.last_observed_at,
    observationCount: row.observation_count,
    metadata:         row.metadata,
  };
}

export class NodeRepository {
  constructor(private db: Database) {}

  public findById(id: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE id = ?');
    return mapNodeRow(stmt.get(id));
  }

  public findByHash(projectId: string, canonicalHash: string): GraphNode | null {
    const stmt = this.db.prepare('SELECT * FROM nodes WHERE project_id = ? AND canonical_hash = ?');
    return mapNodeRow(stmt.get(projectId, canonicalHash));
  }

  public getAll(limit: number = 100): GraphNode[] {
    const stmt = this.db.prepare('SELECT * FROM nodes ORDER BY last_observed_at DESC LIMIT ?');
    return (stmt.all(limit) as any[]).map(mapNodeRow) as GraphNode[];
  }

  public upsert(node: Partial<GraphNode> & { id: string, canonicalHash: string, projectId: string }): string {
    const existing = this.findByHash(node.projectId, node.canonicalHash);

    if (existing) {
      const updates: NodeUpdate = {};

      // lastObservedAt defaults to now if not provided
      updates.lastObservedAt = node.lastObservedAt ?? Date.now();

      if (node.metadata !== undefined)      updates.metadata      = node.metadata;
      if (node.stateSource !== undefined)   updates.stateSource   = node.stateSource;
      if (node.anchors !== undefined)       updates.anchors       = node.anchors;
      if (node.pageUrl !== undefined)       updates.pageUrl       = node.pageUrl;
      if (node.viewportWidth !== undefined) updates.viewportWidth = node.viewportWidth;
      if (node.viewportHeight !== undefined) updates.viewportHeight = node.viewportHeight;

      this.updateObservation(existing.id, updates);
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
      node.pageUrl        || null,
      node.pageTitle      || null,
      node.contextTokens  || null,
      node.snapshotHtml   || null,
      node.anchors        || null,
      node.metadata       || null,
      node.createdAt      || Date.now(),
      node.lastObservedAt || Date.now(),
      node.stateSource    || null,
      node.viewportWidth  || null,
      node.viewportHeight || null
    );

    return node.id;
  }

  public updateObservation(id: string, updates: NodeUpdate): void {
    const setClauses: string[] = [];
    const params: any[] = [];

    // Always increment the observation count
    setClauses.push('observation_count = observation_count + 1');

    if (updates.lastObservedAt !== undefined) {
      setClauses.push('last_observed_at = ?');
      params.push(updates.lastObservedAt);
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = ?');
      params.push(updates.metadata);
    }
    if (updates.stateSource !== undefined) {
      setClauses.push('state_source = ?');
      params.push(updates.stateSource);
    }
    if (updates.anchors !== undefined) {
      setClauses.push('anchors = ?');
      params.push(updates.anchors);
    }
    if (updates.pageUrl !== undefined) {
      setClauses.push('page_url = ?');
      params.push(updates.pageUrl);
    }
    if (updates.viewportWidth !== undefined) {
      setClauses.push('viewport_width = ?');
      params.push(updates.viewportWidth);
    }
    if (updates.viewportHeight !== undefined) {
      setClauses.push('viewport_height = ?');
      params.push(updates.viewportHeight);
    }

    params.push(id);
    const sql = `UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...params);
  }
}