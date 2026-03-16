// Purpose: Schema definition and migration tracking.
// Prototype Origin: db.js (TABLES array and migrations array)
// Changes: Extracted into its own typed module.
// Fix (Bug #9): Added 'nullify_djb2_fp_hashes' migration.
//   ActionHandler previously used DJB2 to compute fingerprint_hash values stored in
//   edges and pending_actions. The algorithm has been switched to SHA-256. Any existing
//   DJB2 hashes in the edges table would never match new SHA-256 hashes, causing
//   duplicate edges on re-recordings of the same interactions. This migration nullifies
//   all existing fingerprint_hash values so they get re-deduped cleanly on next recording.
//   pending_actions are auto-cleaned within 2 minutes so they need no migration.

import { Database } from 'better-sqlite3';

const TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL,
    description TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'default',
    started_at INTEGER NOT NULL,
    last_event_at INTEGER,
    last_node_id TEXT,
    event_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    metadata TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    project_id TEXT DEFAULT 'default',
    canonical_hash TEXT NOT NULL,
    page_url TEXT,
    page_title TEXT,
    snapshot_html TEXT,
    context_tokens TEXT,
    anchors TEXT,
    state_source TEXT,
    viewport_width INTEGER,
    viewport_height INTEGER,
    created_at INTEGER NOT NULL,
    last_observed_at INTEGER,
    observation_count INTEGER DEFAULT 1,
    metadata TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_project_hash ON nodes(project_id, canonical_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_hash ON nodes(canonical_hash)`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    session_id TEXT,
    trace_id TEXT,
    node_id TEXT,
    page_url TEXT,
    payload TEXT NOT NULL,
    processed INTEGER DEFAULT 0,
    intent TEXT,
    intent_raw TEXT,
    FOREIGN KEY(session_id) REFERENCES sessions(id),
    FOREIGN KEY(node_id) REFERENCES nodes(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id)`,
  `CREATE TABLE IF NOT EXISTS edges (
    id TEXT PRIMARY KEY,
    from_node_id TEXT,
    to_node_id TEXT,
    trigger_event_id TEXT NOT NULL,
    fingerprint_hash TEXT,
    seek_strategy TEXT,
    sample_size INTEGER DEFAULT 1,
    last_updated INTEGER,
    outcome_type TEXT,
    FOREIGN KEY(from_node_id) REFERENCES nodes(id),
    FOREIGN KEY(to_node_id) REFERENCES nodes(id),
    FOREIGN KEY(trigger_event_id) REFERENCES events(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_edges_dedup ON edges(from_node_id, to_node_id, fingerprint_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_node_id)`,
  `CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    edge_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    probability FLOAT DEFAULT 1.0,
    decayed_count FLOAT DEFAULT 1.0,
    last_observed INTEGER,
    FOREIGN KEY(edge_id) REFERENCES edges(id),
    FOREIGN KEY(target_node_id) REFERENCES nodes(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outcomes_edge ON outcomes(edge_id)`,
  `CREATE INDEX IF NOT EXISTS idx_outcomes_node ON outcomes(target_node_id)`,
  `CREATE TABLE IF NOT EXISTS pending_actions (
    trace_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    from_node_id TEXT NOT NULL,
    trigger_event_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    fingerprint_hash TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER,
    status TEXT DEFAULT 'pending'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pending_session ON pending_actions(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_actions(status)`,
  `CREATE TABLE IF NOT EXISTS debug_logs (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    component TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    data TEXT,
    session_id TEXT,
    trace_id TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_logs_component ON debug_logs(component)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON debug_logs(timestamp)`
];

const MIGRATIONS: Array<{ cmd: string; name: string }> = [
  { cmd: 'ALTER TABLE events ADD COLUMN intent_raw TEXT',      name: 'intent_raw' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN state_source TEXT',     name: 'state_source' },
  { cmd: 'ALTER TABLE edges ADD COLUMN outcome_type TEXT',     name: 'outcome_type' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN anchors TEXT',          name: 'add_anchors_column' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN page_url TEXT',         name: 'nodes_page_url' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN page_title TEXT',       name: 'nodes_page_title' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN viewport_width INTEGER', name: 'nodes_viewport_w' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN viewport_height INTEGER', name: 'nodes_viewport_h' },
  { cmd: 'ALTER TABLE events ADD COLUMN trace_id TEXT',        name: 'events_trace_id' },
  { cmd: 'ALTER TABLE events ADD COLUMN node_id TEXT',         name: 'events_node_id' },
  { cmd: 'ALTER TABLE edges ADD COLUMN fingerprint_hash TEXT', name: 'edges_fp_hash' },

  // FIX (Bug #9): ActionHandler switched from DJB2 to SHA-256 for fingerprint hashing.
  // Existing edges carry DJB2 hashes that would never match new SHA-256 hashes, causing
  // duplicate edges on re-recordings. Nullify them so the dedup index works correctly
  // on all new recordings. The UPDATE is idempotent — running it twice is harmless.
  {
    cmd:  `UPDATE edges SET fingerprint_hash = NULL WHERE fingerprint_hash IS NOT NULL AND length(fingerprint_hash) <= 8`,
    name: 'nullify_djb2_fp_hashes',
  },
];

export function runMigrations(db: Database): void {
  // 1. Ensure all base tables exist
  TABLES.forEach((sql) => {
    try {
      db.exec(sql);
    } catch (error) {
      console.error(`Error executing base SQL:`, (error as Error).message);
    }
  });

  // 2. Apply iterative migrations (fail-safe for duplicates and already-applied)
  MIGRATIONS.forEach(m => {
    try {
      db.exec(m.cmd);
      console.log(`✅ Applied migration: ${m.name}`);
    } catch (e) {
      const err = e as Error;
      if (!err.message?.includes('duplicate column')) {
        console.error(`Migration ${m.name} failed:`, err.message);
      }
    }
  });
}