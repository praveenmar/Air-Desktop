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

describe('selector engine modular bounded-field core', () => {
  it('returns a legacy-aligned bounded-field shape for repeated custom triggers', async () => {
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
      const { resolveBoundedFieldContextEvidence } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.field-row .select-trigger') as HTMLDivElement;

      const proof = resolveBoundedFieldContextEvidence({
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

      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.fieldLabelText).toBe('User Role');
      expect(proof.fieldRelation).toBe('sibling-label');
      expect(proof.targetControlKind).toBe('custom-trigger');
      expect(proof.usedCanonicalTarget).toBe(true);
      expect(proof.visibleControlCountInContainer).toBe(1);
      expect(proof.targetIndexWithinContainer).toBe(0);
      expect(proof.cleanParentSelector).toBe('[data-testid="user-role-field"]');
      expect(proof.cleanChildSelector).toBe('div.select-trigger-input');
      expect(proof.boundedContainerSelectorCandidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '[data-testid="user-role-field"]',
          kind: 'data-testid',
          isClean: true,
        }),
      ]));
      expect(proof.isValid).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('preserves explicit native label proofs while returning bounded-field-aligned output', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label for="username">Username</label>
        <input id="username" name="username" />
      </div>
    `, 'https://example.test/admin', async () => {
      const { resolveBoundedFieldContextEvidence } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#username') as HTMLInputElement;

      const proof = resolveBoundedFieldContextEvidence({
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

      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.fieldLabelText).toBe('Username');
      expect(proof.fieldRelation).toBe('label-for');
      expect(proof.targetControlKind).toBe('input');
      expect(proof.cleanChildSelector).toBe('input[name="username"]');
      expect(proof.isValid).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('fails closed with legacy-style blocked reasons when repeated triggers remain ambiguous', async () => {
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
      const { resolveBoundedFieldContextEvidence } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.select-trigger') as HTMLDivElement;

      const proof = resolveBoundedFieldContextEvidence({
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

      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.isValid).toBe(false);
      expect(proof.fieldLabelText).toBeNull();
      expect(proof.blockedReason).toBe('bounded-field-multiple-targets');
    });
  });
});
