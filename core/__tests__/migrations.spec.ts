import { afterEach, describe, expect, it } from 'vitest';
import { openAsyncDatabase, type AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { runMigrations } from '../db/migrations';

describe('runMigrations', () => {
  let db: AsyncSQLiteDatabase | null = null;

  afterEach(async () => {
    if (db) {
      await db.close();
      db = null;
    }
  });

  it('adds missing session columns and backfills session_tab_state for thin legacy sessions schemas', async () => {
    db = await openAsyncDatabase(':memory:');

    await db.exec(`
      CREATE TABLE schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL,
        description TEXT
      )
    `);

    await db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        started_at INTEGER NOT NULL,
        status TEXT DEFAULT 'active',
        metadata TEXT
      )
    `);

    await db.exec(`
      INSERT INTO sessions (id, started_at, status)
      VALUES ('session-legacy', 1000, 'active')
    `);

    await runMigrations(db);

    const rows = await db.prepare(`
      SELECT session_id, tab_id, last_node_id, last_event_at, event_count
      FROM session_tab_state
      WHERE session_id = ?
    `).all<{
      session_id: string;
      tab_id: string;
      last_node_id: string | null;
      last_event_at: number | null;
      event_count: number;
    }>('session-legacy');

    expect(rows).toEqual([
      {
        session_id: 'session-legacy',
        tab_id: 'tab-legacy',
        last_node_id: null,
        last_event_at: null,
        event_count: 0,
      },
    ]);

    const sessionColumns = await db.prepare(`PRAGMA table_info(sessions)`).all<{ name: string }>();
    const sessionColumnNames = sessionColumns.map(column => column.name);
    expect(sessionColumnNames).toContain('project_id');
    expect(sessionColumnNames).toContain('last_event_at');
    expect(sessionColumnNames).toContain('last_node_id');
    expect(sessionColumnNames).toContain('event_count');
  });
});
