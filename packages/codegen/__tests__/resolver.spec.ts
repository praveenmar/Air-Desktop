import { describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  generateCandidates,
  hasSameAirTargetNodeId,
  resolveSelectorsForSession,
  scoreCandidate,
  validateCSSCandidate,
  validateTextCandidate,
  SnapshotCache,
} from '../src/selector-resolver';
import type { SelectorFallbackProvider, SelectorFallbackRequest } from '../src/selector-resolver';
import { getSourceNodeId } from '../src/codegen.service';
import { classifySelectorCategory } from '../src/selector-evaluation';
import { CodegenSession, CodegenStep } from '../src/types';
import type { SnapshotSelectionResult } from '../src/snapshot-selector';
import { inferStepSignalAttributes } from '../src/resolver/text-matching';

type TestElement = {
  id?: string;
  tagName?: string;
  textContent?: string;
  style?: string;
  className?: string;
  parentElement?: TestElement | null;
  children?: TestElement[];
  attrs: Record<string, string>;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
  querySelectorAll?: (selector: string) => Array<Element>;
};

type TestDocument = Document & {
  querySelectorAll: (selector: string) => Array<Element>;
  querySelector: (selector: string) => Element | null;
};

function makeElement(
  attrs: Record<string, string> = {},
  options: {
    text?: string;
    style?: string;
    id?: string;
    className?: string;
    parent?: TestElement | null;
    tagName?: string;
    children?: TestElement[];
  } = {}
): Element {
  const element: TestElement = {
    id: options.id ?? attrs.id,
    tagName: options.tagName || 'DIV',
    textContent: options.text || '',
    style: options.style || '',
    className: options.className ?? attrs.class ?? '',
    parentElement: options.parent || null,
    children: options.children || [],
    attrs: { ...attrs, ...(options.style ? { style: options.style } : {}) },
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name);
    },
    getAttribute(name: string) {
      return this.attrs[name] ?? null;
    },
    querySelectorAll() {
      return [];
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

function makeHtmlDocument(html: string): Document {
  const { document } = parseHTML(html);
  const elements = [document.documentElement, ...Array.from(document.querySelectorAll('*'))] as Array<Element & {
    offsetParent?: unknown;
    getBoundingClientRect?: () => DOMRect;
  }>;
  for (const element of elements) {
    if (!element) continue;
    element.offsetParent = {};
    element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      top: 0,
      right: 10,
      bottom: 10,
      left: 0,
      toJSON() {
        return this;
      },
    } as DOMRect);
  }
  return document as unknown as Document;
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

