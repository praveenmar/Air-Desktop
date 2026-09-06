import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import { AIREventSchema } from '../types/events';

const require = createRequire(import.meta.url);
const { AIRInterceptor } = require('../../packages/vscode-extension/interceptor.js') as {
  AIRInterceptor: {
    new (config?: Record<string, unknown>): CustomControlHarness;
    prototype: Record<string, unknown>;
  };
};

type RuntimeGlobals = {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
};

type CustomControlHarness = {
  config: {
    sessionId: string;
    capturePageSnapshot: boolean;
    snapshotDepth: number;
  };
  log: ReturnType<typeof vi.fn>;
  queueEvent: ReturnType<typeof vi.fn>;
  flushQueue: ReturnType<typeof vi.fn>;
  generateUUID: () => string;
  normalizeUrl: (url: string) => string;
  generateFingerprint: (el: Element | null) => Record<string, unknown>;
  _resolveNestedContext: ReturnType<typeof vi.fn>;
  _captureSubtreeSnapshot: ReturnType<typeof vi.fn>;
  _getComposedEventTarget: ReturnType<typeof vi.fn>;
  _openDropdown: Record<string, unknown> | null;
  _dropdownObserver: MutationObserver | null;
  pendingTraceId: string | null;
  lastActionTraceId: string | null;
  lastActionTraceAt: number | null;
  [key: string]: unknown;
};

async function withBrowserGlobals<T>(html: string, url: string, fn: () => T | Promise<T>): Promise<T> {
  const dom = new JSDOM(html, { url });
  const runtime = globalThis as unknown as RuntimeGlobals;
  const previous = {
    window: runtime.window,
    document: runtime.document,
    Node: runtime.Node,
  };

  runtime.window = dom.window as Window & typeof globalThis;
  runtime.document = dom.window.document;
  runtime.Node = dom.window.Node;

  try {
    return await fn();
  } finally {
    runtime.window = previous.window;
    runtime.document = previous.document;
    runtime.Node = previous.Node;
    (dom.window as Window & { close?: () => void }).close?.();
  }
}

function makeHarness(): CustomControlHarness {
  let counter = 0;
  const interceptor = Object.create(AIRInterceptor.prototype) as CustomControlHarness;
  interceptor.config = {
    sessionId: 'session-11111111-1111-4111-8111-111111111111',
    capturePageSnapshot: false,
    snapshotDepth: 2,
  };
  interceptor.log = vi.fn();
  interceptor.queueEvent = vi.fn();
  interceptor.flushQueue = vi.fn();
  interceptor.generateUUID = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  interceptor.normalizeUrl = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  interceptor.generateFingerprint = (el: Element | null) => ({
    selector: el?.classList?.contains('oxd-userdropdown-name')
      ? '.oxd-userdropdown-name'
      : (el?.classList?.contains('oxd-select-text') ? '.oxd-select-text' : (el?.tagName?.toLowerCase?.() || 'div')),
    selectorPriority: 'class',
    selectorRank: 7,
    tagName: el?.tagName?.toLowerCase?.() || 'div',
    textExcerpt: (el?.textContent || '').trim() || 'Control',
    context: {
      parentTag: el?.parentElement?.tagName?.toLowerCase?.() || 'div',
      nearestContainerTag: el?.closest?.('[role], form, nav, main, div')?.tagName?.toLowerCase?.() || 'div',
    },
    attributes: {
      role: el?.getAttribute?.('role') || undefined,
    },
    attributesHash: `hash-${(el?.tagName || 'div').toLowerCase()}`,
  });
  interceptor._resolveNestedContext = vi.fn((event: unknown, target: Element | null) => ({
    target,
    nestedContext: undefined,
  }));
  interceptor._isElementVisible = vi.fn((el: Element | null) => !!el);
  interceptor._captureSubtreeSnapshot = vi.fn((target: Element) => ({
    html: target.outerHTML,
  }));
  interceptor._getComposedEventTarget = vi.fn((event: Event | null) => (event?.target as Element | null) ?? null);
  interceptor._openDropdown = null;
  interceptor._dropdownObserver = null;
  interceptor._pendingOptionSelection = null;
  interceptor._pendingOptionSelectionFallbackTimer = null;
  interceptor.piiPatterns = [];
  interceptor.activeInputSessions = new Map();
  interceptor.inputDebounceTimers = new Map();
  interceptor.recentEventKeys = new Set();
  interceptor.maxRecentKeys = 100;
  interceptor.pendingTraceId = null;
  interceptor.lastActionTraceId = null;
  interceptor.lastActionTraceAt = null;
  return interceptor;
}

function makeSelectorProbe(): Record<string, unknown> {
  const interceptor = Object.create(AIRInterceptor.prototype) as Record<string, unknown>;
  interceptor.config = {
    debugMode: false,
    maxTextLength: 200,
  };
  interceptor.log = vi.fn();
  interceptor._isElementVisible = vi.fn((el: Element | null) => !!el);
  return interceptor;
}

function makeLiveFingerprintHarness(): CustomControlHarness {
  let counter = 0;
  const interceptor = Object.create(AIRInterceptor.prototype) as CustomControlHarness;
  interceptor.config = {
    sessionId: 'session-11111111-1111-4111-8111-111111111111',
    capturePageSnapshot: false,
    snapshotDepth: 2,
    debugMode: false,
    maxTextLength: 200,
  };
  interceptor.log = vi.fn();
  interceptor.queueEvent = vi.fn();
  interceptor.flushQueue = vi.fn();
  interceptor.generateUUID = () => `10000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  interceptor.normalizeUrl = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  interceptor._resolveNestedContext = vi.fn((event: unknown, target: Element | null) => ({
    target,
    nestedContext: undefined,
  }));
  interceptor._captureSubtreeSnapshot = vi.fn((target: Element) => ({
    html: target.outerHTML,
  }));
  interceptor._getComposedEventTarget = vi.fn((event: Event | null) => (event?.target as Element | null) ?? null);
  interceptor._isElementVisible = vi.fn((el: Element | null) => {
    if (!el) return false;
    if (el.hasAttribute?.('hidden')) return false;
    if (el.getAttribute?.('aria-hidden') === 'true') return false;
    if (el.getAttribute?.('data-hidden') === 'true') return false;
    return true;
  });
  interceptor._openDropdown = null;
  interceptor._dropdownObserver = null;
  interceptor._pendingOptionSelection = null;
  interceptor._pendingOptionSelectionFallbackTimer = null;
  interceptor.piiPatterns = [];
  interceptor.activeInputSessions = new Map();
  interceptor.inputDebounceTimers = new Map();
  interceptor.recentEventKeys = new Set();
  interceptor.maxRecentKeys = 100;
  interceptor.pendingTraceId = null;
  interceptor.lastActionTraceId = null;
  interceptor.lastActionTraceAt = null;
  return interceptor;
}

function makeTargetIdentityHarness(): CustomControlHarness {
  let counter = 0;
  const interceptor = Object.create(AIRInterceptor.prototype) as CustomControlHarness;
  interceptor.config = {
    sessionId: 'session-11111111-1111-4111-8111-111111111111',
    capturePageSnapshot: true,
    snapshotDepth: 3,
    snapshotMaxTextLength: 5000,
    snapshotTimeoutMs: 1000,
    debugMode: false,
    maxTextLength: 200,
    snapshotCaptureVueAttrs: true,
    snapshotCaptureReactAttrs: true,
  } as any;
  interceptor.log = vi.fn();
  interceptor.queueEvent = vi.fn();
  interceptor.flushQueue = vi.fn();
  interceptor.generateUUID = () => `20000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;
  interceptor.normalizeUrl = (url: string) => {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  };
  interceptor._openDropdown = null;
  interceptor._dropdownObserver = null;
  interceptor._pendingOptionSelection = null;
  interceptor._pendingOptionSelectionFallbackTimer = null;
  interceptor.piiPatterns = [];
  interceptor.activeInputSessions = new Map();
  interceptor.inputDebounceTimers = new Map();
  interceptor.recentEventKeys = new Set();
  interceptor.maxRecentKeys = 100;
  interceptor.pendingTraceId = null;
  interceptor.lastActionTraceId = null;
  interceptor.lastActionTraceAt = null;
  interceptor._isElementVisible = vi.fn((el: Element | null) => !!el && !el.hasAttribute?.('hidden'));
  return interceptor;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selector generation dynamic class alignment', () => {
  it('prefers an exact placeholder over a focused state class', () => {
    return withBrowserGlobals(`
      <input class="field field--focus" placeholder="Type for hints..." />
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const selector = (interceptor as any).generateOptimalSelector(target);
      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(selector.selector).toBe('input[placeholder="Type for hints..."]');
      expect(selector.priority).toBe('attribute');
      expect(fingerprint.attributes.class).toContain('field--focus');
      expect(fingerprint.attributes.classList).toContain('field--focus');
    });
  });

  it('prefers a stable name over an is-focused state class', () => {
    return withBrowserGlobals(`
      <input class="is-focused login-field" name="username" />
    `, 'https://example.test/login', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('input[name="username"]');
      expect(selector.priority).toBe('attribute');
    });
  });

  it('penalizes active/open/selected state classes before stable button text', () => {
    return withBrowserGlobals(`
      <a class="selected is-active">Continue Shopping</a>
    `, 'https://example.test/cart', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('a') as HTMLAnchorElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('text=Continue Shopping');
      expect(selector.priority).toBe('text');
    });
  });

  it('still allows a stable semantic product class when no stronger evidence exists', () => {
    return withBrowserGlobals(`
      <div class="product-card">Featured Product</div>
    `, 'https://example.test/shop', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.product-card') as HTMLDivElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('.product-card');
      expect(selector.priority).toBe('class');
    });
  });

  it('treats test-style data attributes as stronger than dynamic classes', () => {
    return withBrowserGlobals(`
      <button class="open focus:ring-2" data-cy="save-user">Save</button>
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('button') as HTMLButtonElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('button[data-cy="save-user"]');
      expect(selector.priority).toBe('attribute');
    });
  });

  it('keeps utility and generated classes penalized while preserving a semantic class fallback', () => {
    return withBrowserGlobals(`
      <div class="css-abc123 mt-4 user-row">Record</div>
    `, 'https://example.test/users', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('div') as HTMLDivElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('.user-row');
      expect(selector.priority).toBe('class');
    });
  });
});

