import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { JSDOM } from 'jsdom';

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

type SelectorProbe = Record<string, unknown> & {
  config: Record<string, unknown>;
  log: ReturnType<typeof vi.fn>;
  _isElementVisible: ReturnType<typeof vi.fn>;
  generateFingerprint: (el: Element | null) => Record<string, unknown>;
};

async function withBrowserGlobals<T>(html: string, url: string, fn: () => Promise<T> | T): Promise<T> {
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

function makeSelectorProbe(): SelectorProbe {
  const interceptor = Object.create(AIRInterceptor.prototype) as SelectorProbe;
  interceptor.config = {
    debugMode: false,
    maxTextLength: 200,
  };
  interceptor.log = vi.fn();
  interceptor._isElementVisible = vi.fn((el: Element | null) => !!el);
  return interceptor;
}

afterEach(() => {
  delete (globalThis as any).__AIR_SELECTOR_ENGINE__;
});

describe('selector engine bounded-field parity comparison', () => {
  it('surfaces the remaining selector-format parity gap for simple repeated custom-trigger containers', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const interceptor = makeSelectorProbe();
      const rawTarget = document.querySelector('.field-row .select-trigger') as HTMLDivElement;
      const fingerprint = interceptor.generateFingerprint(rawTarget);
      const legacyContext = fingerprint.boundedFieldContext;
      const modularContext = selectorEngine.resolveBoundedFieldContextEvidence({
        element: rawTarget,
        selectorResult: {
          selector: '.select-trigger',
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });

      const parity = selectorEngine.compareBoundedFieldContextEvidence({
        legacyContext,
        modularContext,
      });

      expect(parity.isExactMatch).toBe(false);
      expect(parity.parityStatus).toBe('partial-match');
      expect(parity.mismatches).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'boundedContainerSelectorCandidates',
          status: 'mismatch',
        }),
        expect.objectContaining({
          field: 'cleanParentSelector',
          status: 'mismatch',
          legacyValue: '.field-row',
          modularValue: 'div.field-row',
        }),
        expect.objectContaining({
          field: 'containerSelector',
          status: 'mismatch',
          legacyValue: '.field-row',
          modularValue: 'div.field-row',
        }),
      ]));
    });
  });

  it('surfaces canonical-child divergence against legacy for nested custom triggers', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const interceptor = makeSelectorProbe();
      const rawTarget = document.querySelector('.field-row .select-trigger') as HTMLDivElement;
      const fingerprint = interceptor.generateFingerprint(rawTarget);
      const legacyContext = fingerprint.boundedFieldContext;
      const modularContext = selectorEngine.resolveBoundedFieldContextEvidence({
        element: rawTarget,
        selectorResult: {
          selector: '.select-trigger',
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });

      const parity = selectorEngine.compareBoundedFieldContextEvidence({
        legacyContext,
        modularContext,
      });

      expect(parity.isExactMatch).toBe(false);
      expect(parity.parityStatus).toBe('partial-match');
      expect(parity.mismatches).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'cleanChildSelector',
          status: 'mismatch',
          legacyValue: 'div[aria-haspopup="listbox"]',
          modularValue: 'div.select-trigger-input',
        }),
      ]));
    });
  });

  it('surfaces modular-only enrichment fields when legacy native-field context is shallow', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label for="username">Username</label>
        <input id="username" name="username" />
      </div>
    `, 'https://example.test/form', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const interceptor = makeSelectorProbe();
      const target = document.querySelector('#username') as HTMLInputElement;
      const fingerprint = interceptor.generateFingerprint(target);
      const legacyContext = fingerprint.boundedFieldContext;
      const modularContext = selectorEngine.resolveBoundedFieldContextEvidence({
        element: target,
        selectorResult: {
          selector: '#username',
          priority: 'id',
          rank: 1,
        },
        eventContext: {
          eventType: 'input',
          trigger: 'input:commit',
        },
      });

      const parity = selectorEngine.compareBoundedFieldContextEvidence({
        legacyContext,
        modularContext,
      });

      expect(parity.isExactMatch).toBe(false);
      expect(parity.parityStatus).toBe('partial-match');
      expect(parity.mismatches).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'visibleControlCountInContainer',
          status: 'legacy-only',
          legacyValue: 1,
          modularValue: null,
        }),
        expect.objectContaining({
          field: 'cleanChildSelector',
          status: 'modular-only',
          legacyValue: null,
          modularValue: 'input[name="username"]',
        }),
        expect.objectContaining({
          field: 'containerSelector',
          status: 'legacy-only',
          legacyValue: '.field-row',
          modularValue: null,
        }),
        expect.objectContaining({
          field: 'competingControlCount',
          status: 'legacy-only',
          legacyValue: 0,
          modularValue: null,
        }),
        expect.objectContaining({
          field: 'duplicateLabelCount',
          status: 'modular-only',
          legacyValue: null,
          modularValue: 2,
        }),
      ]));
    });
  });
});
