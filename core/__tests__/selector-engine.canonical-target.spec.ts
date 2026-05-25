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

describe('selector engine canonical custom-control targets', () => {
  it('chooses the inner meaningful node for repeated custom triggers without replacing raw candidates', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
          <div class="select-trigger-icon" aria-hidden="true"></div>
        </div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
          <div class="select-trigger-icon" aria-hidden="true"></div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.field-row .select-trigger') as HTMLDivElement;

      const canonical = selectorEngine.resolveCanonicalCustomControlTarget(rawTarget, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      expect(canonical.canonicalDiffers).toBe(true);
      expect(canonical.rawTargetSummary).toEqual(expect.objectContaining({
        classList: 'select-trigger',
      }));
      expect(canonical.canonicalTargetSummary).toEqual(expect.objectContaining({
        classList: 'select-trigger-input',
        textExcerpt: '-- Select --',
        tabIndex: '0',
      }));
      expect(canonical.canonicalReason).toBe('focusable-text-descendant');
      expect(canonical.canonicalConfidence).toBeGreaterThan(0.75);

      const candidates = selectorEngine.collectShadowSelectorCandidates({
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

      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: 'div.select-trigger',
          family: 'class',
          source: 'shadow',
        }),
        expect.objectContaining({
          selector: 'div.select-trigger-input',
          family: 'class',
          source: 'shadow',
        }),
      ]));
    });
  });

  it('fails closed when multiple equally plausible descendants exist', async () => {
    await withBrowserGlobals(`
      <div class="select-trigger" aria-haspopup="listbox">
        <div class="trigger-value" tabindex="0">-- Select --</div>
        <div class="trigger-mirror" tabindex="0">-- Select --</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.select-trigger') as HTMLDivElement;

      const canonical = selectorEngine.resolveCanonicalCustomControlTarget(rawTarget, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      expect(canonical.canonicalDiffers).toBe(false);
      expect(canonical.canonicalTargetSummary).toBeNull();
      expect(canonical.blockedReason).toBe('ambiguous-descendants');

      const candidates = selectorEngine.collectShadowSelectorCandidates({
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

      expect(candidates.some((candidate) => candidate.selector === 'div.trigger-value')).toBe(false);
      expect(candidates.some((candidate) => candidate.selector === 'div.trigger-mirror')).toBe(false);
      expect(candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: 'div.select-trigger',
          family: 'class',
        }),
      ]));
    });
  });
});