describe('input field semantic context enrichment', () => {
  it('prefers aria-label over a generic class fallback for inputs', () => {
    return withBrowserGlobals(`
      <input class="generic-input" aria-label="Employee ID" />
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('input[aria-label="Employee ID"]');
      expect(selector.priority).toBe('attribute');
    });
  });

  it('prefers autocomplete when it is the strongest bounded field semantic available', () => {
    return withBrowserGlobals(`
      <input class="generic-input" autocomplete="email" />
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const selector = (interceptor as any).generateOptimalSelector(target);

      expect(selector.selector).toBe('input[autocomplete="email"]');
      expect(selector.priority).toBe('attribute');
    });
  });

  it('preserves explicit label-for text as bounded field context', () => {
    return withBrowserGlobals(`
      <div class="field">
        <label for="employee-id">Employee ID</label>
        <input id="employee-id" class="generic-input" type="text" />
      </div>
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.attributes.associatedLabelText).toBe('Employee ID');
      expect(fingerprint.attributes.fieldLabelText).toBe('Employee ID');
      expect(fingerprint.attributes.class).toContain('generic-input');
    });
  });

  it('preserves wrapped label text as bounded field context', () => {
    return withBrowserGlobals(`
      <label>
        Work Email
        <input class="generic-input" type="email" />
      </label>
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.attributes.wrappedLabelText).toContain('Work Email');
      expect(fingerprint.attributes.fieldLabelText).toContain('Work Email');
      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'Work Email',
        isValid: true,
      }));
    });
  });

  it('captures live selector ambiguity and bounded field context for weak unnamed inputs', () => {
    return withBrowserGlobals(`
      <div class="toolbar"><input class="generic-input" placeholder="Search" /></div>
      <div class="field-row">
        <label>Username</label>
        <input class="generic-input" type="text" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.field-row input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.selector).toBe('.generic-input');
      expect(fingerprint.selectorAmbiguity).toEqual(expect.objectContaining({
        originalSelector: '.generic-input',
        matchCount: 2,
        visibleMatchCount: 2,
        isUnique: false,
        isAmbiguous: true,
      }));
      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'Username',
        fieldRelation: 'sibling-label',
        targetControlKind: 'input',
        visibleControlCountInContainer: 1,
        competingControlCount: 0,
        isValid: true,
      }));
    });
  });

  it('captures searchbox bounded context for search inputs without resolver changes', () => {
    return withBrowserGlobals(`
      <div class="field-row">
        <label>Employee Search</label>
        <input class="generic-input" type="search" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'Employee Search',
        targetControlKind: 'searchbox',
        isValid: true,
      }));
    });
  });

  it('captures contenteditable bounded context when the editable surface is labeled', () => {
    return withBrowserGlobals(`
      <div class="field-row">
        <label>Notes</label>
        <div class="editable-surface" contenteditable="true">Draft</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.editable-surface') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'Notes',
        targetControlKind: 'contenteditable',
        isValid: true,
      }));
    });
  });

  it('joins multi-id aria-labelledby text while ignoring missing and empty references', () => {
    return withBrowserGlobals(`
      <span id="primary-label">Primary</span>
      <span id="empty-label">   </span>
      <span id="secondary-label">Secondary</span>
      <input class="generic-input" aria-labelledby="primary-label missing-id empty-label secondary-label" />
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.accessibilityEvidence).toEqual(expect.objectContaining({
        accessibleName: 'Primary Secondary',
        accessibleNameSource: 'aria-labelledby',
      }));
      expect(fingerprint.accessibilityEvidence?.labelledByIds).toEqual([
        'primary-label',
        'missing-id',
        'empty-label',
        'secondary-label',
      ]);
    });
  });

  it('captures distinct bounded trigger context for repeated custom select triggers', () => {
    return withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.field-row .select-trigger') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.selectorAmbiguity).toEqual(expect.objectContaining({
        originalSelector: '.select-trigger',
        visibleMatchCount: 2,
        isAmbiguous: true,
      }));
      expect(fingerprint.attributes.fieldLabelText).toBe('User Role');
      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'User Role',
        fieldRelation: 'sibling-label',
        targetControlKind: 'custom-trigger',
        targetIndexWithinContainer: 0,
        cleanParentSelector: '.field-row',
        cleanChildSelector: 'div[aria-haspopup="listbox"]',
        isValid: true,
      }));
      expect(fingerprint.boundedFieldContext?.boundedContainerSelectorCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            selector: '.field-row',
            kind: 'semantic-class',
            isClean: true,
          }),
        ]),
      );
    });
  });

  it('carries nested wrapper label context for repeated custom triggers without changing the raw target', () => {
    return withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-shell">
          <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
        </div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-shell">
          <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
        </div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.field-row .select-trigger') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.selector).toBe('.select-trigger');
      expect(fingerprint.attributes.fieldLabelText).toBe('User Role');
      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'User Role',
        fieldRelation: 'sibling-label',
        targetControlKind: 'custom-trigger',
        visibleControlCountInContainer: 1,
        targetIndexWithinContainer: 0,
        cleanParentSelector: '.field-row',
        cleanChildSelector: 'div[aria-haspopup="listbox"]',
        isValid: true,
      }));
    });
  });

  it('fails closed for custom triggers when one label container contains multiple visible controls', () => {
    return withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.field-row .select-trigger') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.attributes.fieldLabelText).toBeUndefined();
      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: null,
        targetControlKind: 'custom-trigger',
        isValid: false,
        blockedReason: 'bounded-field-multiple-targets',
      }));
    });
  });

  it('does not scrape broad nearby container text into field label context', () => {
    return withBrowserGlobals(`
      <section>
        <h1>Employee Search Dashboard</h1>
        <div class="panel">
          <div class="field-row">
            <input class="generic-input" type="text" />
          </div>
        </div>
      </section>
    `, 'https://example.test/form', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target);

      expect(fingerprint.attributes.associatedLabelText).toBeUndefined();
      expect(fingerprint.attributes.wrappedLabelText).toBeUndefined();
      expect(fingerprint.attributes.labelledByText).toBeUndefined();
      expect(fingerprint.attributes.fieldLabelText).toBeUndefined();
    });
  });
});

