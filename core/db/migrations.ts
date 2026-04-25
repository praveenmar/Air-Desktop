// Purpose: Schema definition and migration tracking.

import { AsyncSQLiteDatabase } from './sqlite-adapter';

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
    normalized_url TEXT,
    page_title TEXT,
    snapshot_html TEXT,
    context_tokens TEXT,
    anchors TEXT,
    state_source TEXT,
    control_signature TEXT,
    viewport_width INTEGER,
    viewport_height INTEGER,
    created_at INTEGER NOT NULL,
    last_observed_at INTEGER,
    observation_count INTEGER DEFAULT 1,
    metadata TEXT
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_project_hash ON nodes(project_id, canonical_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_nodes_hash ON nodes(canonical_hash)`,

  `CREATE TABLE IF NOT EXISTS interaction_contexts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    normalized_url TEXT NOT NULL,
    control_signature TEXT NOT NULL DEFAULT '',
    snapshot_html TEXT,
    anchors TEXT,
    is_stable INTEGER DEFAULT 1,
    viewport_width INTEGER,
    viewport_height INTEGER,
    captured_at INTEGER NOT NULL,
    UNIQUE(session_id, normalized_url, control_signature),
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_ic_session_url ON interaction_contexts(session_id, normalized_url)`,

  `CREATE TABLE IF NOT EXISTS session_tab_state (
    session_id TEXT NOT NULL,
    tab_id TEXT NOT NULL,
    last_node_id TEXT,
    last_event_at INTEGER,
    event_count INTEGER DEFAULT 0,
    PRIMARY KEY (session_id, tab_id),
    FOREIGN KEY(session_id) REFERENCES sessions(id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_session_tab_state_session ON session_tab_state(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_session_tab_state_last_event ON session_tab_state(last_event_at)`,

  // ðŸ”¥ STRICT events table for fresh DBs
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    session_id TEXT NOT NULL CHECK (session_id LIKE 'session-%'),
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
  { cmd: 'ALTER TABLE events ADD COLUMN intent_raw TEXT', name: 'intent_raw' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN state_source TEXT', name: 'state_source' },
  { cmd: 'ALTER TABLE edges ADD COLUMN outcome_type TEXT', name: 'outcome_type' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN anchors TEXT', name: 'add_anchors_column' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN page_url TEXT', name: 'nodes_page_url' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN page_title TEXT', name: 'nodes_page_title' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN viewport_width INTEGER', name: 'nodes_viewport_w' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN viewport_height INTEGER', name: 'nodes_viewport_h' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN control_signature TEXT', name: 'add_control_signature' },
  { cmd: 'ALTER TABLE nodes ADD COLUMN normalized_url TEXT', name: 'add_normalized_url' },
  { cmd: 'ALTER TABLE events ADD COLUMN trace_id TEXT', name: 'events_trace_id' },
  { cmd: 'ALTER TABLE events ADD COLUMN node_id TEXT', name: 'events_node_id' },
  { cmd: 'ALTER TABLE edges ADD COLUMN fingerprint_hash TEXT', name: 'edges_fp_hash' },

  {
    cmd: `
      PRAGMA foreign_keys = OFF;

      CREATE TABLE events_new (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL CHECK (session_id LIKE 'session-%'),
        trace_id TEXT,
        node_id TEXT,
        page_url TEXT,
        payload TEXT NOT NULL,
        processed INTEGER DEFAULT 0,
        intent TEXT,
        intent_raw TEXT,
        FOREIGN KEY(session_id) REFERENCES sessions(id),
        FOREIGN KEY(node_id) REFERENCES nodes(id)
      );

      INSERT INTO events_new (
        id, type, timestamp, session_id, trace_id, node_id, page_url, payload, processed, intent, intent_raw
      )
      SELECT 
        id, type, timestamp, session_id, trace_id, node_id, page_url, payload, processed, intent, intent_raw
      FROM events
      WHERE session_id IS NOT NULL
        AND session_id != ''
        AND session_id LIKE 'session-%';

      DROP TABLE events;
      ALTER TABLE events_new RENAME TO events;

      CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_trace ON events(trace_id);

      PRAGMA foreign_keys = ON;
    `,
    name: 'enforce_session_id_not_null',
  },
  { cmd: 'ALTER TABLE pending_actions ADD COLUMN tab_id TEXT', name: 'pending_actions_tab_id' },
  {
    cmd: `CREATE INDEX IF NOT EXISTS idx_pending_session_tab_status
      ON pending_actions(session_id, tab_id, status, created_at)`,
    name: 'idx_pending_session_tab_status',
  },
  {
    cmd: `
      INSERT OR IGNORE INTO session_tab_state (
        session_id,
        tab_id,
        last_node_id,
        last_event_at,
        event_count
      )
      SELECT
        id,
        'tab-legacy',
        last_node_id,
        last_event_at,
        event_count
      FROM sessions
      WHERE last_node_id IS NOT NULL
    `,
    name: 'backfill_session_tab_state_legacy',
  },
];

export async function runMigrations(db: AsyncSQLiteDatabase): Promise<void> {
  for (const sql of TABLES) {
    try {
      await db.exec(sql);
    } catch (error) {
      console.error('Error executing base SQL:', (error as Error).message);
    }
  }

  const appliedMigrations = new Set<string>();

  try {
    const rows = await db
      .prepare('SELECT description FROM schema_version WHERE description IS NOT NULL')
      .all<{ description: string }>();

    for (const row of rows) {
      if (row.description) appliedMigrations.add(row.description);
    }
  } catch (error) {
    console.error('Error reading migration history:', (error as Error).message);
  }

  const markMigrationApplied = async (name: string): Promise<void> => {
    await db.prepare('INSERT INTO schema_version (applied_at, description) VALUES (?, ?)')
      .run(Date.now(), name);
    appliedMigrations.add(name);
  };

  const tableHasColumn = async (tableName: string, columnName: string): Promise<boolean> => {
    const columns = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
    return columns.some((column) => column.name === columnName);
  };

  for (const migration of MIGRATIONS) {
    if (appliedMigrations.has(migration.name)) continue;
    if (migration.name === 'enforce_session_id_not_null') {
      const columns = await db.prepare('PRAGMA table_info(events)').all<{
        name: string;
        notnull: number;
      }>();
      const sessionColumn = columns.find(col => col.name === 'session_id');
      if (sessionColumn?.notnull === 1) {
        await markMigrationApplied(migration.name);
        continue;
      }
    }
    if (migration.name === 'pending_actions_tab_id') {
      if (await tableHasColumn('pending_actions', 'tab_id')) {
        await markMigrationApplied(migration.name);
        continue;
      }
    }

    try {
      await db.exec(migration.cmd);
      console.log(`Applied migration: ${migration.name}`);
      await markMigrationApplied(migration.name);
    } catch (error) {
      const message = (error as Error).message || '';
      const lowered = message.toLowerCase();
      if (lowered.includes('duplicate column name') || lowered.includes('already exists')) {
        await markMigrationApplied(migration.name);
        continue;
      }
      console.error(`Migration ${migration.name} failed:`, message);
      throw error;
    }
  }
}
