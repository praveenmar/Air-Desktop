import { describe, expect, it, vi } from 'vitest';
import {
  resolveSelectorsForSession,
  validateCSSCandidate,
  SnapshotCache,
} from '../src/selector-resolver';
import { getSourceNodeId } from '../src/codegen.service';
import { CodegenSession, CodegenStep } from '../src/types';

type TestElement = {
  id?: string;
  textContent?: string;
  style?: string;
  className?: string;
  parentElement?: TestElement | null;
  attrs: Record<string, string>;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
};

type TestDocument = Document & {
  querySelectorAll: (selector: string) => Array<Element>;
  querySelector: (selector: string) => Element | null;
};

function makeElement(
  attrs: Record<string, string> = {},
  options: { text?: string; style?: string; id?: string; className?: string; parent?: TestElement | null } = {}
): Element {
  const element: TestElement = {
    id: options.id,
    textContent: options.text || '',
    style: options.style || '',
    className: options.className || '',
    parentElement: options.parent || null,
    attrs: { ...attrs, ...(options.style ? { style: options.style } : {}) },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
  };

  return element as unknown as Element;
}

function makeDocument(
  selectorMap: Record<string, Element[]>,
  html = '<html><body></body></html>'
): Document {
  const document = {
    querySelectorAll(selector: string) {
      if (!Object.prototype.hasOwnProperty.call(selectorMap, selector)) {
        throw new Error(`Unknown selector in test doc: ${selector}`);
      }
      return selectorMap[selector];
    },
    querySelector(selector: string) {
      return selectorMap[selector]?.[0] ?? null;
    },
    documentElement: { outerHTML: html },
    body: { outerHTML: html },
  };

  return document as unknown as TestDocument;
}

function makeSnapshotCache(
  entries: Record<string, Document | null>,
  snapshotEngineAvailable = true
): SnapshotCache {
  return {
    snapshotEngineAvailable,
    get(nodeId: string): Document | null {
      return entries[nodeId] ?? null;
    },
  };
}

function makeStep(step: number, overrides: Partial<CodegenStep> = {}): CodegenStep {
  return {
    step,
    intent: `click_step_${step}`,
    action: 'click',
    selector: 'button',
    selectorPriority: 'unknown',
    selectorRank: 10,
    sourceNodeId: `node-${step}`,
    assertions: [],
    userAssertions: [],
    confidence: 1,
    sampleSize: 1,
    pageUrl: 'http://example.com/page',
    ...overrides,
  };
}

function makeSession(steps: CodegenStep[]): CodegenSession {
  return {
    sessionId: 'session-1',
    url: 'http://example.com',
    title: 'Example',
    recordedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    stepCount: steps.length,
    steps,
    flowConfidence: 1,
    nodeCount: steps.length,
  };
}

