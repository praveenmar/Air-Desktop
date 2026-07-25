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

describe('selector engine bounded-field shadow exposure', () => {
  it('builds a compact shadow summary for simple custom-trigger selector-format drift', async () => {
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
      const legacyContext = interceptor.generateFingerprint(rawTarget).boundedFieldContext;
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

      const exposure = selectorEngine.buildBoundedFieldShadowExposure({
        legacyContext,
        modularContext,
      });

      expect(exposure.parityStatus).toBe('partial-match');
      expect(exposure.mismatchReasonCounts).toEqual({
        'selector-format-drift': 3,
      });
      expect(exposure.mismatchedFields).toEqual(expect.arrayContaining([
        'boundedContainerSelectorCandidates',
        'cleanParentSelector',
        'containerSelector',
      ]));
      expect(exposure.legacySummary).toEqual(expect.objectContaining({
        cleanParentSelector: '.field-row',
      }));
      expect(exposure.modularSummary).toEqual(expect.objectContaining({
        cleanParentSelector: 'div.field-row',
      }));
    });
  });

  it('surfaces canonical-child and legacy-container gaps in a summary-only exposure', async () => {
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
      const legacyContext = interceptor.generateFingerprint(rawTarget).boundedFieldContext;
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

      const exposure = selectorEngine.buildBoundedFieldShadowExposure({
        legacyContext,
        modularContext,
      });

      expect(exposure.mismatchReasons).toEqual(expect.arrayContaining([
        expect.objectContaining({
          field: 'cleanChildSelector',
          reason: 'canonical-child-binding',
        }),
      ]));
      expect(exposure.legacySummary).not.toHaveProperty('rawTarget');
      expect(exposure.modularSummary).not.toHaveProperty('effectiveTarget');
    });
  });
});

