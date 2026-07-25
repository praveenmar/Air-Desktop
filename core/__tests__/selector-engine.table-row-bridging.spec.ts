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

describe('selector engine table-row selector bridging', () => {
  it('produces preferred proof-backed proposals for uniquely bound row action', async () => {
    await withBrowserGlobals(`
      <table id="users-table" aria-label="System Users">
        <thead>
          <tr><th>Name</th><th>Role</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr><td>Alice</td><td>Admin</td><td><button class="edit-btn">Edit</button></td></tr>
          <tr><td>Bob</td><td>ESS</td><td><button class="edit-btn">Edit</button></td></tr>
        </tbody>
      </table>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('tbody tr button') as HTMLButtonElement;
      
      const proof = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const proposals = selectorEngine.collectTableRowSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
        tableRowContextEvidence: proof,
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        tableRowContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual([
        expect.objectContaining({
          selector: '//table[@id="users-table"]//tr[.//*[contains(normalize-space(.), "Alice")]]//button[contains(concat(" ", normalize-space(@class), " "), " edit-btn ")]',
          family: 'xpath',
          engine: 'xpath',
          proposalSource: 'table-row',
          proposalTierHint: 'preferred',
        }),
      ]);
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '//table[@id="users-table"]//tr[.//*[contains(normalize-space(.), "Alice")]]//button[contains(concat(" ", normalize-space(@class), " "), " edit-btn ")]',
        tier: 'preferred',
        proposalSource: 'table-row',
      }));
    });
  });

  it('downgrades table-row proposals to fallback when table binding is incomplete', async () => {
    await withBrowserGlobals(`
      <table class="grid-table">
        <tbody>
          <tr><td>Alice</td><td><button>Edit</button></td></tr>
        </tbody>
      </table>
      <table class="grid-table">
        <tbody>
          <tr><td>Bob</td><td><button>Edit</button></td></tr>
        </tbody>
      </table>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('table button') as HTMLButtonElement;
      
      const proof = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const proposals = selectorEngine.collectTableRowSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
        tableRowContextEvidence: proof,
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        tableRowContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual([
        expect.objectContaining({
          selector: '//table[contains(concat(" ", normalize-space(@class), " "), " grid-table ")]//tr[.//*[contains(normalize-space(.), "Alice")]]//button',
          family: 'xpath',
          engine: 'xpath',
          proposalSource: 'table-row',
          proposalTierHint: 'fallback',
          warningCodes: expect.arrayContaining(['incomplete-table-binding']),
        }),
      ]);
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '//table[contains(concat(" ", normalize-space(@class), " "), " grid-table ")]//tr[.//*[contains(normalize-space(.), "Alice")]]//button',
        tier: 'fallback',
        proposalSource: 'table-row',
      }));
    });
  });

  it('emits a positional last-resort proposal when duplicate row identity forces row index fallback', async () => {
    await withBrowserGlobals(`
      <table id="users-table">
        <tbody>
          <tr><td>Alice</td><td><button class="edit-btn">Edit</button></td></tr>
          <tr><td>Alice</td><td><button class="edit-btn">Edit</button></td></tr>
        </tbody>
      </table>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelectorAll('#users-table tbody tr button')[1] as HTMLButtonElement;
      
      const proof = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const proposals = selectorEngine.collectTableRowSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
        tableRowContextEvidence: proof,
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        tableRowContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual([
        expect.objectContaining({
          selector: '(//table[@id="users-table"]//tr[.//*[contains(normalize-space(.), "Alice")]])[2]//button[contains(concat(" ", normalize-space(@class), " "), " edit-btn ")]',
          family: 'xpath',
          engine: 'xpath',
          proposalSource: 'table-row',
          proposalTierHint: 'last-resort',
          usesIndex: true,
          requiresPositionalDisambiguation: true,
          warningCodes: expect.arrayContaining([
            'ambiguous-row-binding',
            'positional-fallback-only',
          ]),
        }),
      ]);
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '(//table[@id="users-table"]//tr[.//*[contains(normalize-space(.), "Alice")]])[2]//button[contains(concat(" ", normalize-space(@class), " "), " edit-btn ")]',
        tier: 'last-resort',
        proposalSource: 'table-row',
      }));
    });
  });

  it('blocks table-row proposals when duplicate row identity cannot be disambiguated safely', async () => {
    await withBrowserGlobals(`
      <div role="grid">
        <div role="row">
          <div role="gridcell">Alice</div>
          <div role="gridcell"><svg class="icon"></svg></div>
        </div>
        <div role="row">
          <div role="gridcell">Alice</div>
          <div role="gridcell"><svg class="icon"></svg></div>
        </div>
      </div>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelectorAll('[role="row"] svg.icon')[0] as SVGElement;
      
      const proposals = selectorEngine.collectTableRowSelectorProposals({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proposals.blockedReason).toBe('table-row-no-action-binding');
      expect(proposals.proposals).toEqual([]);
    });
  });
});
