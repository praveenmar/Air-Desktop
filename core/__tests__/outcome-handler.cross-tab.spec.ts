import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OutcomeHandler } from '../graph/handlers/outcome.handler';

function makePending(overrides: Record<string, unknown> = {}) {
  return {
    traceId: 'trace-1',
    sessionId: 'session-1',
    tabId: 'tab-source',
    fromNodeId: 'node-from',
    triggerEventId: 'trigger-1',
    actionType: 'click',
    fingerprintHash: 'fp-1',
    createdAt: 1_000,
    resolvedAt: null,
    status: 'pending',
    ...overrides,
  };
}

function makeOutcome(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outcome-1',
    type: 'outcome',
    timestamp: 2_000,
    traceId: 'trace-1',
    sessionId: 'session-1',
    tabId: 'tab-destination',
    pageUrl: 'https://example.test/target',
    normalizedUrl: 'https://example.test/target',
    pageState: {
      url: 'https://example.test/target',
      normalizedUrl: 'https://example.test/target',
      html: '<html><body><h1>Target</h1></body></html>',
      anchors: ['URL:/target'],
      timestamp: 2_000,
    },
    pageSnapshot: {
      url: 'https://example.test/target',
      normalizedUrl: 'https://example.test/target',
      html: '<html><body><h1>Target</h1></body></html>',
      anchors: ['URL:/target'],
      timestamp: 2_000,
    },
    meta: {},
    ...overrides,
  };
}

function createHarness() {
  const edgeRepo = {
    findByFingerprint: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockResolvedValue(undefined),
    resolveOutcome: vi.fn().mockResolvedValue(undefined),
  };

  const outcomeRepo = {
    insert: vi.fn().mockResolvedValue(undefined),
    updateProbability: vi.fn().mockResolvedValue(undefined),
  };

  const eventRepo = {
    findById: vi.fn().mockResolvedValue(null),
  };

  const pendingRepo = {
    findByTraceSessionAndTab: vi.fn().mockResolvedValue(null),
    findByTraceAndSessionAnyTab: vi.fn().mockResolvedValue(null),
    findRecentPendingForSessionAndTab: vi.fn().mockResolvedValue([]),
    resolve: vi.fn().mockResolvedValue(1),
  };

  const logger = {
    log: vi.fn().mockResolvedValue(undefined),
  };

  const handler = new OutcomeHandler(
    edgeRepo as any,
    outcomeRepo as any,
    eventRepo as any,
    pendingRepo as any,
    logger as any
  );

  const createExplicitEdgeSpy = vi.spyOn(handler, 'createExplicitEdge').mockResolvedValue(undefined);

  return {
    handler,
    edgeRepo,
    outcomeRepo,
    eventRepo,
    pendingRepo,
    logger,
    createExplicitEdgeSpy,
  };
}

