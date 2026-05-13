import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';
import { AIREventSchema } from '../types/events';

const require = createRequire(import.meta.url);
const { AIRInterceptor } = require('../../packages/vscode-extension/interceptor.js') as {
  AIRInterceptor: {
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
  interceptor._isElementVisible = vi.fn((el: Element | null) => !!el);
  return interceptor;
}

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
      expect(fingerprint.boundedFieldContext).toEqual(expect.objectContaining({
        fieldLabelText: 'User Role',
        targetControlKind: 'custom-trigger',
        isValid: true,
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
});
