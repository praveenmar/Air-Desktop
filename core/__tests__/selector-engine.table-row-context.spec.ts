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

describe('selector engine table/grid row context proof', () => {
  it('resolves unique row identity and action binding for table row actions', async () => {
    await withBrowserGlobals(`
      <table id="users-table" aria-label="System Users">
        <thead>
          <tr><th>Name</th><th>Role</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr><td>Alice</td><td>Admin</td><td><button>Edit</button></td></tr>
          <tr><td>Bob</td><td>ESS</td><td><button>Edit</button></td></tr>
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

      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.tableSelector).toBe('#users-table');
      expect(proof.tableLabelText).toBe('System Users');
      expect(proof.columnHeaderText).toBe('Actions');
      expect(proof.rowIdentityTexts).toEqual(['Alice']);
      expect(proof.rowIdentityMode).toBe('single-text');
      expect(proof.rowScopedActionSelector).toBe('#users-table tr:has-text("Alice") button');
      expect(proof.uniqueTableBinding).toBe(true);
      expect(proof.uniqueRowBinding).toBe(true);
      expect(proof.uniqueActionBinding).toBe(true);
      expect(proof.requiresPositionalDisambiguation).toBe(false);
      expect(proof.isValid).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('keeps partial proof when table binding is incomplete but row/action context still exists', async () => {
    await withBrowserGlobals(`
      <table role="grid">
        <tbody>
          <tr><td>Alice</td><td><button>Edit</button></td></tr>
        </tbody>
      </table>
      <table role="grid">
        <tbody>
          <tr><td>Bob</td><td><button>Edit</button></td></tr>
        </tbody>
      </table>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('table[role="grid"] button') as HTMLButtonElement;

      const proof = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proof.tableSelector).toBe('table[role="grid"]');
      expect(proof.matchingTableCount).toBe(2);
      expect(proof.uniqueTableBinding).toBe(false);
      expect(proof.uniqueRowBinding).toBe(true);
      expect(proof.uniqueActionBinding).toBe(true);
      expect(proof.requiresPositionalDisambiguation).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('marks positional disambiguation when duplicate row identity forces row index fallback', async () => {
    await withBrowserGlobals(`
      <table id="users-table">
        <tbody>
          <tr><td>Alice</td><td><button>Edit</button></td></tr>
          <tr><td>Alice</td><td><button>Edit</button></td></tr>
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

      expect(proof.rowIdentityTexts).toEqual(['Alice']);
      expect(proof.matchingRowIdentityCount).toBe(2);
      expect(proof.uniqueRowBinding).toBe(false);
      expect(proof.requiresPositionalDisambiguation).toBe(true);
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('blocks when row identity is duplicated and no action binding can be proven', async () => {
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
      const target = document.querySelector('[role="row"] svg.icon') as SVGElement;

      const proof = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      expect(proof.uniqueRowBinding).toBe(false);
      expect(proof.uniqueActionBinding).toBe(false);
      expect(proof.targetActionIndexWithinRow).toBeNull();
      expect(proof.blockedReason).toBe('table-row-no-action-binding');
    });
  });
});
