import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  buildBoundedFieldSelectorSpec,
  buildSelectorSpec,
  canRenderSelectorSpecConfidently,
  renderLocatorExpressionFromSelectorSpec,
} from '../src/selector-spec';
import { validateSelectorSpec } from '../src/selector-resolver';
import {
  buildBoundedFieldCandidates,
  buildBoundedFieldTriggerCandidates,
} from '../src/resolver/bounded-field';
import type { CodegenStep } from '../src/types';

function makeDocument(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}

function makeStep(overrides: Partial<CodegenStep> = {}): CodegenStep {
  return {
    step: 1,
    intent: 'input_username',
    action: 'input',
    selector: '.generic-input',
    selectorPriority: 'class',
    selectorRank: 7,
    pageUrl: 'https://example.test/admin',
    confidence: 1,
    sampleSize: 1,
    assertions: [],
    userAssertions: [],
    fingerprint: {
      selector: '.generic-input',
      tagName: 'input',
      attributes: {
        class: 'generic-input',
        type: 'text',
        fieldLabelText: 'Username',
      },
    },
    ...overrides,
  };
}

describe('bounded-field module', () => {
  it('validates label[for] association', () => {
    const snapshot = makeDocument(`
      <div class="field-row">
        <label for="username-input">Username</label>
        <input id="username-input" />
      </div>
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" -> [id="username-input"])',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({
          selector: '[id="username-input"]',
          source: 'resolver',
          proofLevel: 'snapshot_validated',
        }),
        controlKind: 'input',
        relation: 'label-for',
        originalSelector: '.generic-input',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(renderLocatorExpressionFromSelectorSpec(spec)).toBe('locator("[id=\\"username-input\\"]")');
  });

  it('validates wrapped label association', () => {
    const snapshot = makeDocument(`
      <label>Username <input /></label>
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" -> input)',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({ selector: 'input', source: 'resolver', proofLevel: 'snapshot_validated' }),
        controlKind: 'input',
        relation: 'wrapped-label',
        originalSelector: '.generic-input',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    expect(validateSelectorSpec(spec, snapshot).reason).toBe('unique-visible');
  });

  it('validates aria-labelledby association', () => {
    const snapshot = makeDocument(`
      <div id="username-label">Username</div>
      <input aria-labelledby="username-label" />
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" -> input[aria-labelledby~=\\"username-label\\"])',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({
          selector: 'input[aria-labelledby~="username-label"]',
          source: 'resolver',
          proofLevel: 'snapshot_validated',
        }),
        controlKind: 'input',
        relation: 'aria-labelledby',
        originalSelector: '.generic-input',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    expect(validateSelectorSpec(spec, snapshot).reason).toBe('unique-visible');
  });

  it('validates sibling label with one input in a bounded container', () => {
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
        target: buildSelectorSpec({ selector: 'input', source: 'resolver', proofLevel: 'snapshot_validated' }),
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
    expect(canRenderSelectorSpecConfidently(spec)).toBe(true);
  });

  it('rejects a broad form container with multiple fields', () => {
    const snapshot = makeDocument(`
      <form>
        <div>Username</div>
        <input />
        <div>Status</div>
        <input />
      </form>
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" within form -> input)',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({ selector: 'input', source: 'resolver', proofLevel: 'snapshot_validated' }),
        controlKind: 'input',
        relation: 'bounded-container',
        originalSelector: '.generic-input',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    expect(validateSelectorSpec(spec, snapshot).reason).not.toBe('unique-visible');
  });

  it('handles duplicate labels by allowing local proof with a warning', () => {
    const snapshot = makeDocument(`
      <div class="field-row"><div>Username</div><input /></div>
      <div class="field-row"><div>Username</div><input /></div>
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" -> input)',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({ selector: 'input', source: 'resolver', proofLevel: 'snapshot_validated' }),
        controlKind: 'input',
        relation: 'bounded-container',
        originalSelector: '.generic-input',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(validation.warningCodes).toContain('bounded-field-global-duplicate-label');
  });

  it('rejects multiple input-like controls inside the same field container', () => {
    const snapshot = makeDocument(`
      <div class="field-row">
        <div>Username</div>
        <input />
        <div role="combobox" aria-haspopup="listbox"></div>
      </div>
    `);

    const spec = buildBoundedFieldSelectorSpec({
      selector: 'bounded-field("Username" -> input)',
      boundedField: {
        source: 'snapshot-bounded-field',
        labelText: 'Username',
        target: buildSelectorSpec({ selector: 'input', source: 'resolver', proofLevel: 'snapshot_validated' }),
        controlKind: 'input',
        relation: 'bounded-container',
        originalSelector: '.generic-input',
      },
      source: 'resolver',
      proofLevel: 'semantic_validated',
    });

    expect(validateSelectorSpec(spec, snapshot).reason).toBe('no-visible-match');
  });

  it('builds a bounded-field candidate for a weak input with field label text', () => {
    const snapshot = makeDocument(`
      <div class="field-row">
        <div>Username</div>
        <input />
      </div>
    `);

    const candidates = buildBoundedFieldCandidates({
      step: makeStep(),
      snapshot,
      snapshotSelection: {
        source: 'source-node-snapshot',
        temporalClass: 'pre_action',
        reason: 'unit-test',
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].engine).toBe('bounded-field');
    expect(candidates[0].boundedField?.labelText).toBe('Username');
  });

  it('uses recorded bounded-field context when snapshots do not preserve the label structure', () => {
    const snapshot = makeDocument(`
      <div><input class="generic-input" /></div>
    `);

    const step = makeStep({
      fingerprint: {
        selector: '.generic-input',
        tagName: 'input',
        attributes: {
          class: 'generic-input',
          fieldLabelText: 'Username',
        },
        boundedFieldContext: {
          fieldLabelText: 'Username',
          fieldRelation: 'sibling-label',
          targetControlKind: 'input',
          visibleControlCountInContainer: 1,
          targetIndexWithinContainer: 0,
          boundedContainerSummary: 'div.field-row',
          boundedContainerSelectorCandidates: [
            { selector: '[data-testid="username-field"]', kind: 'data-testid', isClean: true },
          ],
          cleanParentSelector: '[data-testid="username-field"]',
          cleanChildSelector: 'input',
          containerSelector: '[data-testid="username-field"]',
          competingControlCount: 0,
          duplicateLabelCount: 1,
          isValid: true,
          blockedReason: null,
        },
      },
    });

    const candidates = buildBoundedFieldCandidates({
      step,
      snapshot,
      snapshotSelection: {
        source: 'event-local-pageState',
        temporalClass: 'action_local',
        reason: 'unit-test',
      },
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].boundedField?.source).toBe('recorded-bounded-field');

    const spec = buildBoundedFieldSelectorSpec({
      selector: candidates[0].selector,
      boundedField: candidates[0].boundedField!,
      source: 'resolver',
      proofLevel: 'recorded',
    });

    const validation = validateSelectorSpec(spec, snapshot);
    expect(validation.reason).toBe('unique-visible');
    expect(renderLocatorExpressionFromSelectorSpec(spec)).toBe('locator("[data-testid=\\"username-field\\"]").locator("input")');
  });

  it.each([
    {
      title: 'name',
      step: makeStep({
        selector: 'input[name="username"]',
        selectorPriority: 'attribute',
        fingerprint: {
          selector: 'input[name="username"]',
          tagName: 'input',
          attributes: { name: 'username', fieldLabelText: 'Username' },
        },
      }),
    },
    {
      title: 'placeholder',
      step: makeStep({
        selector: 'input[placeholder="Username"]',
        selectorPriority: 'attribute',
        fingerprint: {
          selector: 'input[placeholder="Username"]',
          tagName: 'input',
          attributes: { placeholder: 'Username', fieldLabelText: 'Username' },
        },
      }),
    },
    {
      title: 'data-testid',
      step: makeStep({
        selector: '[data-testid="username"]',
        selectorPriority: 'data-testid',
        fingerprint: {
          selector: '[data-testid="username"]',
          tagName: 'input',
          attributes: { dataTestId: 'username', fieldLabelText: 'Username' },
        },
      }),
    },
  ])('bypasses bounded-field candidates when strong direct selector exists: $title', ({ step }) => {
    const snapshot = makeDocument(`<div class="field-row"><div>Username</div><input /></div>`);
    expect(buildBoundedFieldCandidates({ step, snapshot })).toHaveLength(0);
  });

  it('builds a bounded-field trigger candidate for an ambiguous repeated trigger selector', () => {
    const snapshot = makeDocument(`
      <div class="field-row">
        <div>User Role</div>
        <div class="select-trigger" role="combobox" aria-haspopup="listbox"></div>
      </div>
      <div class="field-row">
        <div>Status</div>
        <div class="select-trigger" role="combobox" aria-haspopup="listbox"></div>
      </div>
    `);

    const step = makeStep({
      action: 'custom-select',
      intent: 'select_user_role_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      triggerSelector: '.select-trigger',
      triggerSelectorPriority: 'class',
      controlFamily: 'combobox',
      triggerFingerprint: {
        selector: '.select-trigger',
        tagName: 'div',
        attributes: {
          class: 'select-trigger',
          role: 'combobox',
          fieldLabelText: 'User Role',
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
    });

    const candidates = buildBoundedFieldTriggerCandidates({ step, snapshot });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].boundedField?.controlKind).toBe('custom-trigger');
  });

  it('uses recorded bounded trigger context when trigger labels are unavailable in the selected snapshot', () => {
    const snapshot = makeDocument(`
      <div class="select-trigger" role="combobox" aria-haspopup="listbox"></div>
      <div class="select-trigger" role="combobox" aria-haspopup="listbox"></div>
    `);

    const step = makeStep({
      action: 'custom-select',
      intent: 'select_user_role_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      triggerSelector: '.select-trigger',
      triggerSelectorPriority: 'class',
      controlFamily: 'combobox',
      triggerFingerprint: {
        selector: '.select-trigger',
        tagName: 'div',
        attributes: {
          class: 'select-trigger',
          role: 'combobox',
          fieldLabelText: 'User Role',
        },
        boundedFieldContext: {
          fieldLabelText: 'User Role',
          fieldRelation: 'sibling-label',
          targetControlKind: 'custom-trigger',
          visibleControlCountInContainer: 1,
          targetIndexWithinContainer: 0,
          boundedContainerSummary: 'div.field-row',
          boundedContainerSelectorCandidates: [
            { selector: '[data-testid="user-role-field"]', kind: 'data-testid', isClean: true },
          ],
          cleanParentSelector: '[data-testid="user-role-field"]',
          cleanChildSelector: '.select-trigger',
          containerSelector: '[data-testid="user-role-field"]',
          competingControlCount: 0,
          duplicateLabelCount: 1,
          isValid: true,
          blockedReason: null,
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
    });

    const candidates = buildBoundedFieldTriggerCandidates({ step, snapshot });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].boundedField?.source).toBe('recorded-bounded-field');
  });
});
