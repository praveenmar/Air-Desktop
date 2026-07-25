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

describe('GraphBuilder SPA outcome de-duplication', () => {
  const sessionId = 'session-abc123';
  let harness: ReturnType<typeof createGraphBuilderHarness>;

  beforeEach(() => {
    harness = createGraphBuilderHarness();
  });

  it('suppresses synthetic route outcome when a recent real outcome already exists for the same trace/tab', async () => {
    const traceId = 'trace-spa-1';
    harness.eventRepo.findLatestOutcomeByTraceSessionAndTab.mockResolvedValue({
      id: 'outcome-1',
      timestamp: 2_000,
      traceId,
      sessionId,
      tabId: 'tab-a',
    });

    await harness.builder.processEvent({
      id: 'click-1',
      type: 'click',
      timestamp: 1_000,
      traceId,
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/start',
      normalizedUrl: 'https://example.test/start',
      fingerprint: makeFingerprint('button', 'Save'),
      pageState: makeSnapshot('Start', 'https://example.test/start'),
      pageSnapshot: makeSnapshot('Start', 'https://example.test/start'),
    } as any);

    await harness.builder.processEvent({
      id: 'outcome-1',
      type: 'outcome',
      timestamp: 2_000,
      traceId,
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/destination',
      normalizedUrl: 'https://example.test/destination',
      pageState: makeSnapshot('Destination', 'https://example.test/destination'),
      pageSnapshot: makeSnapshot('Destination', 'https://example.test/destination'),
      meta: {
        settleType: 'navigation',
        urlAfter: 'https://example.test/destination',
      },
    } as any);

    const result = await harness.builder.processEvent({
      id: 'route-1',
      type: 'spa-route-change',
      timestamp: 2_500,
      traceId,
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/destination',
      normalizedUrl: 'https://example.test/destination',
      navigation: {
        from: 'https://example.test/start',
        to: 'https://example.test/destination',
      },
      pageState: makeSnapshot('Destination', 'https://example.test/destination'),
      pageSnapshot: makeSnapshot('Destination', 'https://example.test/destination'),
    } as any);

    expect(result.stage).toBe('spa_route_observational');
    expect(harness.builder.outcomeHandler.handleOutcome).toHaveBeenCalledTimes(1);
    expect(harness.builder.sessionManager.updatePointer).toHaveBeenCalled();
    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'SPA_ROUTE_OBSERVATIONAL_SUPPRESSED_DUPLICATE_OUTCOME',
      expect.objectContaining({
        traceId,
        tabId: 'tab-a',
        latestOutcomeEventId: 'outcome-1',
      }),
      sessionId,
      traceId,
    );
  });

  it('still converts route-only chains into synthetic outcomes', async () => {
    const traceId = 'trace-spa-2';
    harness.eventRepo.findLatestOutcomeByTraceSessionAndTab.mockResolvedValue(null);

    await harness.builder.processEvent({
      id: 'click-2',
      type: 'click',
      timestamp: 10_000,
      traceId,
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/start',
      normalizedUrl: 'https://example.test/start',
      fingerprint: makeFingerprint('a[href]', 'Next'),
      pageState: makeSnapshot('Start', 'https://example.test/start'),
      pageSnapshot: makeSnapshot('Start', 'https://example.test/start'),
    } as any);

    const result = await harness.builder.processEvent({
      id: 'route-2',
      type: 'spa-route-change',
      timestamp: 10_400,
      traceId,
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/next',
      normalizedUrl: 'https://example.test/next',
      navigation: {
        from: 'https://example.test/start',
        to: 'https://example.test/next',
      },
      pageState: makeSnapshot('Next', 'https://example.test/next'),
      pageSnapshot: makeSnapshot('Next', 'https://example.test/next'),
    } as any);

    expect(result.stage).toBe('spa_navigation_recorded');
    expect(harness.builder.outcomeHandler.handleOutcome).toHaveBeenCalledTimes(1);
    expect(harness.logger.log).not.toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'SPA_ROUTE_OBSERVATIONAL_SUPPRESSED_DUPLICATE_OUTCOME',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does not suppress when the trace differs', async () => {
    harness.eventRepo.findLatestOutcomeByTraceSessionAndTab.mockResolvedValue(null);

    const result = await harness.builder.processEvent({
      id: 'route-3',
      type: 'spa-route-change',
      timestamp: 20_800,
      traceId: 'trace-other',
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/other',
      normalizedUrl: 'https://example.test/other',
      navigation: {
        from: 'https://example.test/start',
        to: 'https://example.test/other',
      },
      pageState: makeSnapshot('Other', 'https://example.test/other'),
      pageSnapshot: makeSnapshot('Other', 'https://example.test/other'),
    } as any);

    expect(result.stage).toBe('spa_navigation_recorded');
    expect(harness.builder.outcomeHandler.handleOutcome).toHaveBeenCalledTimes(1);
  });

  it('does not suppress when the latest outcome is older than the duplicate window', async () => {
    const traceId = 'trace-old';
    harness.eventRepo.findLatestOutcomeByTraceSessionAndTab.mockResolvedValue({
      id: 'outcome-old',
      timestamp: 31_000,
      traceId,
      sessionId,
      tabId: 'tab-a',
    });

    const result = await harness.builder.processEvent({
      id: 'route-4',
      type: 'spa-route-change',
      timestamp: 37_500,
      traceId,
      sessionId,
      tabId: 'tab-a',
      pageUrl: 'https://example.test/done',
      normalizedUrl: 'https://example.test/done',
      navigation: {
        from: 'https://example.test/start',
        to: 'https://example.test/done',
      },
      pageState: makeSnapshot('Done', 'https://example.test/done'),
      pageSnapshot: makeSnapshot('Done', 'https://example.test/done'),
    } as any);

    expect(result.stage).toBe('spa_navigation_recorded');
    expect(harness.builder.outcomeHandler.handleOutcome).toHaveBeenCalledTimes(1);
  });

  it('does not suppress cross-tab route events', async () => {
    const traceId = 'trace-cross-tab';
    harness.eventRepo.findLatestOutcomeByTraceSessionAndTab.mockResolvedValue(null);

    const result = await harness.builder.processEvent({
      id: 'route-5',
      type: 'spa-route-change',
      timestamp: 40_700,
      traceId,
      sessionId,
      tabId: 'tab-b',
      pageUrl: 'https://example.test/destination',
      normalizedUrl: 'https://example.test/destination',
      navigation: {
        from: 'https://example.test/start',
        to: 'https://example.test/destination',
      },
      pageState: makeSnapshot('Destination', 'https://example.test/destination'),
      pageSnapshot: makeSnapshot('Destination', 'https://example.test/destination'),
    } as any);

    expect(result.stage).toBe('spa_navigation_recorded');
    expect(harness.builder.outcomeHandler.handleOutcome).toHaveBeenCalledTimes(1);
  });
});
