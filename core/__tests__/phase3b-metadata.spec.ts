import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAsyncDatabase, type AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { CodegenService } from '../../packages/codegen/src/codegen.service';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('Phase 3B: Lightweight Metadata Extraction', () => {
  let dbPath: string;
  let service: CodegenService;
  let asyncDb: AsyncSQLiteDatabase;

  beforeEach(async () => {
    // Create a temporary database for testing
    dbPath = path.join(os.tmpdir(), `air_test_db_${Date.now()}.sqlite`);
    asyncDb = await openAsyncDatabase(dbPath);
    
    // Create the events table schema
    await asyncDb.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL
      )
    `);

    // Insert Test 1: Event with valid selectorResolution and full fingerprint
    const event1 = {
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '.btn-primary',
          engine: 'css',
          replaySafe: true
        }
      },
      fingerprint: {
        selector: '#old-selector',
        textExcerpt: 'Click Me',
        tagName: 'BUTTON'
      }
    };
    
    // Insert Test 2: Old event without selectorResolution
    const event2 = {
      fingerprint: {
        selector: '.legacy-only'
      }
    };

    const event3Payload = JSON.stringify({
      selectorResolution: "{broken_json}", 
      fingerprint: { tagName: "DIV" }
    });

    const insert = asyncDb.prepare('INSERT INTO events (id, type, timestamp, session_id, payload) VALUES (?, ?, ?, ?, ?)');
    await insert.run('event-1', 'click', 1000, 'session-1', JSON.stringify(event1));
    await insert.run('event-2', 'input', 1001, 'session-1', JSON.stringify(event2));
    await insert.run('event-3', 'scroll', 1002, 'session-1', event3Payload);

    await asyncDb.close();

    service = new CodegenService({ dbPath });
  });

  afterEach(() => {
    try {
      service.close();
    } catch (e) {
      // Ignore
    }
    if (fs.existsSync(dbPath)) {
      try {
        fs.unlinkSync(dbPath);
      } catch (e) {
        // Ignore locked file issues on Windows if any
      }
    }
  });

  it('Empty event ID list returns empty Map', () => {
    const result = service.getGenerationEventMetadataByIds([]);
    expect(result.size).toBe(0);
  });

  it('Event with selectorResolution returns parsed selectorResolution and fallbackHints', () => {
    const result = service.getGenerationEventMetadataByIds(['event-1']);
    expect(result.size).toBe(1);
    
    const meta = result.get('event-1');
    expect(meta).toBeDefined();
    expect(meta?.id).toBe('event-1');
    expect(meta?.selectorResolution?.status).toBe('resolved');
    expect(meta?.selectorResolution?.selected?.selector).toBe('.btn-primary');
    
    expect(meta?.fallbackHints?.legacySelector).toBe('#old-selector');
    expect(meta?.fallbackHints?.elementText).toBe('Click Me');
    expect(meta?.fallbackHints?.tagName).toBe('BUTTON');
  });

  it('Old event without selectorResolution returns metadata with selectorResolution undefined', () => {
    const result = service.getGenerationEventMetadataByIds(['event-2']);
    const meta = result.get('event-2');
    
    expect(meta).toBeDefined();
    expect(meta?.selectorResolution).toBeUndefined();
    expect(meta?.fallbackHints?.legacySelector).toBe('.legacy-only');
    expect(meta?.fallbackHints?.elementText).toBeUndefined();
  });

  it('Invalid selectorResolution JSON does not crash and handles safely', () => {
    const result = service.getGenerationEventMetadataByIds(['event-3']);
    const meta = result.get('event-3');
    
    expect(meta).toBeDefined();
    expect(meta?.selectorResolution).toBeUndefined();
    expect(meta?.fallbackHints?.tagName).toBe('DIV');
  });

  it('Missing event ID is handled safely without throwing', () => {
    const result = service.getGenerationEventMetadataByIds(['event-missing', 'event-1']);
    expect(result.size).toBe(1); // Only event-1 is found
    expect(result.get('event-1')).toBeDefined();
    expect(result.get('event-missing')).toBeUndefined();
  });
});
