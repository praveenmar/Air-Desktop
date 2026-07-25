import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

type RuntimeGlobals = {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
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

afterEach(() => {
  delete (globalThis as any).__AIR_SELECTOR_ENGINE__;
});

describe('selector engine weak-app shadow coverage', () => {
  it('skips tertiary weak-app fallbacks when a preferred selector already exists', async () => {
    await withBrowserGlobals(`
      <button data-testid="save-user">Save</button>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('button') as HTMLButtonElement;
      const currentCandidates = selectorEngine.collectShadowSelectorCandidates({
        element: target,
        selectorResult: {
          selector: '[data-testid="save-user"]',
          priority: 'data-testid',
          rank: 1,
        },
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const coverage = selectorEngine.collectWeakAppShadowCoverage({
        element: target,
        currentCandidates,
      });

      expect(coverage.needsWeakCoverage).toBe(false);
      expect(coverage.blockedReason).toBe('strong-selector-already-available');
      expect(coverage.fallbacks).toEqual([]);
    });
  });

  it('generates scoped text and positional fallback coverage for repeated weak controls', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger">-- Select --</div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger">-- Select --</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.field-row .select-trigger') as HTMLDivElement;
      const currentCandidates = selectorEngine.collectShadowSelectorCandidates({
        element: target,
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
      const boundedFieldContextEvidence = selectorEngine.resolveBoundedFieldContextEvidence({
        element: target,
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

      const coverage = selectorEngine.collectWeakAppShadowCoverage({
        element: target,
        currentCandidates,
        boundedFieldContextEvidence,
      });

      expect(coverage.needsWeakCoverage).toBe(true);
      expect(coverage.fallbacks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          strategy: 'container-scoped-text',
          tier: 'last-resort',
        }),
        expect.objectContaining({
          strategy: 'indexed-dom-xpath',
          tier: 'last-resort',
        }),
      ]));
    });
  });

  it('keeps nth-of-type and indexed xpath available as last-resort weak-app coverage', async () => {
    await withBrowserGlobals(`
      <div class="toolbar">
        <button>Go</button>
        <button>Go</button>
        <button>Go</button>
      </div>
    `, 'https://example.test/toolbar', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelectorAll('button')[1] as HTMLButtonElement;
      const currentCandidates = selectorEngine.collectShadowSelectorCandidates({
        element: target,
        selectorResult: {
          selector: 'button:has-text("Go")',
          priority: 'text',
          rank: 8,
        },
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const coverage = selectorEngine.collectWeakAppShadowCoverage({
        element: target,
        currentCandidates,
      });

      expect(coverage.needsWeakCoverage).toBe(true);
      expect(coverage.fallbacks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          strategy: 'nth-of-type-child',
          tier: 'last-resort',
        }),
        expect.objectContaining({
          strategy: 'indexed-dom-xpath',
          tier: 'last-resort',
          engine: 'xpath',
        }),
      ]));
    });
  });
});
