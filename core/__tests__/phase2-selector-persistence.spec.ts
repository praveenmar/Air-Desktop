import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openAsyncDatabase, type AsyncSQLiteDatabase } from '../db/sqlite-adapter';
import { runMigrations } from '../db/migrations';
import { EventRepository } from '../db/repositories/event.repository';
import { EdgeRepository } from '../db/repositories/edge.repository';
import { PendingActionRepository } from '../db/repositories/pending-action.repository';
import { OutcomeRepository } from '../db/repositories/outcome.repository';
import { ActionHandler } from '../graph/handlers/action.handler';
import { AIREvent } from '../types';

describe('Phase 2: selectorResolution Persistence & Stability', () => {
  let db: AsyncSQLiteDatabase;
  let eventRepo: EventRepository;
  let edgeRepo: EdgeRepository;
  let actionHandler: ActionHandler;

  beforeEach(async () => {
    db = await openAsyncDatabase(':memory:');
    await runMigrations(db);
    
    // Seed foreign key requirements
    await db.exec(`
      INSERT INTO sessions (id, started_at, status) VALUES ('session-test', 1000, 'active');
      INSERT INTO nodes (id, canonical_hash, created_at) VALUES ('node-A', 'hash-A', 1000);
      INSERT INTO nodes (id, canonical_hash, created_at) VALUES ('node-B', 'hash-B', 1000);
    `);
    
    eventRepo = new EventRepository(db);
    edgeRepo = new EdgeRepository(db);
    
    const pendingRepo = new PendingActionRepository(db);
    const outcomeRepo = new OutcomeRepository(db);
    const dummyLogger = { log: async () => {} } as any;
    
    actionHandler = new ActionHandler(pendingRepo, edgeRepo, outcomeRepo, dummyLogger);
  });

  afterEach(async () => {
    await db.close();
  });

  it('Test 1: EventRepository persistence saves selectorResolution in events.payload', async () => {
    const eventWithResolution: AIREvent = {
      id: 'event-with-res',
      type: 'click',
      timestamp: 123,
      sessionId: 'session-test',
      traceId: 'trace-1',
      pageUrl: 'https://test',
      fingerprint: {
        selector: 'input[name="username"]',
        textExcerpt: 'login',
        attributesHash: 'attr-hash',
        context: {},
        attributes: {}
      },
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: 'input[name="username"]',
          engine: 'css',
          family: 'name',
          source: 'shadow-preference',
          matchCount: 1,
          visibleMatchCount: 1,
          replaySafe: true,
        }
      }
    };

    // 1a. Insert new event
    await eventRepo.insertIfAbsent(eventWithResolution, 'user-intent', null);
    
    // 1b. Retrieve event
    const savedRow = await eventRepo.findById('event-with-res');
    expect(savedRow).toBeDefined();
    
    // 1c. Parse payload JSON and verify selectorResolution survived
    const payload = JSON.parse(savedRow.payload);
    expect(payload.selectorResolution).toBeDefined();
    expect(payload.selectorResolution.status).toBe('resolved');
    expect(payload.selectorResolution.selected.engine).toBe('css');
    
    // 1d. Also verify old event (no resolution) works perfectly
    const oldEvent: AIREvent = {
      id: 'event-old',
      type: 'click',
      timestamp: 124,
      sessionId: 'session-test',
      traceId: 'trace-1',
      pageUrl: 'https://test',
      fingerprint: {
        selector: 'button',
        textExcerpt: 'submit',
        attributesHash: 'attr-hash-2',
        context: {},
        attributes: {}
      }
    };
    
    await eventRepo.insertIfAbsent(oldEvent, 'submit-intent', null);
    const oldRow = await eventRepo.findById('event-old');
    const oldPayload = JSON.parse(oldRow.payload);
    expect(oldPayload.selectorResolution).toBeUndefined();
    expect(oldPayload.fingerprint.selector).toBe('button');
  });

  it('Test 2: Fingerprint hash stability ignores selectorResolution', async () => {
    const baseEvent: AIREvent = {
      id: 'event-hash',
      type: 'click',
      timestamp: 125,
      sessionId: 'session-test',
      traceId: 'trace-2',
      pageUrl: 'https://test',
      fingerprint: {
        selector: 'button',
        textExcerpt: 'submit',
        attributesHash: 'attr-hash',
        context: {},
        attributes: {}
      }
    };

    const eventWithResolution: AIREvent = {
      ...baseEvent,
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
      }
    };

    const hash1 = actionHandler.computeFingerprintHash(baseEvent);
    const hash2 = actionHandler.computeFingerprintHash(eventWithResolution);

    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe('no_fingerprint');
  });

  it('Test 3: Edge linkage connects to raw event payload natively', async () => {
    const eventId = 'event-edge';
    const event: AIREvent = {
      id: eventId,
      type: 'click',
      timestamp: 126,
      sessionId: 'session-test',
      traceId: 'trace-3',
      pageUrl: 'https://test',
      fingerprint: {
        selector: 'a',
        textExcerpt: 'link',
        attributesHash: 'attr-hash-3',
        context: {},
        attributes: {}
      },
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'unresolved',
        blockedReason: 'no-safe-selector'
      }
    };

    // A real system would insert event first
    await eventRepo.insertIfAbsent(event, 'test', null);
    
    const fpHash = actionHandler.computeFingerprintHash(event);
    
    // Create the edge
    const edgeId = await actionHandler.createEdge('node-A', 'node-B', event, fpHash);
    expect(edgeId).toBeDefined();

    // Verify edge is stored and does not duplicate JSON
    const storedEdge = await edgeRepo.findByFingerprint('node-A', 'node-B', fpHash);
    expect(storedEdge).toBeDefined();
    expect(storedEdge!.triggerEventId).toBe(eventId);
    // Edge schema should not have selectorResolution on it
    expect((storedEdge as any).selectorResolution).toBeUndefined();

    // Downstream Codegen traversal mock
    const eventRow = await eventRepo.findById(storedEdge!.triggerEventId);
    const codegenPayload = JSON.parse(eventRow.payload);
    expect(codegenPayload.selectorResolution.status).toBe('unresolved');
    expect(codegenPayload.selectorResolution.blockedReason).toBe('no-safe-selector');
  });
});