describe('selector-resolver', () => {
  it('keeps valid unique original selector', async () => {
    const step = makeStep(1, {
      selector: '[id="submit-btn"]',
      selectorPriority: 'id',
      selectorRank: 2,
      sourceNodeId: 'node-1',
    });

    const session = makeSession([step]);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[id="submit-btn"]': [makeElement({ id: 'submit-btn' }, { id: 'submit-btn', text: 'Submit' })],
      }),
    });

    const result = await resolveSelectorsForSession(session, snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('[id="submit-btn"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('kept-original');
    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
  });

  it('performs deterministic override when original is non-unique and stable candidate is unique', async () => {
    const step = makeStep(1, {
      selector: '[name="save"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_save',
      sourceNodeId: 'node-1',
    });

    const submit = makeElement({ name: 'save', 'data-testid': 'save-primary' }, { text: 'Save' });
    const draft = makeElement({ name: 'save' }, { text: 'Save Draft' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[name="save"]': [submit, draft],
        '[data-testid="save-primary"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('[data-testid="save-primary"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('treats hidden matches as non-visible during validation', () => {
    const hidden = makeElement({ name: 'save', style: 'display:none' }, { text: 'Hidden Save', style: 'display:none' });
    const visible = makeElement({ name: 'save' }, { text: 'Visible Save' });
    const document = makeDocument({
      '[name="save"]': [hidden, visible],
    });

    const validation = validateCSSCandidate('[name="save"]', document);
    expect(validation.totalMatchCount).toBe(2);
    expect(validation.visibleMatchCount).toBe(1);
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.reason).toBe('unique-visible');
  });

  it('accepts valid LLM fallback when deterministic resolution stays unresolved', async () => {
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });

    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Cancel' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        'button[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.1,
      },
      async () => [{ stepNumber: 1, selector: 'button[aria-label="submit"]' }],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAccepted).toBe(true);
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toEqual([1]);
  });

  it('does not invoke LLM fallback when snapshot is unavailable', async () => {
    const session = makeSession([makeStep(1, { selector: 'button', sourceNodeId: 'missing-node' })]);
    const snapshotCache = makeSnapshotCache({});

    const llmProvider = vi.fn(async () => [{ stepNumber: 1, selector: '#irrelevant' }]);
    const result = await resolveSelectorsForSession(
      session,
      snapshotCache,
      { enableLLMFallback: true },
      llmProvider,
    );

    expect(llmProvider).not.toHaveBeenCalled();
    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
    expect(result.resolutions[0].resolverMetadata.warningCodes).toContain('snapshot-unavailable');
  });

  it('marks engine-unavailable when all snapshots are missing due engine failure', async () => {
    const session = makeSession([makeStep(1, { selector: 'button', sourceNodeId: 'node-1' })]);
    const snapshotCache = makeSnapshotCache({ 'node-1': null }, false);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await resolveSelectorsForSession(
      session,
      snapshotCache,
      { enableLLMFallback: false },
    );

    expect(result.resolutions[0].resolverMetadata.warningCodes).toContain('snapshot-engine-unavailable');
    expect(warnSpy).toHaveBeenCalledWith('[AIR] No snapshots available for entire session');
    warnSpy.mockRestore();
  });

  it('ignores duplicate LLM suggestions for the same step number', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Cancel' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        'button[aria-label="submit"]': [submit],
        'button[aria-label="cancel"]': [cancel],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true, resolverMinScore: 1.1 },
      async () => [
        { stepNumber: 1, selector: 'button[aria-label="submit"]' },
        { stepNumber: 1, selector: 'button[aria-label="cancel"]' },
      ],
    );

    expect(result.resolutions[0].resolvedSelector).toBe('button[aria-label="submit"]');
    expect(result.llmAcceptedStepNumbers).toEqual([1]);
  });

  it('enforces LLM fallback circuit breaker cap', async () => {
    const steps = Array.from({ length: 10 }, (_, idx) =>
      makeStep(idx + 1, {
        selector: 'button',
        intent: `click_submit_${idx + 1}`,
        sourceNodeId: `node-${idx + 1}`,
      }),
    );

    const snapshotEntries: Record<string, Document | null> = {};
    for (const step of steps) {
      const submit = makeElement({ 'aria-label': `submit ${step.step}` }, { text: 'Submit' });
      const cancel = makeElement({ 'aria-label': `cancel ${step.step}` }, { text: 'Cancel' });
      snapshotEntries[step.sourceNodeId as string] = makeDocument({
        button: [submit, cancel],
        [`button[aria-label="submit ${step.step}"]`]: [submit],
      });
    }

    const llmProvider = vi.fn(async request =>
      request.steps.map(item => ({ stepNumber: item.stepNumber, selector: `button[aria-label="submit ${item.stepNumber}"]` })),
    );

    const result = await resolveSelectorsForSession(
      makeSession(steps),
      makeSnapshotCache(snapshotEntries),
      { enableLLMFallback: true, resolverMinScore: 1.1 },
      llmProvider,
    );

    expect(result.llmAttemptedStepNumbers).toHaveLength(3);
    expect(llmProvider).toHaveBeenCalledTimes(1);
    expect(result.resolutions.filter(r => r.resolverMetadata.warningCodes.includes('llm-circuit-breaker')).length)
      .toBeGreaterThan(0);
  });

  it('exports node mapping helper with expected priority', () => {
    expect(getSourceNodeId({ nodeId: 'event-node' }, { fromNodeId: 'from-node', toNodeId: 'to-node' }))
      .toBe('event-node');
    expect(getSourceNodeId({ nodeId: null }, { fromNodeId: 'from-node', toNodeId: 'to-node' }))
      .toBe('from-node');
    expect(getSourceNodeId({ nodeId: null }, { fromNodeId: null, toNodeId: 'to-node' }))
      .toBe('to-node');
  });
});