describe('OutcomeHandler cross-tab recovery', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('resolves source-tab pending action for explicit cross-tab recovery', async () => {
    harness.pendingRepo.findByTraceAndSessionAnyTab.mockResolvedValue(makePending());

    await harness.handler.handleOutcome(
      makeOutcome({
        meta: {
          isRecovery: true,
          isCrossTabRecovery: true,
          settleType: 'cross-tab-navigation',
          crossTabTargetNormalizedUrl: 'https://example.test/target',
          crossTabSourceNormalizedUrl: 'https://example.test/source',
        },
      }) as any,
      'trace-1',
      'node-target',
      'tab-destination'
    );

    expect(harness.pendingRepo.findByTraceSessionAndTab).toHaveBeenCalledWith('trace-1', 'session-1', 'tab-destination');
    expect(harness.pendingRepo.findByTraceAndSessionAnyTab).toHaveBeenCalledWith('trace-1', 'session-1');
    expect(harness.createExplicitEdgeSpy).toHaveBeenCalledWith(
      'node-from',
      'node-target',
      expect.objectContaining({ tabId: 'tab-source' }),
      expect.objectContaining({ traceId: 'trace-1' })
    );
    expect(harness.pendingRepo.resolve).toHaveBeenCalledWith('trace-1', 'session-1', 'tab-source');
    expect(harness.logger.log).toHaveBeenCalledWith(
      'OutcomeHandler',
      'decision',
      'PENDING_ACTION_CROSS_TAB_RECOVERED',
      expect.objectContaining({
        sourceTabId: 'tab-source',
        destinationTabId: 'tab-destination',
      }),
      'session-1',
      'trace-1'
    );
  });

  it('does not resolve across tabs without explicit cross-tab recovery flag', async () => {
    await harness.handler.handleOutcome(
      makeOutcome() as any,
      'trace-1',
      'node-target',
      'tab-destination'
    );

    expect(harness.pendingRepo.findByTraceAndSessionAnyTab).not.toHaveBeenCalled();
    expect(harness.createExplicitEdgeSpy).not.toHaveBeenCalled();
    expect(harness.pendingRepo.resolve).not.toHaveBeenCalled();
  });

  it('keeps exact same-tab lookup as the winning path', async () => {
    harness.pendingRepo.findByTraceSessionAndTab.mockResolvedValue(
      makePending({ tabId: 'tab-destination' })
    );

    await harness.handler.handleOutcome(
      makeOutcome() as any,
      'trace-1',
      'node-target',
      'tab-destination'
    );

    expect(harness.pendingRepo.findByTraceAndSessionAnyTab).not.toHaveBeenCalled();
    expect(harness.createExplicitEdgeSpy).toHaveBeenCalledWith(
      'node-from',
      'node-target',
      expect.objectContaining({ tabId: 'tab-destination' }),
      expect.any(Object)
    );
    expect(harness.pendingRepo.resolve).toHaveBeenCalledWith('trace-1', 'session-1', 'tab-destination');
  });

  it('skips explicit cross-tab recovery when target URL mismatches', async () => {
    await harness.handler.handleOutcome(
      makeOutcome({
        normalizedUrl: 'https://example.test/unexpected',
        pageUrl: 'https://example.test/unexpected',
        meta: {
          isRecovery: true,
          isCrossTabRecovery: true,
          settleType: 'cross-tab-navigation',
          crossTabTargetNormalizedUrl: 'https://example.test/target',
          crossTabSourceNormalizedUrl: 'https://example.test/source',
        },
      }) as any,
      'trace-1',
      'node-target',
      'tab-destination'
    );

    expect(harness.pendingRepo.findByTraceAndSessionAnyTab).not.toHaveBeenCalled();
    expect(harness.createExplicitEdgeSpy).not.toHaveBeenCalled();
    expect(harness.pendingRepo.resolve).not.toHaveBeenCalled();
    expect(harness.logger.log).toHaveBeenCalledWith(
      'OutcomeHandler',
      'warn',
      'Skipped explicit cross-tab recovery due to target URL mismatch',
      expect.objectContaining({
        crossTabTargetNormalizedUrl: 'https://example.test/target',
        normalizedOutcomeUrl: 'https://example.test/unexpected',
      }),
      'session-1',
      'trace-1'
    );
  });

  it('does not crash when explicit cross-tab recovery finds no pending action', async () => {
    await expect(
      harness.handler.handleOutcome(
        makeOutcome({
          meta: {
            isRecovery: true,
            isCrossTabRecovery: true,
            settleType: 'cross-tab-navigation',
            crossTabTargetNormalizedUrl: 'https://example.test/target',
            crossTabSourceNormalizedUrl: 'https://example.test/source',
          },
        }) as any,
        'trace-1',
        'node-target',
        'tab-destination'
      )
    ).resolves.toBeUndefined();

    expect(harness.pendingRepo.findByTraceAndSessionAnyTab).toHaveBeenCalledWith('trace-1', 'session-1');
    expect(harness.createExplicitEdgeSpy).not.toHaveBeenCalled();
    expect(harness.pendingRepo.resolve).not.toHaveBeenCalled();
  });
});
