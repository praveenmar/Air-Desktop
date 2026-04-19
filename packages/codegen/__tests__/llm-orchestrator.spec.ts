import { describe, expect, it } from 'vitest';
import { LlmOrchestrator } from '../src/llm-orchestrator';
import { CodegenSession, CodegenStep } from '../src/types';

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

    expect(emitted.fallbackReason).toBeNull();
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
    expect(emitted.methodCode).toContain(`const target = this.page.locator('button[type=\"submit\"]');`);
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
