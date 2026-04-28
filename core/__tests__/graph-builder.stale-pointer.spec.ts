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
    getLastNode: vi.fn().mockResolvedValue('node-newer'),
    getTabState: vi.fn().mockResolvedValue({
      lastNodeId: 'node-newer',
      lastEventAt: 10_000,
    }),
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
    pendingRepo,
  };
}

function makeEvent(type: string, timestamp: number, extra: Record<string, unknown> = {}) {
  return {
    id: `${type}-${timestamp}`,
    type,
    timestamp,
    traceId: 'trace-1',
    sessionId: 'session-abc123',
    tabId: 'tab-a',
    pageUrl: 'https://example.test/start',
    normalizedUrl: 'https://example.test/start',
    fingerprint: makeFingerprint(type === 'custom-select' ? 'div[role="option"]' : 'button', 'Save'),
    pageState: makeSnapshot('Start', 'https://example.test/start'),
    pageSnapshot: makeSnapshot('Start', 'https://example.test/start'),
    ...extra,
  } as any;
}

describe('GraphBuilder stale pointer protection', () => {
  let harness: ReturnType<typeof createGraphBuilderHarness>;

  beforeEach(() => {
    harness = createGraphBuilderHarness();
  });

  it('bypasses pointer-derived action handling for late click events', async () => {
    const result = await harness.builder.processEvent(makeEvent('click', 1_000));

    expect(result.stage).toBe('stale_pointer_bypassed');
    expect(harness.builder.actionHandler.handleAction).not.toHaveBeenCalled();
    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'warn',
      'STALE_EVENT_POINTER_BYPASS',
      expect.objectContaining({
        eventType: 'click',
        eventTimestamp: 1_000,
        pointerTimestamp: 10_000,
        deltaMs: 9_000,
        tabId: 'tab-a',
      }),
      'session-abc123',
      'trace-1',
    );
  });

  it('bypasses late submit without creating wrong pending registration', async () => {
    const result = await harness.builder.processEvent(
      makeEvent('submit', 1_000, {
        meta: { eventType: 'submit', formId: 'login-form' },
        pageState: makeSnapshot('Submit', 'https://example.test/start'),
        interactionContext: makeSnapshot('Submit', 'https://example.test/start'),
      }),
    );

    expect(result.stage).toBe('stale_pointer_bypassed');
    expect(harness.builder.actionHandler.handleAction).not.toHaveBeenCalled();
  });

  it('bypasses late custom-select without pointer misuse', async () => {
    const result = await harness.builder.processEvent(
      makeEvent('custom-select', 1_000, {
        selection: { label: 'Admin', value: 'admin', index: 0 },
      }),
    );

    expect(result.stage).toBe('stale_pointer_bypassed');
    expect(harness.builder.actionHandler.handleAction).not.toHaveBeenCalled();
  });

  it('keeps outcome handling unchanged even if the event is older than the current pointer', async () => {
    const result = await harness.builder.processEvent(
      makeEvent('outcome', 1_000, {
        meta: { settleType: 'navigation', urlAfter: 'https://example.test/next' },
      }),
    );

    expect(result.stage).toBe('edge_finalized');
    expect(harness.builder.outcomeHandler.handleOutcome).toHaveBeenCalledTimes(1);
  });

  it('does not mark events within tolerance as stale', async () => {
    const result = await harness.builder.processEvent(makeEvent('click', 6_000));

    expect(result.stage).toBe('action_recorded');
    expect(harness.builder.actionHandler.handleAction).toHaveBeenCalledTimes(1);
    expect(harness.logger.log).not.toHaveBeenCalledWith(
      'GraphBuilder',
      'warn',
      'STALE_EVENT_POINTER_BYPASS',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
