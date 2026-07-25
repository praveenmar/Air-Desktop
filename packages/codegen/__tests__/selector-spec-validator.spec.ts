import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  buildBoundedFieldSelectorSpec,
  buildScopedSelectorSpec,
  buildSelectorSpec,
  canRenderSelectorSpecConfidently,
  renderLocatorExpressionFromSelectorSpec,
} from '../src/selector-spec';
import { validateSelectorSpec } from '../src/selector-resolver';

function makeDocument(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

describe('selector spec validator', () => {
  it('keeps flat css selector validation unchanged', () => {
    const snapshot = makeDocument(`
      <div>
        <input name="username" />
      </div>
    `);

    const spec = buildSelectorSpec({
      selector: 'input[name="username"]',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });

  it('keeps flat text selector validation unchanged', () => {
    const snapshot = makeDocument(`
      <div>
        <button>Search</button>
      </div>
    `);

    const spec = buildSelectorSpec({
      selector: 'button:has-text("Search")',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });

  it.each([
    {
      title: 'data-testid with embedded double quotes',
      html: `<button data-testid='save-"draft"'>Save</button>`,
      selector: `[data-testid="save-\\"draft\\""]`,
    },
    {
      title: 'aria-label with embedded double quotes',
      html: `<button aria-label='Save "Draft"'>Save</button>`,
      selector: `[aria-label="Save \\"Draft\\""]`,
    },
    {
      title: 'name with square brackets',
      html: `<input name="user[email]" />`,
      selector: `input[name="user[email]"]`,
    },
    {
      title: 'placeholder with apostrophe',
      html: `<input placeholder="What's your name?" />`,
      selector: `input[placeholder="What's your name?"]`,
    },
    {
      title: 'data-testid containing a closing bracket',
      html: `<button data-testid="invite]user">Invite</button>`,
      selector: `[data-testid="invite]user"]`,
    },
    {
      title: 'data-testid containing an apostrophe',
      html: `<button data-testid="author's-choice">Choose</button>`,
      selector: `[data-testid="author's-choice"]`,
    },
    {
      title: 'data-testid containing a backslash',
      html: `<button data-testid="path\\to\\field">Open</button>`,
      selector: `[data-testid="path\\\\to\\\\field"]`,
    },
    {
      title: 'data-testid containing newline escapes',
      html: `<button data-testid="line1&#10;line2">Open</button>`,
      selector: `[data-testid="line1\\A line2"]`,
    },
  ])('keeps escaped attribute selector validation safe for $title', ({ html, selector }) => {
    const snapshot = makeDocument(`<div>${html}</div>`);
    const spec = buildSelectorSpec({
      selector,
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });

  it('validates a scoped selector when the parent has one visible child target', () => {
    const snapshot = makeDocument(`
      <div data-testid="username-field">
        <label>Username</label>
        <input />
      </div>
    `);

    const scope = buildSelectorSpec({
      selector: '[data-testid="username-field"]',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });
    const target = buildSelectorSpec({
      selector: 'input',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });
    const spec = buildScopedSelectorSpec({
      selector: 'scoped("[data-testid=\\"username-field\\"] -> input")',
      scope,
      target,
      relation: 'parent-child',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });

  it('blocks a scoped selector when the parent has two visible child targets', () => {
    const snapshot = makeDocument(`
      <div data-testid="username-field">
        <input />
        <input />
      </div>
    `);

    const spec = buildScopedSelectorSpec({
      selector: 'scoped("[data-testid=\\"username-field\\"] -> input")',
      scope: buildSelectorSpec({
        selector: '[data-testid="username-field"]',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      target: buildSelectorSpec({
        selector: 'input',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      relation: 'parent-child',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('non-unique');
    expect(validation.effectiveMatchCount).toBe(2);
  });

  it('blocks a scoped selector when the parent scope is missing', () => {
    const snapshot = makeDocument(`<div></div>`);

    const spec = buildScopedSelectorSpec({
      selector: 'scoped("[data-testid=\\"username-field\\"] -> input")',
      scope: buildSelectorSpec({
        selector: '[data-testid="username-field"]',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      target: buildSelectorSpec({
        selector: 'input',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      relation: 'parent-child',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('no-visible-match');
  });

  it('blocks a scoped selector when the child target is missing inside scope', () => {
    const snapshot = makeDocument(`
      <div data-testid="username-field">
        <textarea></textarea>
      </div>
    `);

    const spec = buildScopedSelectorSpec({
      selector: 'scoped("[data-testid=\\"username-field\\"] -> input")',
      scope: buildSelectorSpec({
        selector: '[data-testid="username-field"]',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      target: buildSelectorSpec({
        selector: 'input',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      relation: 'parent-child',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('no-visible-match');
  });

  it('renders a scoped spec as parent.locator(child)', () => {
    const spec = buildScopedSelectorSpec({
      selector: 'scoped("[data-testid=\\"username-field\\"] -> input")',
      scope: buildSelectorSpec({
        selector: '[data-testid="username-field"]',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      target: buildSelectorSpec({
        selector: 'input',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      relation: 'parent-child',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
    });

    expect(renderLocatorExpressionFromSelectorSpec(spec)).toBe(
      'locator("[data-testid=\\"username-field\\"]").locator("input")',
    );
    expect(canRenderSelectorSpecConfidently(spec)).toBe(true);
  });

  it('does not treat blocked scoped specs as confident renderable selectors', () => {
    const spec = buildScopedSelectorSpec({
      selector: 'scoped("[data-testid=\\"username-field\\"] -> input")',
      scope: buildSelectorSpec({
        selector: '[data-testid="username-field"]',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      target: buildSelectorSpec({
        selector: 'input',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      }),
      relation: 'parent-child',
      source: 'resolver',
      proofLevel: 'blocked',
      rejectReason: 'multiple_input_like_targets',
    });

    expect(canRenderSelectorSpecConfidently(spec)).toBe(false);
  });

  it('routes bounded label-context proof through the central validator', () => {
    const snapshot = makeDocument(`
      <div data-testid="username-field">
        <label>Username</label>
        <input />
      </div>
    `);

    const spec = buildSelectorSpec({
      selector: 'label-context("Username" within [data-testid=\\"username-field\\"] -> input)',
      engine: 'label-context',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
      labelContext: {
        source: 'snapshot-label-context',
        labelText: 'Username',
        targetTag: 'input',
        association: 'bounded-field',
        containerSelector: '[data-testid="username-field"]',
      },
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });

  it('routes bounded trigger-context proof through the central validator', () => {
    const snapshot = makeDocument(`
      <div data-testid="user-role-field">
        <label>User Role</label>
        <div class="select-trigger" role="button" aria-haspopup="listbox"></div>
      </div>
    `);

    const spec = buildSelectorSpec({
      selector: 'trigger-context("User Role" within [data-testid=\\"user-role-field\\"] -> .select-trigger)',
      engine: 'trigger-context',
      source: 'resolver',
      proofLevel: 'snapshot_validated',
      triggerContext: {
        source: 'snapshot-trigger-context',
        labelText: 'User Role',
        association: 'bounded-field',
        triggerSelector: '.select-trigger',
        cleanChildSelector: '.select-trigger',
        containerSelector: '[data-testid="user-role-field"]',
        labelElementTag: 'label',
      },
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });

  it('routes bounded-field proof through the central validator', () => {
    const snapshot = makeDocument(`
      <div class="field-row">
        <div>Username</div>
        <input />
      </div>
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" within div.field-row -> input)',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({
          selector: 'input',
          source: 'resolver',
          proofLevel: 'snapshot_validated',
        }),
        controlKind: 'input',
        relation: 'bounded-container',
        originalSelector: '.generic-input',
        containerSelector: 'div.field-row',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.effectiveMatchCount).toBe(1);
  });
});
