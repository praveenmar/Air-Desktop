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

function createGraphBuilderHarness(
  insertImpl: () => Promise<boolean> = async () => true,
) {
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
    insertIfAbsent: vi.fn().mockImplementation(insertImpl),
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

function makeClickEvent(id: string) {
  return {
    id,
    type: 'click',
    timestamp: 1_000,
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

describe('GraphBuilder atomic event ingestion dedup', () => {
  let harness: ReturnType<typeof createGraphBuilderHarness>;

  beforeEach(() => {
    harness = createGraphBuilderHarness();
  });

  it('skips the second processing of the same event id', async () => {
    let seen = false;
    harness = createGraphBuilderHarness(async () => {
      if (seen) return false;
      seen = true;
      return true;
    });

    const first = await harness.builder.processEvent(makeClickEvent('evt-1'));
    const second = await harness.builder.processEvent(makeClickEvent('evt-1'));

    expect(first.success).toBe(true);
    expect(first.stage).toBe('action_recorded');
    expect(second.success).toBe(true);
    expect(second.stage).toBe('duplicate_skipped');
    expect(second.duplicate).toBe(true);
    expect(harness.builder.actionHandler.handleAction).toHaveBeenCalledTimes(1);
    expect(harness.eventRepo.insertIfAbsent).toHaveBeenCalledTimes(2);
    expect(harness.eventRepo.insertDedupKeyIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('treats only one concurrent insert as authoritative when the repository ignores duplicates', async () => {
    let inserted = false;
    harness = createGraphBuilderHarness(async () => {
      if (inserted) return false;
      inserted = true;
      return true;
    });

    const [first, second] = await Promise.all([
      harness.builder.processEvent(makeClickEvent('evt-race')),
      harness.builder.processEvent(makeClickEvent('evt-race')),
    ]);

    const stages = [first.stage, second.stage].sort();
    expect(stages).toEqual(['action_recorded', 'duplicate_skipped']);
    expect(harness.builder.actionHandler.handleAction).toHaveBeenCalledTimes(1);
    expect(harness.builder.baselineHandler.upsertNode).toHaveBeenCalledTimes(1);
  });
});
