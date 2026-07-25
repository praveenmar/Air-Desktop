import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

type RuntimeGlobals = {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  ShadowRoot?: typeof ShadowRoot;
};

async function withBrowserGlobals<T>(html: string, url: string, fn: () => Promise<T> | T): Promise<T> {
  const dom = new JSDOM(html, { url });
  const runtime = globalThis as unknown as RuntimeGlobals;
  const previous = {
    window: runtime.window,
    document: runtime.document,
    Node: runtime.Node,
    ShadowRoot: runtime.ShadowRoot,
  };

  runtime.window = dom.window as Window & typeof globalThis;
  runtime.document = dom.window.document;
  runtime.Node = dom.window.Node;
  runtime.ShadowRoot = dom.window.ShadowRoot;

  try {
    return await fn();
  } finally {
    runtime.window = previous.window;
    runtime.document = previous.document;
    runtime.Node = previous.Node;
    runtime.ShadowRoot = previous.ShadowRoot;
    (dom.window as Window & { close?: () => void }).close?.();
  }
}

afterEach(() => {
  delete (globalThis as any).__AIR_SELECTOR_ENGINE__;
});

describe('modular selector engine structural parity', () => {
  it('adds parent-scoped-css for stable wrapper controls when structural parity is enabled', async () => {
    await withBrowserGlobals(`
      <div class="oxd-select-wrapper">
        <div class="oxd-select-text">-- Select --</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const { collectShadowSelectorCandidates } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.oxd-select-text') as HTMLDivElement;

      const candidates = collectShadowSelectorCandidates({
        element: target,
        selectorResult: {
          selector: '.oxd-select-text',
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
        enableStructuralParity: true,
      });

      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.oxd-select-wrapper > div.oxd-select-text',
          family: 'parent-scoped-css',
          source: 'shadow',
          matchCount: 1,
        }),
      ]));
    });
  });

  it('adds tight-container-css for explicit listbox trigger semantics when structural parity is enabled', async () => {
    await withBrowserGlobals(`
      <div class="user-role-field">
        <div role="button" aria-haspopup="listbox" tabindex="0">User Role</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const { collectShadowSelectorCandidates } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('[role="button"]') as HTMLDivElement;

      const candidates = collectShadowSelectorCandidates({
        element: target,
        selectorResult: {
          selector: '[role="button"]',
          priority: 'attribute',
          rank: 3,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
        enableStructuralParity: true,
      });

      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '.user-role-field div[role="button"][aria-haspopup="listbox"]',
          family: 'tight-container-css',
          source: 'shadow',
          matchCount: 1,
        }),
      ]));
    });
  });
});
