import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { resolveSelectorsForSession, SnapshotCache } from '../src/selector-resolver';
import { CodegenSession, CodegenStep } from '../src/types';

function makeDocument(html: string): Document {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

function makeSnapshotCache(entries: Record<string, Document | null>): SnapshotCache {
  return {
    get(nodeId: string, _normalizedUrl?: string, _controlSignature?: string): Document | null {
      return entries[nodeId] ?? null;
    },
  };
}

function makeStep(step: number, selector: string, selectorPriority: CodegenStep['selectorPriority']): CodegenStep {
  return {
    step,
    intent: `click_step_${step}`,
    action: 'click',
    selector,
    selectorPriority,
    selectorRank: undefined,
    sourceNodeId: `node-${step}`,
    assertions: [],
    userAssertions: [],
    confidence: 1,
    sampleSize: 1,
    pageUrl: 'http://example.com',
  };
}

function makeSession(steps: CodegenStep[]): CodegenSession {
  return {
    sessionId: 'parity-session',
    url: 'http://example.com',
    title: 'Parity',
    recordedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    stepCount: steps.length,
    steps,
    flowConfidence: 1,
    nodeCount: steps.length,
  };
}

describe('selector-resolver parity', () => {
  it('does not change valid original selectors when enableLLMFallback=false', async () => {
    const steps = [
      makeStep(1, '[data-testid="login-button"]', 'data-testid'),
      makeStep(2, '[id="username"]', 'id'),
      makeStep(3, '[name="password"]', 'attribute'),
    ];
    const session = makeSession(steps);

    const snapshots = makeSnapshotCache({
      'node-1': makeDocument('<button data-testid="login-button">Login</button>'),
      'node-2': makeDocument('<input id="username" />'),
      'node-3': makeDocument('<input name="password" />'),
    });

    const result = await resolveSelectorsForSession(session, snapshots, {
      enableLLMFallback: false,
    });

    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
    expect(result.llmAcceptedStepNumbers).toHaveLength(0);
    expect(result.resolutions.map(r => r.resolvedSelector)).toEqual(steps.map(s => s.selector));
    expect(result.resolutions.every(r => r.resolverMetadata.resolvedBy === 'kept-original')).toBe(true);
  });
});
