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

describe('selector engine preference tiers', () => {
  it('prefers strong direct selectors over fallback class and text candidates', async () => {
    await withBrowserGlobals(`
      <button data-testid="save-user" class="save-button">Save User</button>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('button') as HTMLButtonElement;
      const candidates = selectorEngine.collectShadowSelectorCandidates({
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

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        candidates,
      });

      expect(preference.bestSelector).toEqual(expect.objectContaining({
        family: 'test-id',
        tier: 'preferred',
      }));
      expect(preference.selectorChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          family: 'class',
          tier: 'fallback',
        }),
        expect.objectContaining({
          family: 'text',
          tier: 'fallback',
        }),
      ]));
    });
  });

  it('prefers valid bounded-field proof over weaker custom-trigger label-only context', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">-- Select --</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.field-row .select-trigger') as HTMLDivElement;
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
      const labelContextEvidence = selectorEngine.resolveLabelContextEvidence({
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
      const accessibilityEvidence = selectorEngine.resolveAccessibilityEvidence({
        element: target,
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        candidates: selectorEngine.collectShadowSelectorCandidates({
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
        }),
        boundedFieldContextEvidence,
        labelContextEvidence,
        accessibilityEvidence,
      });

      expect(preference.bestProof).toEqual(expect.objectContaining({
        path: 'bounded-field',
        tier: 'preferred',
      }));
      expect(preference.proofChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'label-context',
          tier: 'fallback',
        }),
      ]));
    });
  });

  it('keeps xpath-like indexed selectors as last-resort when stronger selectors exist', async () => {
    const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
    const preference = selectorEngine.buildSelectorPreferenceShadow({
      candidates: [
        {
          selector: '[data-testid="user-role"]',
          family: 'test-id',
          engine: 'css',
          strength: 'strong',
          matchCount: 1,
          visibleMatchCount: 1,
          warningCodes: [],
        },
        {
          selector: '(//div[@role="combobox"])[1]',
          family: 'xpath',
          engine: 'xpath',
          strength: 'weak',
          usesIndex: true,
          matchCount: 1,
          visibleMatchCount: 1,
          warningCodes: [],
        },
      ],
    });

    expect(preference.bestSelector).toEqual(expect.objectContaining({
      family: 'test-id',
      tier: 'preferred',
    }));
    expect(preference.selectorChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        family: 'xpath',
        tier: 'last-resort',
      }),
    ]));
  });

  it('prefers valid option-panel context over generic accessibility proof for listbox options', async () => {
    await withBrowserGlobals(`
      <button type="button" aria-haspopup="listbox" aria-controls="user-role-list">Open</button>
      <div id="user-role-list" role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
        <div role="option">ESS</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#user-role-list [role="option"]') as HTMLDivElement;
      const accessibilityEvidence = selectorEngine.resolveAccessibilityEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });
      const optionPanelContextEvidence = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        candidates: selectorEngine.collectShadowSelectorCandidates({
          element: target,
          selectorResult: {
            selector: '[role="option"]',
            priority: 'role',
            rank: 8,
          },
          eventContext: {
            eventType: 'click',
            trigger: 'click',
          },
        }),
        accessibilityEvidence,
        optionPanelContextEvidence,
      });

      expect(preference.bestProof).toEqual(expect.objectContaining({
        path: 'option-panel-context',
        tier: 'preferred',
      }));
      expect(preference.proofChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'accessibility-role-name',
          tier: 'preferred',
        }),
      ]));
    });
  });

  it('downgrades option-panel proof to fallback when panel binding is incomplete', async () => {
    await withBrowserGlobals(`
      <div role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
        <div role="option">ESS</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('[role="option"]') as HTMLDivElement;
      const optionPanelContextEvidence = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        optionPanelContextEvidence,
      });

      expect(preference.proofChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'option-panel-context',
          tier: 'fallback',
          reasons: expect.arrayContaining(['incomplete-panel-trigger-binding']),
        }),
      ]));
    });
  });

  it('keeps option-panel proof at last-resort when only position separates duplicate option text', async () => {
    await withBrowserGlobals(`
      <div id="user-role-list" role="listbox" aria-label="User Role options">
        <div role="option">Admin</div>
        <div role="option">Admin</div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#user-role-list [role="option"]') as HTMLDivElement;
      const optionPanelContextEvidence = selectorEngine.resolveOptionPanelContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        optionPanelContextEvidence,
      });

      expect(preference.proofChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'option-panel-context',
          tier: 'last-resort',
          reasons: expect.arrayContaining(['blocked:option-panel-duplicate-option-text']),
        }),
      ]));
    });
  });

  it('prefers valid table-row context over generic accessibility proof for unique row actions', async () => {
    await withBrowserGlobals(`
      <table id="users-table" aria-label="System Users">
        <tbody>
          <tr><td>Alice</td><td><button>Edit</button></td></tr>
          <tr><td>Bob</td><td><button>Edit</button></td></tr>
        </tbody>
      </table>
    `, 'https://example.test/users', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('tbody tr button') as HTMLButtonElement;
      const accessibilityEvidence = selectorEngine.resolveAccessibilityEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });
      const tableRowContextEvidence = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        accessibilityEvidence,
        tableRowContextEvidence,
      });

      expect(preference.bestProof).toEqual(expect.objectContaining({
        path: 'table-row-context',
        tier: 'preferred',
      }));
    });
  });

  it('keeps table-row proof at last-resort when partial row/action context still requires positional fallback', async () => {
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
      const tableRowContextEvidence = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        tableRowContextEvidence,
      });

      expect(preference.proofChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'table-row-context',
          tier: 'last-resort',
          reasons: expect.arrayContaining([
            'partial-table-row-proof',
            'incomplete-table-binding',
            'positional-disambiguation-required',
          ]),
        }),
      ]));
    });
  });

  it('keeps table-row proof at last-resort when row identity requires positional fallback', async () => {
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
      const tableRowContextEvidence = selectorEngine.resolveTableRowContextEvidence({
        element: target,
        eventContext: {
          eventType: 'click',
          trigger: 'click',
        },
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        tableRowContextEvidence,
      });

      expect(preference.proofChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          path: 'table-row-context',
          tier: 'last-resort',
          reasons: expect.arrayContaining(['positional-disambiguation-required']),
        }),
      ]));
    });
  });
});
