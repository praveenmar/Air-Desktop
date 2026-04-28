import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphBuilder } from '../graph/graph-builder';
import { StateEngine } from '../graph/state-engine';

type GraphBuilderHarness = GraphBuilder & {
  sessionManager: {
    getOrCreateSession: ReturnType<typeof vi.fn>;
    getLastNode: ReturnType<typeof vi.fn>;
    getTabState: ReturnType<typeof vi.fn>;
    updatePointer: ReturnType<typeof vi.fn>;
  };
  baselineHandler: {
    upsertNode: ReturnType<typeof vi.fn>;
  };
  actionHandler: {
    handleAction: ReturnType<typeof vi.fn>;
  };
  outcomeHandler: {
    handleOutcome: ReturnType<typeof vi.fn>;
  };
};

function makeSnapshot(name: string, pageUrl: string) {
  return {
    html: `<html><body><h1>${name}</h1><button>${name}</button></body></html>`,
    anchors: [`URL:${new URL(pageUrl).pathname}`, `H1:text=${name}`, `BUTTON:text=${name}`],
    url: pageUrl,
    normalizedUrl: pageUrl,
    timestamp: Date.now(),
  };
}

function makeFingerprint(selector: string, text: string) {
  return {
    selector,
    selectorPriority: 'text' as const,
    textExcerpt: text,
    context: {
      parentTag: 'form',
      nearestContainerTag: 'main',
    },
    attributes: {
      name: text.toLowerCase(),
    },
    attributesHash: `hash-${text}`,
  };
}

function createGraphBuilderHarness() {
  const db = {
    transaction: async <T>(callback: () => Promise<T>) => callback(),
    prepare: vi.fn(),
  };

  const nodeRepo = {
    findByControlSigAndUrl: vi.fn().mockResolvedValue(null),
    findByHash: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue('ignored-node'),
    updateObservation: vi.fn().mockResolvedValue(undefined),
  };

  const edgeRepo = {
    findByFingerprint: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue('edge-1'),
    resolveOutcome: vi.fn().mockResolvedValue(undefined),
    incrementObservation: vi.fn().mockResolvedValue(undefined),
  };

  const eventRepo = {
    findById: vi.fn().mockResolvedValue(null),
    insertIfAbsent: vi.fn().mockResolvedValue(true),
    updateNodeId: vi.fn().mockResolvedValue(undefined),
    findLatestOutcomeByTraceSessionAndTab: vi.fn().mockResolvedValue(null),
    insertDedupKeyIfAbsent: vi.fn().mockResolvedValue(true),
    findDedupKeyByKey: vi.fn().mockResolvedValue(null),
    cleanupExpiredDedupKeys: vi.fn().mockResolvedValue(0),
  };

  const sessionRepo = {
    findById: vi.fn().mockResolvedValue(null),
    getOrCreate: vi.fn().mockResolvedValue({ id: 'session-abc123' }),
    updatePointerForTab: vi.fn().mockResolvedValue(undefined),
    getLastNodeForTab: vi.fn().mockResolvedValue(null),
    getTabState: vi.fn().mockResolvedValue(null),
  };

  const outcomeRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
    updateProbability: vi.fn().mockResolvedValue(undefined),
  };

  const pendingRepo = {
    register: vi.fn().mockResolvedValue(undefined),
    findByTraceSessionAndTab: vi.fn().mockResolvedValue(null),
    findRecentPendingForSessionAndTab: vi.fn().mockResolvedValue([]),
    resolve: vi.fn().mockResolvedValue(1),
    cleanupStale: vi.fn().mockResolvedValue(0),
  };

  const interactionContextRepo = {
    upsert: vi.fn().mockResolvedValue({
      isStable: 1,
      persistenceReason: 'inserted_new_ic',
      controlSignatureMissing: false,
      controlSignatureReason: null,
    }),
  };

  const logger = {
    log: vi.fn().mockResolvedValue(undefined),
    pruneOldLogs: vi.fn().mockResolvedValue(0),
  };

  const builder = new GraphBuilder(
    db as any,
    nodeRepo as any,
    edgeRepo as any,
    eventRepo as any,
    sessionRepo as any,
    outcomeRepo as any,
    pendingRepo as any,
    interactionContextRepo as any,
    StateEngine,
    logger as any,
  ) as GraphBuilderHarness;

  builder.sessionManager = {
    getOrCreateSession: vi.fn().mockResolvedValue({ id: 'session-abc123' }),
    getLastNode: vi.fn().mockResolvedValue(null),
    getTabState: vi.fn().mockResolvedValue(null),
    updatePointer: vi.fn().mockResolvedValue(undefined),
  };
  builder.baselineHandler = {
    upsertNode: vi.fn().mockResolvedValue('node-current'),
  };
  builder.actionHandler = {
    handleAction: vi.fn().mockResolvedValue(undefined),
  };
  builder.outcomeHandler = {
    handleOutcome: vi.fn().mockResolvedValue(undefined),
  };

  return {
    builder,
    logger,
    eventRepo,
  };
}

