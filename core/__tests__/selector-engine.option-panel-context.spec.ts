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

describe('selector engine option/menu/listbox context proof', () => {
  it('resolves listbox option context with linked trigger and scoped selectors', async () => {
    await withBrowserGlobals(`
      <div data-testid="user-role-field" class="field-row">
        <label>User Role</label>
        <div class="select-trigger" tabindex="0" aria-haspopup="listbox" aria-controls="user-role-list">-- Select --</div>
      </div>
      <div id="user-role-list" role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
        <div role="option">ESS</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#user-role-list [role="option"]') as HTMLDivElement;

      const proof = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.itemRole).toBe('option');
      expect(proof.itemName).toBe('Admin');
      expect(proof.containerRole).toBe('listbox');
      expect(proof.containerLabelText).toBe('User Role options');
      expect(proof.containerSelector).toBe('#user-role-list');
      expect(proof.itemSelector).toBe('div[role="option"]');
      expect(proof.scopedItemSelector).toBe('#user-role-list div[role="option"]');
      expect(proof.scopedTextSelector).toBe('#user-role-list div[role="option"]:has-text("Admin")');
      expect(proof.triggerSelector).toBe('div[aria-controls="user-role-list"]');
      expect(proof.triggerRelation).toBe('aria-controls');
      expect(proof.visibleItemCountInContainer).toBe(2);
      expect(proof.targetIndexWithinContainer).toBe(0);
      expect(proof.isValid).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('resolves menu item context from menu container and href-backed item selector', async () => {
    await withBrowserGlobals(`
      <button type="button" aria-haspopup="menu" aria-controls="user-menu">Open Menu</button>
      <ul id="user-menu" role="menu" aria-label="User menu">
        <li><a role="menuitem" href="/profile">Profile</a></li>
        <li><a role="menuitem" href="/logout">Logout</a></li>
      </ul>
    `, 'https://example.test/account', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('a[href="/logout"]') as HTMLAnchorElement;

      const proof = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proof.itemRole).toBe('menuitem');
      expect(proof.itemName).toBe('Logout');
      expect(proof.containerRole).toBe('menu');
      expect(proof.containerLabelText).toBe('User menu');
      expect(proof.containerSelector).toBe('#user-menu');
      expect(proof.itemSelector).toBe('a[href="/logout"]');
      expect(proof.triggerSelector).toBe('button[aria-controls="user-menu"]');
      expect(proof.isValid).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('fails closed when an item has no surrounding option/menu/listbox container', async () => {
    await withBrowserGlobals(`
      <div class="floating-item">Orphan</div>
    `, 'https://example.test/overlay', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.floating-item') as HTMLDivElement;

      const proof = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proof.isValid).toBe(false);
      expect(proof.blockedReason).toBe('option-panel-no-container');
      expect(proof.containerSelector).toBeNull();
    });
  });

  it('blocks duplicate option text when the item cannot be disambiguated beyond position', async () => {
    await withBrowserGlobals(`
      <div id="user-role-list" role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
        <div role="option">Admin</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#user-role-list [role="option"]') as HTMLDivElement;

      const proof = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proof.duplicateItemTextCount).toBe(2);
      expect(proof.uniqueTargetBinding).toBe(false);
      expect(proof.requiresPositionalDisambiguation).toBe(true);
      expect(proof.blockedReason).toBe('option-panel-duplicate-option-text');
    });
  });
});
