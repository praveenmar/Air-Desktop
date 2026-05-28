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
      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
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
      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.fieldLabelText).toBe('User Role');
      expect(proof.fieldRelation).toBe('sibling-label');
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
          kind: 'data-testid',
          isClean: true,
        }),
      ]));
      expect(proof.blockedReason).toBeNull();
    });
  });

  it('binds OrangeHRM-style custom trigger shells back to the labelled container', async () => {
    await withBrowserGlobals(`
      <div class="oxd-input-group">
        <label>User Role</label>
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text">
            <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
          </div>
        </div>
      </div>
      <div class="oxd-input-group">
        <label>Status</label>
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text">
            <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
          </div>
        </div>
      </div>
    `, 'https://example.test/admin', async () => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector('.oxd-select-text') as HTMLDivElement;
      const canonicalTargetInfo = selectorEngine.resolveCanonicalCustomControlTarget(rawTarget, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      const proof = selectorEngine.resolveLabelContextEvidence({
        element: rawTarget,
        selectorResult: {
          selector: '.oxd-select-text',
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
      expect(proof.fieldRelation).toBe('sibling-label');
      expect(proof.targetControlKind).toBe('custom-trigger');
      expect(proof.usedCanonicalTarget).toBe(true);
      expect(proof.visibleControlCountInContainer).toBe(1);
      expect(proof.cleanChildSelector).toBe('div.oxd-select-text-input');
      expect(proof.containerSelector).toBe('div.oxd-input-group');
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
      expect('rawTarget' in proof).toBe(false);
      expect('effectiveTarget' in proof).toBe(false);
      expect(proof.fieldLabelText).toBeNull();
      expect(proof.blockedReason).toBe('bounded-field-multiple-targets');
      expect(proof.warningCodes).toContain('bounded-field-multiple-targets');
    });
  });

  describe('false label carry-through prevention for custom triggers', () => {
    const orangeHrmHtml = `
      <div class="oxd-input-group">
        <div class="oxd-input-group__label-wrapper">
          <label>User Role</label>
        </div>
        <div class="oxd-select-wrapper">
          <div class="oxd-select-text">
            <span class="oxd-select-text-value">Admin</span>
            <i class="oxd-icon"></i>
          </div>
        </div>
      </div>
    `;

    const runLabelResolution = async (selector: string) => {
      const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
      const rawTarget = document.querySelector(selector) as HTMLElement;
      const canonicalTargetInfo = selectorEngine.resolveCanonicalCustomControlTarget(rawTarget, {
        eventType: 'custom-control-open',
        trigger: 'trigger-click',
      });

      return selectorEngine.resolveLabelContextEvidence({
        element: rawTarget,
        selectorResult: {
          selector,
          priority: 'class',
          rank: 7,
        },
        eventContext: {
          eventType: 'custom-control-open',
          trigger: 'trigger-click',
        },
        canonicalTargetInfo,
      });
    };

    it('resolves the correct label when clicking the trigger container', async () => {
      await withBrowserGlobals(orangeHrmHtml, 'https://example.test/admin', async () => {
        const proof = await runLabelResolution('.oxd-select-text');
        expect(proof.isValid).toBe(true);
        expect(proof.fieldLabelText).toBe('User Role');
      });
    });

    it('resolves the correct label when clicking the inner value text', async () => {
      await withBrowserGlobals(orangeHrmHtml, 'https://example.test/admin', async () => {
        const proof = await runLabelResolution('.oxd-select-text-value');
        expect(proof.isValid).toBe(true);
        expect(proof.fieldLabelText).toBe('User Role');
      });
    });

    it('resolves the correct label when clicking the icon leaf node', async () => {
      await withBrowserGlobals(orangeHrmHtml, 'https://example.test/admin', async () => {
        const proof = await runLabelResolution('.oxd-icon');
        expect(proof.isValid).toBe(true);
        expect(proof.fieldLabelText).toBe('User Role');
      });
    });

    it('keeps broad repeated-dropdown containers blocked when clicking an icon leaf', async () => {
      await withBrowserGlobals(`
        <div class="filters-panel">
          <label>Filters</label>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text">
              <span class="oxd-select-text-value">Admin</span>
              <i class="oxd-icon"></i>
            </div>
          </div>
          <div class="oxd-select-wrapper">
            <div class="oxd-select-text">
              <span class="oxd-select-text-value">Enabled</span>
              <i class="oxd-icon"></i>
            </div>
          </div>
        </div>
      `, 'https://example.test/admin', async () => {
        const proof = await runLabelResolution('.oxd-select-wrapper .oxd-icon');
        expect(proof.isValid).toBe(false);
        expect(proof.fieldLabelText).toBeNull();
        expect(proof.blockedReason).toBe('bounded-field-multiple-targets');
        expect(proof.warningCodes).toContain('bounded-field-multiple-targets');
      });
    });

    it('pairs repeated OrangeHRM dropdowns to the correct field labels', async () => {
      await withBrowserGlobals(`
        <div class="oxd-grid-row">
          <div class="oxd-grid-item">
            <div class="oxd-input-group">
              <div class="oxd-input-group__label-wrapper">
                <label>User Role</label>
              </div>
              <div class="oxd-select-wrapper">
                <div class="oxd-select-text">
                  <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
                  <div class="oxd-select-dropdown">
                    <div class="oxd-select-option" role="option">Admin</div>
                    <div class="oxd-select-option" role="option">ESS</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="oxd-grid-item">
            <div class="oxd-input-group">
              <div class="oxd-input-group__label-wrapper">
                <label>Status</label>
              </div>
              <div class="oxd-select-wrapper">
                <div class="oxd-select-text">
                  <div class="oxd-select-text-input" tabindex="0">-- Select --</div>
                  <div class="oxd-select-dropdown">
                    <div class="oxd-select-option" role="option">Enabled</div>
                    <div class="oxd-select-option" role="option">Disabled</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `, 'https://example.test/admin', async () => {
        const selectorEngine = await import('../../packages/vscode-extension/interceptor/selector-engine/index.js');
        const firstTarget = document.querySelector('.oxd-grid-item:first-of-type .oxd-select-text') as HTMLElement;
        const secondTarget = document.querySelector('.oxd-grid-item:last-of-type .oxd-select-text') as HTMLElement;

        const firstProof = selectorEngine.resolveLabelContextEvidence({
          element: firstTarget,
          selectorResult: {
            selector: '.oxd-select-text',
            priority: 'class',
            rank: 7,
          },
          eventContext: {
            eventType: 'custom-control-open',
            trigger: 'trigger-click',
          },
          canonicalTargetInfo: selectorEngine.resolveCanonicalCustomControlTarget(firstTarget, {
            eventType: 'custom-control-open',
            trigger: 'trigger-click',
          }),
        });

        const secondProof = selectorEngine.resolveLabelContextEvidence({
          element: secondTarget,
          selectorResult: {
            selector: '.oxd-select-text',
            priority: 'class',
            rank: 7,
          },
          eventContext: {
            eventType: 'custom-control-open',
            trigger: 'trigger-click',
          },
          canonicalTargetInfo: selectorEngine.resolveCanonicalCustomControlTarget(secondTarget, {
            eventType: 'custom-control-open',
            trigger: 'trigger-click',
          }),
        });

        expect(firstProof.isValid).toBe(true);
        expect(firstProof.fieldLabelText).toBe('User Role');
        expect(secondProof.isValid).toBe(true);
        expect(secondProof.fieldLabelText).toBe('Status');
      });
    });
  });
});
