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

describe('selector engine shadow label context proof', () => {
  it('resolves native label-for associations without needing bounded container proof', async () => {
    await withBrowserGlobals(`
      <div data-testid="username-field">
        <label for="username">Username</label>
        <input id="username" name="username" />
      </div>
    `, 'https://example.test/admin', async () => {
      const { resolveLabelContextEvidence } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#username') as HTMLInputElement;

      const proof = resolveLabelContextEvidence({
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

      expect(proof.isValid).toBe(true);
      expect(proof.fieldLabelText).toBe('Username');
      expect(proof.fieldRelation).toBe('label-for');
      expect(proof.targetControlKind).toBe('input');
      expect(proof.usedCanonicalTarget).toBe(false);
      expect(proof.cleanChildSelector).toBe('input[name="username"]');
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('uses the canonical inner node for child proof while preserving raw custom trigger scope', async () => {
    await withBrowserGlobals(`
      <div data-testid="user-role-field" class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
          <div class="select-trigger-icon" aria-hidden="true"></div>
        </div>
      </div>
      <div data-testid="status-field" class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
          <div class="select-trigger-icon" aria-hidden="true"></div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.field-row .select-trigger') as HTMLDivElement;
      const canonicalTargetInfo = selectorEngine.resolveCanonicalCustomControlTarget(rawTarget, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      const proof = selectorEngine.resolveLabelContextEvidence({
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
        canonicalTargetInfo,
      });

      expect(proof.isValid).toBe(true);
      expect(proof.fieldLabelText).toBe('User Role');
      expect(proof.fieldRelation).toBe('bounded-container');
      expect(proof.targetControlKind).toBe('custom-trigger');
      expect(proof.usedCanonicalTarget).toBe(true);
      expect(proof.visibleControlCountInContainer).toBe(1);
      expect(proof.competingControlCount).toBe(0);
      expect(proof.targetIndexWithinContainer).toBe(0);
      expect(proof.cleanParentSelector).toBe('[data-testid="user-role-field"]');
      expect(proof.cleanChildSelector).toBe('div.select-trigger-input');
      expect(proof.containerSelector).toBe('[data-testid="user-role-field"]');
      expect(proof.boundedContainerSelectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '[data-testid="user-role-field"]',
          isClean: true,
        }),
      ]));
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('fails closed when a labelled container still has multiple trigger-like targets', async () => {
    await withBrowserGlobals(`
      <div data-testid="user-role-field">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
        <div class="select-trigger secondary" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.select-trigger') as HTMLDivElement;
      const canonicalTargetInfo = selectorEngine.resolveCanonicalCustomControlTarget(rawTarget, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      const proof = selectorEngine.resolveLabelContextEvidence({
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
        canonicalTargetInfo,
      });

      expect(proof.isValid).toBe(false);
      expect(proof.fieldLabelText).toBeNull();
      expect(proof.blockedReason).toBe('multiple-control-like-targets');
      expect(proof.warningCodes).toContain('multiple-control-like-targets');
    });
  });
});