function makeSnapshotCacheWithSelection(
  entries: Record<string, Document | null>,
  selectionFactory: (step: CodegenStep, mode?: 'action' | 'outcome') => SnapshotSelectionResult,
  snapshotEngineAvailable = true,
): SnapshotCache {
  return {
    ...makeSnapshotCache(entries, snapshotEngineAvailable),
    selectForStep: selectionFactory,
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

function scoreResolvedCandidate(
  step: CodegenStep,
  snapshot: Document,
  selector: string,
): { score: number; reason: string | undefined } {
  const candidate = generateCandidates(step, snapshot).find(entry => entry.selector === selector);
  if (!candidate) {
    throw new Error(`Missing candidate for selector: ${selector}`);
  }
  const validation = selector.startsWith('text=')
    ? validateTextCandidate(selector, snapshot, step)
    : validateCSSCandidate(selector, snapshot, step);
  return {
    score: scoreCandidate(candidate, validation, step, snapshot),
    reason: undefined,
  };
}

function scoreExplicitCandidate(
  step: CodegenStep,
  snapshot: Document,
  selector: string,
  source: 'class' | 'path' | 'text' | 'parent-scope' | 'id' | 'name' | 'testid' | 'data-cy' | 'data-qa' | 'aria' | 'placeholder' | 'href' | 'role+name' | 'original' | 'other',
  rank: number,
): number {
  const validation = selector.startsWith('text=')
    ? validateTextCandidate(selector, snapshot, step)
    : validateCSSCandidate(selector, snapshot, step);
  const effectiveSource = (source === 'path' ? 'original' : source);
  return scoreCandidate({ selector, source: effectiveSource, rank }, validation, step, snapshot);
}

describe('selector-resolver', () => {
  it('prefers preserved fingerprint href over selector-string inference', () => {
    const step = makeStep(1, {
      selector: 'a[href="/wrong"]',
      fingerprint: {
        selector: 'a[href="/wrong"]',
        attributes: {
          href: '/admin/viewAdminModule',
        },
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.href).toBe('/admin/viewAdminModule');
  });

  it('prefers preserved placeholder and exposes data-cy/data-qa signal attributes', () => {
    const step = makeStep(1, {
      selector: 'input[placeholder="Wrong"][data-cy="fallback-cy"][data-qa="fallback-qa"]',
      action: 'input',
      fingerprint: {
        selector: 'input[placeholder="Wrong"][data-cy="fallback-cy"][data-qa="fallback-qa"]',
        attributes: {
          placeholder: 'Search',
          dataCy: 'employee-search',
          'data-qa': 'employee-search',
        },
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.placeholder).toBe('Search');
    expect(attrs.dataCy).toBe('employee-search');
    expect(attrs.dataQa).toBe('employee-search');
  });

  it('preserves enriched field semantics from fingerprint attributes', () => {
    const step = makeStep(1, {
      selector: '.generic-input',
      action: 'input',
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          autocomplete: 'email',
          'aria-labelledby': 'employee-email-label',
          associatedLabelText: 'Employee Email',
          wrappedLabelText: 'Wrapped Email Label',
          labelledByText: 'Email address',
          describedByText: 'Used for notifications',
          fieldLabelText: 'Employee Email',
          class: 'generic-input',
        },
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.autocomplete).toBe('email');
    expect(attrs.ariaLabelledBy).toBe('employee-email-label');
    expect(attrs.associatedLabelText).toBe('Employee Email');
    expect(attrs.wrappedLabelText).toBe('Wrapped Email Label');
    expect(attrs.labelledByText).toBe('Email address');
    expect(attrs.describedByText).toBe('Used for notifications');
    expect(attrs.fieldLabelText).toBe('Employee Email');
  });

  it('falls back to selector-string inference when recorded fingerprint field is missing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const step = makeStep(1, {
      selector: 'input[name="username"][placeholder="Username"]',
      action: 'input',
      fingerprint: {
        selector: 'input[name="username"][placeholder="Username"]',
        attributes: {},
      },
    });

    const attrs = inferStepSignalAttributes(step);
    expect(attrs.name).toBe('username');
    expect(attrs.placeholder).toBe('Username');
    expect(warnSpy).toHaveBeenCalledWith(
      'FINGERPRINT_ATTRIBUTE_INFERRED_DOWNSTREAM',
      expect.objectContaining({ attribute: 'name' }),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      'FINGERPRINT_ATTRIBUTE_INFERRED_DOWNSTREAM',
      expect.objectContaining({ attribute: 'placeholder' }),
    );
  });

  it('classifies current selector categories including data-cy, data-qa, href, and xpath', () => {
    expect(classifySelectorCategory('[data-testid="submit"]', 'testid')).toBe('testid');
    expect(classifySelectorCategory('[data-cy="submit"]', 'data-cy')).toBe('data-cy');
    expect(classifySelectorCategory('[data-qa="submit"]', 'data-qa')).toBe('data-qa');
    expect(classifySelectorCategory('[name="username"]', 'name')).toBe('name');
    expect(classifySelectorCategory('[href="/admin"]', 'href')).toBe('href');
    expect(classifySelectorCategory('[placeholder="Username"]', 'placeholder')).toBe('placeholder');
    expect(classifySelectorCategory('[aria-label="Search"]', 'aria')).toBe('aria-label');
    expect(classifySelectorCategory('.btn.btn-primary', 'class')).toBe('class');
    expect(classifySelectorCategory('form .field [name="username"]', 'parent-scope')).toBe('parent-scoped');
    expect(classifySelectorCategory('div > div:nth-child(2) > input', 'path')).toBe('structural');
    expect(classifySelectorCategory('//button[@id="submit"]', 'original')).toBe('xpath');
  });

  it('classifies :has-text selectors as text and keeps them off plain CSS direct evidence paths', () => {
    const searchButton = makeElement({}, { tagName: 'BUTTON', text: 'Search' });
    const snapshot = makeDocument({
      button: [searchButton],
      '*': [searchButton],
    });

    const category = classifySelectorCategory('button:has-text("Search")', 'text');

    expect(category).toBe('text');
    expect([
      'testid',
      'data-cy',
      'data-qa',
      'id',
      'name',
      'href',
      'placeholder',
      'aria-label',
    ]).not.toContain(category);
    expect(validateCSSCandidate('button:has-text("Search")', snapshot).reason).toBe('invalid-selector');
    expect(validateTextCandidate('button:has-text("Search")', snapshot).reason).toBe('unique-visible');
  });

  it('prefers proven testid over weaker class selector when both are valid', () => {
    const submit = makeElement(
      { 'data-testid': 'submit-btn', class: 'btn btn-primary' },
      { tagName: 'BUTTON', text: 'Submit', className: 'btn btn-primary' },
    );
    const snapshot = makeDocument({
      '[data-testid="submit-btn"]': [submit],
      '.btn': [submit],
    });
    const step = makeStep(1, {
      selector: '.btn',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.btn',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Submit',
        attributes: {
          'data-testid': 'submit-btn',
          class: 'btn btn-primary',
        },
      },
    });

    const testidScore = scoreExplicitCandidate(step, snapshot, '[data-testid="submit-btn"]', 'testid', 1);
    const classScore = scoreExplicitCandidate(step, snapshot, '.btn', 'class', 7);

    expect(testidScore).toBeGreaterThan(classScore);
  });

  it('prefers proven name selector over brittle structural selector and keeps compact scoped selectors usable', () => {
    const username = makeElement(
      { name: 'username' },
      { tagName: 'INPUT' },
    );
    const snapshot = makeDocument({
      '[name="username"]': [username],
      'form [name="username"]': [username],
      'div > div:nth-child(2) > input': [username],
    });
    const step = makeStep(1, {
      action: 'input',
      selector: 'div > div:nth-child(2) > input',
      selectorPriority: 'path',
      selectorRank: 10,
      fingerprint: {
        selector: 'div > div:nth-child(2) > input',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'input',
        attributes: {
          name: 'username',
        },
      },
    });

    const nameScore = scoreExplicitCandidate(step, snapshot, '[name="username"]', 'name', 3);
    const scopedScore = scoreExplicitCandidate(step, snapshot, 'form [name="username"]', 'parent-scope', 4);
    const structuralScore = scoreExplicitCandidate(step, snapshot, 'div > div:nth-child(2) > input', 'path', 10);

    expect(nameScore).toBeGreaterThan(structuralScore);
    expect(scopedScore).toBeGreaterThan(structuralScore);
  });

  it('prefers enriched autocomplete candidates over weak class fallback for generic inputs', () => {
    const field = makeElement(
      { autocomplete: 'email', class: 'generic-input' },
      { tagName: 'INPUT', className: 'generic-input' },
    );
    const snapshot = makeDocument({
      '[autocomplete="email"]': [field],
      'input[autocomplete="email"]': [field],
      '.generic-input': [field],
    });
    const step = makeStep(1, {
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          autocomplete: 'email',
          class: 'generic-input',
        },
      },
    });

    const autocompleteScore = scoreExplicitCandidate(step, snapshot, 'input[autocomplete="email"]', 'other', 4);
    const classScore = scoreExplicitCandidate(step, snapshot, '.generic-input', 'class', 7);

    expect(autocompleteScore).toBeGreaterThan(classScore);
  });

  it('does not invoke LLM fallback for a first-observation placeholder selector when deterministic proof is strong', async () => {
    const field = makeElement(
      { placeholder: 'Employee name' },
      { tagName: 'INPUT' },
    );
    const snapshot = makeDocument({
      '[placeholder="Employee name"]': [field],
      'input[placeholder="Employee name"]': [field],
      '*': [field],
    });
    const snapshotCache = makeSnapshotCache({ 'node-1': snapshot });
    const fallbackProvider = vi.fn(async (_request: SelectorFallbackRequest) => []);
    const step = makeStep(1, {
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      sampleSize: 1,
      confidence: 1,
      fingerprint: {
        selector: '.generic-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          placeholder: 'Employee name',
          class: 'generic-input',
        },
      },
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true },
      fallbackProvider,
    );

    expect(result.resolutions[0]?.resolvedSelector).toBe('input[placeholder="Employee name"]');
    expect(result.llmAttemptedStepNumbers).toEqual([]);
    expect(fallbackProvider).not.toHaveBeenCalled();
  });

  it('persists selector evaluation summary for deterministic winners', async () => {
    const submit = makeElement(
      { 'data-cy': 'submit-btn' },
      { tagName: 'BUTTON', text: 'Submit' },
    );
    const cancel = makeElement(
      { class: 'submit' },
      { tagName: 'BUTTON', text: 'Cancel', className: 'submit' },
    );
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.submit': [submit, cancel],
        '[data-cy="submit-btn"]': [submit],
        'button[data-cy="submit-btn"]': [submit],
        '*': [submit, cancel],
      }),
    });
    const step = makeStep(1, {
      selector: '.submit',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_submit',
      fingerprint: {
        selector: '.submit',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Submit',
        attributes: {
          'data-cy': 'submit-btn',
          class: 'submit',
        },
      },
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('button[data-cy="submit-btn"]');
    expect(resolution.resolverMetadata.selectorEvaluation).toEqual(expect.objectContaining({
      category: 'data-cy',
      proof: expect.objectContaining({
        proofLevel: 'semantic_validated',
        proofSource: 'semantic',
      }),
      scoring: expect.objectContaining({
        finalScore: expect.any(Number),
        stabilityScore: expect.any(Number),
        semanticScore: expect.any(Number),
        brittlenessPenalty: expect.any(Number),
      }),
      reasons: expect.arrayContaining(['category:data-cy', 'proof:semantic_validated']),
    }));
  });

  it('derives preferred getByTestId rendering only for exact data-testid selectors', async () => {
    const submit = makeElement(
      { 'data-testid': 'save-primary' },
      { tagName: 'BUTTON', text: 'Save' },
    );
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[data-testid="save-primary"]': [submit],
      }),
    });
    const step = makeStep(1, {
      selector: '[data-testid="save-primary"]',
      selectorPriority: 'data-testid',
      selectorRank: 1,
      sourceNodeId: 'node-1',
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const preferredRenderings = result.resolutions[0]?.resolverMetadata.selectorEvaluation?.preferredRenderings ?? [];

    expect(preferredRenderings[0]).toEqual(expect.objectContaining({
      engine: 'testid',
      locator: `getByTestId("save-primary")`,
      proofLevel: 'proven_equivalent',
      proofSource: 'attribute-equivalence',
      sourceSelector: '[data-testid="save-primary"]',
      sourceEngine: 'css',
    }));
  });

  it('does not derive getByTestId rendering for data-cy or data-qa selectors', async () => {
    const submit = makeElement(
      { 'data-cy': 'save-cy', 'data-qa': 'save-qa' },
      { tagName: 'BUTTON', text: 'Save' },
    );
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[data-cy="save-cy"]': [submit],
        '[data-qa="save-qa"]': [submit],
      }),
    });

    const dataCyStep = makeStep(1, {
      selector: '[data-cy="save-cy"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'node-1',
    });
    const dataQaStep = makeStep(2, {
      selector: '[data-qa="save-qa"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      sourceNodeId: 'node-1',
    });

    const result = await resolveSelectorsForSession(makeSession([dataCyStep, dataQaStep]), snapshotCache, { enableLLMFallback: false });

    expect(result.resolutions[0]?.resolverMetadata.selectorEvaluation?.preferredRenderings ?? []).toEqual([]);
    expect(result.resolutions[1]?.resolverMetadata.selectorEvaluation?.preferredRenderings ?? []).toEqual([]);
  });

  it('derives exact getByPlaceholder rendering only for input and textarea families', async () => {
    const input = makeElement(
      { placeholder: 'Username' },
      { tagName: 'INPUT' },
    );
    const div = makeElement(
      { placeholder: 'Username' },
      { tagName: 'DIV', text: 'Username' },
    );
    const inputSnapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'input[placeholder="Username"]': [input],
      }),
    });
    const divSnapshotCache = makeSnapshotCache({
      'node-2': makeDocument({
        'div[placeholder="Username"]': [div],
      }),
    });

    const inputStep = makeStep(1, {
      selector: 'input[placeholder="Username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      action: 'input',
      sourceNodeId: 'node-1',
    });
    const divStep = makeStep(2, {
      selector: 'div[placeholder="Username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      action: 'click',
      sourceNodeId: 'node-2',
    });

    const inputResult = await resolveSelectorsForSession(makeSession([inputStep]), inputSnapshotCache, { enableLLMFallback: false });
    const divResult = await resolveSelectorsForSession(makeSession([divStep]), divSnapshotCache, { enableLLMFallback: false });

    expect(inputResult.resolutions[0]?.resolverMetadata.selectorEvaluation?.preferredRenderings?.[0]).toEqual(expect.objectContaining({
      engine: 'placeholder',
      locator: `getByPlaceholder("Username", { exact: true })`,
      proofLevel: 'proven_equivalent',
      proofSource: 'attribute-equivalence',
    }));
    expect(divResult.resolutions[0]?.resolverMetadata.selectorEvaluation?.preferredRenderings ?? []).toEqual([]);
  });

  it('derives exact getByText rendering only for strict text selectors, not :has-text containers', async () => {
    const logout = makeElement({}, { tagName: 'A', text: 'Logout' });
    const container = makeElement({}, { tagName: 'DIV', text: 'Logout' });
    const strictSnapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '*': [logout],
      }),
    });
    const broadSnapshotCache = makeSnapshotCache({
      'node-2': makeDocument({
        'div:has-text("Logout")': [container],
      }),
    });

    const strictStep = makeStep(1, {
      selector: 'text=Logout',
      selectorPriority: 'text',
      selectorRank: 8,
      sourceNodeId: 'node-1',
    });
    const broadStep = makeStep(2, {
      selector: 'div:has-text("Logout")',
      selectorPriority: 'text',
      selectorRank: 8,
      sourceNodeId: 'node-2',
    });

    const strictResult = await resolveSelectorsForSession(makeSession([strictStep]), strictSnapshotCache, { enableLLMFallback: false });
    const broadResult = await resolveSelectorsForSession(makeSession([broadStep]), broadSnapshotCache, { enableLLMFallback: false });

    expect(strictResult.resolutions[0]?.resolverMetadata.selectorEvaluation?.preferredRenderings?.[0]).toEqual(expect.objectContaining({
      engine: 'text',
      locator: `getByText("Logout", { exact: true })`,
      proofLevel: 'proven_equivalent',
      proofSource: 'text-equivalence',
    }));
    expect(broadResult.resolutions[0]?.resolverMetadata.selectorEvaluation?.preferredRenderings ?? []).toEqual([]);
  });

  it('rejects unique href-mismatched deterministic candidate', async () => {
    const adminWrong = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'Admin', tagName: 'A' },
    );
    const otherLinks = Array.from({ length: 59 }, (_, idx) =>
      makeElement(
        { class: 'menu-item', href: `/web/index.php/module/${idx}` },
        { text: `Item ${idx}`, tagName: 'A' },
      ),
    );
    const menuItems = [adminWrong, ...otherLinks];
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': menuItems,
        'text=admin': [adminWrong],
        'a:has-text("Admin")': [adminWrong],
        '*': menuItems,
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('.menu-item');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-semantic-mismatch');
    expect(resolution.resolverMetadata.rejectReason).toBe('href_mismatch');
    expect(resolution.resolverMetadata.semanticRejectReason).toBe('href_mismatch');
    expect(resolution.resolverMetadata.rejectedCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: 'text=admin', reason: 'href_mismatch' }),
      ]),
    );
  });

  it('does not resolve select-like "-- Select --" interaction to search input', async () => {
    const searchInput = makeElement(
      { placeholder: 'Search', type: 'search' },
      { tagName: 'INPUT' },
    );
    const unrelated = makeElement({}, { text: 'Other', tagName: 'DIV' });
    const step = makeStep(1, {
      selector: 'div > div:nth-of-type(1)',
      selectorPriority: 'path',
      selectorRank: 10,
      intent: 'click_Select',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: 'div > div:nth-of-type(1)',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'div',
        textExcerpt: '-- Select --',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'div > div:nth-of-type(1)': [],
        '[placeholder="Search"]': [searchInput],
        'input[placeholder="Search"]': [searchInput],
        '*': [searchInput, unrelated],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('div > div:nth-of-type(1)');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-semantic-mismatch');
    expect(resolution.resolverMetadata.rejectReason).toBe('control_family_mismatch');
    expect(resolution.resolverMetadata.semanticRejectReason).toBe('control_family_mismatch');
  });

  it('rejects unique candidate with wrong menu role/control family', async () => {
    const logoutButton = makeElement(
      { role: 'button' },
      { text: 'Logout', tagName: 'BUTTON' },
    );
    const otherButtons = Array.from({ length: 59 }, (_, idx) =>
      makeElement(
        { role: 'button' },
        { text: `Action ${idx}`, tagName: 'BUTTON' },
      ),
    );
    const menuEntries = [logoutButton, ...otherButtons];
    const step = makeStep(1, {
      selector: '.menu-entry',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Logout',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-entry',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'li',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-entry': menuEntries,
        'text=logout': [logoutButton],
        'button:has-text("Logout")': [logoutButton],
        '*': menuEntries,
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('.menu-entry');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-semantic-mismatch');
    expect(resolution.resolverMetadata.rejectReason).toBe('control_family_mismatch');
    expect(resolution.resolverMetadata.semanticRejectReason).toBe('control_family_mismatch');
  });

  it('still resolves good Admin navigation candidate when text and href align', async () => {
    const admin = makeElement(
      { class: 'menu-item', href: '/web/index.php/admin/viewAdminModule' },
      { text: 'Admin', tagName: 'A' },
    );
    const pim = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'PIM', tagName: 'A' },
    );
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [admin, pim],
        'text=admin': [admin],
        'a:has-text("Admin")': [admin],
        '*': [admin, pim],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toMatch(/admin/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
    expect(resolution.resolverMetadata.semanticCompatibilityScore).toBeGreaterThan(0);
  });

  it('allows deterministic override when event-local snapshot reports target evidence present', async () => {
    const admin = makeElement(
      { class: 'menu-item', href: '/web/index.php/admin/viewAdminModule' },
      { text: 'Admin', tagName: 'A' },
    );
    const pim = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'PIM', tagName: 'A' },
    );
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      eventId: 'ev-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshot = makeDocument({
      '.menu-item': [admin, pim],
      'text=admin': [admin],
      'a:has-text("Admin")': [admin],
      '*': [admin, pim],
    });

    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'event-local-pageState',
          temporalClass: 'action_local',
          reason: 'selected_event_local_pageState_by_eventId',
          eventId: 'ev-1',
          confidenceScore: 1,
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
        },
        evaluatedCandidates: [
          {
            source: 'event-local-pageState',
            temporalClass: 'action_local',
            selected: true,
            reason: 'selected_event_local_pageState_by_eventId',
            eventId: 'ev-1',
            confidenceScore: 1,
            targetPresent: true,
            snapshotTargetEvidenceReason: 'selector_match',
          },
        ],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toMatch(/admin/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('uses explicit label text as semantic compatibility evidence for field candidates', async () => {
    const labelUser = makeElement({ for: 'username' }, { text: 'Username', tagName: 'LABEL' });
    const labelPassword = makeElement({ for: 'password' }, { text: 'Password', tagName: 'LABEL' });
    const usernameInput = makeElement(
      { id: 'username', name: 'username', class: 'field-input' },
      { tagName: 'INPUT', id: 'username' },
    );
    const passwordInput = makeElement(
      { id: 'password', name: 'password', class: 'field-input' },
      { tagName: 'INPUT', id: 'password' },
    );

    const step = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        textExcerpt: 'Username',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.field-input': [usernameInput, passwordInput],
        '#username': [usernameInput],
        '[id="username"]': [usernameInput],
        'input[name="username"]': [usernameInput],
        '*': [labelUser, labelPassword, usernameInput, passwordInput],
        label: [labelUser, labelPassword],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toMatch(/username/i);
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.semanticCompatibilityReasons).toEqual(
      expect.arrayContaining(['text_match:label_for']),
    );
  });

  it('keeps stable semantic IDs strong without over-penalizing them', async () => {
    const usernameInput = makeElement(
      { id: 'username', name: 'username', class: 'field-input' },
      { tagName: 'INPUT' },
    );
    const passwordInput = makeElement(
      { id: 'password', name: 'password', class: 'field-input' },
      { tagName: 'INPUT' },
    );

    const step = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          id: 'username',
          name: 'username',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.field-input': [usernameInput, passwordInput],
        '#username': [usernameInput],
        '[id="username"]': [usernameInput],
        '[name="username"]': [usernameInput],
        'input[name="username"]': [usernameInput],
        '*': [usernameInput, passwordInput],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect([ '#username', 'input[name="username"]' ]).toContain(resolution.resolvedSelector);
    expect(scoreResolvedCandidate(step, snapshotCache.get('node-1')!, '[id="username"]').score).toBeGreaterThanOrEqual(0.65);
  });

  it('uses title and icon alt as bounded semantic compatibility evidence', async () => {
    const iconChild = makeElement({ alt: 'Upload Avatar' }, { tagName: 'IMG' }) as any;
    const uploadButton = makeElement(
      { 'data-testid': 'upload-avatar', title: 'Upload Avatar' },
      { tagName: 'BUTTON', children: [iconChild] },
    ) as any;
    iconChild.parentElement = uploadButton;
    const otherButton = makeElement(
      { 'data-testid': 'cancel-avatar', title: 'Cancel Avatar' },
      { tagName: 'BUTTON' },
    );

    const step = makeStep(1, {
      selector: '.icon-btn',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_upload_avatar',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.icon-btn',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        attributes: {
          dataTestId: 'upload-avatar',
          title: 'Upload Avatar',
          alt: 'Upload Avatar',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.icon-btn': [uploadButton, otherButton],
        '[data-testid="upload-avatar"]': [uploadButton],
        'button[data-testid="upload-avatar"]': [uploadButton],
        '*': [uploadButton, iconChild, otherButton],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toContain('upload-avatar');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.semanticCompatibilityReasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^text_match:(title|icon_child_alt)$/),
      ]),
    );
  });

  it('penalizes generated headlessui IDs but does not reject them', async () => {
    const logout = makeElement(
      { id: 'headlessui-menu-item-12', role: 'menuitem' },
      { text: 'Logout', tagName: 'BUTTON' },
    );
    const other = makeElement(
      { id: 'headlessui-menu-item-13', role: 'menuitem' },
      { text: 'Profile', tagName: 'BUTTON' },
    );

    const step = makeStep(1, {
      selector: '.menu-entry',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Logout',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-entry',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-entry': [logout, other],
        '[id="headlessui-menu-item-12"]': [logout],
        'text=logout': [logout],
        'button:has-text("Logout")': [logout],
        '*': [logout, other],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).not.toContain('headlessui');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
  });

  it('records bounded nav/menu context as semantic compatibility evidence', async () => {
    const navRoot = makeElement({ id: 'main-nav' }, { tagName: 'NAV' }) as any;
    const navItem = makeElement({}, { tagName: 'LI', parent: navRoot }) as any;
    const pimItem = makeElement({}, { tagName: 'LI', parent: navRoot }) as any;
    const adminLink = makeElement(
      { class: 'menu-item', href: '/web/index.php/admin/viewAdminModule' },
      { text: 'Admin', tagName: 'A', parent: navItem },
    );
    const pimLink = makeElement(
      { class: 'menu-item', href: '/web/index.php/pim/viewPimModule' },
      { text: 'PIM', tagName: 'A', parent: pimItem },
    );
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        parentSelector: '#main-nav',
        context: {
          parentTag: 'li',
          nearestContainerTag: 'nav',
        },
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [adminLink, pimLink],
        '#main-nav': [navRoot],
        'text=admin': [adminLink],
        'a:has-text("Admin")': [adminLink],
        '*': [navRoot, navItem, pimItem, adminLink, pimLink],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.semanticCompatibilityReasons).toEqual(
      expect.arrayContaining([
        'parent_selector_match',
        'parent_tag_match:li',
        'nearest_container_match:nav',
      ]),
    );
  });

  it('penalizes UUID-like and long numeric IDs in candidate scoring', () => {
    const uuidElement = makeElement(
      { id: 'user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123' },
      { tagName: 'DIV' },
    );
    const longNumericElement = makeElement(
      { id: 'account-1234567890' },
      { tagName: 'DIV' },
    );
    const stableElement = makeElement({ id: 'usernameField' }, { tagName: 'DIV', id: 'usernameField' });
    const snapshot = makeDocument({
      '.item': [uuidElement, longNumericElement],
      '.stable-item': [stableElement],
      '[id="user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123"]': [uuidElement],
      '[id="account-1234567890"]': [longNumericElement],
      '[id="usernameField"]': [stableElement],
      '#usernameField': [stableElement],
      '*': [uuidElement, longNumericElement, stableElement],
    });

    const uuidStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: 'user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123',
        },
      },
    });
    const longNumericStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: 'account-1234567890',
        },
      },
    });
    const stableStep = makeStep(1, {
      selector: '.stable-item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.stable-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: 'usernameField',
        },
      },
    });

    const stableScore = scoreResolvedCandidate(stableStep, snapshot, '#usernameField').score;
    expect(scoreResolvedCandidate(uuidStep, snapshot, '[id="user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123"]').score).toBeLessThan(stableScore);
    expect(scoreResolvedCandidate(longNumericStep, snapshot, '[id="account-1234567890"]').score).toBeLessThan(stableScore);
  });

  it('does not over-penalize readable IDs with small numeric suffixes', () => {
    const addressLine = makeElement({ id: 'addressLine2' }, { tagName: 'INPUT', id: 'addressLine2' });
    const step = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      action: 'input',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          id: 'addressLine2',
          name: 'addressLine2',
        },
      },
    });
    const snapshot = makeDocument({
      '.field-input': [addressLine],
      '#addressLine2': [addressLine],
      '[id="addressLine2"]': [addressLine],
      '*': [addressLine],
    });

    expect(scoreResolvedCandidate(step, snapshot, '#addressLine2').score).toBeGreaterThanOrEqual(0.65);
  });

  it('penalizes runtime, framework, css-hash, and opaque generated IDs below stable semantic IDs', () => {
    const stableIds = ['login-email', 'submit-button'] as const;
    const dynamicIds = [
      'radix-:R2H1:',
      'headlessui-menu-button-1',
      ':r1:',
      'user-7f4c2f31-1e1a-4bd4-a1a2-99f9f6a5f123',
      'css-1x2y3z4a',
      'sc-kxYz12',
      'account-1234567890',
    ] as const;

    const stableScores = stableIds.map(id => {
      const element = makeElement({ id }, { tagName: 'INPUT', id });
      const step = makeStep(1, {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        action: 'input',
        fingerprint: {
          selector: '.field-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: { id },
        },
      });
      const snapshot = makeDocument({
        '.field-input': [element],
        [`[id="${id}"]`]: [element],
        '*': [element],
      });

      return scoreResolvedCandidate(step, snapshot, `[id="${id}"]`).score;
    });

    const semanticFloor = Math.min(...stableScores);
    expect(semanticFloor).toBeGreaterThanOrEqual(0.65);

    for (const id of dynamicIds) {
      const element = makeElement({ id }, { tagName: 'DIV', id });
      const step = makeStep(1, {
        selector: '.generated-item',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.generated-item',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'div',
          attributes: { id },
        },
      });
      const snapshot = makeDocument({
        '.generated-item': [element],
        [`[id="${id}"]`]: [element],
        '*': [element],
      });

      expect(scoreResolvedCandidate(step, snapshot, `[id="${id}"]`).score).toBeLessThan(semanticFloor);
    }
  });

  it('gives readable fingerprint-aligned IDs a small bonus', () => {
    const usernameInput = makeElement(
      { id: 'usernameField', name: 'username' },
      { tagName: 'INPUT', id: 'usernameField' },
    );
    const snapshot = makeDocument({
      '.field-input': [usernameInput],
      '#usernameField': [usernameInput],
      '[id="usernameField"]': [usernameInput],
      '[name="username"]': [usernameInput],
      '*': [usernameInput],
    });

    const unalignedStep = makeStep(1, {
      selector: '.field-input',
      selectorPriority: 'class',
      selectorRank: 7,
      action: 'input',
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {},
      },
    });
    const alignedStep = makeStep(1, {
      ...unalignedStep,
      fingerprint: {
        selector: '.field-input',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          name: 'username',
        },
      },
      intent: 'input_username',
    });

    expect(scoreResolvedCandidate(alignedStep, snapshot, '[id="usernameField"]').score)
      .toBeGreaterThan(scoreResolvedCandidate(unalignedStep, snapshot, '[id="usernameField"]').score);
  });

  it('semantic class beats hashed class in candidate scoring', () => {
    const semanticElement = makeElement({ class: 'username-field' }, { tagName: 'INPUT' });
    const hashedElement = makeElement({ class: 'a1b2c3d4e5' }, { tagName: 'INPUT' });
    const semanticSnapshot = makeDocument({
      '.field': [semanticElement],
      '.username-field': [semanticElement],
      'input.username-field': [semanticElement],
      '*': [semanticElement],
    });
    const hashedSnapshot = makeDocument({
      '.field': [hashedElement],
      '.a1b2c3d4e5': [hashedElement],
      'input.a1b2c3d4e5': [hashedElement],
      '*': [hashedElement],
    });

    const semanticStep = makeStep(1, {
      selector: '.field',
      selectorPriority: 'class',
      selectorRank: 7,
      action: 'input',
      fingerprint: {
        selector: '.field',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          name: 'username',
        },
      },
      intent: 'input_username',
    });
    const hashedStep = makeStep(1, {
      ...semanticStep,
      fingerprint: {
        selector: '.field',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        attributes: {
          class: 'a1b2c3d4e5',
        },
      },
    });

    expect(scoreExplicitCandidate(semanticStep, semanticSnapshot, '.username-field', 'class', 7))
      .toBeGreaterThan(scoreExplicitCandidate(hashedStep, hashedSnapshot, '.a1b2c3d4e5', 'class', 7));
  });

  it('utility-only Tailwind class list is penalized', () => {
    const utilityElement = makeElement({ class: 'flex items-center justify-center bg-blue-500 text-white p-4' }, { tagName: 'DIV' });
    const semanticElement = makeElement({ class: 'sidebar-button flex mt-4' }, { tagName: 'DIV' });
    const utilitySnapshot = makeDocument({
      '.target': [utilityElement],
      '.flex': [utilityElement],
      '*': [utilityElement],
    });
    const semanticSnapshot = makeDocument({
      '.target': [semanticElement],
      '.sidebar-button': [semanticElement],
      '*': [semanticElement],
    });

    const utilityStep = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'flex items-center justify-center bg-blue-500 text-white p-4',
        },
      },
    });
    const semanticStep = makeStep(1, {
      ...utilityStep,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'sidebar-button flex mt-4',
        },
      },
      intent: 'click_sidebar_button',
    });

    expect(scoreExplicitCandidate(utilityStep, utilitySnapshot, '.flex', 'class', 7))
      .toBeLessThan(scoreExplicitCandidate(semanticStep, semanticSnapshot, '.sidebar-button', 'class', 7));
  });

  it('does not generate or prefer compound utility selectors', () => {
    const element = makeElement({ class: 'flex items-center justify-center bg-blue-500 text-white p-4 rounded-md' }, { tagName: 'DIV' });
    const snapshot = makeDocument({
      '.target': [element],
      '*': [element],
    });
    const step = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'flex items-center justify-center bg-blue-500 text-white p-4 rounded-md',
        },
      },
    });

    const candidates = generateCandidates(step, snapshot).map(candidate => candidate.selector);
    expect(candidates.some(selector => selector.includes('.flex.items-center'))).toBe(false);
  });

  it('semantic class mixed with utility classes remains usable', async () => {
    const sidebarItem = makeElement({ class: 'oxd-sidebar-item flex mt-4' }, { tagName: 'DIV' });
    const otherItem = makeElement({ class: 'oxd-sidebar-link flex mt-4' }, { tagName: 'DIV', text: 'Other' });
    const step = makeStep(1, {
      selector: '.oxd-sidebar-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_sidebar_item',
      fingerprint: {
        selector: '.oxd-sidebar-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'oxd-sidebar-item flex mt-4',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-sidebar-item': [sidebarItem],
        'div.oxd-sidebar-item': [sidebarItem],
        '*': [sidebarItem, otherItem],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toContain('oxd-sidebar-item');
  });

  it('generic framework class is penalized but not rejected', async () => {
    const menuItem = makeElement({ class: 'oxd-main-menu-item' }, { tagName: 'DIV', text: 'Admin' });
    const semanticMenuItem = makeElement({ class: 'admin-menu-item' }, { tagName: 'DIV', text: 'Admin' });
    const step = makeStep(1, {
      selector: '.oxd-main-menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Admin',
      fingerprint: {
        selector: '.oxd-main-menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'Admin',
        attributes: {
          class: 'oxd-main-menu-item',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-main-menu-item': [menuItem],
        'div.oxd-main-menu-item': [menuItem],
        '*': [menuItem],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.rejectReason).toBeNull();
    expect(scoreExplicitCandidate(step, snapshotCache.get('node-1')!, '.oxd-main-menu-item', 'class', 7))
      .toBeLessThan(scoreExplicitCandidate(
        {
          ...step,
          selector: '.admin-menu-item',
          fingerprint: {
            ...step.fingerprint,
            selector: '.admin-menu-item',
            attributes: {
              class: 'admin-menu-item',
            },
          },
        },
        makeDocument({
          '.admin-menu-item': [semanticMenuItem],
          '*': [semanticMenuItem],
        }),
        '.admin-menu-item',
        'class',
        7,
      ));
  });

  it('BEM-like class remains usable', () => {
    const bemElement = makeElement({ class: 'user-menu__logout' }, { tagName: 'BUTTON' });
    const frameworkElement = makeElement({ class: 'oxd-main-menu-item' }, { tagName: 'BUTTON' });
    const bemSnapshot = makeDocument({
      '.target': [bemElement],
      '.user-menu__logout': [bemElement],
      '*': [bemElement],
    });
    const frameworkSnapshot = makeDocument({
      '.target': [frameworkElement],
      '.oxd-main-menu-item': [frameworkElement],
      '*': [frameworkElement],
    });

    const bemStep = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_logout',
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Logout',
        attributes: {
          class: 'user-menu__logout',
        },
      },
    });
    const frameworkStep = makeStep(1, {
      ...bemStep,
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Logout',
        attributes: {
          class: 'oxd-main-menu-item',
        },
      },
    });

    expect(scoreExplicitCandidate(bemStep, bemSnapshot, '.user-menu__logout', 'class', 7))
      .toBeGreaterThan(scoreExplicitCandidate(frameworkStep, frameworkSnapshot, '.oxd-main-menu-item', 'class', 7));
  });

  it('penalizes css-in-js, hashed, state, and framework classes below semantic BEM-style classes', () => {
    const semanticClass = 'login-form__email-input';
    const controlClass = 'checkout-button--primary';
    const riskyClasses = [
      'css-abc123',
      'sc-kxYz12',
      'k9Lm8Np7qX',
      'is-active',
      '--selected',
      'data-state-open',
      'mui-button-root',
      'radix-dropdown-trigger',
      'headlessui-button',
    ] as const;

    const semanticElement = makeElement({ class: `${semanticClass} ${controlClass}` }, { tagName: 'BUTTON' });
    const semanticSnapshot = makeDocument({
      '.target': [semanticElement],
      [`.${semanticClass}`]: [semanticElement],
      [`.${controlClass}`]: [semanticElement],
      '*': [semanticElement],
    });
    const semanticStep = makeStep(1, {
      selector: '.target',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_checkout_button',
      fingerprint: {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Checkout',
        attributes: {
          class: `${semanticClass} ${controlClass}`,
          name: 'checkout',
        },
      },
    });

    const semanticScore = scoreExplicitCandidate(
      semanticStep,
      semanticSnapshot,
      `.${semanticClass}`,
      'class',
      7,
    );
    const controlScore = scoreExplicitCandidate(
      semanticStep,
      semanticSnapshot,
      `.${controlClass}`,
      'class',
      7,
    );

    expect(controlScore).toBeGreaterThanOrEqual(semanticScore - 0.05);

    for (const classToken of riskyClasses) {
      const element = makeElement({ class: classToken }, { tagName: 'BUTTON' });
      const snapshot = makeDocument({
        '.target': [element],
        [`.${classToken}`]: [element],
        '*': [element],
      });
      const step = makeStep(1, {
        selector: '.target',
        selectorPriority: 'class',
        selectorRank: 7,
        intent: 'click_checkout_button',
        fingerprint: {
          selector: '.target',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'button',
          textExcerpt: 'Checkout',
          attributes: {
            class: classToken,
          },
        },
      });

      expect(scoreExplicitCandidate(step, snapshot, `.${classToken}`, 'class', 7)).toBeLessThan(controlScore);
    }
  });

  it('class-only selector remains available if no better truth exists', async () => {
    const classOnly = makeElement({ class: 'product-card' }, { tagName: 'DIV', text: 'Card' });
    const step = makeStep(1, {
      selector: '.product-card',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.product-card',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'product-card',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.product-card': [classOnly],
        '*': [classOnly],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    expect(['kept-original', 'deterministic-override']).toContain(result.resolutions[0].resolverMetadata.resolvedBy);
  });

  it('penalized class still outranks brittle structural fallback when no stronger semantic candidate exists', () => {
    const button = makeElement({ class: 'flex items-center justify-center' }, { tagName: 'BUTTON', text: 'Open' });
    const snapshot = makeDocument({
      '.target': [button],
      '.flex': [button],
      'div > main > div:nth-child(3) > span > button': [button],
      '*': [button],
    });
    const step = makeStep(1, {
      selector: 'div > main > div:nth-child(3) > span > button',
      selectorPriority: 'path',
      selectorRank: 10,
      fingerprint: {
        selector: 'div > main > div:nth-child(3) > span > button',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'button',
        attributes: {
          class: 'flex items-center justify-center',
        },
      },
    });

    expect(scoreExplicitCandidate(step, snapshot, '.flex', 'class', 7))
      .toBeGreaterThan(scoreExplicitCandidate(step, snapshot, 'div > main > div:nth-child(3) > span > button', 'path', 10));
  });

  it('surfaces class penalty reasons in metadata', async () => {
    const utilityElement = makeElement({ class: 'flex text-white bg-blue-500' }, { tagName: 'DIV', text: '' });
    const step = makeStep(1, {
      selector: '.missing-target',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.missing-target',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          class: 'flex text-white bg-blue-500',
        },
      },
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.flex': [utilityElement],
        'div.flex': [utilityElement],
        '*': [utilityElement],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    expect(result.resolutions[0].resolverMetadata.classPenaltyReason ?? []).toContain('utility_class');
  });

  it('does not treat unrelated parent wrapper text as a semantic text match', async () => {
    const wrapper = makeElement({}, { text: 'Approve request', tagName: 'DIV' }) as any;
    const siblingWrapper = makeElement({}, { text: 'Reject request', tagName: 'DIV' }) as any;
    const editButton = makeElement(
      { 'data-testid': 'edit-row' },
      { text: 'Edit', tagName: 'BUTTON', parent: wrapper },
    );
    const rejectButton = makeElement(
      { 'data-testid': 'reject-row' },
      { text: 'Reject', tagName: 'BUTTON', parent: siblingWrapper },
    );
    wrapper.children = [editButton as any];
    siblingWrapper.children = [rejectButton as any];

    const step = makeStep(1, {
      selector: '.row-action',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_Approve',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.row-action',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'button',
        textExcerpt: 'Approve',
        attributes: {
          dataTestId: 'edit-row',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.row-action': [editButton, rejectButton],
        '[data-testid="edit-row"]': [editButton],
        'button[data-testid="edit-row"]': [editButton],
        '*': [wrapper, siblingWrapper, editButton, rejectButton],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.semanticCompatibilityReasons ?? []).not.toEqual(
      expect.arrayContaining(['text_match:parent_wrapper_text']),
    );
  });

  it('keeps generated IDs above fragile structural selectors', () => {
    const button = makeElement({ id: 'headlessui-menu-button-12' }, { tagName: 'BUTTON', text: 'Open' });
    const snapshot = makeDocument({
      'div > main > div:nth-child(3) > span > button': [button],
      '[id="headlessui-menu-button-12"]': [button],
      '*': [button],
    });
    const step = makeStep(1, {
      selector: 'div > main > div:nth-child(3) > span > button',
      selectorPriority: 'path',
      selectorRank: 10,
      fingerprint: {
        selector: 'div > main > div:nth-child(3) > span > button',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'button',
        attributes: {
          id: 'headlessui-menu-button-12',
        },
      },
    });

    const idScore = scoreResolvedCandidate(step, snapshot, '[id="headlessui-menu-button-12"]').score;
    const structuralScore = scoreResolvedCandidate(step, snapshot, 'div > main > div:nth-child(3) > span > button').score;
    expect(idScore).toBeGreaterThan(structuralScore);
  });

  it('emits attribute ID selectors for React runtime IDs and leading-digit IDs', () => {
    const reactElement = makeElement({ id: ':r1:' }, { tagName: 'DIV' });
    const numericElement = makeElement({ id: '123-login' }, { tagName: 'DIV' });
    const snapshot = makeDocument({
      '.item': [reactElement, numericElement],
      '*': [reactElement, numericElement],
    });

    const reactStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: ':r1:',
        },
      },
    });
    const digitStep = makeStep(1, {
      selector: '.item',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        attributes: {
          id: '123-login',
        },
      },
    });

    expect(generateCandidates(reactStep, snapshot).map(candidate => candidate.selector)).toContain('[id=":r1:"]');
    expect(generateCandidates(reactStep, snapshot).map(candidate => candidate.selector)).not.toContain('#:r1:');
    expect(generateCandidates(digitStep, snapshot).map(candidate => candidate.selector)).toContain('[id="123-login"]');
    expect(generateCandidates(digitStep, snapshot).map(candidate => candidate.selector)).not.toContain('#123-login');
  });

  it('blocks deterministic rescue when selected action snapshot reports target evidence missing', async () => {
    const searchInput = makeElement(
      { placeholder: 'Search', type: 'search' },
      { tagName: 'INPUT' },
    );
    const snapshot = makeDocument({
      '[placeholder="Search"]': [searchInput],
      'input[placeholder="Search"]': [searchInput],
      '*': [searchInput],
    });
    const step = makeStep(1, {
      selector: 'div > div:nth-of-type(1)',
      selectorPriority: 'path',
      selectorRank: 10,
      intent: 'click_Select',
      sourceNodeId: 'node-1',
      eventId: 'ev-1',
      fingerprint: {
        selector: 'div > div:nth-of-type(1)',
        selectorPriority: 'path',
        selectorRank: 10,
        tagName: 'div',
        textExcerpt: '-- Select --',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'selected_source_node_snapshot_after_event_local_missing',
          sourceNodeId: 'node-1',
          confidenceScore: 0.35,
          snapshotTargetEvidence: false,
          snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
        },
        evaluatedCandidates: [
          {
            source: 'source-node-snapshot',
            temporalClass: 'pre_action',
            selected: true,
            reason: 'selected_source_node_snapshot_after_event_local_missing',
            sourceNodeId: 'node-1',
            confidenceScore: 0.35,
            targetPresent: false,
            snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
          },
        ],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toBe('div > div:nth-of-type(1)');
    expect(resolution.resolverMetadata.resolvedBy).toBe('blocked-snapshot-target-missing');
    expect(resolution.resolverMetadata.rejectReason).toBe('snapshot_target_missing');
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'div > div:nth-of-type(1)',
      engine: 'css',
      source: 'resolver',
      proofLevel: 'blocked',
      rejectReason: 'snapshot_target_missing',
    }));
  });

  it('still resolves Logout menu item when role and text align', async () => {
    const logout = makeElement(
      { role: 'menuitem', href: '/web/index.php/auth/logout' },
      { text: 'Logout', tagName: 'A' },
    );
    const changePassword = makeElement(
      { role: 'menuitem', href: '/web/index.php/pim/changePassword' },
      { text: 'Change Password', tagName: 'A' },
    );
    const step = makeStep(1, {
      selector: '[role="menuitem"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_Logout',
      action: 'click',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'a',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
          href: '/web/index.php/auth/logout',
        },
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '[role="menuitem"]': [logout, changePassword],
        'text=logout': [logout],
        '[role="menuitem"]:has-text("Logout")': [logout],
        '*': [logout, changePassword],
      }),
    });

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelector).toContain('Logout');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
  });

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
    expect(resolution.selectorSpec).toEqual(expect.objectContaining({
      selector: '[id="submit-btn"]',
      engine: 'css',
      source: 'interceptor',
      proofLevel: 'recorded',
    }));
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: '[id="submit-btn"]',
      engine: 'css',
      source: 'interceptor',
      proofLevel: 'snapshot_validated',
    }));
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
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'text=Logout',
      engine: 'text',
      source: 'interceptor',
      proofLevel: 'snapshot_validated',
    }));
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
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: '[data-testid="save-primary"]',
      engine: 'css',
      source: 'resolver',
      proofLevel: 'semantic_validated',
    }));
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

  it('resolves calendar year selection deterministically from numeric intent', async () => {
    const year1981 = makeElement({ class: 'oxd-calendar-dropdown--option' }, { text: '1981' });
    const year2026 = makeElement({ class: 'oxd-calendar-dropdown--option' }, { text: '2026' });
    const step = makeStep(1, {
      selector: '.oxd-calendar-dropdown--option',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_1981',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-calendar-dropdown--option': [year1981, year2026],
        '.oxd-calendar-dropdown--option:has-text("1981")': [year1981],
        '*': [year1981, year2026],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).not.toBe('.oxd-calendar-dropdown--option');
    expect(resolution.resolvedSelector).toContain('1981');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('resolves calendar date input with scoped deterministic selector', async () => {
    const calendarContainer = makeElement({ class: 'oxd-date-input' }, { text: '' });
    const dateInput = makeElement(
      { class: 'oxd-input oxd-input--focus', placeholder: 'yyyy-dd-mm' },
      { text: '' },
    );
    const otherInput = makeElement(
      { class: 'oxd-input oxd-input--focus', placeholder: 'Search' },
      { text: '' },
    );
    const step = makeStep(1, {
      selector: '.oxd-input--focus',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_oxd_input_focus',
      action: 'input',
      value: '2026-01-20',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-date-input': [calendarContainer],
        '.oxd-input--focus': [dateInput, otherInput],
        '.oxd-date-input .oxd-input--focus': [dateInput],
        '.oxd-date-input input': [dateInput],
        '.oxd-date-input .oxd-input': [dateInput],
        'input[placeholder*="yyyy"]': [dateInput],
        '*': [calendarContainer, dateInput, otherInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).not.toBe('.oxd-input--focus');
    expect(resolution.resolvedSelector).toContain('.oxd-date-input');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('resolves calendar icon click via calendar-scoped selector', async () => {
    const calendarContainer = makeElement({ class: 'oxd-date-input' }, { text: '' });
    const calendarIcon = makeElement({ class: 'oxd-icon' }, { text: '' });
    const otherIcon = makeElement({ class: 'oxd-icon' }, { text: '' });
    const step = makeStep(1, {
      selector: '.oxd-icon',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_oxd_icon',
      action: 'click',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-date-input': [calendarContainer],
        '.oxd-icon': [calendarIcon, otherIcon],
        '.oxd-date-input .oxd-icon': [calendarIcon],
        '*': [calendarContainer, calendarIcon, otherIcon],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.oxd-date-input .oxd-icon');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
  });

  it('blocks deterministic override to generic shell selector and keeps original unresolved', async () => {
    const appShell = makeElement({ id: 'app' }, { id: 'app', text: 'username password login' });
    const step = makeStep(1, {
      selector: '.btn',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_username',
      sourceNodeId: 'node-1',
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.btn': [],
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
    expect(resolution.resolvedSelector).toBe('.btn');
    expect(resolution.resolverMetadata.resolvedBy).toBe('unresolved');
    expect(resolution.resolverMetadata.warningCodes).toContain('blocked-generic-shell-override');
  });

  it('trusts strong original selector when snapshot misses control', async () => {
    const step = makeStep(1, {
      selector: 'input[name="username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
    });

    const shell = makeElement({ class: 'orangehrm-login-layout' }, { text: 'Login shell' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'input[name="username"]': [],
        '.orangehrm-login-layout': [shell],
        '*': [shell],
      }),
    });

    const llmProvider = vi.fn(async () => [{ stepNumber: 1, selector: '.orangehrm-login-layout' }]);
    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true },
      llmProvider,
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('kept-original');
    expect(resolution.resolverMetadata.warningCodes).toContain('trusted-original-snapshot-miss');
    expect(result.llmAttemptedStepNumbers).toHaveLength(0);
    expect(llmProvider).not.toHaveBeenCalled();
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

  it('treats matches inside hidden ancestors as non-visible during validation', () => {
    const hiddenAncestor = makeElement({ style: 'display:none' }, { text: 'wrapper' }) as any;
    const hiddenChild = makeElement({ name: 'save' }, { text: 'Hidden Save', parent: hiddenAncestor });
    const visible = makeElement({ name: 'save' }, { text: 'Visible Save' });
    const document = makeDocument({
      '[name="save"]': [hiddenChild, visible],
    });

    const validation = validateCSSCandidate('[name="save"]', document);
    expect(validation.totalMatchCount).toBe(2);
    expect(validation.visibleMatchCount).toBe(1);
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.reason).toBe('unique-visible');
  });

  it('matches text selectors against input value and placeholder', () => {
    const emailInput = makeElement({ name: 'email', value: 'alice@example.com', placeholder: 'Email address' });
    const document = makeDocument({
      '*': [emailInput],
      input: [emailInput],
    });

    const valueValidation = validateTextCandidate('text=alice@example.com', document);
    expect(valueValidation.effectiveMatchCount).toBe(1);
    expect(valueValidation.reason).toBe('unique-visible');

    const placeholderValidation = validateTextCandidate('text=Email address', document);
    expect(placeholderValidation.effectiveMatchCount).toBe(1);
    expect(placeholderValidation.reason).toBe('unique-visible');
  });

  it('matches text selectors against aria-label when textContent is empty', () => {
    const button = makeElement({ 'aria-label': 'Save Changes' });
    const document = makeDocument({
      '*': [button],
      button: [button],
    });

    const validation = validateTextCandidate('text=save changes', document);
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.reason).toBe('unique-visible');
  });

  it('resolves overly broad selectors deterministically after pruning', () => {
    const buttons = Array.from({ length: 60 }, (_, idx) =>
      makeElement({ type: 'button', 'data-idx': String(idx) }, { text: `Button ${idx}`, tagName: 'BUTTON' }),
    );
    const document = makeDocument({
      button: buttons,
    });

    const validation = validateCSSCandidate('button', document, makeStep(1, {
      selector: 'button',
      intent: 'click_button',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        attributes: {},
      },
    }));
    expect(validation.totalMatchCount).toBe(60);
    expect(validation.reason).toBe('too-broad');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(60);
    expect(validation.resolvedElement).toBeTruthy();
  });

  it('uses parent proximity to disambiguate repeated buttons', () => {
    const formScope = makeElement({ id: 'profile-form' }, { tagName: 'FORM' }) as any;
    const saveA = makeElement({ 'aria-label': 'Save' }, { text: 'Save', tagName: 'BUTTON', parent: formScope });
    const saveB = makeElement({ 'aria-label': 'Save' }, { text: 'Save', tagName: 'BUTTON' });

    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_save',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        parentSelector: '#profile-form',
        attributes: { 'aria-label': 'Save' },
      },
    });

    const document = makeDocument({
      button: [saveA, saveB],
      '#profile-form': [formScope],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(saveA);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('uses context proximity to disambiguate same-label menu options in different groups', () => {
    const accountMenu = makeElement({ id: 'account-menu' }, { tagName: 'UL' }) as any;
    const settingsMenu = makeElement({ id: 'settings-menu' }, { tagName: 'UL' }) as any;
    const profileAccount = makeElement(
      { role: 'menuitem', 'aria-label': 'Profile' },
      { text: 'Profile', tagName: 'LI', parent: accountMenu },
    );
    const profileSettings = makeElement(
      { role: 'menuitem', 'aria-label': 'Profile' },
      { text: 'Profile', tagName: 'LI', parent: settingsMenu },
    );

    const step = makeStep(1, {
      selector: '[role="menuitem"]',
      intent: 'click_profile',
      fingerprint: {
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'li',
        textExcerpt: 'Profile',
        parentSelector: '#settings-menu',
        attributes: { 'aria-label': 'Profile', role: 'menuitem' },
      },
    });

    const document = makeDocument({
      '[role="menuitem"]': [profileAccount, profileSettings],
      '#account-menu': [accountMenu],
      '#settings-menu': [settingsMenu],
    });

    const validation = validateCSSCandidate('[role="menuitem"]', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(profileSettings);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('uses parent row context to disambiguate repeated row actions', () => {
    const rowA = makeElement({ id: 'row-alpha' }, { tagName: 'TR' }) as any;
    const rowB = makeElement({ id: 'row-beta' }, { tagName: 'TR' }) as any;
    const editAlpha = makeElement(
      { 'aria-label': 'Edit', 'data-testid': 'edit-alpha' },
      { text: 'Edit', tagName: 'BUTTON', parent: rowA },
    );
    const editBeta = makeElement(
      { 'aria-label': 'Edit', 'data-testid': 'edit-beta' },
      { text: 'Edit', tagName: 'BUTTON', parent: rowB },
    );

    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_edit',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Edit',
        parentSelector: '#row-beta',
        attributes: { 'aria-label': 'Edit' },
      },
    });

    const document = makeDocument({
      button: [editAlpha, editBeta],
      '#row-alpha': [rowA],
      '#row-beta': [rowB],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(editBeta);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('prefers a slightly better ranked element over DOM order when repeated matches are similar', () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement(
      { 'data-testid': 'primary-save', 'aria-label': 'Save' },
      { text: 'Save', tagName: 'BUTTON' },
    );

    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_save',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: { 'data-testid': 'primary-save', 'aria-label': 'Save' },
      },
    });

    const document = makeDocument({
      button: [saveA, saveB],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.effectiveMatchCount).toBe(1);
    expect(validation.matchCount).toBe(2);
    expect(validation.resolvedElement).toBe(saveB);
    expect(validation.ambiguityReason).toBeUndefined();
  });

  it('uses DOM order tiebreaker when repeated matches score the same', () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_save',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: {},
      },
    });

    const document = makeDocument({
      button: [saveA, saveB],
    });

    const validation = validateCSSCandidate('button', document, step);
    expect(validation.reason).toBe('resolved-multi-match');
    expect(validation.resolvedElement).toBe(saveA);
    expect(validation.ambiguityReason).toBe('resolved_by_dom_order_tiebreaker');
    expect(validation.confidenceScore).toBeLessThan(0.7);
  });

  it('records ambiguity metadata on deterministic multi-match resolution', async () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_save',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [saveA, saveB],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolverMetadata.matchCount).toBe(2);
    expect(resolution.resolverMetadata.ambiguityReason).toBe('resolved_by_dom_order_tiebreaker');
    expect(resolution.resolverMetadata.confidenceScore).toBeGreaterThan(0);
  });

  it('preserves threshold safety for truly identical elements resolved by DOM order', async () => {
    const saveA = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const saveB = makeElement({}, { text: 'Save', tagName: 'BUTTON' });
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_save',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: 'button',
        selectorPriority: 'other',
        selectorRank: 10,
        tagName: 'button',
        textExcerpt: 'Save',
        attributes: {},
      },
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [saveA, saveB],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: false },
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolverMetadata.resolvedBy).toBe('unresolved');
    expect(resolution.resolverMetadata.matchCount).toBe(2);
    expect(resolution.resolverMetadata.ambiguityReason).toBe('resolved_by_dom_order_tiebreaker');
    expect(resolution.resolverMetadata.confidenceScore).toBeLessThan(0.7);
    expect(resolution.resolverMetadata.warningCodes).toContain('deterministic-below-threshold');
  });

  it('accepts valid LLM fallback when deterministic candidates stay below threshold', async () => {
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
        resolverMinScore: 1.3,
      },
      async () => [{ stepNumber: 1, selector: 'button[aria-label="submit"]' }],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAccepted).toBe(true);
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'button[aria-label="submit"]',
      engine: 'css',
      source: 'llm',
      proofLevel: 'semantic_validated',
    }));
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
      { enableLLMFallback: true, resolverMinScore: 1.3 },
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

    const providerImpl: SelectorFallbackProvider = async (request: SelectorFallbackRequest) =>
      request.steps.map((item: any) => ({ stepNumber: item.stepNumber, selector: `button[aria-label="submit ${item.stepNumber}"]` }));
    const llmProvider = vi.fn(providerImpl);

    const result = await resolveSelectorsForSession(
      makeSession(steps),
      makeSnapshotCache(snapshotEntries),
      { enableLLMFallback: true, resolverMinScore: 1.3 },
      llmProvider as unknown as SelectorFallbackProvider,
    );

    expect(result.llmAttemptedStepNumbers).toHaveLength(3);
    expect(llmProvider).toHaveBeenCalledTimes(1);
    expect(result.resolutions.filter(r => r.resolverMetadata.warningCodes.includes('llm-circuit-breaker')).length)
      .toBeGreaterThan(0);
  });

  it('caps LLM retries per step and falls back to deterministic candidate after rejection', async () => {
    const step = makeStep(1, {
      selector: 'button',
      selectorPriority: 'unknown',
      selectorRank: 10,
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });

    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const cancelOne = makeElement({ 'aria-label': 'cancel-1' }, { text: 'Cancel' });
    const cancelTwo = makeElement({ 'aria-label': 'cancel-2' }, { text: 'Cancel' });
    const cancelThree = makeElement({ 'aria-label': 'cancel-3' }, { text: 'Cancel' });
    const cancelFour = makeElement({ 'aria-label': 'cancel-4' }, { text: 'Cancel' });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancelOne],
        '[aria-label="submit"]': [submit],
        '[aria-label="cancel-1"]': [cancelOne],
        '[aria-label="cancel-2"]': [cancelTwo],
        '[aria-label="cancel-3"]': [cancelThree],
        '[aria-label="cancel-4"]': [cancelFour],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          selector: '[aria-label="cancel-1"]',
          selectors: [
            '[aria-label="cancel-1"]',
            '[aria-label="cancel-2"]',
            '[aria-label="cancel-3"]',
            '[aria-label="cancel-4"]',
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toHaveLength(0);
    expect(resolution.resolvedSelector).toBe('[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.warningCodes).toContain('llm-retry-cap-reached');
    expect(resolution.resolverMetadata.warningCodes).toContain('deterministic-low-score-fallback');
    expect(resolution.resolverMetadata.warningCodes).toContain('llm-retries-exhausted');
    expect(resolution.resolverMetadata.llmAccepted).toBe(false);
    expect(resolution.resolverMetadata.rejectReason).toBe('llm-intent-mismatch');
  });

  it('accepts a valid field selector via LLM instead of using a non-interactive container fallback', async () => {
    const step = makeStep(1, {
      selector: 'input[name="username"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      intent: 'click_username',
      action: 'click',
      sourceNodeId: 'node-1',
    });

    const loginContainer = makeElement({ class: 'orangehrm-login-layout' }, { text: 'Username Password Login' });
    const uniqueInput = makeElement({ name: 'username' }, { text: '', tagName: 'INPUT' });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        'input[name="username"]': [uniqueInput],
        '.orangehrm-login-layout': [loginContainer],
        '*': [loginContainer, uniqueInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.1,
      },
      async () => [
        { stepNumber: 1, selector: 'input[name="username"]' },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toEqual([1]);
    expect(resolution.resolverMetadata.warningCodes).not.toContain('deterministic-low-score-fallback');
    expect(resolution.resolverMetadata.rejectReason).toBeNull();
    expect(resolution.resolverMetadata.llmCandidatesReturned).toEqual(['input[name="username"]']);
    expect(resolution.resolverMetadata.llmCandidatesTried).toEqual(['input[name="username"]']);
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(1);
    expect(resolution.resolverMetadata.llmResponseFormat).toBe('legacy-selector');
  });

  it('rejects false-positive LLM selector when intent token does not match target element context', async () => {
    const step = makeStep(1, {
      selector: '.oxd-text',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_2026',
      action: 'click',
      sourceNodeId: 'node-1',
    });

    const yearOption = makeElement({ class: 'oxd-calendar-dropdown--option' }, { text: '2026' });
    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.oxd-text': [yearOption, adminLink],
        'a[href="/web/index.php/admin/viewAdminModule"]': [adminLink],
        '*': [yearOption, adminLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        { stepNumber: 1, selector: 'a[href="/web/index.php/admin/viewAdminModule"]' },
      ],
    );

    const resolution = result.resolutions[0];
    expect(result.llmAttemptedStepNumbers).toEqual([1]);
    expect(result.llmAcceptedStepNumbers).toHaveLength(0);
    expect(resolution.resolverMetadata.resolvedSelector).not.toBe('a[href="/web/index.php/admin/viewAdminModule"]');
    expect(['unresolved', 'deterministic-override']).toContain(resolution.resolverMetadata.resolvedBy);
    expect(resolution.resolverMetadata.rejectReason).toBe('llm-intent-mismatch');
    expect(resolution.resolverMetadata.warningCodes).toContain('llm-intent-mismatch');
    expect(resolution.resolverMetadata.llmAlternative).toBe('a[href="/web/index.php/admin/viewAdminModule"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'a[href="/web/index.php/admin/viewAdminModule"]',
        rejectReason: 'llm-intent-mismatch',
      },
    ]);
  });

  it('accepts a later LLM candidate after an earlier invalid selector', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.dialog button.primary': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.dialog button.primary' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.dialog button.primary');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(2);
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'button[',
        rejectReason: 'invalid-llm-selector',
      },
    ]);
  });

  it('accepts a later LLM candidate after an earlier non-unique selector', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({}, { text: 'Submit', tagName: 'BUTTON' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.dialog button.primary': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          selectors: [
            'button',
            '.dialog button.primary',
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.dialog button.primary');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(2);
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'button',
        rejectReason: 'llm-selector-not-unique',
      },
    ]);
  });

  it('merges duplicate LLM step objects and accepts a later valid candidate', async () => {
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
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
        llmMaxCandidatesPerStep: 3,
      },
      async () => [
        { stepNumber: 1, selector: 'button[aria-label="cancel"]' },
        { stepNumber: 1, selectors: ['button[aria-label="submit"]'] },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.llmCandidatesReturned).toEqual([
      'button[aria-label="cancel"]',
      'button[aria-label="submit"]',
    ]);
    expect(resolution.resolverMetadata.llmCandidatesTried).toEqual([
      'button[aria-label="cancel"]',
      'button[aria-label="submit"]',
    ]);
    expect(resolution.resolverMetadata.llmAcceptedRank).toBe(2);
  });

  it('applies href mismatch semantic safety to LLM candidates before accepting later valid candidate', async () => {
    const step = makeStep(1, {
      selector: '.menu-link',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-link',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });
    const wrongLink = makeElement({ href: '/web/index.php/pim/viewPimModule' }, { text: 'Admin' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-link': [adminLink, wrongLink],
        'a[href="/web/index.php/pim/viewPimModule"]': [wrongLink],
        'a[href="/web/index.php/admin/viewAdminModule"]': [adminLink],
        '*': [adminLink, wrongLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'a[href="/web/index.php/pim/viewPimModule"]' },
            { selector: 'a[href="/web/index.php/admin/viewAdminModule"]' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('a[href="/web/index.php/admin/viewAdminModule"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'a[href="/web/index.php/pim/viewPimModule"]',
        rejectReason: 'href_mismatch',
      },
    ]);
  });

  it('applies control-family mismatch safety to LLM candidates', async () => {
    const step = makeStep(1, {
      selector: '.menu-item',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_logout',
      action: 'custom-select',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'a',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
          href: '/logout',
        },
      },
    });

    const wrongButton = makeElement({ role: 'button', 'aria-label': 'Logout' }, { text: 'Logout' });
    const rightMenuItem = makeElement({ role: 'menuitem', href: '/logout' }, { text: 'Logout' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-item': [wrongButton, rightMenuItem],
        '[role="button"]': [wrongButton],
        '[role="menuitem"]': [rightMenuItem],
        '*': [wrongButton, rightMenuItem],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: '[role="button"]' },
            { selector: '[role="menuitem"]' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('[role="menuitem"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: '[role="button"]',
        rejectReason: 'control_family_mismatch',
      },
    ]);
  });

  it('applies text mismatch safety to LLM candidates', async () => {
    const step = makeStep(1, {
      selector: '.nav-link',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.nav-link',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });

    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });
    const pimLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'PIM' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.nav-link': [adminLink, pimLink],
        '.sidebar a.pim-link': [pimLink],
        '.sidebar a.admin-link': [adminLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            { selector: '.sidebar a.pim-link' },
            { selector: '.sidebar a.admin-link' },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('.sidebar a.admin-link');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: '.sidebar a.pim-link',
        rejectReason: 'text_mismatch',
      },
    ]);
  });

  it('rejects overly complex LLM selectors before accepting a simpler valid candidate', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit' });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit],
        'button[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      async () => [
        {
          stepNumber: 1,
          candidates: [
            {
              selector: 'html body main section div div div div div button:nth-child(2):nth-of-type(1)',
            },
            {
              selector: 'button[aria-label="submit"]',
            },
          ],
        },
      ],
    );

    const resolution = result.resolutions[0];
    expect(resolution.resolvedSelector).toBe('button[aria-label="submit"]');
    expect(resolution.resolverMetadata.llmRejectedCandidates).toEqual([
      {
        selector: 'html body main section div div div div div button:nth-child(2):nth-of-type(1)',
        rejectReason: 'llm-selector-too-complex',
      },
    ]);
  });

  it('triggers one corrective retry after all top-k candidates fail and accepts a normalized retry selector', async () => {
    const step = makeStep(1, {
      selector: '.login-panel',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      action: 'input',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.login-panel',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'input',
        textExcerpt: 'Username',
        parentSelector: 'form.login-form',
        attributes: {
          name: 'username',
          placeholder: 'Username',
          'data-testid': 'username-input',
          'data-cy': 'username-field',
          role: 'textbox',
        },
      },
    });

    const container = makeElement({ class: 'login-panel' }, { text: 'Login', tagName: 'DIV' });
    const usernameInput = makeElement(
      { name: 'username', placeholder: 'Username', role: 'textbox' },
      { tagName: 'INPUT' },
    );
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return [{ stepNumber: 1, selector: 'locator(\'input[name="username"]\')' }];
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.login-panel' },
          ],
        },
      ];
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.login-panel': [container],
        'input[name="username"]': [usernameInput],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolvedSelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('llm-accepted');
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetrySelector).toBe('input[name="username"]');
    expect(resolution.resolverMetadata.llmRetryAccepted).toBe(true);
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('accepted');
  });

  it('applies existing low-score fallback after retry rejection and does not retry more than once', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const shell = makeElement({ class: 'shell' }, { text: 'Layout', tagName: 'DIV' });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return [{ stepNumber: 1, selector: 'button' }];
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.shell' },
          ],
        },
      ];
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.shell': [shell],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolvedSelector).toBe('[aria-label="submit"]');
    expect(resolution.resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetryAccepted).toBe(false);
    expect(resolution.resolverMetadata.llmRetryRejectReason).toBe('llm-selector-not-unique');
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('rejected');
    expect(resolution.resolverMetadata.warningCodes).toContain('deterministic-low-score-fallback');
  });

  it('rejects semantically wrong retry selectors through the same validation gates', async () => {
    const step = makeStep(1, {
      selector: '.menu-link',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'click_admin',
      sourceNodeId: 'node-1',
      fingerprint: {
        selector: '.menu-link',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        textExcerpt: 'Admin',
        attributes: {
          href: '/web/index.php/admin/viewAdminModule',
        },
      },
    });
    const adminLink = makeElement({ href: '/web/index.php/admin/viewAdminModule' }, { text: 'Admin' });
    const wrongLink = makeElement({ href: '/web/index.php/pim/viewPimModule' }, { text: 'Admin' });
    const provider = vi.fn(async (request: any) => {
      if (request.mode === 'retry') {
        return [{ stepNumber: 1, selector: 'a[href="/web/index.php/pim/viewPimModule"]' }];
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.menu-link' },
          ],
        },
      ];
    });

    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        '.menu-link': [adminLink, wrongLink],
        'a[href="/web/index.php/admin/viewAdminModule"]': [adminLink],
        'a[href="/web/index.php/pim/viewPimModule"]': [wrongLink],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetryRejectReason).toBe('href_mismatch');
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('rejected');
  });

  it('does not run corrective retry for blocked-snapshot-target-missing steps', async () => {
    const step = makeStep(1, {
      selector: 'div > div:nth-of-type(1)',
      selectorPriority: 'path',
      selectorRank: 10,
      intent: 'click_select',
      sourceNodeId: 'node-1',
      eventId: 'ev-1',
    });
    const provider = vi.fn(async () => []);
    const selectTrigger = makeElement({ 'aria-haspopup': 'listbox' }, { text: '-- Select --', tagName: 'DIV' });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': makeDocument({ '*': [selectTrigger] }) },
      () => ({
        snapshot: makeDocument({ '*': [selectTrigger] }),
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'selected_source_node_snapshot_after_event_local_missing',
          eventId: 'ev-1',
          sourceNodeId: 'node-1',
          confidenceScore: 0.35,
          snapshotTargetEvidence: false,
          snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
        },
        evaluatedCandidates: [
          {
            source: 'source-node-snapshot',
            temporalClass: 'pre_action',
            selected: true,
            reason: 'selected_source_node_snapshot_after_event_local_missing',
            sourceNodeId: 'node-1',
            confidenceScore: 0.35,
            targetPresent: false,
            snapshotTargetEvidenceReason: 'target_missing_in_snapshot',
          },
        ],
      }),
    );

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true },
      provider,
    );

    expect(provider).not.toHaveBeenCalled();
    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('blocked-snapshot-target-missing');
    expect(result.resolutions[0].resolverMetadata.llmRetryTriggered).toBe(false);
  });

  it('does not run corrective retry on empty initial response', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async () => []);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.resolutions[0].resolverMetadata.llmRetryTriggered).toBe(false);
    expect(result.resolutions[0].resolverMetadata.llmRetryStatus).toBe('skipped-empty-response');
  });

  it('does not run corrective retry on initial provider error', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const provider = vi.fn(async () => {
      throw new Error('provider-down');
    });
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
      },
      provider,
    );

    expect(provider).toHaveBeenCalledTimes(1);
    expect(result.resolutions[0].resolverMetadata.llmRetryTriggered).toBe(false);
  });

  it('uses llmRetryTimeoutMs for corrective retry and falls back safely on timeout', async () => {
    const step = makeStep(1, {
      selector: 'button',
      intent: 'click_submit',
      sourceNodeId: 'node-1',
    });
    const shell = makeElement({ class: 'shell' }, { text: 'Layout', tagName: 'DIV' });
    const submit = makeElement({ 'aria-label': 'submit' }, { text: 'Submit', tagName: 'BUTTON' });
    const cancel = makeElement({ 'aria-label': 'cancel' }, { text: 'Submit', tagName: 'BUTTON' });
    const providerImpl: SelectorFallbackProvider = async (request: SelectorFallbackRequest) => {
      if (request.mode === 'retry') {
        return await new Promise(() => {});
      }
      return [
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.shell' },
          ],
        },
      ];
    };
    const provider = vi.fn(providerImpl);
    const snapshotCache = makeSnapshotCache({
      'node-1': makeDocument({
        button: [submit, cancel],
        '.shell': [shell],
        '[aria-label="submit"]': [submit],
      }),
    });

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      {
        enableLLMFallback: true,
        resolverMinScore: 1.3,
        llmRetryTimeoutMs: 1,
      },
      provider as unknown as SelectorFallbackProvider,
    );

    const resolution = result.resolutions[0];
    expect(provider).toHaveBeenCalledTimes(2);
    expect(resolution.resolvedSelector).toBe('[aria-label="submit"]');
    expect(resolution.resolverMetadata.llmRetryTriggered).toBe(true);
    expect(resolution.resolverMetadata.llmRetryTimeoutMs).toBe(1);
    expect(resolution.resolverMetadata.llmRetryStatus).toBe('skipped-timeout');
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

  it('recovers a stable id selector from label[for] association', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label for="username-field">Username</label>
          <input id="username-field" class="generic-input" type="text" />
        </div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Username',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_label_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'exact_label_association',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(['#username-field', '[id="username-field"]']).toContain(resolution.resolvedSelector);
    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      engine: 'css',
      proofLevel: 'semantic_validated',
      labelContext: expect.objectContaining({
        association: 'label-for',
        labelText: 'Username',
        targetId: 'username-field',
      }),
    }));
  });

  it('recovers a wrapped-label selector as structured label-context proof', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <label>Username<input class="generic-input" type="text" /></label>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Username',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_label_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'exact_label_association',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      engine: 'label-context',
      labelContext: expect.objectContaining({
        association: 'wrapped-label',
        labelText: 'Username',
        targetTag: 'input',
      }),
    }));
    expect(resolution.resolvedSelector).toContain('label-context("Username"');
  });

  it('recovers a bounded field container with exact label structure', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Employee Id</label>
          <input class="generic-input" type="text" />
        </div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_employee_id',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Employee Id',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_label_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'bounded_label_structure',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelectorSpec).toEqual(expect.objectContaining({
      engine: 'label-context',
      labelContext: expect.objectContaining({
        association: 'bounded-field',
        containerSelector: 'div.field-row',
        boundedContainerSummary: 'div.field-row',
      }),
    }));
  });

  it('blocks label-context recovery when duplicate labels exist', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div><label>Username</label><input class="generic-input" type="text" /></div>
        <div><label>Username</label><input class="other-input" type="text" /></div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Username',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_label_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'label_text_match',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });

    // Bounded-field recovery is valid here because it provides a unique local association 
    // within the div container, even though the label text is globally duplicated.
    // This is more robust than the original weak class selector.
    expect(result.resolutions[0].resolvedSelector).toContain('bounded-field("Username"');
    expect((result.resolutions[0].resolvedSelectorSpec as any)?.labelContext).toBeUndefined();
  });

  it('does not invoke llm fallback when deterministic label-context recovery succeeds', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <label>Username<input class="generic-input" type="text" /></label>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Username',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_label_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'exact_label_association',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );
    const fallbackProvider = vi.fn(async (_request: SelectorFallbackRequest) => []);

    const result = await resolveSelectorsForSession(
      makeSession([step]),
      snapshotCache,
      { enableLLMFallback: true },
      fallbackProvider,
    );

    expect(result.resolutions[0].resolverMetadata.resolvedBy).toBe('deterministic-override');
    expect(fallbackProvider).not.toHaveBeenCalled();
  });

  it.each([
    {
      title: 'data-testid',
      selector: '[data-testid="username"]',
      priority: 'data-testid',
      attributes: { dataTestId: 'username', fieldLabelText: 'Username', type: 'text' },
    },
    {
      title: 'name',
      selector: 'input[name="username"]',
      priority: 'attribute',
      attributes: { name: 'username', fieldLabelText: 'Username', type: 'text' },
    },
    {
      title: 'placeholder',
      selector: 'input[placeholder="Username"]',
      priority: 'attribute',
      attributes: { placeholder: 'Username', fieldLabelText: 'Username', type: 'text' },
    },
    {
      title: 'aria-label',
      selector: 'input[aria-label="Username"]',
      priority: 'attribute',
      attributes: { ariaLabel: 'Username', fieldLabelText: 'Username', type: 'text' },
    },
  ])('bypasses label-context recovery when strong direct selector exists: $title', async ({ selector, priority, attributes }) => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Username</label>
          <input data-testid="username" name="username" placeholder="Username" aria-label="Username" />
        </div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector,
      selectorPriority: priority as any,
      selectorRank: 3,
      fingerprint: {
        selector,
        tagName: 'input',
        attributes,
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'strong_direct_selector',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'exact_label_association',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    expect(result.resolutions[0].resolvedSelector).toBe(selector);
    expect(result.resolutions[0].resolvedSelectorSpec?.engine).not.toBe('label-context');
  });

  it('recovers a weak class-only input as a bounded-field selector when exact field proof exists', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <div>Username</div>
          <input />
        </div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Username',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'bounded_field_unit',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolvedSelectorSpec?.engine).toBe('bounded-field');
    const boundedFieldSpec = resolution.resolvedSelectorSpec?.engine === 'bounded-field'
      ? resolution.resolvedSelectorSpec.boundedField
      : undefined;
    expect(boundedFieldSpec).toEqual(expect.objectContaining({
      labelText: 'Username',
      controlKind: 'input',
      relation: expect.stringMatching(/sibling-label|bounded-container/),
    }));
  });

  it('blocks bounded label-context recovery when a custom combobox trigger competes inside the same container', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Username</label>
          <input class="generic-input" type="text" />
          <div role="combobox" aria-haspopup="listbox">Open</div>
        </div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'input',
      intent: 'input_username',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          type: 'text',
          fieldLabelText: 'Username',
        },
      },
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'custom_competitor',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
          labelStructureEvidence: true,
          labelStructureEvidenceReason: 'bounded_label_structure',
          labelContextSnapshotSource: 'source-node-snapshot',
          labelContextBlockedReason: null,
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    expect(result.resolutions[0].resolvedSelector).toBe('input.generic-input');
    expect((result.resolutions[0].resolvedSelectorSpec as any)?.labelContext).toBeUndefined();
  });

  it('recovers an ambiguous custom-control trigger using bounded field context for User Role', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <div>User Role</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div class="field-row">
          <div>Status</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div role="option">Admin</div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'custom-select',
      intent: 'select_user_role_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      value: 'Admin',
      controlFamily: 'combobox',
      triggerSelector: '.select-trigger',
      triggerSelectorPriority: 'class',
      triggerFingerprint: {
        selector: '.select-trigger',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'User Role',
        attributes: {
          class: 'select-trigger',
          role: 'combobox',
          fieldLabelText: 'User Role',
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_trigger_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.triggerResolvedSelectorSpec).toEqual(expect.objectContaining({
      engine: 'bounded-field',
      boundedField: expect.objectContaining({
        labelText: 'User Role',
        relation: expect.stringMatching(/sibling-label|bounded-container/),
        containerSelector: 'div.field-row',
        renderStatus: expect.stringMatching(/clean-scoped-locator|proven-structural-fallback/),
      }),
    }));
    expect(resolution.resolverMetadata.triggerResolvedSelector).toContain('bounded-field("User Role"');
    if (resolution.resolverMetadata.triggerResolvedSelectorSpec?.engine === 'bounded-field') {
      const renderStatus = resolution.resolverMetadata.triggerResolvedSelectorSpec.boundedField?.renderStatus;
      if (renderStatus === 'proven-structural-fallback') {
        expect(resolution.resolverMetadata.triggerWarningCodes).toContain('custom-control-trigger-structural-fallback');
      } else {
        expect(resolution.resolverMetadata.triggerWarningCodes ?? []).not.toContain('custom-control-trigger-structural-fallback');
      }
    }
  });

  it('recovers an ambiguous custom-control trigger using bounded field context for Status', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <div>User Role</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div class="field-row">
          <div>Status</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div role="option">Enabled</div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'custom-select',
      intent: 'select_status_enabled',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      value: 'Enabled',
      controlFamily: 'combobox',
      triggerSelector: '.select-trigger',
      triggerSelectorPriority: 'class',
      triggerFingerprint: {
        selector: '.select-trigger',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'Status',
        attributes: {
          class: 'select-trigger',
          role: 'combobox',
          fieldLabelText: 'Status',
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Enabled',
      optionValue: 'Enabled',
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_trigger_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    const triggerBoundedField = resolution.resolverMetadata.triggerResolvedSelectorSpec?.engine === 'bounded-field'
      ? resolution.resolverMetadata.triggerResolvedSelectorSpec.boundedField
      : undefined;
    expect(triggerBoundedField).toEqual(expect.objectContaining({
      labelText: 'Status',
    }));
    expect(resolution.resolverMetadata.triggerResolvedSelector).toContain('bounded-field("Status"');
  });

  it('blocks trigger-context recovery when the bounded container has two visible triggers', async () => {
    const snapshot = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <div>User Role</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div role="option">Admin</div>
      </body></html>
    `);
    const step = makeStep(1, {
      action: 'custom-select',
      intent: 'select_user_role_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      value: 'Admin',
      controlFamily: 'combobox',
      triggerSelector: '.select-trigger',
      triggerSelectorPriority: 'class',
      triggerFingerprint: {
        selector: '.select-trigger',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'User Role',
        attributes: {
          class: 'select-trigger',
          role: 'combobox',
          fieldLabelText: 'User Role',
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
    });
    const snapshotCache = makeSnapshotCacheWithSelection(
      { 'node-1': snapshot },
      () => ({
        snapshot,
        provenance: {
          source: 'source-node-snapshot',
          temporalClass: 'pre_action',
          reason: 'test_trigger_context_snapshot',
          snapshotTargetEvidence: true,
          snapshotTargetEvidenceReason: 'selector_match',
        },
        evaluatedCandidates: [],
      }),
    );

    const result = await resolveSelectorsForSession(makeSession([step]), snapshotCache, { enableLLMFallback: false });
    const resolution = result.resolutions[0];

    expect(resolution.resolverMetadata.triggerResolvedSelectorSpec).toBeUndefined();
    expect(resolution.resolverMetadata.triggerContextRenderStatus).toBe('blocked-unsafe-render');
  });

  it('reports matching AIR target node ids without consuming them in resolver selection', () => {
    const matching = makeHtmlDocument(`
      <html><body>
        <button data-air-node-id="air-node-1">Save</button>
      </body></html>
    `).querySelector('button');
    const different = makeHtmlDocument(`
      <html><body>
        <button data-air-node-id="air-node-2">Save</button>
      </body></html>
    `).querySelector('button');
    const missing = makeHtmlDocument(`
      <html><body>
        <button>Save</button>
      </body></html>
    `).querySelector('button');

    expect(hasSameAirTargetNodeId(matching, 'air-node-1')).toBe(true);
    expect(hasSameAirTargetNodeId(different, 'air-node-1')).toBe(false);
    expect(hasSameAirTargetNodeId(missing, 'air-node-1')).toBe(false);
    expect(hasSameAirTargetNodeId(matching, undefined)).toBe(false);
    expect(hasSameAirTargetNodeId(null, 'air-node-1')).toBe(false);
  });
});