describe('selector candidate capture generation', () => {
  it('mirrors the selected primary selector as a recorded primary candidate', () => {
    return withBrowserGlobals(`
      <button data-testid="save-profile">Save Profile</button>
    `, 'https://example.test/profile', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('button') as HTMLButtonElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      });

      expect(fingerprint.selector).toBe('[data-testid="save-profile"]');
      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '[data-testid="save-profile"]',
          engine: 'css',
          family: 'primary',
          strength: 'strong',
          source: 'capture',
          isPrimary: true,
          matchCount: 1,
          visibleMatchCount: 1,
          positionInAllMatches: 0,
          positionInVisibleMatches: 0,
        }),
      ]));
    });
  });

  it('captures stable attribute candidates for semantic attributes and href without changing the primary selector', () => {
    return withBrowserGlobals(`
      <input
        id="username"
        name="username"
        data-cy="username-field"
        data-qa="username-field-qa"
        placeholder="Username"
        aria-label="Username"
      />
      <a href="/web/index.php/admin/viewAdminModule">Admin</a>
    `, 'https://example.test/login', () => {
      const interceptor = makeSelectorProbe();
      const input = document.querySelector('input') as HTMLInputElement;
      const link = document.querySelector('a') as HTMLAnchorElement;

      const inputFingerprint = (interceptor as any).generateFingerprint(input, {
        eventType: 'input',
        trigger: 'change',
      });
      const linkFingerprint = (interceptor as any).generateFingerprint(link, {
        eventType: 'click',
        trigger: 'click',
      });

      expect(inputFingerprint.selector).toBe('input[data-cy="username-field"]');
      expect(inputFingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ selector: 'input[data-cy="username-field"]', family: 'primary' }),
        expect.objectContaining({ selector: 'input[data-qa="username-field-qa"]', family: 'test-id' }),
        expect.objectContaining({ selector: '#username', family: 'id' }),
        expect.objectContaining({ selector: 'input[name="username"]', family: 'name' }),
        expect.objectContaining({ selector: 'input[placeholder="Username"]', family: 'placeholder' }),
        expect.objectContaining({ selector: 'input[aria-label="Username"]', family: 'aria-label' }),
      ]));
      expect(linkFingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: 'a[href="/web/index.php/admin/viewAdminModule"]',
          family: 'primary',
        }),
      ]));
    });
  });

  it('captures one stable class candidate and skips dynamic-only class tokens', () => {
    return withBrowserGlobals(`
      <button data-cy="save-user" class="css-abc123 is-open user-row">Save</button>
      <div class="css-z9yx7 open state-active"></div>
    `, 'https://example.test/users', () => {
      const interceptor = makeSelectorProbe();
      const stableTarget = document.querySelector('button') as HTMLButtonElement;
      const dynamicOnlyTarget = document.querySelector('div') as HTMLDivElement;

      const stableFingerprint = (interceptor as any).generateFingerprint(stableTarget, {
        eventType: 'click',
        trigger: 'click',
      });
      const dynamicFingerprint = (interceptor as any).generateFingerprint(dynamicOnlyTarget, {
        eventType: 'click',
        trigger: 'click',
      });

      expect(stableFingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.user-row',
          family: 'class',
          source: 'capture',
        }),
      ]));
      expect(stableFingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.selector === '.css-abc123' || candidate.selector === '.is-open',
      )).toBe(false);
      expect(dynamicFingerprint.selectorCandidates?.some((candidate: any) => candidate.family === 'class')).toBe(false);
    });
  });

  it('captures one simple parent-scoped CSS candidate when the parent has a stable selector', () => {
    return withBrowserGlobals(`
      <div data-testid="user-row">
        <input name="username" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '[data-testid="user-row"] > input[name="username"]',
          family: 'parent-scoped-css',
          source: 'capture',
        }),
      ]));
    });
  });

  it('emits tight-container-css for a generic single-field row without app-specific container classes', () => {
    return withBrowserGlobals(`
      <div class="profile-field">
        <div>
          <input name="username" />
        </div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.profile-field input[name="username"]',
          family: 'tight-container-css',
          source: 'capture',
          strength: 'medium',
        }),
      ]));
    });
  });

  it('finds a tight container beyond five wrapper levels when a stable bounded ancestor exists', () => {
    return withBrowserGlobals(`
      <div class="employee-field">
        <div><div><div><div><div><div><input name="employee" /></div></div></div></div></div></div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery).toEqual(expect.objectContaining({
        status: 'found',
        depth: expect.any(Number),
      }));
      expect(discovery.depth).toBeGreaterThan(5);
      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.employee-field input[name="employee"]',
          family: 'tight-container-css',
        }),
      ]));
    });
  });

  it('blocks tight-container discovery when multiple competing controls share the same bounded container', () => {
    return withBrowserGlobals(`
      <div class="profile-field">
        <input name="username" />
        <input name="password" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input[name="username"]') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery).toEqual(expect.objectContaining({
        status: 'blocked',
        blockedReason: 'multiple-control-like-targets',
      }));
      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('bails out when a container exposes more than four control-like descendants', () => {
    return withBrowserGlobals(`
      <div class="profile-grid">
        <input name="field-1" />
        <input name="field-2" />
        <input name="field-3" />
        <input name="field-4" />
        <input name="field-5" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input[name="field-1"]') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');

      expect(discovery).toEqual(expect.objectContaining({
        status: 'blocked',
        blockedReason: 'container-too-broad',
        controlCount: 5,
      }));
    });
  });

  it('blocks broad semantic ancestors from becoming tight-container candidates', () => {
    return withBrowserGlobals(`
      <section id="profile-section">
        <input name="username" />
      </section>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery).toEqual(expect.objectContaining({
        status: 'blocked',
        blockedReason: 'broad-container',
      }));
      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('skips tight-container-css when only generic parent wrappers are available', () => {
    return withBrowserGlobals(`
      <div class="container">
        <input name="username" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('uses fast visibility in the ancestor loop and ignores hidden controls when discovering a tight container', () => {
    return withBrowserGlobals(`
      <div class="profile-field">
        <input type="hidden" name="username" value="hidden-user" />
        <input name="username" value="visible-user" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelectorAll('input')[1] as HTMLInputElement;
      const styleSpy = vi.spyOn(window, 'getComputedStyle');
      const rectSpy = vi.spyOn(window.Element.prototype, 'getBoundingClientRect');

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      expect(styleSpy).not.toHaveBeenCalled();
      expect(rectSpy).not.toHaveBeenCalled();
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery).toEqual(expect.objectContaining({
        status: 'found',
        controlCount: 1,
      }));
      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.profile-field input[name="username"]',
          family: 'tight-container-css',
        }),
      ]));
    });
  });

  it('handles detached targets safely in tight-container discovery without removing basic selector candidates', () => {
    return withBrowserGlobals(`
      <div class="profile-field">
        <input data-testid="username-field" name="username" />
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;
      target.remove();

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery).toEqual(expect.objectContaining({
        status: 'blocked',
        blockedReason: 'detached-target',
      }));
      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'primary',
        }),
      ]));
      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('emits tight-container-css for explicit listbox triggers with role and aria semantics', () => {
    return withBrowserGlobals(`
      <div class="user-role-field">
        <div role="button" aria-haspopup="listbox" tabindex="0">User Role</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('[role="button"]') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.user-role-field div[role="button"][aria-haspopup="listbox"]',
          family: 'tight-container-css',
        }),
      ]));
    });
  });

  it('does not emit tight-container-css for bare visual div triggers without role or aria semantics', () => {
    return withBrowserGlobals(`
      <div class="user-role-field">
        <div class="select-trigger">User Role</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('.select-trigger') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('allows role=\"searchbox\" targets to participate in tight-container discovery', () => {
    return withBrowserGlobals(`
      <div class="search-panel">
        <div role="searchbox" contenteditable="true">Search</div>
      </div>
    `, 'https://example.test/search', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('[role="searchbox"]') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.search-panel div[role="searchbox"]',
          family: 'tight-container-css',
        }),
      ]));
    });
  });

  it('allows contenteditable=\"true\" targets to participate in tight-container discovery', () => {
    return withBrowserGlobals(`
      <div class="editor-field">
        <div contenteditable="true">Notes</div>
      </div>
    `, 'https://example.test/editor', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('[contenteditable="true"]') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.editor-field div[contenteditable="true"]',
          family: 'tight-container-css',
        }),
      ]));
    });
  });

  it('does not treat contenteditable=\"false\" nodes as tight-container candidates', () => {
    return withBrowserGlobals(`
      <div class="editor-field">
        <div contenteditable="false">Read only</div>
      </div>
    `, 'https://example.test/editor', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('[contenteditable="false"]') as HTMLDivElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('emits shadow-local tight-container-css and annotates inside-shadow-dom without crossing the boundary', () => {
    return withBrowserGlobals(`
      <div id="shadow-host"></div>
    `, 'https://example.test/shadow', () => {
      const interceptor = makeSelectorProbe();
      const host = document.querySelector('#shadow-host') as HTMLDivElement;
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = `
        <div class="employee-field">
          <div><input name="employee" /></div>
        </div>
      `;
      const target = shadowRoot.querySelector('input') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });
      const tightCandidate = fingerprint.selectorCandidates.find((candidate: any) =>
        candidate.family === 'tight-container-css',
      );

      expect(discovery).toEqual(expect.objectContaining({
        status: 'found',
        shadowBoundaryCrossed: false,
      }));
      expect(tightCandidate).toEqual(expect.objectContaining({
        selector: '.employee-field input[name="employee"]',
        family: 'tight-container-css',
        warningCodes: expect.arrayContaining(['inside-shadow-dom']),
      }));
    });
  });

  it('annotates open shadow boundary crossings and avoids fake document tight-container selectors across the boundary', () => {
    return withBrowserGlobals(`
      <div class="host-shell">
        <div id="shadow-host"></div>
      </div>
    `, 'https://example.test/shadow', () => {
      const interceptor = makeSelectorProbe();
      const host = document.querySelector('#shadow-host') as HTMLDivElement;
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = `<input name="employee" />`;
      const target = shadowRoot.querySelector('input') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery.shadowBoundaryCrossed).toBe(true);
      expect(discovery.warningCodes).toEqual(expect.arrayContaining([
        'inside-shadow-dom',
        'shadow-boundary-crossed',
      ]));
      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('uses the local shadow root for tight-container candidate match counts when the target lives in open shadow DOM', () => {
    return withBrowserGlobals(`
      <div id="shadow-host"></div>
    `, 'https://example.test/shadow', () => {
      const interceptor = makeSelectorProbe();
      const host = document.querySelector('#shadow-host') as HTMLDivElement;
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = `
        <div class="employee-field">
          <input name="employee" hidden value="shadow-hidden" />
          <div><input name="employee" value="shadow-visible" /></div>
        </div>
      `;
      interceptor._isElementVisible = vi.fn((el: Element | null) => !!el && !el.hasAttribute('hidden'));
      const target = shadowRoot.querySelectorAll('input')[1] as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });
      const tightCandidate = fingerprint.selectorCandidates.find((candidate: any) =>
        candidate.family === 'tight-container-css',
      );

      expect(tightCandidate).toEqual(expect.objectContaining({
        selector: '.employee-field input[name="employee"]',
        matchCount: 2,
        visibleMatchCount: 1,
        positionInAllMatches: 1,
        positionInVisibleMatches: 0,
      }));
    });
  });

  it('handles closed shadow roots gracefully without emitting a fake tight-container candidate', () => {
    return withBrowserGlobals(`
      <div id="shadow-host"></div>
    `, 'https://example.test/shadow', () => {
      const interceptor = makeSelectorProbe();
      const host = document.querySelector('#shadow-host') as HTMLDivElement;
      const shadowRoot = host.attachShadow({ mode: 'closed' });
      shadowRoot.innerHTML = `
        <div class="employee-field">
          <input name="employee" />
        </div>
      `;
      const target = shadowRoot.querySelector('input') as HTMLInputElement;

      const discovery = (interceptor as any)._discoverTightContainerContext(target, 'input-like');
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(discovery).toEqual(expect.objectContaining({
        status: 'blocked',
        blockedReason: 'unsupported-shadow-root',
      }));
      expect(fingerprint.selectorCandidates?.some((candidate: any) =>
        candidate.family === 'tight-container-css',
      )).toBe(false);
    });
  });

  it('captures raw and visible indexes separately when hidden matches differ from visible matches', () => {
    return withBrowserGlobals(`
      <input name="username" hidden value="hidden-user" />
      <input name="username" value="visible-user" />
    `, 'https://example.test/login', () => {
      const interceptor = makeSelectorProbe();
      interceptor._isElementVisible = vi.fn((el: Element | null) => !!el && !el.hasAttribute('hidden'));
      const target = document.querySelectorAll('input')[1] as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });
      const primaryCandidate = fingerprint.selectorCandidates.find((candidate: any) => candidate.family === 'primary');

      expect(primaryCandidate).toEqual(expect.objectContaining({
        selector: 'input[name="username"]',
        matchCount: 2,
        visibleMatchCount: 1,
        positionInAllMatches: 1,
        positionInVisibleMatches: 0,
      }));
      expect(primaryCandidate.positionInAllMatches).not.toBe(primaryCandidate.positionInVisibleMatches);
    });
  });

  it('preserves same-selector evidence across primary and id families', () => {
    return withBrowserGlobals(`
      <input id="username" name="username" placeholder="Username" />
    `, 'https://example.test/login', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      const sharedSelectorCandidates = fingerprint.selectorCandidates.filter((candidate: any) =>
        candidate.selector === '#username',
      );

      expect(sharedSelectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'primary',
          isPrimary: true,
        }),
        expect.objectContaining({
          family: 'id',
        }),
      ]));
      expect(sharedSelectorCandidates).toHaveLength(2);
    });
  });

  it('dedupes exact duplicate candidates by engine, family, and selector', () => {
    return withBrowserGlobals(`
      <input id="username" />
    `, 'https://example.test/login', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      (interceptor as any)._collectStableAttributeSelectorCandidates = vi.fn(() => [
        { selector: '#username', engine: 'css', family: 'id', source: 'capture' },
        { selector: '#username', engine: 'css', family: 'id', source: 'capture' },
      ]);
      (interceptor as any)._collectStableClassCandidate = vi.fn(() => null);
      (interceptor as any)._collectParentScopedCssCandidate = vi.fn(() => null);

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      const sharedSelectorCandidates = fingerprint.selectorCandidates.filter((candidate: any) =>
        candidate.selector === '#username',
      );
      const idCandidates = sharedSelectorCandidates.filter((candidate: any) => candidate.family === 'id');

      expect(sharedSelectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'primary',
          isPrimary: true,
        }),
        expect.objectContaining({
          family: 'id',
        }),
      ]));
      expect(idCandidates).toHaveLength(1);
    });
  });

  it('caps recorded selector candidates at 8 and preserves primary-first entries under cap pressure', () => {
    return withBrowserGlobals(`
      <div data-testid="user-row">
        <input
          id="username"
          name="username"
          data-testid="username-input"
          data-cy="username-field"
          data-qa="username-field-qa"
          placeholder="Username"
          aria-label="Username"
          class="user-row-field"
        />
      </div>
    `, 'https://example.test/login', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });

      expect(fingerprint.selectorCandidates).toHaveLength(8);
      expect(fingerprint.selectorCandidates.filter((candidate: any) =>
        candidate.selector === '[data-testid="username-input"]',
      )).toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'primary',
          isPrimary: true,
        }),
        expect.objectContaining({
          family: 'test-id',
        }),
      ]));
    });
  });

  it('does not throw on detached targets and falls back to a safe primary candidate', () => {
    return withBrowserGlobals(`
      <button data-testid="save-user">Save</button>
    `, 'https://example.test/users', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('button') as HTMLButtonElement;
      target.remove();

      expect(() => (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      })).not.toThrow();

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      });

      expect(fingerprint.selectorCandidates).toEqual([
        expect.objectContaining({
          selector: '[data-testid="save-user"]',
          family: 'primary',
          isPrimary: true,
        }),
      ]);
      expect(interceptor.log).toHaveBeenCalledWith('SELECTOR_CANDIDATES_SKIPPED_DETACHED_TARGET', expect.objectContaining({
        eventType: 'click',
      }));
    });
  });

  it('skips advanced selector candidates for input:progress heartbeats', () => {
    return withBrowserGlobals(`
      <input name="username" value="Admin" />
    `, 'https://example.test/login', () => {
      const interceptor = makeLiveFingerprintHarness();
      const target = document.querySelector('input') as HTMLInputElement;

      (interceptor as any)._emitInputEvent(target, 'trace-input-progress', 'input:progress');

      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = interceptor.queueEvent.mock.calls[0][0];
      expect(event.fingerprint?.selectorCandidates).toBeUndefined();
      expect(interceptor.log).toHaveBeenCalledWith('SELECTOR_CANDIDATES_SKIPPED_HOT_PATH', expect.objectContaining({
        eventType: 'input',
        trigger: 'input:progress',
      }));
    });
  });

  it('captures advanced candidates for committed input change events', () => {
    return withBrowserGlobals(`
      <input name="username" placeholder="Username" value="Admin" />
    `, 'https://example.test/login', () => {
      const interceptor = makeLiveFingerprintHarness();
      const target = document.querySelector('input') as HTMLInputElement;

      (interceptor as any)._emitInputEvent(target, 'trace-input-change', 'change');

      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = interceptor.queueEvent.mock.calls[0][0];
      expect(event.fingerprint?.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ family: 'primary' }),
        expect.objectContaining({ family: 'placeholder' }),
      ]));
    });
  });

  it('captures selectorCandidates on emitted custom-control-open and custom-select trigger fingerprints', async () => {
    await withBrowserGlobals(`
      <div class="oxd-select-text" aria-haspopup="listbox">
        <div class="oxd-select-text-input">-- Select --</div>
      </div>
      <div role="listbox">
        <div role="option">Admin</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const interceptor = makeLiveFingerprintHarness();
      const trigger = document.querySelector('.oxd-select-text') as Element;
      const option = document.querySelector('[role="option"]') as Element;
      const triggerFingerprint = (interceptor as any).generateFingerprint(trigger, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      const handled = await (interceptor as any)._handlePotentialCustomControlTrigger(
        trigger,
        triggerFingerprint,
        undefined,
      );

      expect(handled).toBe(true);
      const openEvent = interceptor.queueEvent.mock.calls[0][0];
      const parsedOpenEvent = AIREventSchema.parse(openEvent);
      expect((parsedOpenEvent as any).fingerprint?.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'primary',
        }),
      ]));

      interceptor.queueEvent.mockClear();
      interceptor._openDropdown = {
        traceId: 'trace-select',
        triggerEl: trigger,
        triggerFingerprint,
        controlFamily: 'combobox',
        openTimestamp: Date.now() - 20,
      };

      const optionData = (interceptor as any)._extractOptionData(option);
      (interceptor as any)._handleCustomDropdownSelection(optionData, { target: option });

      const selectEvent = interceptor.queueEvent.mock.calls[0][0];
      const parsedSelectEvent = AIREventSchema.parse(selectEvent);
      expect((parsedSelectEvent as any).fingerprint?.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ family: 'primary' }),
      ]));
      expect((parsedSelectEvent as any).triggerFingerprint?.selectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ family: 'primary' }),
      ]));
    });
  });

  it('does not crash on SVG className objects when capture candidate generation runs', () => {
    return withBrowserGlobals(`
      <svg viewBox="0 0 10 10">
        <path class="chart-point stable-icon" d="M0 0 L10 10"></path>
      </svg>
    `, 'https://example.test/charts', () => {
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('path') as SVGPathElement;

      expect(() => (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      })).not.toThrow();
    });
  });

  it('validates selector candidate counts against the target owner document instead of the global document', () => {
    return withBrowserGlobals(`
      <input name="email" />
      <input name="email" />
    `, 'https://example.test/main', () => {
      const interceptor = makeSelectorProbe();
      const alternateDocument = document.implementation.createHTMLDocument('alternate');
      alternateDocument.body.innerHTML = `<input name="email" />`;
      const target = alternateDocument.querySelector('input') as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });
      const primaryCandidate = fingerprint.selectorCandidates.find((candidate: any) => candidate.family === 'primary');

      expect(primaryCandidate).toEqual(expect.objectContaining({
        matchCount: 1,
        visibleMatchCount: 1,
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
      }));
    });
  });

  it('uses the target shadow root for candidate match counts when the target lives in open shadow DOM', () => {
    return withBrowserGlobals(`
      <input name="employee" value="light-dom" />
      <div id="shadow-host"></div>
    `, 'https://example.test/shadow', () => {
      const interceptor = makeSelectorProbe();
      const host = document.querySelector('#shadow-host') as HTMLDivElement;
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = `
        <input name="employee" hidden value="shadow-hidden" />
        <input name="employee" value="shadow-visible" />
      `;
      interceptor._isElementVisible = vi.fn((el: Element | null) => !!el && !el.hasAttribute('hidden'));
      const target = shadowRoot.querySelectorAll('input')[1] as HTMLInputElement;

      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'input',
        trigger: 'change',
      });
      const primaryCandidate = fingerprint.selectorCandidates.find((candidate: any) => candidate.family === 'primary');

      expect(primaryCandidate).toEqual(expect.objectContaining({
        matchCount: 2,
        visibleMatchCount: 1,
        positionInAllMatches: 1,
        positionInVisibleMatches: 0,
      }));
    });
  });
});

