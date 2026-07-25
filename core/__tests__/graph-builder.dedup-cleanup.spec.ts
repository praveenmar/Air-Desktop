import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    pendingRepo,
  };
}

describe('GraphBuilder dedup key TTL cleanup', () => {
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  it('runs cleanup safely and logs deleted rows', async () => {
    const harness = createGraphBuilderHarness();
    harness.eventRepo.cleanupExpiredDedupKeys.mockResolvedValue(3);

    await (harness.builder as any).runCleanupTick();

    expect(harness.eventRepo.cleanupExpiredDedupKeys).toHaveBeenCalledTimes(1);
    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'info',
      'DEDUP_TTL_CLEANUP',
      expect.objectContaining({
        deletedRowCount: 3,
        ttlMs: 48 * 60 * 60 * 1000,
      }),
      null,
      null,
    );
  });

  it('does not throw when dedup cleanup fails', async () => {
    const harness = createGraphBuilderHarness();
    harness.eventRepo.cleanupExpiredDedupKeys.mockRejectedValue(new Error('cleanup boom'));

    await expect((harness.builder as any).runCleanupTick()).resolves.toBeUndefined();
    expect(harness.logger.log).toHaveBeenCalledWith(
      'GraphBuilder',
      'warn',
      'DEDUP_TTL_CLEANUP_FAILED',
      expect.objectContaining({
        error: 'cleanup boom',
      }),
      null,
      null,
    );
  });

  it('prevents overlapping cleanup runs', async () => {
    const harness = createGraphBuilderHarness();
    let releaseCleanup!: () => void;
    const cleanupPromise = new Promise<number>((resolve) => {
      releaseCleanup = () => resolve(0);
    });
    harness.eventRepo.cleanupExpiredDedupKeys.mockReturnValue(cleanupPromise);

    const firstRun = (harness.builder as any).runCleanupTick();
    await Promise.resolve();
    const secondRun = (harness.builder as any).runCleanupTick();

    await secondRun;
    expect(harness.eventRepo.cleanupExpiredDedupKeys).toHaveBeenCalledTimes(1);

    releaseCleanup();
    await firstRun;
  });

  it('uses an unref-ed background interval and triggers a startup run', async () => {
    const harness = createGraphBuilderHarness();
    const unref = vi.fn();
    const fakeInterval = { unref } as any;
    const runCleanupSpy = vi.spyOn(harness.builder as any, 'runCleanupTick').mockResolvedValue(undefined);
    const setIntervalSpy = vi.fn(() => fakeInterval);
    const clearIntervalSpy = vi.fn();

    global.setInterval = setIntervalSpy as any;
    global.clearInterval = clearIntervalSpy as any;

    harness.builder.startCleanupService();
    await Promise.resolve();

    expect(runCleanupSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(unref).toHaveBeenCalledTimes(1);

    await harness.builder.close();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });
});
