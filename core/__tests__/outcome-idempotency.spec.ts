import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAsyncDatabase, type AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { runMigrations } from '../db/migrations';

describe('Outcome row idempotency', () => {
  let db: AsyncSQLiteDatabase;

  beforeEach(async () => {
    db = await openAsyncDatabase(':memory:');
    await runMigrations(db);
    await db.exec(`
      INSERT INTO sessions (id, started_at, status)
      VALUES ('session-test', 1000, 'active');

      INSERT INTO nodes (
        id,
        project_id,
        canonical_hash,
        normalized_url,
        created_at,
        last_observed_at,
        observation_count
      ) VALUES
        ('node-from', 'default', 'hash-from', 'https://app.test/from', 1000, 1000, 1),
        ('node-1', 'default', 'hash-node-1', 'https://app.test/node-1', 1000, 1000, 1),
        ('node-2', 'default', 'hash-node-2', 'https://app.test/node-2', 1000, 1000, 1);

      INSERT INTO events (
        id,
        type,
        timestamp,
        session_id,
        trace_id,
        node_id,
        page_url,
        payload,
        processed
      ) VALUES (
        'event-trigger-1',
        'click',
        1000,
        'session-test',
        'trace-test',
        'node-from',
        'https://app.test/from',
        '{"type":"click","tabId":"tab-a"}',
        1
      );

      INSERT INTO edges (
        id,
        from_node_id,
        to_node_id,
        trigger_event_id,
        fingerprint_hash,
        seek_strategy,
        sample_size,
        last_updated,
        outcome_type
      ) VALUES (
        'edge-1',
        'node-from',
        'node-1',
        'event-trigger-1',
        'fp-edge-1',
        'selector',
        1,
        1000,
        'navigation'
      );
    `);
  });

  afterEach(async () => {
    await db.close();
  });

  it('keeps only one outcome row for the same edge and target node under replay', async () => {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO outcomes (id, edge_id, target_node_id, probability, decayed_count, last_observed)
      VALUES (?, ?, ?, 1.0, 1.0, ?)
    `);
    const touchStmt = db.prepare(`
      UPDATE outcomes
      SET last_observed = CASE
        WHEN last_observed IS NULL OR last_observed < ?
        THEN ?
        ELSE last_observed
      END
      WHERE edge_id = ? AND target_node_id = ?
    `);

    const first = await insertStmt.run('outcome-1', 'edge-1', 'node-1', 1000);
    const second = await insertStmt.run('outcome-2', 'edge-1', 'node-1', 1200);
    if ((second.changes ?? 0) === 0) {
      await touchStmt.run(1200, 1200, 'edge-1', 'node-1');
    }

    const rows = await db.prepare(`
      SELECT id, edge_id AS edgeId, target_node_id AS targetNodeId, last_observed AS lastObserved
      FROM outcomes
      WHERE edge_id = 'edge-1'
    `).all<{ id: string; edgeId: string; targetNodeId: string; lastObserved: number }>();

    expect(first.changes).toBe(1);
    expect(second.changes).toBe(0);
    expect(rows).toEqual([
      { id: 'outcome-1', edgeId: 'edge-1', targetNodeId: 'node-1', lastObserved: 1200 },
    ]);
  });

  it('preserves the newer last_observed value when replay arrives older', async () => {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO outcomes (id, edge_id, target_node_id, probability, decayed_count, last_observed)
      VALUES (?, ?, ?, 1.0, 1.0, ?)
    `);
    const touchStmt = db.prepare(`
      UPDATE outcomes
      SET last_observed = CASE
        WHEN last_observed IS NULL OR last_observed < ?
        THEN ?
        ELSE last_observed
      END
      WHERE edge_id = ? AND target_node_id = ?
    `);

    await insertStmt.run('outcome-1', 'edge-1', 'node-1', 1200);
    const replay = await insertStmt.run('outcome-2', 'edge-1', 'node-1', 1100);
    if ((replay.changes ?? 0) === 0) {
      await touchStmt.run(1100, 1100, 'edge-1', 'node-1');
    }

    const row = await db.prepare(`
      SELECT last_observed AS lastObserved
      FROM outcomes
      WHERE edge_id = 'edge-1' AND target_node_id = 'node-1'
      LIMIT 1
    `).get<{ lastObserved: number }>();

    expect(replay.changes).toBe(0);
    expect(row?.lastObserved).toBe(1200);
  });

  it('migration removes duplicate outcome rows and keeps the row with max(last_observed)', async () => {
    const seedDb = await openAsyncDatabase(':memory:');
    await seedDb.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      );
      CREATE TABLE outcomes (
        id TEXT PRIMARY KEY,
        edge_id TEXT NOT NULL,
        target_node_id TEXT NOT NULL,
        probability FLOAT DEFAULT 1.0,
        decayed_count FLOAT DEFAULT 1.0,
        last_observed INTEGER
      );
      INSERT INTO outcomes (id, edge_id, target_node_id, probability, decayed_count, last_observed)
      VALUES
        ('outcome-old', 'edge-1', 'node-1', 1.0, 1.0, 1000),
        ('outcome-new', 'edge-1', 'node-1', 1.0, 1.0, 1500),
        ('outcome-other', 'edge-2', 'node-2', 1.0, 1.0, 900);
    `);

    await runMigrations(seedDb);

    const rows = await seedDb.prepare(`
      SELECT id, edge_id AS edgeId, target_node_id AS targetNodeId, last_observed AS lastObserved
      FROM outcomes
      ORDER BY edge_id, target_node_id, id
    `).all<{ id: string; edgeId: string; targetNodeId: string; lastObserved: number }>();

    const indexes = await seedDb.prepare(`PRAGMA index_list(outcomes)`).all<{ name: string }>();

    expect(rows).toEqual([
      { id: 'outcome-new', edgeId: 'edge-1', targetNodeId: 'node-1', lastObserved: 1500 },
      { id: 'outcome-other', edgeId: 'edge-2', targetNodeId: 'node-2', lastObserved: 900 },
    ]);
    expect(indexes.some((index) => index.name === 'idx_outcomes_edge_target')).toBe(true);

    await seedDb.close();
  });
});