function makeClickEvent(id: string, timestamp: number) {
  return {
    id,
    type: 'click',
    timestamp,
    traceId: 'trace-1',
    sessionId: 'session-abc123',
    tabId: 'tab-a',
    pageUrl: 'https://example.test/start',
    normalizedUrl: 'https://example.test/start',
    fingerprint: makeFingerprint('button', 'Save'),
    pageState: makeSnapshot('Start', 'https://example.test/start'),
    pageSnapshot: makeSnapshot('Start', 'https://example.test/start'),
  } as any;
}

describe('GraphBuilder semantic dedup shadow mode', () => {
  let harness: ReturnType<typeof createGraphBuilderHarness>;

  beforeEach(() => {
    harness = createGraphBuilderHarness();
  });

  it('logs semantic duplicates but continues normal graph processing', async () => {
    harness.eventRepo.insertDedupKeyIfAbsent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    harness.eventRepo.findDedupKeyByKey.mockResolvedValue({
      dedupKey: 'dedup-1',
      eventId: 'evt-1',
      sessionId: 'session-abc123',
      traceId: 'trace-1',
      eventType: 'click',
      originalTimestamp: 1_000,
      createdAt: 1_000,
    });

    const first = await harness.builder.processEvent(makeClickEvent('evt-1', 1_000));
    const second = await harness.builder.processEvent(makeClickEvent('evt-2', 1_500));

    expect(first.stage).toBe('action_recorded');
    expect(second.stage).toBe('action_recorded');
    expect(harness.builder.actionHandler.handleAction).toHaveBeenCalledTimes(2);
    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'SEMANTIC_DUPLICATE_DETECTED',
      expect.objectContaining({
        eventId: 'evt-2',
        previousEventId: 'evt-1',
      }),
      'session-abc123',
      'trace-1',
    );
  });

  it('logs timestamp delta and classifies near-time duplicates correctly', async () => {
    harness.eventRepo.insertDedupKeyIfAbsent.mockResolvedValue(false);
    harness.eventRepo.findDedupKeyByKey.mockResolvedValue({
      dedupKey: 'dedup-2',
      eventId: 'evt-prev',
      sessionId: 'session-abc123',
      traceId: 'trace-1',
      eventType: 'click',
      originalTimestamp: 2_000,
      createdAt: 2_000,
    });

    await harness.builder.processEvent(makeClickEvent('evt-now', 4_000));

    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'SEMANTIC_DUPLICATE_DETECTED',
      expect.objectContaining({
        originalTimestamp: 4_000,
        previousEventTimestamp: 2_000,
        deltaMs: 2_000,
        duplicateTimingClass: 'near_time_possible_double_click',
      }),
      'session-abc123',
      'trace-1',
    );
  });

  it('classifies delayed duplicates correctly', async () => {
    harness.eventRepo.insertDedupKeyIfAbsent.mockResolvedValue(false);
    harness.eventRepo.findDedupKeyByKey.mockResolvedValue({
      dedupKey: 'dedup-3',
      eventId: 'evt-prev',
      sessionId: 'session-abc123',
      traceId: 'trace-1',
      eventType: 'click',
      originalTimestamp: 1_000,
      createdAt: 1_000,
    });

    await harness.builder.processEvent(makeClickEvent('evt-now', 8_000));

    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'SEMANTIC_DUPLICATE_DETECTED',
      expect.objectContaining({
        deltaMs: 7_000,
        duplicateTimingClass: 'delayed_replay_candidate',
      }),
      'session-abc123',
      'trace-1',
    );
  });

  it('does not compute semantic keys for ineligible event types', async () => {
    const result = await harness.builder.processEvent({
      id: 'scroll-1',
      type: 'scroll',
      timestamp: 1_000,
      traceId: 'trace-1',
      sessionId: 'session-abc123',
      tabId: 'tab-a',
      pageUrl: 'https://example.test/start',
      normalizedUrl: 'https://example.test/start',
      scroll: { x: 0, y: 100, deltaY: 100, direction: 'down' },
    } as any);

    expect(result.success).toBe(true);
    expect(harness.eventRepo.insertDedupKeyIfAbsent).not.toHaveBeenCalled();
    expect(harness.logger.log).not.toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'SEMANTIC_DUPLICATE_DETECTED',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
