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

describe('selector engine option-panel selector bridging', () => {
  it('produces proof-backed proposals for a uniquely bound listbox option', async () => {
    await withBrowserGlobals(`
      <button type="button" aria-haspopup="listbox" aria-controls="user-role-list">Open</button>
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

      const proposals = selectorEngine.collectOptionPanelSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
        optionPanelContextEvidence: proof,
      });
      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        optionPanelContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual([
        expect.objectContaining({
          selector: '#user-role-list div[role="option"]:has-text("Admin")',
          family: 'parent-scoped-text-css',
          proposalSource: 'option-panel',
          proposalTierHint: 'preferred',
        }),
      ]);
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '#user-role-list div[role="option"]:has-text("Admin")',
        proposalSource: 'option-panel',
        tier: 'preferred',
      }));
    });
  });

  it('downgrades proof-backed option-panel proposals to fallback when trigger binding is incomplete', async () => {
    await withBrowserGlobals(`
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

      const proposals = selectorEngine.collectOptionPanelSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
        optionPanelContextEvidence: proof,
      });
      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        optionPanelContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual([
        expect.objectContaining({
          selector: '#user-role-list div[role="option"]:has-text("Admin")',
          family: 'parent-scoped-text-css',
          proposalSource: 'option-panel',
          proposalTierHint: 'fallback',
          warningCodes: expect.arrayContaining(['incomplete-trigger-binding']),
        }),
      ]);
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '#user-role-list div[role="option"]:has-text("Admin")',
        tier: 'fallback',
        proposalSource: 'option-panel',
      }));
    });
  });

  it('emits a positional last-resort proposal when duplicate option text can only be disambiguated by index', async () => {
    await withBrowserGlobals(`
      <div id="user-role-list" role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
        <div role="option">Admin</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelectorAll('#user-role-list [role="option"]')[1] as HTMLDivElement;

      const proposals = selectorEngine.collectOptionPanelSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });
      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual([
        expect.objectContaining({
          selector: '#user-role-list div[role="option"]:nth-of-type(2)',
          family: 'parent-scoped-css',
          proposalSource: 'option-panel',
          proposalTierHint: 'last-resort',
          usesIndex: true,
          requiresPositionalDisambiguation: true,
          warningCodes: expect.arrayContaining([
            'incomplete-trigger-binding',
            'ambiguous-item-binding',
            'positional-fallback-only',
          ]),
        }),
      ]);
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '#user-role-list div[role="option"]:nth-of-type(2)',
        tier: 'last-resort',
        proposalSource: 'option-panel',
      }));
    });
  });

  it('bridges a menu wrapper item to a unique actionable descendant when href-backed child is available', async () => {
    await withBrowserGlobals(`
      <button type="button" aria-haspopup="menu" aria-controls="user-menu">Open Menu</button>
      <ul id="user-menu" role="menu" aria-label="User menu">
        <li class="menu-item"><a role="menuitem" href="/profile">Profile</a></li>
        <li class="menu-item"><a role="menuitem" href="/logout">Logout</a></li>
      </ul>
    `, 'https://example.test/account', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelectorAll('#user-menu li')[1] as HTMLLIElement;
      const proof = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const proposals = selectorEngine.collectOptionPanelSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
        optionPanelContextEvidence: proof,
      });
      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        optionPanelContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '#user-menu a[href="/logout"]',
          family: 'parent-scoped-css',
          proposalSource: 'option-panel',
          proposalTierHint: 'preferred',
          warningCodes: expect.arrayContaining(['actionable-descendant-bridge']),
        }),
      ]));
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '#user-menu li.menu-item:has-text("Logout")',
        proposalSource: 'option-panel',
        tier: 'preferred',
      }));
    });
  });

  it('fails closed for descendant bridging when a menu wrapper contains multiple actionable descendants', async () => {
    await withBrowserGlobals(`
      <button type="button" aria-haspopup="menu" aria-controls="user-menu">Open Menu</button>
      <ul id="user-menu" role="menu" aria-label="User menu">
        <li class="menu-item">
          <a role="menuitem" href="/logout">Logout</a>
          <button type="button">More</button>
        </li>
      </ul>
    `, 'https://example.test/account', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#user-menu li') as HTMLLIElement;

      const proposals = selectorEngine.collectOptionPanelSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const descendantSelectors = proposals.proposals
        .map((candidate: { selector: string }) => candidate.selector)
        .filter((selector: string) => selector.includes('a[href="/logout"]') || selector.includes('button'));

      expect(descendantSelectors).toEqual([]);
    });
  });

  it('blocks option-panel proposals when multiple active panels cannot be disambiguated safely', async () => {
    await withBrowserGlobals(`
      <div role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
      </div>
      <div role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('[role="option"]') as HTMLDivElement;

      const proposals = selectorEngine.collectOptionPanelSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proposals.blockedReason).toBe('option-panel-multiple-panels');
      expect(proposals.proposals).toEqual([]);
    });
  });
});
