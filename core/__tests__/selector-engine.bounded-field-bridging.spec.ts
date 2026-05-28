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

describe('selector engine bounded-field selector bridging', () => {
  it('produces a preferred proof-derived selector for repeated native inputs when the scoped proposal is unique', async () => {
    await withBrowserGlobals(`
      <div data-testid="work-email-field" class="field-row">
        <label>Email</label>
        <input name="email" />
      </div>
      <div data-testid="personal-email-field" class="field-row">
        <label>Email</label>
        <input name="email" />
      </div>
    `, 'https://example.test/profile', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('[data-testid="work-email-field"] input') as HTMLInputElement;
      const proof = selectorEngine.resolveBoundedFieldContextEvidence({
        element: target,
        selectorResult: {
          selector: 'input[name="email"]',
          priority: 'name',
          rank: 3,
        },
        eventContext: {
          eventType: 'input',
          trigger: 'input:commit',
        },
      });

      const proposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: target,
        selectorResult: {
          selector: 'input[name="email"]',
          priority: 'name',
          rank: 3,
        },
        eventContext: {
          eventType: 'input',
          trigger: 'input:commit',
        },
        boundedFieldContextEvidence: proof,
      });

      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        boundedFieldContextEvidence: proof,
      });

      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '[data-testid="work-email-field"] input[name="email"]',
          family: 'parent-scoped-css',
          proposalSource: 'bounded-field',
        }),
      ]));
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        selector: '[data-testid="work-email-field"] input[name="email"]',
        tier: 'preferred',
        proposalSource: 'bounded-field',
      }));
    });
  });

  it('produces distinct proof-derived proposals for repeated custom dropdowns', async () => {
    await withBrowserGlobals(`
      <div data-testid="user-role-field" class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
      <div data-testid="status-field" class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const userRoleTarget = document.querySelector('[data-testid="user-role-field"] .select-trigger') as HTMLDivElement;
      const statusTarget = document.querySelector('[data-testid="status-field"] .select-trigger') as HTMLDivElement;

      const userRoleProposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: userRoleTarget,
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
      const statusProposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: statusTarget,
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

      expect(userRoleProposals.blockedReason).toBeNull();
      expect(statusProposals.blockedReason).toBeNull();
      expect(userRoleProposals.proposals[0]).toEqual(expect.objectContaining({
        selector: '[data-testid="user-role-field"] div.select-trigger-input',
      }));
      expect(statusProposals.proposals[0]).toEqual(expect.objectContaining({
        selector: '[data-testid="status-field"] div.select-trigger-input',
      }));
      expect(userRoleProposals.proposals[0]?.selector).not.toBe(statusProposals.proposals[0]?.selector);
    });
  });

  it('does not produce a preferred selector for duplicate labels with weak scoped selectors', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>Email</label>
        <input name="email" />
      </div>
      <div class="field-row">
        <label>Email</label>
        <input name="email" />
      </div>
    `, 'https://example.test/profile', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.field-row input') as HTMLInputElement;

      const proposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: target,
        selectorResult: {
          selector: 'input[name="email"]',
          priority: 'name',
          rank: 3,
        },
        eventContext: {
          eventType: 'input',
          trigger: 'input:commit',
        },
      });
      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
      });

      expect(proposals.proposals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: 'div.field-row input[name="email"]',
          proposalSource: 'bounded-field',
        }),
      ]));
      expect(preference.selectorChoices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: 'div.field-row input[name="email"]',
          tier: 'fallback',
          reasons: expect.arrayContaining([
            'proof-derived-bounded-field',
            'multiple-matches',
          ]),
        }),
      ]));
    });
  });

  it('keeps proposal generation alive when legacy comparison only shows selector-format drift', async () => {
    await withBrowserGlobals(`
      <div class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
      <div class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.field-row .select-trigger') as HTMLDivElement;
      const modularContext = selectorEngine.resolveBoundedFieldContextEvidence({
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
      const exposure = selectorEngine.buildBoundedFieldShadowExposure({
        legacyContext: {
          fieldLabelText: 'User Role',
          fieldRelation: 'sibling-label',
          targetControlKind: 'custom-trigger',
          visibleControlCountInContainer: 1,
          targetIndexWithinContainer: 0,
          boundedContainerSummary: 'div.field-row',
          boundedContainerSelectorCandidates: [
            { selector: '.field-row', kind: 'semantic-class', isClean: true },
          ],
          cleanParentSelector: '.field-row',
          cleanChildSelector: 'div[aria-haspopup="listbox"]',
          containerSelector: '.field-row',
          competingControlCount: 0,
          duplicateLabelCount: 1,
          isValid: true,
          blockedReason: null,
        },
        modularContext,
      });
      const proposals = selectorEngine.collectBoundedFieldSelectorProposals({
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
        boundedFieldContextEvidence: modularContext,
      });

      expect(exposure.mismatchReasonCounts).toEqual(expect.objectContaining({
        'selector-format-drift': expect.any(Number),
      }));
      expect(proposals.blockedReason).toBeNull();
      expect(proposals.proposals.length).toBeGreaterThan(0);
    });
  });

  it('emits a label-anchored fallback for repeated custom triggers when generic field wrappers are shared', async () => {
    await withBrowserGlobals(`
      <div class="oxd-input-group">
        <div class="oxd-input-group__label-wrapper"><label>User Role</label></div>
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text">
            <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
            <i class="oxd-icon bi-caret-down-fill"></i>
          </div>
        </div>
      </div>
      <div class="oxd-input-group">
        <div class="oxd-input-group__label-wrapper"><label>Status</label></div>
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text">
            <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
            <i class="oxd-icon bi-caret-down-fill"></i>
          </div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelectorAll('.oxd-select-text-input')[0] as HTMLDivElement;
      const proof = selectorEngine.resolveBoundedFieldContextEvidence({
        element: target,
        selectorResult: {
          selector: '.oxd-select-text-input',
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });

      const proposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: target,
        selectorResult: {
          selector: '.oxd-select-text-input',
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
        boundedFieldContextEvidence: proof,
      });
      const preference = selectorEngine.buildSelectorPreferenceShadow({
        proposalCandidates: proposals.proposals,
        boundedFieldContextEvidence: proof,
      });

      expect(proof.fieldLabelText).toBe('User Role');
      expect(proposals.proposals).toEqual(expect.arrayContaining([
        expect.objectContaining({
          selector: '//div[contains(concat(" ", normalize-space(@class), " "), " oxd-input-group ")][.//*[normalize-space(.)="User Role"]]//div[contains(concat(" ", normalize-space(@class), " "), " oxd-select-text-input ")]',
          family: 'xpath',
          proposalSource: 'bounded-field',
          warningCodes: expect.arrayContaining(['label-anchored-trigger-scope']),
        }),
      ]));
      expect(preference.bestSelector).toEqual(expect.objectContaining({
        family: 'xpath',
        proposalSource: 'bounded-field',
      }));
    });
  });

  it('keeps the label-anchored bounded-field XPath generic across non-div field wrappers', async () => {
    await withBrowserGlobals(`
      <section class="filter-field">
        <span class="field-label">Region</span>
        <div class="trigger-shell" aria-haspopup="listbox">
          <span class="trigger-value" tabindex="0">-- Select --</span>
        </div>
      </section>
      <section class="filter-field">
        <span class="field-label">Department</span>
        <div class="trigger-shell" aria-haspopup="listbox">
          <span class="trigger-value" tabindex="0">-- Select --</span>
        </div>
      </section>
    `, 'https://example.test/filters', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('.trigger-value') as HTMLSpanElement;

      const proposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: target,
        selectorResult: {
          selector: '.trigger-shell',
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
      });
      const xpathProposal = proposals.proposals.find((candidate: { family: string }) => candidate.family === 'xpath');

      expect(xpathProposal).toEqual(expect.objectContaining({
        selector: '//section[contains(concat(" ", normalize-space(@class), " "), " filter-field ")][.//*[normalize-space(.)="Region"]]//span[contains(concat(" ", normalize-space(@class), " "), " trigger-value ")]',
        matchCount: 1,
        proposalSource: 'bounded-field',
      }));
    });
  });

  it('blocks proposal generation when there is no clean renderable parent scope', async () => {
    await withBrowserGlobals(`
      <div>
        <label for="email-field">Email</label>
        <input id="email-field" name="email" />
      </div>
    `, 'https://example.test/profile', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('#email-field') as HTMLInputElement;

      const proposals = selectorEngine.collectBoundedFieldSelectorProposals({
        element: target,
        selectorResult: {
          selector: '#email-field',
          priority: 'id',
          rank: 1,
        },
        eventContext: {
          eventType: 'input',
          trigger: 'input:commit',
        },
      });

      expect(proposals.blockedReason).toBe('bounded-field-no-renderable-scope');
      expect(proposals.proposals).toEqual([]);
    });
  });

  it('never changes the active shadow candidate output when proposals are generated separately', async () => {
    await withBrowserGlobals(`
      <div data-testid="user-role-field" class="field-row">
        <label>User Role</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
      <div data-testid="status-field" class="field-row">
        <label>Status</label>
        <div class="select-trigger" aria-haspopup="listbox">
          <div class="select-trigger-input" tabindex="0">-- Select --</div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const target = document.querySelector('[data-testid="user-role-field"] .select-trigger') as HTMLDivElement;

      const activeBefore = selectorEngine.collectShadowSelectorCandidates({
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

      selectorEngine.collectBoundedFieldSelectorProposals({
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

      const activeAfter = selectorEngine.collectShadowSelectorCandidates({
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

      expect(activeAfter).toEqual(activeBefore);
    });
  });
});