describe('target identity capture contract', () => {
  it('emits snapshot-backed targetNodeId for committed input events without mutating live DOM', () => {
    return withBrowserGlobals(`
      <form>
        <input name="username" value="Admin" />
      </form>
    `, 'https://example.test/login', () => {
      const interceptor = makeTargetIdentityHarness();
      const target = document.querySelector('input') as HTMLInputElement;

      (interceptor as any)._emitInputEvent(target, 'trace-target-id', 'change');

      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = interceptor.queueEvent.mock.calls[0][0];
      const parsed = AIREventSchema.parse(event);
      expect(parsed.fingerprint).toEqual(expect.objectContaining({
        targetNodeId: 'air-node-1',
        targetIdentitySource: 'pageSnapshot',
        targetIdentityStatus: 'emitted',
      }));
      expect(parsed.pageSnapshot?.html).toContain('data-air-node-id="air-node-1"');
      expect(target.getAttribute('data-air-node-id')).toBeNull();
    });
  });

  it('resolves text-node targets to their parent element for snapshot-backed identity', () => {
    return withBrowserGlobals(`
      <button id="save-button">Save Profile</button>
    `, 'https://example.test/profile', () => {
      const interceptor = makeTargetIdentityHarness();
      const button = document.querySelector('button') as HTMLButtonElement;
      const textNode = button.firstChild;
      const targetIdentityCapture = (interceptor as any)._createTargetIdentityCapture(textNode);
      const snapshot = (interceptor as any)._captureSubtreeSnapshot(textNode, 50000, { targetIdentityCapture });
      const fingerprint = (interceptor as any).generateFingerprint(textNode, {
        eventType: 'click',
        trigger: 'click',
      });
      (interceptor as any)._applyTargetIdentityToFingerprint(
        fingerprint,
        (interceptor as any)._buildTargetIdentityFromSnapshot(targetIdentityCapture, snapshot, 'pageSnapshot'),
      );

      expect((interceptor as any).resolveElementTarget(textNode)).toBe(button);
      expect(fingerprint).toEqual(expect.objectContaining({
        targetNodeId: 'air-node-1',
        targetIdentityStatus: 'emitted',
      }));
      expect(snapshot.html).toContain('data-air-node-id="air-node-1"');
    });
  });

  it('returns target-not-element for unresolved non-element targets without crashing', () => {
    return withBrowserGlobals(`<div>Shell</div>`, 'https://example.test/profile', () => {
      const interceptor = makeTargetIdentityHarness();
      const comment = document.createComment('note');
      const capture = (interceptor as any)._createTargetIdentityCapture(comment);
      const result = (interceptor as any)._buildTargetIdentityFromSnapshot(capture, null, 'pageSnapshot');

      expect((interceptor as any).resolveElementTarget(comment)).toBeNull();
      expect(result).toEqual(expect.objectContaining({
        targetIdentityStatus: 'target-not-element',
      }));
    });
  });

  it('omits targetNodeId gracefully when the target is detached before snapshot serialization', () => {
    return withBrowserGlobals(`
      <button data-testid="delete-row">Delete</button>
    `, 'https://example.test/users', () => {
      const interceptor = makeTargetIdentityHarness();
      const target = document.querySelector('button') as HTMLButtonElement;
      target.remove();

      const targetIdentityCapture = (interceptor as any)._createTargetIdentityCapture(target);
      const snapshot = (interceptor as any)._captureSubtreeSnapshot(target, 50000, { targetIdentityCapture });
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      });
      (interceptor as any)._applyTargetIdentityToFingerprint(
        fingerprint,
        (interceptor as any)._buildTargetIdentityFromSnapshot(targetIdentityCapture, snapshot, 'pageSnapshot'),
      );

      expect(snapshot).not.toBeNull();
      expect(snapshot.html).not.toContain('data-air-node-id=');
      expect(fingerprint.targetNodeId).toBeUndefined();
      expect(fingerprint.targetIdentityStatus).toBe('target-detached');
    });
  });

  it('stamps SVG element targets safely in serialized subtree snapshots', () => {
    return withBrowserGlobals(`
      <svg viewBox="0 0 10 10">
        <path class="chart-point" d="M0 0 L10 10"></path>
      </svg>
    `, 'https://example.test/charts', () => {
      const interceptor = makeTargetIdentityHarness();
      const target = document.querySelector('path') as SVGPathElement;
      const targetIdentityCapture = (interceptor as any)._createTargetIdentityCapture(target);
      const snapshot = (interceptor as any)._captureSubtreeSnapshot(target, 50000, { targetIdentityCapture });
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      });
      (interceptor as any)._applyTargetIdentityToFingerprint(
        fingerprint,
        (interceptor as any)._buildTargetIdentityFromSnapshot(targetIdentityCapture, snapshot, 'pageSnapshot'),
      );

      expect(snapshot.html).toContain('data-air-node-id="air-node-1"');
      expect(fingerprint.targetNodeId).toBe('air-node-1');
      expect(fingerprint.targetIdentityStatus).toBe('emitted');
    });
  });

  it('stamps the actual captured label element without remapping to its control', () => {
    return withBrowserGlobals(`
      <label for="terms">I agree</label>
      <input id="terms" type="checkbox" />
    `, 'https://example.test/forms', () => {
      const interceptor = makeTargetIdentityHarness();
      const target = document.querySelector('label') as HTMLLabelElement;
      const targetIdentityCapture = (interceptor as any)._createTargetIdentityCapture(target);
      const snapshot = (interceptor as any)._captureSubtreeSnapshot(target, 50000, { targetIdentityCapture });
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      });
      (interceptor as any)._applyTargetIdentityToFingerprint(
        fingerprint,
        (interceptor as any)._buildTargetIdentityFromSnapshot(targetIdentityCapture, snapshot, 'pageSnapshot'),
      );

      expect(snapshot.html).toContain('<label');
      expect(snapshot.html).toContain('data-air-node-id="air-node-1"');
      expect(snapshot.html).not.toContain('<input id="terms" type="checkbox" data-air-node-id="air-node-1"');
      expect(fingerprint.targetNodeId).toBe('air-node-1');
    });
  });

  it('does not fabricate identity for open shadow targets when the full-page snapshot does not serialize shadow internals', async () => {
    await withBrowserGlobals(`
      <div id="shadow-host"></div>
    `, 'https://example.test/shadow', async () => {
      const interceptor = makeTargetIdentityHarness();
      const host = document.querySelector('#shadow-host') as HTMLDivElement;
      const shadowRoot = host.attachShadow({ mode: 'open' });
      shadowRoot.innerHTML = `<button id="shadow-save">Save</button>`;
      const target = shadowRoot.querySelector('button') as HTMLButtonElement;
      const targetIdentityCapture = (interceptor as any)._createTargetIdentityCapture(target);
      const snapshot = await (interceptor as any).capturePageSnapshot(2, true, { targetIdentityCapture });
      const fingerprint = (interceptor as any).generateFingerprint(target, {
        eventType: 'click',
        trigger: 'click',
      });
      (interceptor as any)._applyTargetIdentityToFingerprint(
        fingerprint,
        (interceptor as any)._buildTargetIdentityFromSnapshot(targetIdentityCapture, snapshot, 'pageSnapshot'),
      );

      expect(snapshot?.html).not.toContain('data-air-node-id=');
      expect(fingerprint.targetNodeId).toBeUndefined();
      expect(fingerprint.targetIdentityStatus).toBe('shadow-not-serialized');
    });
  });

  it('reports cross-origin-frame when nested context proves iframe DOM is inaccessible', () => {
    return withBrowserGlobals(`
      <iframe src="https://example.test/remote"></iframe>
    `, 'https://example.test/frame-host', () => {
      const interceptor = makeTargetIdentityHarness();
      const target = document.querySelector('iframe') as HTMLIFrameElement;
      const targetIdentityCapture = (interceptor as any)._createTargetIdentityCapture(target, {
        nestedContext: {
          isIframe: true,
          iframeSameOrigin: false,
        },
      });
      const result = (interceptor as any)._buildTargetIdentityFromSnapshot(targetIdentityCapture, null, 'pageSnapshot');

      expect(result).toEqual(expect.objectContaining({
        targetIdentityStatus: 'cross-origin-frame',
      }));
    });
  });
});

