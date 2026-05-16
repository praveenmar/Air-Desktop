import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { LlmOrchestrator } from '../src/llm-orchestrator';
import { CodegenSession, CodegenStep } from '../src/types';
import * as selectorResolverModule from '../src/selector-resolver';

const createStep = (overrides: Partial<CodegenStep> = {}): CodegenStep => ({
  step: 1,
  intent: 'input_username',
  action: 'input',
  selector: 'input[name="username"]',
  selectorPriority: 'attribute',
  selectorRank: 3,
  pageUrl: 'https://example.test/login',
  confidence: 1,
  sampleSize: 1,
  assertions: [],
  userAssertions: [],
  ...overrides,
});

const createSession = (steps: CodegenStep[], overrides: Partial<CodegenSession> = {}): CodegenSession => ({
  sessionId: 'session-test',
  url: 'https://example.test/login',
  title: 'Recorded Flow',
  recordedAt: '2026-04-19T00:00:00.000Z',
  stepCount: steps.length,
  steps,
  flowConfidence: 0.9,
  nodeCount: 3,
  ...overrides,
});

describe('LlmOrchestrator - emission safety', () => {
  it('falls back to deterministic action when fill arg is an unsafe bare identifier', () => {
    const step = createStep({
      action: 'input',
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('input[name="username"]').fill(username)`,
      step.selector
    );

    expect(emitted.fallbackReason).toBe('llm-unsafe-action-args');
    expect(emitted.methodCode).toContain('async fillUsername(username: string = "Admin")');
    expect(emitted.methodCode).toContain('await target.fill(username);');
  });

  it('falls back to deterministic submit handling instead of emitting locator.submit()', () => {
    const step = createStep({
      action: 'submit',
      selector: '.oxd-form',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'submit_login',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'submitLoginForm',
      `locator('.oxd-form').submit()`,
      step.selector
    );

    expect(emitted.fallbackReason).toBe('llm-action-invalid-or-noop');
    expect(emitted.methodCode).not.toContain('.submit(');
    expect(emitted.methodCode).toContain(`await target.press('Enter');`);
  });

  it('keeps safe quoted fill args emitted by llm', () => {
    const step = createStep({
      action: 'input',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('input[name="username"]').fill('admin')`,
      step.selector
    );

    expect(emitted.fallbackReason).toBe('selector-spec-missing-fallback');
    expect(emitted.methodCode).toContain('// WARNING: selector-spec-missing-fallback');
    expect(emitted.methodCode).toContain('async fillUsername(username: string = "input_username_value")');
    expect(emitted.methodCode).toContain('await target.fill(username);');
  });

  it('does not force .first() into locator actions by default', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_login',
      selector: 'button[type="submit"]',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickLogin',
      `locator('button[type="submit"]').click()`,
      step.selector,
    );

    expect(emitted.methodCode).not.toContain('.first()');
    expect(emitted.methodCode).toContain(`const target = this.page.locator("button[type=\\"submit\\"]");`);
  });

  it('preserves exact proven css selector instead of upgrading to getByRole without proof', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: 'button[type="submit"]',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `getByRole('button', { name: 'Submit' }).click()`,
      step.selector,
      {
        selector: 'button[type="submit"]',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'semantic_validated',
      },
    );

    expect(emitted.fallbackReason).toBe('selector-spec-exact-render');
    expect(emitted.methodCode).toContain(`const target = this.page.locator("button[type=\\"submit\\"]");`);
    expect(emitted.methodCode).not.toContain('getByRole');
  });

  it('keeps strong selector output unchanged without weak AIR warning comments', () => {
    const step = createStep({
      action: 'input',
      intent: 'input_username',
      selector: 'input[name="username"]',
      selectorPriority: 'attribute',
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('input[name="username"]').fill('Admin')`,
      step.selector,
      {
        selector: 'input[name="username"]',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'semantic_validated',
      },
    );

    expect(emitted.methodCode).toContain(`const target = this.page.locator("input[name=\\"username\\"]");`);
    expect(emitted.methodCode).toContain('await target.fill(username);');
    expect(emitted.methodCode).not.toContain('AIR WARNING: Weak selector fallback');
    expect(emitted.emittedWeakFallback).toBeUndefined();
    expect(emitted.weakFallbackIndexKind).toBeUndefined();
    expect(emitted.weakFallbackUsedVisibleFilter).toBeUndefined();
  });

  it('uses resolvedSelectorSpec before raw resolvedSelector when they differ', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: 'button',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `locator('button.secondary').click()`,
      'button.secondary',
      {
        selector: 'button.primary',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'semantic_validated',
      },
    );

    expect(emitted.methodCode).toContain(`const target = this.page.locator("button.primary");`);
    expect(emitted.methodCode).not.toContain('button.secondary');
  });

  it('renders snapshot_validated text selector exactly instead of prettifying to getByText', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: 'text=Submit',
      selectorPriority: 'text',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `getByText('Submit').click()`,
      'text=Submit',
      {
        selector: 'text=Submit',
        engine: 'text',
        source: 'resolver',
        proofLevel: 'snapshot_validated',
      },
    );

    expect(emitted.methodCode).toContain(`const target = this.page.locator("text=Submit");`);
    expect(emitted.methodCode).not.toContain('getByText');
  });

  it('emits getByTestId when resolver provides a proven equivalent rendering', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: '[data-testid="login-btn"]',
      selectorPriority: 'data-testid',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `locator('[data-testid="login-btn"]').click()`,
      '[data-testid="login-btn"]',
      {
        selector: '[data-testid="login-btn"]',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'semantic_validated',
      },
      {
        resolvedSelector: '[data-testid="login-btn"]',
        resolvedBy: 'deterministic-override',
        bestScore: 1.2,
        effectiveMatchCount: 1,
        snapshotSource: 'latest',
        validationMethod: 'test',
        llmAttempted: false,
        llmAccepted: false,
        llmAlternative: null,
        rejectReason: null,
        warningCodes: [],
        resolverVersion: 1,
        selectorEvaluation: {
          selectorSpec: {
            selector: '[data-testid="login-btn"]',
            engine: 'css',
            source: 'resolver',
            proofLevel: 'semantic_validated',
          },
          category: 'testid',
          validation: {
            valid: true,
            matchCount: 1,
            visibleMatchCount: 1,
            uniqueVisible: true,
          },
          proof: {
            proofLevel: 'semantic_validated',
            proofSource: 'semantic',
          },
          scoring: {
            proofScore: 1,
            stabilityScore: 0.8,
            semanticScore: 0.9,
            brittlenessPenalty: 0,
            entropyPenalty: 0,
            finalScore: 1.2,
          },
          reasons: ['category:testid', 'proof:semantic_validated'],
          warningCodes: [],
          preferredRenderings: [
            {
              engine: 'testid',
              locator: `getByTestId("login-btn")`,
              proofLevel: 'proven_equivalent',
              proofSource: 'attribute-equivalence',
              sourceSelector: '[data-testid="login-btn"]',
              sourceEngine: 'css',
            },
          ],
        },
      },
    );

    expect(emitted.methodCode).toContain(`const target = this.page.getByTestId("login-btn");`);
    expect(emitted.emittedLocator).toBe(`getByTestId("login-btn")`);
    expect(emitted.emittedLocatorEngine).toBe('testid');
    expect(emitted.equivalentRenderingUsed).toBe(true);
    expect(emitted.equivalentProofSource).toBe('attribute-equivalence');
  });

  it('maps semantic custom control actions to click locators in deterministic fallback', () => {
    const openStep = createStep({
      action: 'custom-control-open',
      intent: 'open_user_role',
      selector: '.oxd-select-text',
      selectorPriority: 'class',
      selectorRank: 7,
    });

    const menuStep = createStep({
      action: 'custom-menu-select',
      intent: 'select_logout',
      selector: '[role="menuitem"]:has-text("Logout")',
      selectorPriority: 'attribute',
      selectorRank: 3,
    });

    const openEmitted = (LlmOrchestrator as any).buildMethodCode(
      openStep,
      'openUserRole',
      `locator('.oxd-select-text').noop()`,
      openStep.selector,
    );
    const menuEmitted = (LlmOrchestrator as any).buildMethodCode(
      menuStep,
      'selectLogout',
      `locator('[role="menuitem"]:has-text("Logout")').noop()`,
      menuStep.selector,
    );

    expect(openEmitted.fallbackReason).toBe('llm-action-invalid-or-noop');
    expect(openEmitted.methodCode).toContain(`await target.click();`);
    expect(menuEmitted.fallbackReason).toBe('llm-action-invalid-or-noop');
    expect(menuEmitted.methodCode).toContain(`await target.click();`);
  });

  it('emits trigger click and option click for compressed custom-select steps', () => {
    const step = createStep({
      action: 'custom-select',
      intent: 'select_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      controlFamily: 'combobox',
      triggerSelector: '.oxd-select-text',
      triggerSelectorPriority: 'class',
      triggerSelectorSpec: {
        selector: '.oxd-select-text',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
        rank: 7,
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
      optionSelectorSpec: {
        selector: '[role="option"]',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
        rank: 3,
      },
      absorbedOpenEventId: 'ev-open',
      absorbedOpenTraceId: 'trace-1',
      compressedFromEvents: ['ev-open', 'ev-select'],
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'selectAdmin',
      `locator('[role="option"]').selectOption('Admin')`,
      step.selector,
      step.optionSelectorSpec,
    );

    expect(emitted.fallbackReason).toBe('compressed-custom-control-select');
    expect(emitted.methodCode).toContain('const triggerTarget = this.page.locator(".oxd-select-text");');
    expect(emitted.methodCode).toContain('await triggerTarget.click();');
    expect(emitted.methodCode).toContain('const optionTarget = this.page.locator("[role=\\"option\\"]");');
    expect(emitted.methodCode).toContain('await optionTarget.click();');
  });

  it('emits bounded trigger fallback for compressed custom-select steps with an AIR warning', () => {
    const step = createStep({
      action: 'custom-select',
      intent: 'select_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      controlFamily: 'combobox',
      triggerSelector: '.select-trigger',
      triggerResolvedSelector: 'trigger-context("User Role" within div.field-row -> .select-trigger)',
      triggerSelectorPriority: 'class',
      triggerSelectorSpec: {
        selector: 'trigger-context("User Role" within div.field-row -> .select-trigger)',
        engine: 'trigger-context',
        source: 'resolver',
        proofLevel: 'semantic_validated',
        triggerContext: {
          source: 'snapshot-trigger-context',
          association: 'bounded-field',
          labelText: 'User Role',
          controlFamily: 'combobox',
          triggerSelector: '.select-trigger',
          containerSelector: 'div.field-row',
          labelElementTag: 'div',
          boundedContainerSummary: 'div.field-row',
          renderStatus: 'proven-structural-fallback',
          renderReason: 'no_clean_parent_selector',
          cleanChildSelector: '.select-trigger',
          warningCodes: ['custom-control-trigger-structural-fallback'],
          recoveredFromSelector: '.select-trigger',
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
      optionSelectorSpec: {
        selector: '[role="option"]',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
        rank: 3,
      },
      absorbedOpenEventId: 'ev-open',
      absorbedOpenTraceId: 'trace-1',
      compressedFromEvents: ['ev-open', 'ev-select'],
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'selectAdmin',
      `locator('[role="option"]').click()`,
      step.selector,
      step.optionSelectorSpec,
    );

    expect(emitted.methodCode).toContain('this.page.locator("div.field-row").filter({ has: this.page.locator("div").filter({ hasText: /^User Role$/ }) }).locator(".select-trigger")');
    expect(emitted.methodCode).toContain('// AIR WARNING: Structural custom-control trigger fallback.');
    expect(emitted.fallbackReason).toBe('compressed-custom-control-select');
    expect(emitted.triggerContextRenderStatus).toBe('proven-structural-fallback');
  });

  it('emits a weak trigger fallback and preserves option click when custom-control trigger rendering is blocked', () => {
    const step = createStep({
      action: 'custom-select',
      intent: 'select_admin',
      selector: '[role="option"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      controlFamily: 'combobox',
      triggerSelector: '.oxd-select-text',
      triggerSelectorPriority: 'class',
      triggerSelectorSpec: {
        selector: '.oxd-select-text',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
        rank: 7,
      },
      triggerFingerprint: {
        selector: '.oxd-select-text',
        selectorPriority: 'class',
        selectorRank: 7,
        selectorAmbiguity: {
          originalSelector: '.oxd-select-text',
          matchCount: 2,
          visibleMatchCount: 2,
          positionInMatches: 0,
          isUnique: false,
          isAmbiguous: true,
        },
      },
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
      optionSelectorSpec: {
        selector: '[role="option"]',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
        rank: 3,
      },
      absorbedOpenEventId: 'ev-open',
      absorbedOpenTraceId: 'trace-1',
      compressedFromEvents: ['ev-open', 'ev-select'],
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'selectAdmin',
      `locator('[role="option"]').click()`,
      step.selector,
      step.optionSelectorSpec,
      {
        resolvedSelector: '[role="option"]',
        resolvedBy: 'kept-original',
        bestScore: 0.9,
        effectiveMatchCount: 1,
        snapshotSource: 'event-local-pageState',
        validationMethod: 'css-query-static-visibility-element-ranking-v1',
        llmAttempted: false,
        llmAccepted: false,
        llmAlternative: null,
        rejectReason: null,
        warningCodes: [],
        resolverVersion: 1,
        triggerContextRenderStatus: 'blocked-unsafe-render',
        triggerContextRenderReason: 'target_missing',
        triggerWarningCodes: ['custom-control-trigger-target-binding-ambiguous'],
      },
    );

    expect(emitted.methodCode).toContain('// AIR WARNING: Weak selector fallback.');
    expect(emitted.methodCode).toContain('// Reason: trigger selector was ambiguous during recording.');
    expect(emitted.methodCode).toContain('// Selector: ".oxd-select-text"');
    expect(emitted.methodCode).toContain('// Visible match count during recording: 2');
    expect(emitted.methodCode).toContain('// Recorded index used: 0');
    expect(emitted.methodCode).toContain('const triggerTarget = this.page.locator(".oxd-select-text:visible").nth(0);');
    expect(emitted.methodCode).toContain(`await triggerTarget.waitFor({ state: 'visible', timeout: 5000 });`);
    expect(emitted.methodCode).toContain('await triggerTarget.click();');
    expect(emitted.methodCode).toContain('// AIR WARNING: Weak trigger selector fallback.');
    expect(emitted.methodCode).toContain('// AIR preserved the recorded option selection below.');
    expect(emitted.methodCode).toContain('const optionTarget = this.page.locator("[role=\\"option\\"]");');
    expect(emitted.methodCode).toContain('await optionTarget.click();');
    expect(emitted.methodCode).not.toContain('throw new Error(');
    expect(emitted.methodCode).not.toContain('// TODO[AIR]');
    expect(emitted.fallbackReason).toBe('custom-control-trigger-weak-fallback');
    expect(emitted.emittedLocator).toBeNull();
    expect(emitted.emittedWeakFallback).toBe(true);
    expect(emitted.weakFallbackSelector).toBe('.oxd-select-text');
    expect(emitted.weakFallbackIndex).toBe(0);
    expect(emitted.weakFallbackIndexKind).toBe('visible');
    expect(emitted.weakFallbackUsedVisibleFilter).toBe(true);
    expect(emitted.triggerContextRenderStatus).toBe('blocked-unsafe-render');
  });

  it('keeps blocked compressed custom-select explicit when AIR cannot reconstruct option selection', () => {
    const step = createStep({
      action: 'custom-select',
      intent: 'select_admin',
      selector: '',
      selectorPriority: 'attribute',
      selectorRank: 3,
      controlFamily: 'combobox',
      triggerSelector: '.oxd-select-text',
      triggerSelectorPriority: 'class',
      triggerSelectorSpec: {
        selector: '.oxd-select-text',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
        rank: 7,
      },
      triggerFingerprint: {
        selector: '.oxd-select-text',
        selectorPriority: 'class',
        selectorRank: 7,
        selectorAmbiguity: {
          originalSelector: '.oxd-select-text',
          matchCount: 2,
          visibleMatchCount: 2,
          positionInMatches: 0,
          isUnique: false,
          isAmbiguous: true,
        },
      },
      compressedFromEvents: ['ev-open', 'ev-select'],
      value: 'Admin',
      optionSelector: '',
      optionText: '',
      optionValue: '',
      optionSelectorSpec: undefined,
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'selectAdmin',
      `locator('[role="option"]').click()`,
      '',
      undefined,
      {
        resolvedSelector: '',
        resolvedBy: 'kept-original',
        bestScore: 0.4,
        effectiveMatchCount: 2,
        snapshotSource: 'event-local-pageState',
        validationMethod: 'css-query-static-visibility-element-ranking-v1',
        llmAttempted: false,
        llmAccepted: false,
        llmAlternative: null,
        rejectReason: null,
        warningCodes: [],
        resolverVersion: 1,
        triggerContextRenderStatus: 'blocked-unsafe-render',
        triggerContextRenderReason: 'target_missing',
        triggerWarningCodes: ['custom-control-trigger-target-binding-ambiguous'],
      },
    );

    expect(emitted.methodCode).toContain('// AIR WARNING: Weak trigger selector fallback.');
    expect(emitted.methodCode).toContain('AIR could not reconstruct the option selection for "select_admin".');
    expect(emitted.methodCode).toContain('throw new Error(');
    expect(emitted.methodCode).not.toContain('await triggerTarget.click();');
    expect(emitted.fallbackReason).toBe('custom-control-trigger-blocked-unsafe-render');
  });

  it('renders wrapped label-context proof as a safe chained locator instead of getByLabel', () => {
    const step = createStep({
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('.generic-input').fill('Admin')`,
      'label-context("Username" -> input)',
      {
        selector: 'label-context("Username" -> input)',
        engine: 'label-context',
        source: 'resolver',
        proofLevel: 'semantic_validated',
        labelContext: {
          source: 'snapshot-label-context',
          association: 'wrapped-label',
          labelText: 'Username',
          targetTag: 'input',
          recoveredFromSelector: '.generic-input',
        },
      },
    );

    expect(emitted.methodCode).toContain('this.page.locator("label").filter({ hasText: /^Username$/ }).locator("input")');
    expect(emitted.methodCode).not.toContain('getByLabel');
    expect(emitted.fallbackReason).toBe('selector-spec-exact-render');
    expect(emitted.methodCode).toContain('// AIR WARNING: Structural label-context fallback.');
    expect(emitted.emittedLocatorWarnings).toContain('label-context-structural-fallback');
    expect(emitted.labelContextRenderStatus).toBe('proven-structural-fallback');
  });

  it('renders bounded label-context proof as a safe chained locator', () => {
    const step = createStep({
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_employee_id',
      value: '1234',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillEmployeeId',
      `locator('.generic-input').fill('1234')`,
      'label-context("Employee Id" within div.field-row -> input)',
      {
        selector: 'label-context("Employee Id" within div.field-row -> input)',
        engine: 'label-context',
        source: 'resolver',
        proofLevel: 'semantic_validated',
        labelContext: {
          source: 'snapshot-label-context',
          association: 'bounded-field',
          labelText: 'Employee Id',
          targetTag: 'input',
          containerSelector: 'div.field-row',
          boundedContainerSummary: 'div.field-row',
          recoveredFromSelector: '.generic-input',
        },
      },
    );

    expect(emitted.methodCode).toContain('this.page.locator("div.field-row").filter({ has: this.page.locator("label").filter({ hasText: /^Employee Id$/ }) }).locator("input")');
    expect(emitted.methodCode).not.toContain('getByLabel');
    expect(emitted.methodCode).toContain('// AIR WARNING: Structural label-context fallback.');
    expect(emitted.labelContextRenderStatus).toBe('proven-structural-fallback');
  });

  it('renders clean scoped bounded-field proof without structural warning when parent selector is independently safe', () => {
    const step = createStep({
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('.generic-input').fill('Admin')`,
      'label-context("Username" within [data-testid=\\"username-field\\"] -> input)',
      {
        selector: 'label-context("Username" within [data-testid=\\"username-field\\"] -> input)',
        engine: 'label-context',
        source: 'resolver',
        proofLevel: 'semantic_validated',
        labelContext: {
          source: 'snapshot-label-context',
          association: 'bounded-field',
          labelText: 'Username',
          targetTag: 'input',
          containerSelector: '[data-testid="username-field"]',
          boundedContainerSummary: 'div.username-field',
          cleanParentSelector: '[data-testid="username-field"]',
          cleanChildSelector: 'input',
          renderStatus: 'clean-scoped-locator',
          renderReason: 'clean_parent_unique_visible',
          recoveredFromSelector: '.generic-input',
        },
      },
    );

    expect(emitted.methodCode).toContain('this.page.locator("[data-testid=\\"username-field\\"]").locator("input")');
    expect(emitted.methodCode).not.toContain('Structural label-context fallback');
    expect(emitted.labelContextRenderStatus).toBe('clean-scoped-locator');
  });

  it('renders bounded-field proof as a scoped locator with an AIR warning', () => {
    const step = createStep({
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_username',
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('.generic-input').fill('Admin')`,
      'bounded-field("Username" within div.field-row -> input)',
      {
        selector: 'bounded-field("Username" within div.field-row -> input)',
        engine: 'bounded-field',
        source: 'resolver',
        proofLevel: 'semantic_validated',
        boundedField: {
          source: 'snapshot-bounded-field',
          labelText: 'Username',
          target: {
            selector: 'input',
            engine: 'css',
            source: 'resolver',
            proofLevel: 'snapshot_validated',
          },
          controlKind: 'input',
          relation: 'bounded-container',
          originalSelector: '.generic-input',
          containerSelector: 'div.field-row',
          labelElementTag: 'div',
          boundedContainerSummary: 'div.field-row',
          renderStatus: 'proven-structural-fallback',
          renderReason: 'no_clean_parent_selector',
          cleanChildSelector: 'input',
          warningCodes: ['bounded-field-structural-fallback'],
        },
      },
    );

    expect(emitted.methodCode).toContain('this.page.locator("div.field-row").filter({ has: this.page.locator("div").filter({ hasText: /^Username$/ }) }).locator("input")');
    expect(emitted.methodCode).toContain('// AIR WARNING: Structural bounded-field fallback.');
    expect(emitted.emittedLocatorWarnings).toContain('bounded-field-structural-fallback');
    expect(emitted.boundedFieldRenderStatus).toBe('proven-structural-fallback');
  });

  it('escapes exact label regex safely for structural fallback rendering', () => {
    const step = createStep({
      action: 'input',
      selector: '.generic-input',
      selectorPriority: 'class',
      selectorRank: 7,
      intent: 'input_user_admin',
      value: 'Admin',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUserAdmin',
      `locator('.generic-input').fill('Admin')`,
      'label-context("User (Admin)" -> input)',
      {
        selector: 'label-context("User (Admin)" -> input)',
        engine: 'label-context',
        source: 'resolver',
        proofLevel: 'semantic_validated',
        labelContext: {
          source: 'snapshot-label-context',
          association: 'wrapped-label',
          labelText: 'User (Admin)',
          targetTag: 'input',
          renderStatus: 'proven-structural-fallback',
          renderReason: 'wrapped_label_exact',
          warningCodes: ['label-context-structural-fallback'],
          recoveredFromSelector: '.generic-input',
        },
      },
    );

    expect(emitted.methodCode).toContain('/^User \\(Admin\\)$/');
  });

  it('emits getByPlaceholder exact only when resolver provides a placeholder equivalent rendering', () => {
    const step = createStep({
      action: 'input',
      intent: 'input_username',
      selector: 'input[placeholder="Username"]',
      selectorPriority: 'attribute',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('input[placeholder="Username"]').fill(value)`,
      'input[placeholder="Username"]',
      {
        selector: 'input[placeholder="Username"]',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'semantic_validated',
      },
      {
        resolvedSelector: 'input[placeholder="Username"]',
        resolvedBy: 'deterministic-override',
        bestScore: 1.1,
        effectiveMatchCount: 1,
        snapshotSource: 'latest',
        validationMethod: 'test',
        llmAttempted: false,
        llmAccepted: false,
        llmAlternative: null,
        rejectReason: null,
        warningCodes: [],
        resolverVersion: 1,
        selectorEvaluation: {
          selectorSpec: {
            selector: 'input[placeholder="Username"]',
            engine: 'css',
            source: 'resolver',
            proofLevel: 'semantic_validated',
          },
          category: 'placeholder',
          validation: {
            valid: true,
            matchCount: 1,
            visibleMatchCount: 1,
            uniqueVisible: true,
          },
          proof: {
            proofLevel: 'semantic_validated',
            proofSource: 'semantic',
          },
          scoring: {
            proofScore: 1,
            stabilityScore: 0.8,
            semanticScore: 0.9,
            brittlenessPenalty: 0,
            entropyPenalty: 0,
            finalScore: 1.1,
          },
          reasons: ['category:placeholder', 'proof:semantic_validated'],
          warningCodes: [],
          preferredRenderings: [
            {
              engine: 'placeholder',
              locator: `getByPlaceholder("Username", { exact: true })`,
              proofLevel: 'proven_equivalent',
              proofSource: 'attribute-equivalence',
              sourceSelector: 'input[placeholder="Username"]',
              sourceEngine: 'css',
            },
          ],
        },
      },
    );

    expect(emitted.methodCode).toContain(`const target = this.page.getByPlaceholder("Username", { exact: true });`);
    expect(emitted.emittedLocator).toBe(`getByPlaceholder("Username", { exact: true })`);
    expect(emitted.emittedLocatorEngine).toBe('placeholder');
  });

  it('renders recorded-only selector with inline recorded warning', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: 'button[type="submit"]',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `locator('button[type="submit"]').click()`,
      step.selector,
      {
        selector: 'button[type="submit"]',
        engine: 'css',
        source: 'interceptor',
        proofLevel: 'recorded',
      },
    );

    expect(emitted.methodCode).toContain('// WARNING: recorded-not-revalidated');
    expect(emitted.emittedLocatorWarnings).toContain('recorded-not-revalidated');
    expect(emitted.methodCode).toContain(`const target = this.page.locator("button[type=\\"submit\\"]");`);
  });

  it('emits runnable weak fallback code for weak input selectors', () => {
    const step = createStep({
      action: 'input',
      intent: 'input_username',
      selector: '.oxd-input',
      selectorPriority: 'class',
      selectorRank: 7,
      value: 'Admin',
      fingerprint: {
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        selectorAmbiguity: {
          originalSelector: '.oxd-input',
          matchCount: 2,
          visibleMatchCount: 2,
          positionInMatches: 1,
          isUnique: false,
          isAmbiguous: true,
        },
      },
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `locator('.oxd-input').fill('Admin')`,
      '.oxd-input',
      {
        selector: '.oxd-input',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'unvalidated',
      },
    );

    expect(emitted.methodCode).toContain('// AIR WARNING: Weak selector fallback.');
    expect(emitted.methodCode).toContain('// Selector: ".oxd-input"');
    expect(emitted.methodCode).toContain('// Match count during recording: 2');
    expect(emitted.methodCode).toContain('// Visible match count during recording: 2');
    expect(emitted.methodCode).toContain('// Recorded index used: 1');
    expect(emitted.methodCode).toContain('const target = this.page.locator(".oxd-input:visible").nth(1);');
    expect(emitted.methodCode).toContain(`await target.waitFor({ state: 'visible', timeout: 5000 });`);
    expect(emitted.methodCode).toContain('await target.fill(username);');
    expect(emitted.methodCode).not.toContain('// TODO[AIR]');
    expect(emitted.methodCode).not.toContain('throw new Error(');
    expect(emitted.emittedLocator).toBeNull();
    expect(emitted.emittedWeakFallback).toBe(true);
    expect(emitted.weakFallbackSelector).toBe('.oxd-input');
    expect(emitted.weakFallbackIndex).toBe(1);
    expect(emitted.weakFallbackIndexKind).toBe('visible');
    expect(emitted.weakFallbackUsedVisibleFilter).toBe(true);
    expect(emitted.weakFallbackVisibleMatchCount).toBe(2);
  });

  it('emits runnable weak fallback code for weak click selectors', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_some_button',
      selector: '.some-button',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.some-button',
        selectorPriority: 'class',
        selectorRank: 7,
        selectorAmbiguity: {
          originalSelector: '.some-button',
          matchCount: 3,
          visibleMatchCount: 3,
          positionInMatches: 2,
          isUnique: false,
          isAmbiguous: true,
        },
      },
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSomeButton',
      `locator('.some-button').click()`,
      '.some-button',
      {
        selector: '.some-button',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'blocked',
      },
    );

    expect(emitted.methodCode).toContain('// AIR WARNING: Weak selector fallback.');
    expect(emitted.methodCode).toContain('// Selector: ".some-button"');
    expect(emitted.methodCode).toContain('// Visible match count during recording: 3');
    expect(emitted.methodCode).toContain('// Recorded index used: 2');
    expect(emitted.methodCode).toContain('const target = this.page.locator(".some-button:visible").nth(2);');
    expect(emitted.methodCode).toContain(`await target.waitFor({ state: 'visible', timeout: 5000 });`);
    expect(emitted.methodCode).toContain('await target.click();');
    expect(emitted.methodCode).not.toContain('// TODO[AIR]');
    expect(emitted.methodCode).not.toContain('throw new Error(');
    expect(emitted.emittedLocator).toBeNull();
    expect(emitted.emittedWeakFallback).toBe(true);
    expect(emitted.weakFallbackSelector).toBe('.some-button');
    expect(emitted.weakFallbackIndex).toBe(2);
    expect(emitted.weakFallbackIndexKind).toBe('visible');
    expect(emitted.weakFallbackUsedVisibleFilter).toBe(true);
  });

  it('keeps raw nth with an explicit warning when visible-index filtering cannot be safely applied', () => {
    const renderedLocator = 'getByRole("textbox", { name: "Username", exact: true })';
    const step = createStep({
      action: 'input',
      intent: 'input_username',
      selector: renderedLocator,
      selectorPriority: 'other',
      selectorRank: 7,
      value: 'Admin',
      fingerprint: {
        selector: renderedLocator,
        selectorPriority: 'other',
        selectorRank: 7,
        selectorAmbiguity: {
          originalSelector: renderedLocator,
          matchCount: 3,
          visibleMatchCount: 2,
          positionInMatches: 1,
          isUnique: false,
          isAmbiguous: true,
        },
      },
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `${renderedLocator}.fill('Admin')`,
      renderedLocator,
      {
        selector: renderedLocator,
        engine: 'playwright',
        source: 'resolver',
        proofLevel: 'unvalidated',
      },
    );

    expect(emitted.methodCode).toContain('const target = this.page.getByRole("textbox", { name: "Username", exact: true }).nth(1);');
    expect(emitted.methodCode).toContain('AIR WARNING: Recorded index is based on visible matches; raw nth may be unsafe if hidden matches exist.');
    expect(emitted.weakFallbackIndexKind).toBe('visible');
    expect(emitted.weakFallbackUsedVisibleFilter).toBe(false);
    expect(emitted.weakFallbackWarnings ?? []).toContain(
      'AIR WARNING: Recorded index is based on visible matches; raw nth may be unsafe if hidden matches exist.',
    );
  });

  it('uses first() when AIR knows there were multiple matches but no recorded index', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_some_button',
      selector: '.some-button',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.some-button',
        selectorPriority: 'class',
        selectorRank: 7,
        selectorAmbiguity: {
          originalSelector: '.some-button',
          matchCount: 4,
          visibleMatchCount: 2,
          positionInMatches: null,
          isUnique: false,
          isAmbiguous: true,
        },
      },
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSomeButton',
      `locator('.some-button').click()`,
      '.some-button',
      {
        selector: '.some-button',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'unvalidated',
      },
    );

    expect(emitted.methodCode).toContain('const target = this.page.locator(".some-button").first();');
    expect(emitted.methodCode).toContain('No recorded index was available. AIR used first() as a best-effort fallback.');
    expect(emitted.methodCode).toContain(`await target.waitFor({ state: 'visible', timeout: 5000 });`);
    expect(emitted.weakFallbackSource).toBe('first-fallback');
    expect(emitted.weakFallbackIndex).toBeNull();
  });

  it('uses a plain locator when selector match counts are unavailable', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: '.unknown-button',
      selectorPriority: 'class',
      selectorRank: 7,
      fingerprint: {
        selector: '.unknown-button',
        selectorPriority: 'class',
        selectorRank: 7,
      },
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `locator('.unknown-button').click()`,
      '.unknown-button',
      {
        selector: '.unknown-button',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'blocked',
      },
    );

    expect(emitted.methodCode).toContain('const target = this.page.locator(".unknown-button");');
    expect(emitted.methodCode).toContain('// Match count during recording: unavailable');
    expect(emitted.methodCode).toContain('// Visible match count during recording: unavailable');
    expect(emitted.methodCode).toContain(`await target.waitFor({ state: 'visible', timeout: 5000 });`);
    expect(emitted.methodCode).not.toContain('.first()');
    expect(emitted.methodCode).not.toContain('.nth(');
    expect(emitted.weakFallbackSource).toBe('plain-locator');
  });

  it('keeps TODO and throw when AIR has no usable selector for weak fallback', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: '',
      selectorPriority: 'unknown',
      selectorSpec: undefined,
      fingerprint: undefined,
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `locator('button').click()`,
      'bounded-field("Submit" within div.form-row -> button)',
      {
        selector: 'bounded-field("Submit" within div.form-row -> button)',
        engine: 'bounded-field',
        source: 'resolver',
        proofLevel: 'blocked',
        boundedField: {
          source: 'snapshot-bounded-field',
          labelText: 'Submit',
          target: {
            selector: 'button',
            engine: 'css',
            source: 'resolver',
            proofLevel: 'blocked',
          },
          controlKind: 'custom-trigger',
          relation: 'bounded-container',
          renderStatus: 'blocked-unsafe-render',
        },
      },
    );

    expect(emitted.methodCode).toContain('// TODO[AIR]: Selector is blocked');
    expect(emitted.methodCode).toContain('throw new Error(');
    expect(emitted.methodCode).toContain('AIR could not build weak fallback for method clickSubmit');
    expect(emitted.emittedWeakFallback).toBeUndefined();
  });

  it('uses legacy selector fallback with explicit warning when selector spec is missing', () => {
    const step = createStep({
      action: 'click',
      intent: 'click_submit',
      selector: 'button[type="submit"]',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickSubmit',
      `getByRole('button', { name: 'Submit' }).click()`,
      'button[type="submit"]',
      undefined,
    );

    expect(emitted.fallbackReason).toBe('selector-spec-missing-fallback');
    expect(emitted.methodCode).toContain('// WARNING: selector-spec-missing-fallback');
    expect(emitted.methodCode).toContain(`const target = this.page.locator("button[type=\\"submit\\"]");`);
    expect(emitted.usedSelectorSpec).toBe(false);
  });

  it('does not emit getByLabel from css attrs unless explicitly proven', () => {
    const step = createStep({
      action: 'input',
      intent: 'input_username',
      selector: 'input[aria-label="Username"]',
      selectorPriority: 'attribute',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'fillUsername',
      `getByLabel('Username').fill('Admin')`,
      'input[aria-label="Username"]',
      {
        selector: 'input[aria-label="Username"]',
        engine: 'css',
        source: 'resolver',
        proofLevel: 'semantic_validated',
      },
    );

    expect(emitted.methodCode).toContain(`const target = this.page.locator("input[aria-label=\\"Username\\"]");`);
    expect(emitted.methodCode).not.toContain('getByLabel');
  });

  it('emits popup-aware click code when step likely opens a new tab', () => {
    const step = createStep({
      step: 5,
      action: 'click',
      intent: 'click_open_product',
      selector: '.product-link',
      pageUrl: 'https://example.test/search',
      normalizedUrl: 'https://example.test/search',
      outcomeType: 'no_change',
    });

    const emitted = (LlmOrchestrator as any).buildMethodCode(
      step,
      'clickOpenProduct',
      `locator('.product-link').click()`,
      step.selector,
      undefined,
      undefined,
      true,
    );

    expect(emitted.methodCode).toContain(`waitForEvent('page'`);
    expect(emitted.methodCode).toContain('this.page = popupPage;');
  });
});

describe('LlmOrchestrator - navigate helper', () => {
  it('builds navigate() method for valid http/https start urls', () => {
    const method = (LlmOrchestrator as any).buildNavigateMethod('https://example.test/login');
    expect(method).toContain('async navigate()');
    expect(method).toContain("await this.page.goto(\"https://example.test/login\");");
  });

  it('skips navigate() method for unknown or non-web urls', () => {
    expect((LlmOrchestrator as any).buildNavigateMethod('unknown')).toBeNull();
    expect((LlmOrchestrator as any).buildNavigateMethod('about:blank')).toBeNull();
    expect((LlmOrchestrator as any).buildNavigateMethod('file:///tmp/index.html')).toBeNull();
  });
});

describe('LlmOrchestrator - composite methods', () => {
  it('adds login(username, password) composite method for clear auth sequence', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: 'input[name="username"]',
        resolvedSelector: 'input[name="username"]',
        normalizedUrl: 'https://example.test/login',
      }),
      createStep({
        step: 2,
        action: 'input',
        intent: 'input_password',
        selector: 'input[name="password"]',
        resolvedSelector: 'input[name="password"]',
        normalizedUrl: 'https://example.test/login',
      }),
      createStep({
        step: 3,
        action: 'click',
        intent: 'click_login',
        selector: 'button[type="submit"]',
        resolvedSelector: 'button[type="submit"]',
        normalizedUrl: 'https://example.test/login',
      }),
    ];

    const methods = (LlmOrchestrator as any).buildCompositeMethods(steps, new Set<string>());
    expect(methods).toHaveLength(1);
    expect(methods[0]).toContain('async login(username: string, password: string)');
    expect(methods[0]).toContain('await usernameField.fill(username);');
    expect(methods[0]).toContain('await passwordField.fill(password);');
    expect(methods[0]).toContain('await submitTarget.click();');
    expect(methods[0]).not.toContain('.first()');
  });

  it('does not add composite method when sequence is incomplete', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: 'input[name="username"]',
        normalizedUrl: 'https://example.test/login',
      }),
      createStep({
        step: 2,
        action: 'click',
        intent: 'click_continue',
        selector: 'button.next',
        normalizedUrl: 'https://example.test/login',
      }),
    ];

    const methods = (LlmOrchestrator as any).buildCompositeMethods(steps, new Set<string>());
    expect(methods).toHaveLength(0);
  });
});

describe('LlmOrchestrator - assertion helpers', () => {
  it('builds visible/enabled/text/value helpers for unique selectors', () => {
    const helpers = (LlmOrchestrator as any).buildAssertionHelpers(
      [
        {
          stepNumber: 1,
          methodName: 'fillUsername',
          selector: 'input[name="username"]',
          action: 'input',
        },
        {
          stepNumber: 2,
          methodName: 'clickLoginButton',
          selector: 'button[type="submit"]',
          action: 'click',
        },
        {
          stepNumber: 3,
          methodName: 'fillUsernameAgain',
          selector: 'input[name="username"]',
          action: 'input',
        },
      ],
      new Set<string>(),
    );

    const joined = helpers.join('\n');
    expect(joined).toContain('async isUsernameVisible()');
    expect(joined).toContain('async isUsernameEnabled()');
    expect(joined).toContain('async getUsernameText()');
    expect(joined).toContain('async getUsernameValue()');
    expect(joined).toContain('async isLoginButtonVisible()');
    expect(joined).toContain('async isLoginButtonEnabled()');
    expect(joined).toContain('async getLoginButtonText()');
    expect((joined.match(/isUsernameVisible/g) || []).length).toBe(1);
  });
});

describe('LlmOrchestrator - flow context prompt', () => {
  it('builds compact flow context with repeated selector hints', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        intent: 'click_login',
        selector: 'button[type="submit"]',
        pageUrl: 'https://example.test/login',
        normalizedUrl: 'https://example.test/login',
      }),
      createStep({
        step: 2,
        action: 'input',
        intent: 'input_search',
        selector: '#query',
        pageUrl: 'https://example.test/dashboard',
        normalizedUrl: 'https://example.test/dashboard',
      }),
      createStep({
        step: 3,
        action: 'click',
        intent: 'click_logout',
        selector: 'button[type="submit"]',
        pageUrl: 'https://example.test/dashboard',
        normalizedUrl: 'https://example.test/dashboard',
      }),
    ];

    const session = createSession(steps, { stepCount: 3 });
    const context = (LlmOrchestrator as any).buildFlowPromptContext(session, steps);

    expect(context).toHaveProperty('flowTitle');
    expect(context).toHaveProperty('pageJourney');
    expect(context).toHaveProperty('repeatedSelectorHints');
    expect(context.repeatedSelectorHints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: 'button[type="submit"]',
          occurrences: 2,
          stepNumbers: [1, 3],
        }),
      ]),
    );
  });

  it('injects FLOW CONTEXT into prompt body', () => {
    const steps: CodegenStep[] = [
      createStep({ step: 1, intent: 'input_username', selector: '#username' }),
      createStep({ step: 2, intent: 'input_password', selector: '#password' }),
    ];
    const session = createSession(steps, { stepCount: 2 });

    const prompt = (LlmOrchestrator as any).buildPrompt(session, steps);
    expect(prompt).toContain('FLOW CONTEXT:');
    expect(prompt).toContain('repeatedSelectorHints');
    expect(prompt).toContain('Use FLOW CONTEXT to keep method intent aligned with the user journey.');
  });
});

describe('LlmOrchestrator - selector fallback parsing', () => {
  it('accepts legacy single selector payload', async () => {
    const spy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi').mockResolvedValueOnce(JSON.stringify([
      { stepNumber: 1, selector: '  button[type="submit"]  ' },
    ]));

    const suggestions = await (LlmOrchestrator as any).requestSelectorFallback({
      mode: 'initial',
      steps: [],
      config: {
        enableLLMFallback: true,
        resolverMinScore: 0.7,
        intentMinScore: 0.6,
        maxSnapshotBytesForValidation: 2_000_000,
        maxSnapshotExcerptChars: 2000,
        llmTimeoutMs: 20_000,
        llmMaxCandidatesPerStep: 3,
        llmMaxRetriesPerStep: 3,
      },
    });

    expect(suggestions).toEqual([
      {
        stepNumber: 1,
        candidates: ['button[type="submit"]'],
        responseFormat: 'legacy-selector',
        truncated: false,
      },
    ]);
    spy.mockRestore();
  });

  it('accepts legacy selectors[] payload and clamps to candidate cap', async () => {
    const spy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi').mockResolvedValueOnce(JSON.stringify([
      {
        stepNumber: 1,
        selectors: [
          'button[type="submit"]',
          'css=[aria-label="submit"]',
          'locator(button.primary)',
          '#submit',
        ],
      },
    ]));

    const suggestions = await (LlmOrchestrator as any).requestSelectorFallback({
      mode: 'initial',
      steps: [],
      config: {
        enableLLMFallback: true,
        resolverMinScore: 0.7,
        intentMinScore: 0.6,
        maxSnapshotBytesForValidation: 2_000_000,
        maxSnapshotExcerptChars: 2000,
        llmTimeoutMs: 20_000,
        llmMaxCandidatesPerStep: 3,
        llmMaxRetriesPerStep: 3,
      },
    });

    expect(suggestions).toEqual([
      {
        stepNumber: 1,
        candidates: [
          'button[type="submit"]',
          '[aria-label="submit"]',
          'button.primary',
        ],
        responseFormat: 'legacy-selectors',
        truncated: true,
      },
    ]);
    spy.mockRestore();
  });

  it('accepts candidates-v2 payload, merges duplicate steps, dedupes, and ignores invalid selectors', async () => {
    const spy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi').mockResolvedValueOnce(JSON.stringify([
      {
        stepNumber: 1,
        candidates: [
          { selector: '```css\nbutton[type="submit"]\n```', reason: 'best' },
          { selector: 'xpath=//button[@type="submit"]', reason: 'unsupported' },
          { selector: '`[aria-label="submit"]`' },
        ],
      },
      {
        stepNumber: 1,
        candidates: [
          { selector: 'button[type="submit"]' },
          { selector: 'Use #submit because it is stable.' },
          { selector: '#submit' },
        ],
      },
      {
        stepNumber: 0,
        candidates: [{ selector: '#ignored' }],
      },
    ]));

    const suggestions = await (LlmOrchestrator as any).requestSelectorFallback({
      mode: 'initial',
      steps: [],
      config: {
        enableLLMFallback: true,
        resolverMinScore: 0.7,
        intentMinScore: 0.6,
        maxSnapshotBytesForValidation: 2_000_000,
        maxSnapshotExcerptChars: 2000,
        llmTimeoutMs: 20_000,
        llmMaxCandidatesPerStep: 3,
        llmMaxRetriesPerStep: 3,
      },
    });

    expect(suggestions).toEqual([
      {
        stepNumber: 1,
        candidates: [
          'button[type="submit"]',
          '[aria-label="submit"]',
          '#submit',
        ],
        responseFormat: 'candidates-v2',
        truncated: false,
      },
    ]);
    spy.mockRestore();
  });

  it('returns [] safely for malformed JSON', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi').mockResolvedValueOnce('not-json');

    const suggestions = await (LlmOrchestrator as any).requestSelectorFallback({
      mode: 'initial',
      steps: [],
      config: {
        enableLLMFallback: true,
        resolverMinScore: 0.7,
        intentMinScore: 0.6,
        maxSnapshotBytesForValidation: 2_000_000,
        maxSnapshotExcerptChars: 2000,
        llmTimeoutMs: 20_000,
        llmMaxCandidatesPerStep: 3,
        llmMaxRetriesPerStep: 3,
      },
    });

    expect(suggestions).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    spy.mockRestore();
    warnSpy.mockRestore();
  });

  it('normalizes corrective retry selectors and keeps the first valid selector per step', async () => {
    const spy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi').mockResolvedValueOnce(JSON.stringify([
      { stepNumber: 1, selector: '```css\nlocator("#submit")\n```' },
      { stepNumber: 1, selector: '#ignored' },
      { stepNumber: 2, selector: 'xpath=//button[@type="submit"]' },
      { stepNumber: 0, selector: '#ignored-too' },
    ]));

    const suggestions = await (LlmOrchestrator as any).requestSelectorCorrectiveRetry({
      mode: 'retry',
      steps: [],
      config: {
        enableLLMFallback: true,
        resolverMinScore: 0.7,
        intentMinScore: 0.6,
        maxSnapshotBytesForValidation: 2_000_000,
        maxSnapshotExcerptChars: 2000,
        llmTimeoutMs: 20_000,
        llmRetryTimeoutMs: 10_000,
        llmMaxCandidatesPerStep: 3,
        llmMaxRetriesPerStep: 3,
      },
    });

    expect(suggestions).toEqual([
      {
        stepNumber: 1,
        selector: '#submit',
      },
    ]);
    spy.mockRestore();
  });

  it('builds a compact corrective retry prompt with fingerprint summary and retry rules', () => {
    const prompt = (LlmOrchestrator as any).buildSelectorCorrectiveRetryPrompt({
      mode: 'retry',
      steps: [
        {
          stepNumber: 1,
          action: 'input',
          intent: 'input_username',
          originalSelector: '.login-panel',
          fingerprint: {
            textExcerpt: 'Username',
            href: '/admin',
            dataTestId: 'username-input',
            dataCy: 'username-field',
            dataQa: 'username-field',
            role: 'textbox',
            name: 'username',
            placeholder: 'Username',
          },
          snapshotExcerpt: '<form><input name="username" /></form>',
          failedCandidates: [
            { selector: '.login-panel', rejectReason: 'llm-intent-mismatch' },
          ],
        },
      ],
      config: {
        enableLLMFallback: true,
        resolverMinScore: 0.7,
        intentMinScore: 0.6,
        maxSnapshotBytesForValidation: 2_000_000,
        maxSnapshotExcerptChars: 2000,
        llmTimeoutMs: 20_000,
        llmRetryTimeoutMs: 10_000,
        llmMaxCandidatesPerStep: 3,
        llmMaxRetriesPerStep: 3,
      },
    });

    expect(prompt).toContain('"textExcerpt": "Username"');
    expect(prompt).toContain('"dataTestId": "username-input"');
    expect(prompt).toContain('"dataCy": "username-field"');
    expect(prompt).toContain('"dataQa": "username-field"');
    expect(prompt).toContain('Do NOT use :nth-child or :nth-of-type.');
    expect(prompt).toContain('Do NOT use body/html-root descendant paths.');
  });
});

describe('LlmOrchestrator - sidecar resolver metadata', () => {
  it('writes top-k LLM metadata into the sidecar resolver block', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-llm-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'click',
        intent: 'click_submit',
        selector: 'button',
        selectorPriority: 'unknown',
        selectorRank: 10,
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.test/login',
      }),
    ], {
      url: 'https://example.test/login',
      stepCount: 1,
    });

    const snapshot = new JSDOM(`<!doctype html><html><body>
      <button aria-label="submit">Submit</button>
      <button aria-label="cancel">Cancel</button>
    </body></html>`).window.document;

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify([
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[aria-label="cancel"]' },
            { selector: 'button[aria-label="submit"]' },
          ],
        },
      ]))
      .mockResolvedValueOnce(JSON.stringify({
        className: 'LoginPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'click_submit',
            methodName: 'clickSubmit',
            playwrightAction: `locator('button[aria-label="submit"]').click()`,
          },
        ],
      }));

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: true,
          resolverMinScore: 1.3,
          llmMaxCandidatesPerStep: 3,
        },
        snapshotCache: {
          get(nodeId: string) {
            return nodeId === 'node-1' ? snapshot : null;
          },
          getSource() {
            return 'source-node-snapshot';
          },
        },
      },
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'LoginPage.air.json'), 'utf-8'),
    );

    expect(sidecar.methods.clickSubmit.resolver).toEqual(expect.objectContaining({
      llmAttempted: true,
      llmAccepted: true,
      llmAlternative: 'button[aria-label="submit"]',
      llmCandidatesReturned: [
        'button[aria-label="cancel"]',
        'button[aria-label="submit"]',
      ],
      llmCandidatesTried: [
        'button[aria-label="cancel"]',
        'button[aria-label="submit"]',
      ],
      llmAcceptedRank: 2,
      llmRejectedCandidates: [
        {
          selector: 'button[aria-label="cancel"]',
          rejectReason: 'llm-intent-mismatch',
        },
      ],
      llmResponseFormat: 'candidates-v2',
      resolvedBy: 'llm-accepted',
      selectorEvaluation: expect.objectContaining({
        category: 'aria-label',
        proof: expect.objectContaining({
          proofLevel: 'semantic_validated',
          proofSource: 'llm-validator',
        }),
        scoring: expect.objectContaining({
          finalScore: expect.any(Number),
          stabilityScore: expect.any(Number),
          semanticScore: expect.any(Number),
        }),
      }),
    }));
    expect(sidecar.methods.clickSubmit.originalSelector).toBe('button');
    expect(sidecar.methods.clickSubmit.selectorUsed).toBe('button[aria-label="submit"]');
    expect(sidecar.methods.clickSubmit.originalSelectorSpec).toEqual(expect.objectContaining({
      selector: 'button',
      engine: 'css',
      source: 'interceptor',
      proofLevel: 'recorded',
    }));
    expect(sidecar.methods.clickSubmit.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'button[aria-label="submit"]',
      engine: 'css',
      source: 'llm',
      proofLevel: 'semantic_validated',
    }));
    expect(sidecar.methods.clickSubmit).toEqual(expect.objectContaining({
      emittedLocator: `locator("button[aria-label=\\"submit\\"]")`,
      emittedLocatorEngine: 'css',
      emittedLocatorProofLevel: 'semantic_validated',
      emittedLocatorSource: 'llm',
      emittedLocatorWarnings: [],
      usedSelectorSpec: true,
    }));

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes recordedSelectorCandidates to sidecar without changing generated TypeScript output', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-selector-candidates-sidecar-'));
    const outputDirWithCandidates = path.join(tempRoot, 'with-candidates');
    const outputDirWithoutCandidates = path.join(tempRoot, 'without-candidates');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDirWithCandidates, { recursive: true });
    fs.mkdirSync(outputDirWithoutCandidates, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const snapshot = new JSDOM(`<!doctype html><html><body>
      <input data-testid="username-input" name="username" placeholder="Username" />
    </body></html>`).window.document;

    const baseFingerprint = {
      selector: 'input[name="username"]',
      selectorPriority: 'attribute' as const,
      selectorRank: 3,
      tagName: 'input',
      textExcerpt: null,
      attributes: {
        name: 'username',
        placeholder: 'Username',
        'data-testid': 'username-input',
      },
      attributesHash: 'selector-candidates-sidecar-hash',
    };

    const sessionWithCandidates = createSession([
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: 'input[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.test/login',
        value: 'Admin',
        fingerprint: {
          ...baseFingerprint,
          selectorCandidates: [
            {
              selector: 'input[name="username"]',
              engine: 'css',
              family: 'primary',
              strength: 'strong',
              source: 'capture',
              isPrimary: true,
              matchCount: 1,
              visibleMatchCount: 1,
              positionInAllMatches: 0,
              positionInVisibleMatches: 0,
              warningCodes: ['recorded-primary'],
            },
          ],
        },
      }),
    ], {
      url: 'https://example.test/login',
      stepCount: 1,
    });

    const sessionWithoutCandidates = createSession([
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: 'input[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.test/login',
        value: 'Admin',
        fingerprint: baseFingerprint,
      }),
    ], {
      url: 'https://example.test/login',
      stepCount: 1,
    });

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValue(JSON.stringify({
        className: 'LoginPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'input_username',
            methodName: 'fillUsername',
            playwrightAction: `locator('input[name="username"]').fill(value)`,
          },
        ],
      }));

    const generationOptions = {
      snapshotCache: {
        get(nodeId: string) {
          return nodeId === 'node-1' ? snapshot : null;
        },
        getSource() {
          return 'source-node-snapshot' as const;
        },
      },
    };

    await LlmOrchestrator.generatePageObjects(
      sessionWithCandidates,
      outputDirWithCandidates,
      projectRoot,
      generationOptions,
    );
    await LlmOrchestrator.generatePageObjects(
      sessionWithoutCandidates,
      outputDirWithoutCandidates,
      projectRoot,
      generationOptions,
    );

    const generatedWithCandidates = fs.readFileSync(path.join(outputDirWithCandidates, 'LoginPage.ts'), 'utf-8');
    const generatedWithoutCandidates = fs.readFileSync(path.join(outputDirWithoutCandidates, 'LoginPage.ts'), 'utf-8');
    const sidecarWithCandidates = JSON.parse(
      fs.readFileSync(path.join(outputDirWithCandidates, 'LoginPage.air.json'), 'utf-8'),
    );
    const sidecarWithoutCandidates = JSON.parse(
      fs.readFileSync(path.join(outputDirWithoutCandidates, 'LoginPage.air.json'), 'utf-8'),
    );

    expect(generatedWithCandidates).toBe(generatedWithoutCandidates);
    expect(sidecarWithCandidates.methods.fillUsername.recordedSelectorCandidates).toEqual([
      expect.objectContaining({
        selector: 'input[name="username"]',
        engine: 'css',
        family: 'primary',
        strength: 'strong',
        source: 'capture',
        isPrimary: true,
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
      }),
    ]);
    expect(sidecarWithoutCandidates.methods.fillUsername.recordedSelectorCandidates).toBeUndefined();
    expect(sidecarWithCandidates.methods.fillUsername.playwrightNativeCandidates).toBeUndefined();

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('writes corrective retry metadata into the sidecar resolver block', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-llm-retry-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: '.login-panel',
        selectorPriority: 'class',
        selectorRank: 7,
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.test/login',
        fingerprint: {
          selector: '.login-panel',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          textExcerpt: 'Username',
          attributes: {
            name: 'username',
            placeholder: 'Username',
            'data-testid': 'username-input',
          },
        },
      }),
    ], {
      url: 'https://example.test/login',
      stepCount: 1,
    });

    const snapshot = new JSDOM(`<!doctype html><html><body>
      <div class="login-panel">Login</div>
      <input name="username" placeholder="Username" />
    </body></html>`).window.document;

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify([
        {
          stepNumber: 1,
          candidates: [
            { selector: 'button[' },
            { selector: '.login-panel' },
          ],
        },
      ]))
      .mockResolvedValueOnce(JSON.stringify([
        {
          stepNumber: 1,
          selector: 'locator(\'input[name="username"]\')',
        },
      ]))
      .mockResolvedValueOnce(JSON.stringify({
        className: 'LoginPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'input_username',
            methodName: 'fillUsername',
            playwrightAction: `locator('input[name="username"]').fill(value)`,
          },
        ],
      }));

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: true,
          resolverMinScore: 1.3,
          llmRetryTimeoutMs: 10_000,
        },
        snapshotCache: {
          get(nodeId: string) {
            return nodeId === 'node-1' ? snapshot : null;
          },
          getSource() {
            return 'source-node-snapshot';
          },
        },
      },
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'LoginPage.air.json'), 'utf-8'),
    );

    expect(sidecar.methods.fillUsername.resolver).toEqual(expect.objectContaining({
      llmRetryTriggered: true,
      llmRetrySelector: 'input[name="username"]',
      llmRetryRejectReason: null,
      llmRetryAccepted: true,
      llmRetryTimeoutMs: 10000,
      llmRetryStatus: 'accepted',
      resolvedBy: 'llm-accepted',
      selectorEvaluation: expect.objectContaining({
        category: 'name',
        proof: expect.objectContaining({
          proofLevel: 'semantic_validated',
          proofSource: 'llm-validator',
        }),
      }),
    }));
    expect(sidecar.methods.fillUsername.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'input[name="username"]',
      engine: 'css',
      source: 'llm',
      proofLevel: 'semantic_validated',
    }));
    expect(sidecar.methods.fillUsername).toEqual(expect.objectContaining({
      emittedLocator: `locator("input[name=\\"username\\"]")`,
      emittedLocatorEngine: 'css',
      emittedLocatorProofLevel: 'semantic_validated',
      emittedLocatorSource: 'llm',
      emittedLocatorWarnings: [],
      usedSelectorSpec: true,
    }));

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists weak fallback sidecar metadata without marking strong selectors as weak', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-weak-fallback-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        value: 'Admin',
        pageUrl: 'https://example.test/login',
        normalizedUrl: 'https://example.test/login',
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          selectorAmbiguity: {
            originalSelector: '.oxd-input',
            matchCount: 2,
            visibleMatchCount: 2,
            positionInMatches: 1,
            isUnique: false,
            isAmbiguous: true,
          },
          attributes: {
            name: 'username',
          },
        },
      }),
      createStep({
        step: 2,
        action: 'click',
        intent: 'click_submit',
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        pageUrl: 'https://example.test/login',
        normalizedUrl: 'https://example.test/login',
      }),
    ], {
      url: 'https://example.test/login',
      stepCount: 2,
    });

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify({
        className: 'LoginPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'input_username',
            methodName: 'fillUsername',
            playwrightAction: `locator('.oxd-input').fill('Admin')`,
          },
          {
            stepNumber: 2,
            intent: 'click_submit',
            methodName: 'clickSubmit',
            playwrightAction: `locator('button[type="submit"]').click()`,
          },
        ],
      }));

    const resolveSpy = vi.spyOn(selectorResolverModule, 'resolveSelectorsForSession')
      .mockResolvedValueOnce({
        resolutions: [
          {
            stepNumber: 1,
            originalSelector: '.oxd-input',
            resolvedSelector: '.oxd-input',
            selectorSpec: {
              selector: '.oxd-input',
              engine: 'css',
              source: 'interceptor',
              proofLevel: 'recorded',
              rank: 7,
            },
            resolvedSelectorSpec: {
              selector: '.oxd-input',
              engine: 'css',
              source: 'resolver',
              proofLevel: 'unvalidated',
              rank: 7,
            },
            resolverMetadata: {
              resolvedSelector: '.oxd-input',
              resolvedBy: 'kept-original',
              bestScore: 0.41,
              effectiveMatchCount: 2,
              matchCount: 2,
              snapshotSource: 'event-local-pageState',
              validationMethod: 'css-query-static-visibility-element-ranking-v1',
              llmAttempted: false,
              llmAccepted: false,
              llmAlternative: null,
              rejectReason: null,
              warningCodes: ['unvalidated-selector'],
              resolverVersion: 1,
            },
          },
          {
            stepNumber: 2,
            originalSelector: 'button[type="submit"]',
            resolvedSelector: 'button[type="submit"]',
            selectorSpec: {
              selector: 'button[type="submit"]',
              engine: 'css',
              source: 'interceptor',
              proofLevel: 'recorded',
              rank: 3,
            },
            resolvedSelectorSpec: {
              selector: 'button[type="submit"]',
              engine: 'css',
              source: 'resolver',
              proofLevel: 'semantic_validated',
              rank: 3,
            },
            resolverMetadata: {
              resolvedSelector: 'button[type="submit"]',
              resolvedBy: 'kept-original',
              bestScore: 0.92,
              effectiveMatchCount: 1,
              matchCount: 1,
              snapshotSource: 'event-local-pageState',
              validationMethod: 'css-query-static-visibility-element-ranking-v1',
              llmAttempted: false,
              llmAccepted: false,
              llmAlternative: null,
              rejectReason: null,
              warningCodes: [],
              resolverVersion: 1,
            },
          },
        ],
        unresolvedStepNumbers: [],
        llmAttemptedStepNumbers: [],
        llmAcceptedStepNumbers: [],
      } as any);

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: false,
        },
        snapshotCache: {
          get() {
            return null;
          },
          getSource() {
            return 'unavailable';
          },
        },
      },
    );

    const code = fs.readFileSync(path.join(outputDir, 'LoginPage.ts'), 'utf-8');
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'LoginPage.air.json'), 'utf-8'),
    );

    expect(code).toContain('// AIR WARNING: Weak selector fallback.');
    expect(code).toContain('const target = this.page.locator(".oxd-input:visible").nth(1);');
    expect(sidecar.methods.fillUsername).toEqual(expect.objectContaining({
      emittedWeakFallback: true,
      weakFallbackReason: 'selector was not confidently validated.',
      weakFallbackSelector: '.oxd-input',
      weakFallbackLocator: 'locator(".oxd-input:visible").nth(1)',
      weakFallbackIndex: 1,
      weakFallbackIndexKind: 'visible',
      weakFallbackUsedVisibleFilter: true,
      weakFallbackMatchCount: 2,
      weakFallbackVisibleMatchCount: 2,
      weakFallbackSource: 'indexed-fallback',
    }));
    expect(sidecar.methods.clickSubmit.emittedWeakFallback).toBeUndefined();

    resolveSpy.mockRestore();
    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('preserves exact resolvedSelectorSpec in sidecar when emitting getByTestId equivalent rendering', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-equiv-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'click',
        intent: 'click_login',
        selector: 'button',
        selectorPriority: 'class',
        selectorRank: 7,
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.test/login',
        fingerprint: {
          selector: 'button',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'button',
          textExcerpt: 'Login',
          attributes: {
            'data-testid': 'login-btn',
          },
        },
      }),
    ], {
      url: 'https://example.test/login',
      stepCount: 1,
    });

    const snapshot = new JSDOM(`<!doctype html><html><body>
      <button data-testid="login-btn">Login</button>
      <button>Cancel</button>
    </body></html>`).window.document;

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify({
        className: 'LoginPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'click_login',
            methodName: 'clickLogin',
            playwrightAction: `locator('button').click()`,
          },
        ],
      }));

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: false,
        },
        snapshotCache: {
          get(nodeId: string) {
            return nodeId === 'node-1' ? snapshot : null;
          },
          getSource() {
            return 'source-node-snapshot';
          },
        },
      },
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'LoginPage.air.json'), 'utf-8'),
    );

    expect(sidecar.methods.clickLogin.resolvedSelectorSpec).toEqual(expect.objectContaining({
      selector: 'button[data-testid="login-btn"]',
      engine: 'css',
      source: 'resolver',
      proofLevel: 'semantic_validated',
    }));
    expect(sidecar.methods.clickLogin).toEqual(expect.objectContaining({
      emittedLocator: `getByTestId("login-btn")`,
      emittedLocatorEngine: 'testid',
      emittedLocatorProofLevel: 'proven_equivalent',
      equivalentRenderingUsed: true,
      equivalentLocator: `getByTestId("login-btn")`,
      equivalentLocatorEngine: 'testid',
      equivalentProofLevel: 'proven_equivalent',
      equivalentProofSource: 'attribute-equivalence',
      equivalentSourceSelector: 'button[data-testid="login-btn"]',
      preferredRenderings: [
        expect.objectContaining({
          engine: 'testid',
          locator: `getByTestId("login-btn")`,
        }),
      ],
    }));

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists bounded custom-control compression metadata in the sidecar', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-custom-control-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'custom-select',
        intent: 'select_admin',
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        pageUrl: 'https://example.test/admin',
        normalizedUrl: 'https://example.test/admin',
        controlFamily: 'combobox',
        triggerSelector: '.oxd-select-text',
        triggerSelectorPriority: 'class',
        triggerSelectorSpec: {
          selector: '.oxd-select-text',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 7,
        },
        optionSelector: '[role="option"]',
        optionText: 'Admin',
        optionValue: 'Admin',
        optionSelectorSpec: {
          selector: '[role="option"]',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 3,
        },
        absorbedOpenEventId: 'ev-open',
        absorbedOpenTraceId: 'trace-1',
        compressedFromEvents: ['ev-open', 'ev-select'],
        value: 'Admin',
      }),
    ], {
      url: 'https://example.test/admin',
      stepCount: 1,
    });

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify({
        className: 'AdminPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'select_admin',
            methodName: 'selectAdmin',
            playwrightAction: `locator('[role="option"]').click()`,
          },
        ],
      }));

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: false,
        },
        snapshotCache: {
          get() {
            return null;
          },
          getSource() {
            return 'unavailable';
          },
        },
      },
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'AdminPage.air.json'), 'utf-8'),
    );

    expect(sidecar.methods.selectAdmin).toEqual(expect.objectContaining({
      controlFamily: 'combobox',
      triggerSelector: '.oxd-select-text',
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
      absorbedOpenEventId: 'ev-open',
      absorbedOpenTraceId: 'trace-1',
      compressedFromEvents: ['ev-open', 'ev-select'],
    }));
    expect(sidecar.methods.selectAdmin.triggerSelectorSpec).toEqual(expect.objectContaining({
      selector: '.oxd-select-text',
      proofLevel: 'recorded',
    }));
    expect(sidecar.methods.selectAdmin.optionSelectorSpec).toEqual(expect.objectContaining({
      selector: '[role="option"]',
      proofLevel: 'recorded',
    }));

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists trigger-context proof metadata in the sidecar for ambiguous custom-control triggers', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-trigger-context-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'custom-select',
        intent: 'select_admin',
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        sourceNodeId: 'node-1',
        pageUrl: 'https://example.test/admin',
        normalizedUrl: 'https://example.test/admin',
        controlFamily: 'combobox',
        triggerSelector: '.select-trigger',
        triggerSelectorPriority: 'class',
        triggerFingerprint: {
          selector: '.select-trigger',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'div',
          textExcerpt: 'User Role',
          attributes: {
            class: 'select-trigger',
            role: 'combobox',
            fieldLabelText: 'User Role',
          },
        },
        triggerSelectorSpec: {
          selector: '.select-trigger',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 7,
        },
        optionSelector: '[role="option"]',
        optionText: 'Admin',
        optionValue: 'Admin',
        optionSelectorSpec: {
          selector: '[role="option"]',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 3,
        },
        absorbedOpenEventId: 'ev-open',
        absorbedOpenTraceId: 'trace-1',
        compressedFromEvents: ['ev-open', 'ev-select'],
        value: 'Admin',
      }),
    ], {
      url: 'https://example.test/admin',
      stepCount: 1,
    });

    const snapshot = new JSDOM(`
      <html><body>
        <div class="field-row">
          <div>User Role</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div class="field-row">
          <div>Status</div>
          <div class="select-trigger" role="combobox" aria-haspopup="listbox">-- Select --</div>
        </div>
        <div role="option">Admin</div>
      </body></html>
    `).window.document;
    for (const element of [snapshot.documentElement, ...Array.from(snapshot.querySelectorAll('*'))] as Array<any>) {
      Object.defineProperty(element, 'offsetParent', {
        configurable: true,
        get() {
          return {};
        },
      });
      element.getBoundingClientRect = () => ({ width: 10, height: 10, top: 0, left: 0, right: 10, bottom: 10, x: 0, y: 0, toJSON() { return this; } });
    }

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify({
        className: 'AdminPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'select_admin',
            methodName: 'selectAdmin',
            playwrightAction: `locator('[role="option"]').click()`,
          },
        ],
      }));

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: false,
        },
        snapshotCache: {
          get() {
            return snapshot;
          },
          getSource() {
            return 'source-node-snapshot';
          },
          selectForStep() {
            return {
              snapshot,
              provenance: {
                source: 'source-node-snapshot',
                temporalClass: 'pre_action',
                reason: 'test_trigger_context_snapshot',
                snapshotTargetEvidence: true,
                snapshotTargetEvidenceReason: 'selector_match',
              },
              evaluatedCandidates: [],
            };
          },
        },
      },
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'AdminPage.air.json'), 'utf-8'),
    );

    expect(sidecar.methods.selectAdmin).toEqual(expect.objectContaining({
      triggerOriginalSelector: '.select-trigger',
      triggerResolvedSelector: expect.stringContaining('bounded-field("User Role"'),
      triggerContextLabel: 'User Role',
      triggerContextRenderStatus: expect.stringMatching(/clean-scoped-locator|proven-structural-fallback/),
    }));
    const triggerBoundedField =
      sidecar.methods.selectAdmin.triggerSelectorSpec?.engine === 'bounded-field'
        ? sidecar.methods.selectAdmin.triggerSelectorSpec.boundedField
        : undefined;
    expect(triggerBoundedField).toEqual(expect.objectContaining({
      labelText: 'User Role',
      relation: expect.stringMatching(/sibling-label|bounded-container/),
    }));

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists blocked trigger-context warnings in the sidecar and avoids silent trigger emission', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-trigger-context-blocked-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'custom-select',
        intent: 'select_admin',
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        pageUrl: 'https://example.test/admin',
        normalizedUrl: 'https://example.test/admin',
        controlFamily: 'combobox',
        triggerSelector: '.oxd-select-text',
        triggerSelectorPriority: 'class',
        triggerSelectorSpec: {
          selector: '.oxd-select-text',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 7,
        },
        triggerFingerprint: {
          selector: '.oxd-select-text',
          selectorPriority: 'class',
          selectorRank: 7,
          selectorAmbiguity: {
            originalSelector: '.oxd-select-text',
            matchCount: 2,
            visibleMatchCount: 2,
            positionInMatches: 0,
            isUnique: false,
            isAmbiguous: true,
          },
        },
        optionSelector: '[role="option"]',
        optionText: 'Admin',
        optionValue: 'Admin',
        optionSelectorSpec: {
          selector: '[role="option"]',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 3,
        },
        absorbedOpenEventId: 'ev-open',
        absorbedOpenTraceId: 'trace-1',
        compressedFromEvents: ['ev-open', 'ev-select'],
        value: 'Admin',
      }),
    ], {
      url: 'https://example.test/admin',
      stepCount: 1,
    });

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify({
        className: 'AdminPage',
        methods: [
          {
            stepNumber: 1,
            intent: 'select_admin',
            methodName: 'selectAdmin',
            playwrightAction: `locator('[role="option"]').click()`,
          },
        ],
      }));

    const resolveSpy = vi.spyOn(selectorResolverModule, 'resolveSelectorsForSession')
      .mockResolvedValueOnce({
        resolutions: [
          {
            stepNumber: 1,
            originalSelector: '[role="option"]',
            resolvedSelector: '[role="option"]',
            selectorSpec: {
              selector: '[role="option"]',
              engine: 'css',
              source: 'interceptor',
              proofLevel: 'recorded',
              rank: 3,
            },
            resolvedSelectorSpec: {
              selector: '[role="option"]',
              engine: 'css',
              source: 'interceptor',
              proofLevel: 'snapshot_validated',
              rank: 3,
              confidence: 1,
            },
            resolverMetadata: {
              resolvedSelector: '[role="option"]',
              resolvedBy: 'kept-original',
              bestScore: 0.9,
              effectiveMatchCount: 1,
              snapshotSource: 'event-local-pageState',
              validationMethod: 'css-query-static-visibility-element-ranking-v1',
              llmAttempted: false,
              llmAccepted: false,
              llmAlternative: null,
              rejectReason: null,
              warningCodes: [],
              resolverVersion: 1,
              triggerContextRenderStatus: 'blocked-unsafe-render',
              triggerContextRenderReason: 'target_missing',
              triggerWarningCodes: ['custom-control-trigger-target-binding-ambiguous'],
            },
          },
        ],
        unresolvedStepNumbers: [],
        llmAttemptedStepNumbers: [],
        llmAcceptedStepNumbers: [],
      } as any);

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: false,
        },
        snapshotCache: {
          get() {
            return null;
          },
          getSource() {
            return 'unavailable';
          },
        },
      },
    );

    const code = fs.readFileSync(path.join(outputDir, 'AdminPage.ts'), 'utf-8');
    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'AdminPage.air.json'), 'utf-8'),
    );

    expect(code).toContain('// AIR WARNING: Weak selector fallback.');
    expect(code).toContain('const triggerTarget = this.page.locator(".oxd-select-text:visible").nth(0);');
    expect(code).toContain(`await triggerTarget.waitFor({ state: 'visible', timeout: 5000 });`);
    expect(code).toContain('await triggerTarget.click();');
    expect(code).toContain('// AIR WARNING: Weak trigger selector fallback.');
    expect(code).toContain('// AIR preserved the recorded option selection below.');
    expect(code).toContain('const optionTarget = this.page.locator("[role=\\"option\\"]");');
    expect(code).toContain('await optionTarget.click();');
    expect(code).not.toContain('throw new Error(');
    expect(sidecar.methods.selectAdmin).toEqual(expect.objectContaining({
      emittedWeakFallback: true,
      weakFallbackReason: 'trigger selector was ambiguous during recording.',
      weakFallbackSelector: '.oxd-select-text',
      weakFallbackLocator: 'locator(".oxd-select-text:visible").nth(0)',
      weakFallbackIndex: 0,
      weakFallbackIndexKind: 'visible',
      weakFallbackUsedVisibleFilter: true,
      weakFallbackMatchCount: 2,
      weakFallbackVisibleMatchCount: 2,
      weakFallbackSource: 'indexed-fallback',
      triggerContextRenderStatus: 'blocked-unsafe-render',
      triggerContextRenderReason: 'target_missing',
      triggerWarningCodes: ['custom-control-trigger-target-binding-ambiguous'],
    }));
    expect(sidecar.methods.selectAdmin.weakFallbackWarnings ?? []).toEqual([]);
    expect(sidecar.methods.selectAdmin.warningCodes).toContain('custom-control-trigger-target-binding-ambiguous');

    resolveSpy.mockRestore();
    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('persists label-context proof metadata in the sidecar', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'air-label-context-sidecar-'));
    const outputDir = path.join(tempRoot, 'out');
    const projectRoot = path.join(tempRoot, 'project');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.mkdirSync(projectRoot, { recursive: true });

    const session = createSession([
      createStep({
        step: 1,
        action: 'input',
        intent: 'input_username',
        selector: '.generic-input',
        selectorPriority: 'class',
        selectorRank: 7,
        value: 'Admin',
        sourceNodeId: 'node-1',
        fingerprint: {
          selector: '.generic-input',
          tagName: 'input',
          attributes: {
            class: 'generic-input',
            type: 'text',
            fieldLabelText: 'Username',
          },
        },
      }),
    ], {
      url: 'https://example.test/profile',
      stepCount: 1,
    });

    const callSpy = vi.spyOn(LlmOrchestrator as any, 'callGeminiApi')
      .mockResolvedValueOnce(JSON.stringify({
        className: 'ProfilePage',
        methods: [
          {
            stepNumber: 1,
            intent: 'input_username',
            methodName: 'fillUsername',
            playwrightAction: `locator('.generic-input').fill('Admin')`,
          },
        ],
      }));

    const snapshot = new JSDOM(`<!doctype html><html><body>
      <label>Username<input class="generic-input" type="text" /></label>
    </body></html>`).window.document;

    await LlmOrchestrator.generatePageObjects(
      session,
      outputDir,
      projectRoot,
      {
        resolverConfig: {
          enableLLMFallback: false,
        },
        snapshotCache: {
          get(nodeId: string) {
            return nodeId === 'node-1' ? snapshot : null;
          },
          getSource() {
            return 'source-node-snapshot';
          },
          selectForStep() {
            return {
              snapshot,
              provenance: {
                source: 'source-node-snapshot',
                temporalClass: 'pre_action',
                reason: 'test_label_context_snapshot',
                snapshotTargetEvidence: true,
                snapshotTargetEvidenceReason: 'selector_match',
                labelStructureEvidence: true,
                labelStructureEvidenceReason: 'exact_label_association',
                labelContextSnapshotSource: 'source-node-snapshot',
                labelContextBlockedReason: null,
              },
              evaluatedCandidates: [],
            };
          },
        },
      },
    );

    const sidecar = JSON.parse(
      fs.readFileSync(path.join(outputDir, 'ProfilePage.air.json'), 'utf-8'),
    );

    expect(sidecar.methods.fillUsername.labelContextProof).toEqual(expect.objectContaining({
      association: 'wrapped-label',
      labelText: 'Username',
      targetTag: 'input',
      recoveredFromSelector: '.generic-input',
      labelStructureEvidenceReason: 'exact_label_association',
      snapshotSource: 'source-node-snapshot',
      renderStatus: 'proven-structural-fallback',
      renderReason: 'wrapped_label_exact',
    }));
    expect(sidecar.methods.fillUsername.resolvedSelectorSpec).toEqual(expect.objectContaining({
      engine: 'label-context',
    }));
    expect(sidecar.methods.fillUsername).toEqual(expect.objectContaining({
      labelContextRenderStatus: 'proven-structural-fallback',
      labelContextRenderReason: 'wrapped_label_exact',
      labelText: 'Username',
      relationType: 'wrapped-label',
      recoveredFromSelector: '.generic-input',
    }));
    expect(sidecar.methods.fillUsername.warningCodes).toContain('label-context-structural-fallback');

    callSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
});

describe('LlmOrchestrator - popup transition detection', () => {
  it('detects likely popup transition when next step is on a different page and current step has no navigation outcome', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 5,
        action: 'click',
        intent: 'click_open_product',
        selector: '.product-link',
        pageUrl: 'https://example.test/search?q=phone',
        normalizedUrl: 'https://example.test/search',
        outcomeType: 'no_change',
      }),
      createStep({
        step: 6,
        action: 'click',
        intent: 'click_variant',
        selector: '.variant',
        pageUrl: 'https://example.test/product/sku-1',
        normalizedUrl: 'https://example.test/product/sku-1',
      }),
    ];

    const popupSteps = (LlmOrchestrator as any).detectPopupTransitionSteps(steps);
    expect(popupSteps.has(5)).toBe(true);
  });
});
