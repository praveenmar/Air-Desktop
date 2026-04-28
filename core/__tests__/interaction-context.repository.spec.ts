import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAsyncDatabase, type AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { runMigrations } from '../db/migrations';
import { InteractionContextRepository } from '../db/repositories/interaction-context.repository';

describe('InteractionContextRepository upsert policy', () => {
  let db: AsyncSQLiteDatabase;
  let repo: InteractionContextRepository;

  beforeEach(async () => {
    db = await openAsyncDatabase(':memory:');
    await runMigrations(db);
    await db.exec(`
      INSERT INTO sessions (id, started_at, status)
      VALUES ('session-test', 1000, 'active');
    `);
    repo = new InteractionContextRepository(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('stable replaces unstable for the same session/url/signature', async () => {
    const first = await repo.upsert({
      sessionId: 'session-test',
      normalizedUrl: 'https://app.test/page',
      controlSignature: 'sig-a',
      snapshotHtml: '<div>unstable</div>',
      isStable: false,
      capturedAt: 1000,
    });

    const second = await repo.upsert({
      sessionId: 'session-test',
      normalizedUrl: 'https://app.test/page',
      controlSignature: 'sig-a',
      snapshotHtml: '<div>stable</div>',
      isStable: true,
      capturedAt: 1100,
    });

    expect(first.persistenceReason).toBe('inserted_new_ic');
    expect(second.persistenceReason).toBe('stable_replaced_unstable');
    expect(second.isStable).toBe(1);
  });

  it('newer stable replaces older stable, while older stable is skipped', async () => {
    await repo.upsert({
      sessionId: 'session-test',
      normalizedUrl: 'https://app.test/page',
      controlSignature: 'sig-a',
      snapshotHtml: '<div>stable-v1</div>',
      isStable: true,
      capturedAt: 1000,
    });

    const newer = await repo.upsert({
      sessionId: 'session-test',
      normalizedUrl: 'https://app.test/page',
      controlSignature: 'sig-a',
      snapshotHtml: '<div>stable-v2</div>',
      isStable: true,
      capturedAt: 1200,
    });

    const older = await repo.upsert({
      sessionId: 'session-test',
      normalizedUrl: 'https://app.test/page',
      controlSignature: 'sig-a',
      snapshotHtml: '<div>stable-old</div>',
      isStable: true,
      capturedAt: 900,
    });

    expect(newer.persistenceReason).toBe('newer_stable_replaced_older');
    expect(older.persistenceReason).toBe('skipped_older_or_unstable_ic');
    expect(older.isStable).toBe(1);
  });
});