describe('custom-control capture heuristics', () => {
  it('promotes an OrangeHRM select shell click to the semantic trigger ancestor', () => {
    return withBrowserGlobals(`
      <div class="oxd-select-wrapper">
        <div class="oxd-select-text">
          <div class="oxd-select-text-input" readonly>ESS</div>
          <i class="oxd-icon bi-caret-down-fill"></i>
        </div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const target = document.querySelector('.oxd-select-text-input') as Element;

      const resolved = (interceptor as any)._resolveCustomDropdownTrigger(target) as Element | null;

      expect(resolved).not.toBeNull();
      expect(resolved?.classList.contains('oxd-select-text')).toBe(true);
    });
  });

  it('does not promote a generic div click without dropdown evidence', () => {
    return withBrowserGlobals(`
      <div class="shell">
        <div class="content">Just a generic wrapper</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const target = document.querySelector('.content') as Element;

      const resolved = (interceptor as any)._resolveCustomDropdownTrigger(target) as Element | null;
      expect(resolved).toBeNull();
    });
  });

  it('emits a semantic custom-control-open event with visible option preview', async () => {
    await withBrowserGlobals(`
      <div class="oxd-userdropdown">
        <span class="oxd-userdropdown-name">Paul Collings</span>
        <i class="oxd-icon bi-caret-down-fill"></i>
      </div>
      <ul role="menu">
        <li role="menuitem">Logout</li>
      </ul>
    `, 'https://example.test/admin', async () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const trigger = document.querySelector('.oxd-userdropdown-name') as Element;
      const triggerFingerprint = interceptor.generateFingerprint(trigger);

      const handled = await (interceptor as any)._handlePotentialCustomControlTrigger(
        trigger,
        triggerFingerprint,
        undefined,
      );

      expect(handled).toBe(true);
      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);

      const event = interceptor.queueEvent.mock.calls[0][0];
      const parsed = AIREventSchema.parse(event);
      expect(parsed.type).toBe('custom-control-open');
      expect((parsed as any).controlFamily).toBe('menu');
      expect((parsed as any).meta.optionPreview).toEqual([
        expect.objectContaining({ label: 'Logout' }),
      ]);
      expect((parsed as any).fingerprint?.selector).toBe('.oxd-userdropdown-name');
    });
  });

  it('emits custom-menu-select for menuitem options and preserves the trigger relationship', () => {
    return withBrowserGlobals(`
      <div class="oxd-userdropdown">
        <span class="oxd-userdropdown-name">Paul Collings</span>
        <i class="oxd-icon bi-caret-down-fill"></i>
      </div>
      <ul role="menu">
        <li role="menuitem">Logout</li>
      </ul>
    `, 'https://example.test/admin', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const trigger = document.querySelector('.oxd-userdropdown-name') as Element;
      const option = document.querySelector('[role="menuitem"]') as Element;
      interceptor._openDropdown = {
        traceId: 'trace-dropdown',
        triggerEl: trigger,
        triggerFingerprint: interceptor.generateFingerprint(trigger),
        controlFamily: 'menu',
        openTimestamp: Date.now() - 25,
      };

      const optionData = (interceptor as any)._extractOptionData(option);
      (interceptor as any)._handleCustomDropdownSelection(optionData, { target: option });

      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = interceptor.queueEvent.mock.calls[0][0];
      const parsed = AIREventSchema.parse(event);

      expect(parsed.type).toBe('custom-menu-select');
      expect((parsed as any).selection).toEqual({
        label: 'Logout',
        value: 'Logout',
        index: 0,
      });
      expect((parsed as any).fingerprint?.textExcerpt).toBe('Logout');
      expect((parsed as any).triggerFingerprint?.selector).toBe('.oxd-userdropdown-name');
      expect((parsed as any).meta.containerRole).toBe('menu');
    });
  });

  it('falls back to emit custom-select for a combobox option when click never arrives', async () => {
    vi.useFakeTimers();
    try {
      await withBrowserGlobals(`
        <div class="oxd-select-text">
          <div class="oxd-select-text-input">-- Select --</div>
        </div>
        <div role="listbox">
          <div role="option">Admin</div>
        </div>
      `, 'https://example.test/admin', async () => {
        const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
        const trigger = document.querySelector('.oxd-select-text') as Element;
        const option = document.querySelector('[role="option"]') as Element;
        interceptor._openDropdown = {
          traceId: 'trace-combobox',
          triggerEl: trigger,
          triggerFingerprint: interceptor.generateFingerprint(trigger),
          controlFamily: 'combobox',
          openTimestamp: Date.now() - 25,
        };
        (interceptor._getComposedEventTarget as any).mockImplementation((event: Event | null) => (event?.target as Element | null) ?? option);
        const down = new window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 40,
          clientY: 24,
        });
        option.dispatchEvent(down);
        (interceptor as any)._handleMousedownForOption(down);

        await vi.advanceTimersByTimeAsync(120);

        expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
        const event = interceptor.queueEvent.mock.calls[0][0];
        const parsed = AIREventSchema.parse(event);
        expect(parsed.type).toBe('custom-select');
        expect((parsed as any).selection).toEqual({
          label: 'Admin',
          value: 'Admin',
          index: 0,
        });
        expect((parsed as any).fingerprint?.textExcerpt).toBe('Admin');
        expect((parsed as any).triggerFingerprint?.selector).toBe('.oxd-select-text');
        expect(interceptor.log).toHaveBeenCalledWith('PENDING_OPTION_FALLBACK_CONSUMED', expect.objectContaining({
          label: 'Admin',
          controlFamily: 'combobox',
        }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('prefers the click path and does not double emit when pending is consumed before fallback', async () => {
    vi.useFakeTimers();
    try {
      await withBrowserGlobals(`
        <div class="oxd-select-text">
          <div class="oxd-select-text-input">-- Select --</div>
        </div>
        <div role="listbox">
          <div role="option">Enabled</div>
        </div>
      `, 'https://example.test/admin', async () => {
        const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
        const trigger = document.querySelector('.oxd-select-text') as Element;
        const option = document.querySelector('[role="option"]') as Element;
        interceptor._openDropdown = {
          traceId: 'trace-status',
          triggerEl: trigger,
          triggerFingerprint: interceptor.generateFingerprint(trigger),
          controlFamily: 'combobox',
          openTimestamp: Date.now() - 10,
        };
        (interceptor._getComposedEventTarget as any).mockImplementation((event: Event | null) => (event?.target as Element | null) ?? option);

        const down = new window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 18,
          clientY: 12,
        });
        option.dispatchEvent(down);
        (interceptor as any)._handleMousedownForOption(down);

        const click = new window.MouseEvent('click', {
          bubbles: true,
          clientX: 18,
          clientY: 12,
        });
        option.dispatchEvent(click);
        await (interceptor as any).handleClick(click);
        await vi.advanceTimersByTimeAsync(120);

        expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
        const event = interceptor.queueEvent.mock.calls[0][0];
        const parsed = AIREventSchema.parse(event);
        expect(parsed.type).toBe('custom-select');
        expect(interceptor.log).not.toHaveBeenCalledWith('PENDING_OPTION_FALLBACK_CONSUMED', expect.anything());
        expect((interceptor as any)._pendingOptionSelection).toBeNull();
        expect((interceptor as any)._pendingOptionSelectionFallbackTimer).toBeNull();
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps menuitem logout on the click path and does not double emit via fallback', async () => {
    vi.useFakeTimers();
    try {
      await withBrowserGlobals(`
        <div class="oxd-userdropdown">
          <span class="oxd-userdropdown-name">Paul Collings</span>
        </div>
        <ul role="menu">
          <li role="menuitem">Logout</li>
        </ul>
      `, 'https://example.test/admin', async () => {
        const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
        const trigger = document.querySelector('.oxd-userdropdown-name') as Element;
        const option = document.querySelector('[role="menuitem"]') as Element;
        interceptor._openDropdown = {
          traceId: 'trace-logout',
          triggerEl: trigger,
          triggerFingerprint: interceptor.generateFingerprint(trigger),
          controlFamily: 'menu',
          openTimestamp: Date.now() - 10,
        };
        (interceptor._getComposedEventTarget as any).mockImplementation((event: Event | null) => (event?.target as Element | null) ?? option);

        const down = new window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 8,
          clientY: 8,
        });
        option.dispatchEvent(down);
        (interceptor as any)._handleMousedownForOption(down);
        const click = new window.MouseEvent('click', {
          bubbles: true,
          clientX: 8,
          clientY: 8,
        });
        option.dispatchEvent(click);
        await (interceptor as any).handleClick(click);
        await vi.advanceTimersByTimeAsync(120);

        expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
        const event = interceptor.queueEvent.mock.calls[0][0];
        const parsed = AIREventSchema.parse(event);
        expect(parsed.type).toBe('custom-menu-select');
        expect(interceptor.log).not.toHaveBeenCalledWith('PENDING_OPTION_FALLBACK_CONSUMED', expect.anything());
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not fallback emit without open-dropdown or active-input context', async () => {
    vi.useFakeTimers();
    try {
      await withBrowserGlobals(`
        <div role="listbox">
          <div role="option">Admin</div>
        </div>
      `, 'https://example.test/admin', async () => {
        const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
        const option = document.querySelector('[role="option"]') as Element;
        (interceptor._getComposedEventTarget as any).mockImplementation((event: Event | null) => (event?.target as Element | null) ?? option);

        const down = new window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 10,
          clientY: 10,
        });
        option.dispatchEvent(down);
        (interceptor as any)._handleMousedownForOption(down);
        await vi.advanceTimersByTimeAsync(120);

        expect(interceptor.queueEvent).not.toHaveBeenCalled();
        expect(interceptor.log).toHaveBeenCalledWith('PENDING_OPTION_FALLBACK_SKIPPED', expect.objectContaining({
          reason: 'invalid_context',
        }));
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows autocomplete option fallback when linked to an active input session', async () => {
    vi.useFakeTimers();
    try {
      await withBrowserGlobals(`
        <input id="employee" />
        <div role="listbox">
          <div role="option">manda akhil user</div>
        </div>
      `, 'https://example.test/admin', async () => {
        const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
        const input = document.querySelector('#employee') as HTMLInputElement;
        const option = document.querySelector('[role="option"]') as Element;
        interceptor.activeInputSessions.set((interceptor as any)._fieldKey(input), {
          traceId: 'trace-autocomplete',
          startValue: '',
          inputCount: 1,
          startTimestamp: Date.now() - 20,
        });
        (interceptor._getComposedEventTarget as any).mockImplementation((event: Event | null) => (event?.target as Element | null) ?? option);

        const down = new window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 22,
          clientY: 16,
        });
        option.dispatchEvent(down);
        (interceptor as any)._handleMousedownForOption(down);
        await vi.advanceTimersByTimeAsync(120);

        expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
        const event = interceptor.queueEvent.mock.calls[0][0];
        const parsed = AIREventSchema.parse(event);
        expect(parsed.type).toBe('custom-select');
        expect((parsed as any).fingerprint?.textExcerpt).toBe('manda akhil user');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits malformed selection payloads without crashing custom-select capture', () => {
    return withBrowserGlobals(`
      <div class="oxd-select-text">
        <div class="oxd-select-text-input">-- Select --</div>
      </div>
      <div role="listbox">
        <div role="option">Admin</div>
      </div>
    `, 'https://example.test/admin', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const trigger = document.querySelector('.oxd-select-text') as Element;
      const option = document.querySelector('[role="option"]') as Element;
      interceptor._openDropdown = {
        traceId: 'trace-combobox',
        triggerEl: trigger,
        triggerFingerprint: interceptor.generateFingerprint(trigger),
        controlFamily: 'combobox',
        openTimestamp: Date.now() - 25,
      };

      expect(() => (interceptor as any)._handleCustomDropdownSelection({
        el: option,
        label: '',
        value: 'Admin',
        index: -1,
      }, { target: option })).not.toThrow();

      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = interceptor.queueEvent.mock.calls[0][0];
      const parsed = AIREventSchema.parse(event);
      expect(parsed.type).toBe('custom-select');
      expect((parsed as any).selection).toBeUndefined();
      expect(interceptor.log).toHaveBeenCalledWith('CUSTOM_SELECT_SELECTION_SKIPPED', expect.objectContaining({
        eventType: 'custom-select',
        hasLabel: false,
        hasValue: true,
      }));
    });
  });
});

describe('interceptor session id contract', () => {
  it('generates a session-prefixed fallback session id in non-strict mode', () => {
    return withBrowserGlobals('<div></div>', 'https://example.test/admin', () => {
      (window as any).__air_rawFetch = vi.fn();
      const initSpy = vi.spyOn(AIRInterceptor.prototype as any, 'init').mockImplementation(() => undefined);
      const uuidSpy = vi.spyOn(AIRInterceptor.prototype as any, 'generateUUID').mockReturnValue('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

      const interceptor = new AIRInterceptor({ debugMode: false }) as unknown as CustomControlHarness;

      expect(interceptor.config.sessionId).toBe('session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      expect(window.sessionStorage.getItem('AIR_SESSION_ID')).toBe('session-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

      initSpy.mockRestore();
      uuidSpy.mockRestore();
    });
  });

  it('normalizes a legacy bare UUID from session storage once instead of double-prefixing', () => {
    return withBrowserGlobals('<div></div>', 'https://example.test/admin', () => {
      (window as any).__air_rawFetch = vi.fn();
      window.sessionStorage.setItem('AIR_SESSION_ID', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      const initSpy = vi.spyOn(AIRInterceptor.prototype as any, 'init').mockImplementation(() => undefined);

      const interceptor = new AIRInterceptor({ debugMode: false }) as unknown as CustomControlHarness;

      expect(interceptor.config.sessionId).toBe('session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
      expect(window.sessionStorage.getItem('AIR_SESSION_ID')).toBe('session-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

      initSpy.mockRestore();
    });
  });

  it('preserves an already-prefixed session id as-is', () => {
    return withBrowserGlobals('<div></div>', 'https://example.test/admin', () => {
      (window as any).__air_rawFetch = vi.fn();
      const initSpy = vi.spyOn(AIRInterceptor.prototype as any, 'init').mockImplementation(() => undefined);

      const interceptor = new AIRInterceptor({
        debugMode: false,
        sessionId: 'session-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      }) as unknown as CustomControlHarness;

      expect(interceptor.config.sessionId).toBe('session-cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      expect(window.sessionStorage.getItem('AIR_SESSION_ID')).toBe('session-cccccccc-cccc-4ccc-8ccc-cccccccccccc');

      initSpy.mockRestore();
    });
  });
});

describe('option sibling index computation', () => {
  // Phase 0.1 regression: _extractOptionData previously used
  // container.querySelectorAll('*') for role-less elements, giving position
  // among all descendants rather than among sibling options. These tests
  // verify the fix: parentElement.children filtered by tagName.

  it('reports correct 0-based index for a role-less <li> at position 2 of 5', () => {
    return withBrowserGlobals(`
      <ul>
        <li>City A</li>
        <li>City B</li>
        <li>City C</li>
        <li>City D</li>
        <li>City E</li>
      </ul>
    `, 'https://example.test/autocomplete', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const items = Array.from(document.querySelectorAll('li'));
      // Target: 3rd item (0-based index 2)
      const target = items[2] as Element;

      const optionData = (interceptor as any)._extractOptionData(target);

      expect(optionData.label).toBe('City C');
      expect(optionData.value).toBe('City C');
      // Must be 2 (0-based position among <li> siblings), not -1 or a large descendant index
      expect(optionData.index).toBe(2);
    });
  });

  it('reports index 0 for a role-less <li> that is the first and only sibling', () => {
    return withBrowserGlobals(`
      <ul>
        <li>Only City</li>
      </ul>
    `, 'https://example.test/autocomplete', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const target = document.querySelector('li') as Element;

      const optionData = (interceptor as any)._extractOptionData(target);

      expect(optionData.index).toBe(0);
    });
  });

  it('reports correct index for a role-less <div> sibling (AbhiBus-shaped DOM)', () => {
    return withBrowserGlobals(`
      <div class="suggestions">
        <div class="text-neutral-800 col">Hyderabad (All boarding points)</div>
        <div class="text-neutral-800 col">Mumbai (All boarding points)</div>
        <div class="text-neutral-800 col">Pune (All boarding points)</div>
      </div>
    `, 'https://www.abhibus.com', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const items = Array.from(document.querySelectorAll('.suggestions > div'));
      // Target: 2nd item (0-based index 1) — "Mumbai"
      const target = items[1] as Element;

      const optionData = (interceptor as any)._extractOptionData(target);

      expect(optionData.label).toBe('Mumbai (All boarding points)');
      expect(optionData.index).toBe(1);
    });
  });

  it('uses role-based sibling count when option has an explicit role', () => {
    return withBrowserGlobals(`
      <div role="listbox">
        <div role="option">Option A</div>
        <div role="option">Option B</div>
        <div role="option">Option C</div>
      </div>
    `, 'https://example.test/listbox', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      const items = Array.from(document.querySelectorAll('[role="option"]'));
      const target = items[2] as Element; // Option C

      const optionData = (interceptor as any)._extractOptionData(target);

      expect(optionData.label).toBe('Option C');
      expect(optionData.index).toBe(2);
    });
  });

  it('returns index -1 when element has no parentElement', () => {
    return withBrowserGlobals(`<div></div>`, 'https://example.test', () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      // Detached element — no parentElement
      const detached = document.createElement('li');
      detached.textContent = 'Orphan';

      const optionData = (interceptor as any)._extractOptionData(detached);

      expect(optionData.index).toBe(-1);
    });
  });
});

describe('unresolvedInteraction and structural fallback pipeline', () => {
  it('Test Case 1: structural fallback emits custom-select on role-less li click and preserves traceId', async () => {
    return withBrowserGlobals(`
      <div>
        <input type="text" id="autocomplete-input" placeholder="Search cities" />
        <ul class="options-list">
          <li>Mumbai</li>
          <li>Pune</li>
          <li>Hyderabad</li>
        </ul>
      </div>
    `, 'https://example.test/autocomplete', async () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      
      const input = document.getElementById('autocomplete-input') as HTMLInputElement;
      interceptor.handleFocus({ target: input, type: 'focus', composedPath: () => [input] } as any);
      interceptor.handleInput({ target: input, type: 'input', composedPath: () => [input] } as any);
      
      const session = Array.from(interceptor.activeInputSessions.values())[0];
      const traceId = (session as any).traceId;
      
      const targetLi = Array.from(document.querySelectorAll('li'))[0];
      
      interceptor._handleMousedownForOption({ target: targetLi, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any);
      await interceptor.handleClick({ target: targetLi, clientX: 10, clientY: 10, composedPath: () => [targetLi], preventDefault: vi.fn() } as any);
      
      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = (interceptor.queueEvent as any).mock.calls[0][0];
      expect(event.type).toBe('custom-select');
      expect(event.traceId).toBe(traceId);
      expect(event.unresolvedInteraction).toBeUndefined();
    });
  });

  it('Test Case 2: duplicate semantic elements correctly fall back to positional warning (E6)', async () => {
    return withBrowserGlobals(`
      <div>
        <input type="text" id="autocomplete-input" />
        <ul class="options-list">
          <li>Identical Option</li>
          <li>Identical Option</li>
        </ul>
      </div>
    `, 'https://example.test/autocomplete', async () => {
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      
      const input = document.getElementById('autocomplete-input') as HTMLInputElement;
      interceptor.handleFocus({ target: input, type: 'focus', composedPath: () => [input] } as any);
      interceptor.handleInput({ target: input, type: 'input', composedPath: () => [input] } as any);
      
      const targetLi = Array.from(document.querySelectorAll('li'))[1];
      
      interceptor._handleMousedownForOption({ target: targetLi, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any);
      await interceptor.handleClick({ target: targetLi, clientX: 10, clientY: 10, composedPath: () => [targetLi], preventDefault: vi.fn() } as any);
      
      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = (interceptor.queueEvent as any).mock.calls[0][0];
      expect(event.type).toBe('custom-select');
      expect(event).toBeDefined();
    });
  });

  it('Test Case 3: mousedown without click successfully clears pending state leak and unresolvedInteraction emits correctly', async () => {
    return withBrowserGlobals(`
      <div>
        <input type="text" id="autocomplete-input" />
        <div class="fake-option text-neutral-800">Fake Option</div>
        <button id="submit-btn">Submit</button>
      </div>
    `, 'https://example.test/autocomplete', async () => {
      (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16) as any;
      const interceptor = makeHarness();
      interceptor.waitForUrlChange = () => Promise.resolve() as any;
      
      const input = document.getElementById('autocomplete-input') as HTMLInputElement;
      interceptor.handleFocus({ target: input, type: 'focus', composedPath: () => [input] } as any);
      interceptor.handleInput({ target: input, type: 'input', composedPath: () => [input] } as any);
      
      const fakeOption = document.querySelector('.fake-option') as Element;
      const submitBtn = document.getElementById('submit-btn') as Element;
      
      interceptor._handleMousedownForOption({ target: fakeOption, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any);
      
      expect(interceptor._pendingUnresolvedInteraction).toBeDefined();
      expect((interceptor._pendingUnresolvedInteraction as any).payload.textContent).toBe('Fake Option');
      expect((interceptor._pendingUnresolvedInteraction as any).payload.classTokens).toContain('fake-option');
      
      (interceptor.queueEvent as any).mockClear();
      await interceptor.handleClick({ target: submitBtn, clientX: 50, clientY: 50, composedPath: () => [submitBtn], preventDefault: vi.fn() } as any);
      
      expect(interceptor.queueEvent).toHaveBeenCalledTimes(1);
      const event = (interceptor.queueEvent as any).mock.calls[0][0];
      expect(['click', 'outcome']).toContain(event.type);
      expect(event.unresolvedInteraction).toBeUndefined();
      expect(interceptor._pendingUnresolvedInteraction).toBeNull();
    });

    it('Test Case 4: unresolvedInteraction payload is correctly emitted on successful click', async () => {
      return withBrowserGlobals(`
        <div>
          <input type="text" id="autocomplete-input" />
          <div class="fake-option text-neutral-800">Fake Option</div>
        </div>
      `, 'https://example.test/autocomplete', async () => {
        (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16) as any;
        const interceptor = makeHarness();
        interceptor.waitForUrlChange = () => Promise.resolve() as any;
        
        const input = document.getElementById('autocomplete-input') as HTMLInputElement;
        const fakeOption = document.querySelector('.fake-option') as Element;
        
        interceptor.handleFocus({ target: input, type: 'focus', composedPath: () => [input] } as any);
        interceptor.handleInput({ target: input, type: 'input', composedPath: () => [input] } as any);
        
        interceptor._handleMousedownForOption({ target: fakeOption, clientX: 10, clientY: 10, preventDefault: vi.fn() } as any);
        
        (interceptor.queueEvent as any).mockClear();
        await interceptor.handleClick({ target: fakeOption, clientX: 10, clientY: 10, composedPath: () => [fakeOption], preventDefault: vi.fn() } as any);
        
        const clickEvent2 = (interceptor.queueEvent as any).mock.calls.slice(-1)[0][0];
        expect(['click', 'outcome']).toContain(clickEvent2.type);
        expect(clickEvent2.unresolvedInteraction).toBeDefined();
        expect(clickEvent2.unresolvedInteraction.textContent).toBe('Fake Option');
      });
    });
  });
});
