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

describe('selector engine modular accessibility proof', () => {
  it('resolves native textbox label associations', async () => {
    await withBrowserGlobals(`
      <div>
        <label for="username">Username</label>
        <input id="username" name="username" />
      </div>
    `, 'https://example.test/admin', async () => {
      const { resolveAccessibilityEvidence } = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#username') as HTMLInputElement;

      const evidence = resolveAccessibilityEvidence({
        element: target,
      });

      expect('rawTarget' in evidence).toBe(false);
      expect('effectiveTarget' in evidence).toBe(false);
      expect(evidence.role).toBe('textbox');
      expect(evidence.roleSource).toBe('native-role');
      expect(evidence.accessibleName).toBe('Username');
      expect(evidence.accessibleNameSource).toBe('label-for');
      expect(evidence.isNativeLabelAssociation).toBe(true);
      expect(evidence.usedCanonicalTarget).toBe(false);
      expect(evidence.blockedReason).toBeNull();
    });
  });

  it('keeps stronger raw wrapper semantics when canonical child is only visual text', async () => {
    await withBrowserGlobals(`
      <span id="user-role-label">User Role</span>
      <div class="select-trigger" role="combobox" aria-labelledby="user-role-label">
        <div class="select-trigger-input" tabindex="0">-- Select --</div>
        <div class="select-trigger-icon" aria-hidden="true"></div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.select-trigger') as HTMLDivElement;
      const evidence = selectorEngine.resolveAccessibilityEvidence({
        element: rawTarget,
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });

      expect('rawTarget' in evidence).toBe(false);
      expect('effectiveTarget' in evidence).toBe(false);
      expect(evidence.role).toBe('combobox');
      expect(evidence.roleSource).toBe('explicit-role');
      expect(evidence.accessibleName).toBe('User Role');
      expect(evidence.accessibleNameSource).toBe('aria-labelledby');
      expect(evidence.usedCanonicalTarget).toBe(false);
      expect(evidence.proofTargetSummary).toEqual(expect.objectContaining({
        role: 'combobox',
      }));
    });
  });

  it('uses canonical descendant semantics when the meaningful role lives on the inner node', async () => {
    await withBrowserGlobals(`
      <div class="action-shell">
        <div role="button" tabindex="0">Save Changes</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.action-shell') as HTMLDivElement;
      const evidence = selectorEngine.resolveAccessibilityEvidence({
        element: rawTarget,
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });

      expect('rawTarget' in evidence).toBe(false);
      expect('effectiveTarget' in evidence).toBe(false);
      expect(evidence.usedCanonicalTarget).toBe(true);
      expect(evidence.role).toBe('button');
      expect(evidence.roleSource).toBe('explicit-role');
      expect(evidence.accessibleName).toBe('Save Changes');
      expect(evidence.accessibleNameSource).toBe('role-text');
    });
  });
});
