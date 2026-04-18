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
  const compoundKey = (normalizedUrl?: string, controlSignature?: string): string | null => {
    if (!normalizedUrl) return null;
    return `${normalizedUrl}|${controlSignature ?? ''}`;
  };

  return {
    snapshotEngineAvailable,
    get(nodeId: string, normalizedUrl?: string, controlSignature?: string): Document | null {
      const key = compoundKey(normalizedUrl, controlSignature);
      if (key && Object.prototype.hasOwnProperty.call(entries, key)) {
        return entries[key] ?? null;
      }
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

  it('keeps valid unique original text selector', async () => {
    const logout = makeElement({}, { text: 'Logout' });
    const cancel = makeElement({}, { text: 'Cancel' });
    const step = makeStep(1, {
      selector: 'text=Logout',
      selectorPriority: 'text',
      selectorRank: 8,
      sourceNodeId: 'node-1',
    });

    const session = makeSession([step]);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '*': [logout, cancel],
      }),
    });

    const result = await resolveSelectorsForSession(session, snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('text=Logout');
    expect(resolution.resolverMetadata.resolvedBy).toBe('kept-original');
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

  it('performs deterministic override to unique text candidate when css selector is non-unique', async () => {
    const logoutBtn = makeElement({ class: 'btn' }, { text: 'Logout' });
    const cancelBtn = makeElement({ class: 'btn' }, { text: 'Cancel' });
    const step = makeStep(1, {
      selector: '.btn',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_logout',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.btn': [logoutBtn, cancelBtn],
        '*': [logoutBtn, cancelBtn],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('text=logout');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('uses text-derived deterministic override for repeated css selector with intent text', async () => {
    const admin = makeElement({ class: 'menu-item' }, { text: 'Admin' });
    const pim = makeElement({ class: 'menu-item' }, { text: 'PIM' });
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [admin, pim],
        '.menu-item:has-text("Admin")': [admin],
        '*': [admin, pim],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).not.toBe('.menu-item');
    expect(resolution.resolvedSelector).toMatch(/admin/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('blocks deterministic override to generic shell selector and keeps original unresolved', async () => {
    const appShell = makeElement({ id: 'app' }, { id: 'app', text: 'username password login' });
    const step = makeStep(1, {
      selector: '[name="username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_username',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[name="username"]': [],
        '[id="app"]': [appShell],
        '*': [appShell],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('unresolved');
    expect(resolution.resolverMetadata.warningCodes).toContain('blocked-generic-shell-override');
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
      request.steps.map((item: any) => ({ stepNumber: item.stepNumber, selector: `button[aria-label="submit ${item.stepNumber}"]` })),
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

  it('uses controlSignature-specific snapshots for same normalized URL', async () => {
    const firstNameInput = makeElement({ name: 'firstName' }, { text: 'First Name' });
    const lastNameInput = makeElement({ name: 'lastName' }, { text: 'Last Name' });

    const stepA = makeStep(1, {
      selector: '[name="firstName"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'shared-node',
      normalizedUrl: 'https://app.test/profile',
      controlSignature: 'sig-a',
    });
    const stepB = makeStep(2, {
      selector: '[name="lastName"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'shared-node',
      normalizedUrl: 'https://app.test/profile',
      controlSignature: 'sig-b',
    });

    const snapshotCache = makeSnapshotCache({
      'https://app.test/profile|sig-a': makeDocument({
        '[name="firstName"]': [firstNameInput],
        '[name="lastName"]': [],
        '*': [firstNameInput],
      }),
      'https://app.test/profile|sig-b': makeDocument({
        '[name="firstName"]': [],
        '[name="lastName"]': [lastNameInput],
        '*': [lastNameInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([stepA, stepB]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    expect(result.resolutions.map(r => r.resolvedSelector)).toEqual([
      '[name="firstName"]',
      '[name="lastName"]',
    ]);
    expect(result.resolutions.every(r => r.resolverMetadata.resolvedBy === 'kept-original')).toBe(true);
  });

  it('falls back to blank controlSignature key when step controlSignature is missing', async () => {
    const emailInput = makeElement({ name: 'email' }, { text: 'Email' });
    const step = makeStep(1, {
      selector: '[name="email"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'shared-node',
      normalizedUrl: 'https://app.test/profile',
      controlSignature: undefined,
    });

    const snapshotCache = makeSnapshotCache({
      'https://app.test/profile|': makeDocument({
        '[name="email"]': [emailInput],
        '*': [emailInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    expect(result.resolutions[0].resolvedSelector).toBe('[name="email"]');
    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('kept-original');
  });

  it('uses fingerprint parentSelector hint for parent-scoped deterministic override', async () => {
    const primary = makeElement({ class: 'submit-btn' }, { text: 'Save' });
    const secondary = makeElement({ class: 'submit-btn' }, { text: 'Save Draft' });

    const step = makeStep(1, {
      selector: '.submit-btn',
      selectorPriority: 'class',
      selectorRank: 7,
      sourceNodeId: 'node-1',
      intent: 'click_save',
      fingerprint: {
        selector: '.submit-btn',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        parentSelector: '#profile-form',
        textExcerpt: 'Save',
        attributes: {},
        attributesHash: 'hash-1',
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.submit-btn': [primary, secondary],
        '#profile-form .submit-btn': [primary],
        '*': [primary, secondary],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false, resolverMinScore: 0.6 },
    );

    expect(result.resolutions[0].resolvedSelector).toBe('#profile-form .submit-btn');
    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('deterministic-override');
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
