import * as fs from 'fs';
import * as path from 'path';
import { CodegenSession, CodegenStep } from './types';
import { AirMetadata, AirMethodMeta } from './sidecar.types';
import { computeActionChecksum } from './checksum.utils';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { FlowReviewService } from './flow-review.service';
import {
  canRenderSelectorSpecConfidently,
  getSelectorSpecRenderingWarnings,
  renderLocatorExpressionFromSelectorSpec,
} from './selector-spec';
import {
  normalizeLlmRetrySuggestions,
  normalizeLlmSuggestions,
  resolveSelectorsForSession,
} from './selector-resolver';
import type {
  LlmCorrectiveRetryRequest,
  LlmFallbackRequest,
  LlmFallbackSuggestion,
  SelectorFallbackRequest,
  ResolverConfig,
  SnapshotCache,
} from './selector-resolver';

interface LlmResponse {
  className: string;
  methods: Array<{
    stepNumber: number;
    intent: string;
    methodName: string;
    playwrightAction: string;
  }>;
}

interface ParsedLocatorAction {
  locatorExpr: string;
  operation: string;
  args: string;
}

interface EmittedMethod {
  methodCode: string;
  fullAction: string;
  fallbackReason: string | null;
  selectorUsed: string;
  emittedLocator: string | null;
  emittedLocatorEngine: AirMethodMeta['emittedLocatorEngine'];
  emittedLocatorProofLevel: AirMethodMeta['emittedLocatorProofLevel'];
  emittedLocatorSource: AirMethodMeta['emittedLocatorSource'];
  emittedLocatorWarnings: string[];
  usedSelectorSpec: boolean;
}

interface AssertionHelperSeed {
  stepNumber: number;
  methodName: string;
  selector: string;
  action: CodegenStep['action'];
}

interface ValueParameter {
  name: string;
  defaultValue: string;
}

export interface GeneratePageObjectsOptions {
  resolverConfig?: ResolverConfig;
  snapshotCache?: SnapshotCache;
}

export class LlmOrchestrator {
  private static shouldGenerateAssertionHelpers(): boolean {
    const raw = (process.env.AIR_GENERATE_ASSERTION_HELPERS || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private static isRetryableGeminiError(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === 429 || status === 503 || status === 504;
  }

  static async generatePageObjects(
    session: CodegenSession,
    outputDir: string,
    projectRoot: string,
    options: GeneratePageObjectsOptions = {}
  ): Promise<void> {
    const resolverConfig = options.resolverConfig ?? {};
    const snapshotCache = options.snapshotCache ?? {
      get: (_nodeId: string, _normalizedUrl?: string, _controlSignature?: string) => null,
      getSource: (_nodeId: string, _normalizedUrl?: string, _controlSignature?: string) => 'unavailable',
    } as SnapshotCache & { snapshotEngineAvailable?: boolean };
    console.log('[DEBUG] snapshotCache received, engineAvailable:', !!(snapshotCache as any).snapshotEngineAvailable);
    const debugTrace = /^(1|true|yes)$/i.test(process.env.AIR_DEBUG_RESOLVER_TRACE || '');

    if (debugTrace) {
      console.log('--- SESSION STEPS ---');
      for (const step of session.steps) {
        console.log({
          step: step.step,
          selector: step.selector,
          sourceNodeId: step.sourceNodeId ?? null,
        });
      }

      console.log('--- SNAPSHOT AVAILABILITY ---');
      for (const step of session.steps) {
        const nodeId = step.sourceNodeId;
        const snapshot = snapshotCache.get(nodeId ?? '', step.normalizedUrl, step.controlSignature);
        console.log(`Step ${step.step} snapshot:`, snapshot ? 'YES' : 'NO');
      }
    }

    const resolverResult = await resolveSelectorsForSession(
      session,
      snapshotCache,
      resolverConfig,
      resolverConfig.enableLLMFallback
        ? (request: SelectorFallbackRequest) => (
          request.mode === 'retry'
            ? this.requestSelectorCorrectiveRetry(request)
            : this.requestSelectorFallback(request)
        )
        : undefined,
    );
    console.log('[AIR] Resolver summary', {
      totalSteps: session.steps.length,
      unresolved: resolverResult.unresolvedStepNumbers.length,
      llmAttempted: resolverResult.llmAttemptedStepNumbers.length,
      llmAccepted: resolverResult.llmAcceptedStepNumbers.length,
    });
    const resolutionMap = new Map(
      resolverResult.resolutions.map(resolution => [resolution.stepNumber, resolution]),
    );

    if (resolverResult.unresolvedStepNumbers.length > 0) {
      console.warn('[AIR] Some selectors unresolved:', resolverResult.unresolvedStepNumbers);
    }

    if (debugTrace) {
      console.log('--- RESOLVER OUTPUT ---');
      for (const resolution of resolverResult.resolutions) {
        console.log({
          step: resolution.stepNumber,
          original: resolution.originalSelector,
          resolved: resolution.resolvedSelector,
          resolvedBy: resolution.resolverMetadata.resolvedBy,
          score: resolution.resolverMetadata.bestScore,
          warnings: resolution.resolverMetadata.warningCodes,
        });
      }
    }

    // Generation-only view. Recorded session truth remains unchanged.
    const generationSteps: CodegenStep[] = session.steps.map(step => {
      const resolution = resolutionMap.get(step.step);
      return {
        ...step,
        selector: resolution?.resolvedSelector ?? step.selector,
        selectorSpec: resolution?.selectorSpec ?? step.selectorSpec,
        resolvedSelector: resolution?.resolvedSelector ?? step.selector,
        resolvedSelectorSpec: resolution?.resolvedSelectorSpec,
        resolverMetadata: resolution?.resolverMetadata,
      };
    });

    if (debugTrace) {
      console.log('--- FINAL SELECTORS USED ---');
      for (const step of generationSteps) {
        console.log({
          step: step.step,
          selectorUsed: step.selector,
        });
      }
    }

    const promptPayload = this.buildPrompt(session, generationSteps);

    const geminiResponseJson = await this.callGeminiApi(promptPayload);
    const parsedResponse: LlmResponse = JSON.parse(geminiResponseJson);

    if (parsedResponse.methods.length !== generationSteps.length) {
      console.warn(
        `[AIR] Warning: Expected ${generationSteps.length} steps, LLM returned ${parsedResponse.methods.length}.`,
      );
    }

    const methodsContent: string[] = [];
    const sidecarMethods: Record<string, AirMethodMeta> = {};
    const originalStepMap = new Map(session.steps.map(step => [step.step, step]));
    const usedMethodNames = new Set<string>();
    const assertionHelperSeeds: AssertionHelperSeed[] = [];
    const popupTransitionSteps = this.detectPopupTransitionSteps(generationSteps);
    const navigateMethod = this.buildNavigateMethod(session.url);
    if (navigateMethod) {
      methodsContent.push(navigateMethod);
      usedMethodNames.add('navigate');
    }

    for (const generatedMethod of parsedResponse.methods) {
      const originalStep = originalStepMap.get(generatedMethod.stepNumber);
      if (!originalStep) {
        console.error('[AIR] Invalid LLM output (Unknown step):', generatedMethod);
        continue;
      }

      const actionStr = generatedMethod.playwrightAction.trim();
      if (actionStr.startsWith('await ') || actionStr.startsWith('page.') || actionStr.startsWith('this.page.')) {
        console.error('[AIR] Invalid LLM output (Forbidden syntax):', generatedMethod);
        continue;
      }

      const methodName = this.ensureUniqueMethodName(generatedMethod.methodName, originalStep.step, usedMethodNames);
      const resolution = resolutionMap.get(originalStep.step);
      const emittedMethod = this.buildMethodCode(
        originalStep,
        methodName,
        actionStr,
        resolution?.resolvedSelector,
        resolution?.resolvedSelectorSpec,
        resolution?.resolverMetadata,
        popupTransitionSteps.has(originalStep.step),
      );
      methodsContent.push(emittedMethod.methodCode);
      if (emittedMethod.selectorUsed) {
        assertionHelperSeeds.push({
          stepNumber: originalStep.step,
          methodName,
          selector: emittedMethod.selectorUsed,
          action: originalStep.action,
        });
      }

      if (emittedMethod.fallbackReason) {
        console.warn('[AIR] [CODEGEN] Replaced weak LLM action with deterministic action', {
          step: originalStep.step,
          methodName,
          fallbackReason: emittedMethod.fallbackReason,
          llmAction: actionStr,
          emittedAction: emittedMethod.fullAction,
        });
      }

      const resolverForSidecar = resolution?.resolverMetadata
        ? {
            ...resolution.resolverMetadata,
            warningCodes: Array.from(new Set([
              ...(resolution.resolverMetadata.warningCodes ?? []),
              ...(!resolution?.resolvedSelectorSpec ? ['selector-spec-missing-fallback'] : []),
            ])),
          }
        : undefined;

      sidecarMethods[methodName] = {
        step: originalStep.step,
        intent: originalStep.intent,
        originalSelector: originalStep.selector,
        originalSelectorSpec: resolution?.selectorSpec ?? originalStep.selectorSpec,
        checksum: computeActionChecksum(emittedMethod.fullAction),
        resolver: resolverForSidecar,
        selectorUsed: emittedMethod.selectorUsed,
        resolvedSelectorSpec: resolution?.resolvedSelectorSpec,
        selectorType: originalStep.selectorPriority,
        actionType: originalStep.action,
        locatorFlavor: this.detectLocatorFlavor(emittedMethod.selectorUsed, originalStep.selectorPriority),
        emittedLocator: emittedMethod.emittedLocator ?? undefined,
        emittedLocatorEngine: emittedMethod.emittedLocatorEngine,
        emittedLocatorProofLevel: emittedMethod.emittedLocatorProofLevel,
        emittedLocatorSource: emittedMethod.emittedLocatorSource,
        emittedLocatorWarnings: emittedMethod.emittedLocatorWarnings,
        usedSelectorSpec: emittedMethod.usedSelectorSpec,
      };
    }

    const compositeMethods = this.buildCompositeMethods(generationSteps, usedMethodNames);
    methodsContent.push(...compositeMethods);
    if (this.shouldGenerateAssertionHelpers()) {
      const assertionHelpers = this.buildAssertionHelpers(assertionHelperSeeds, usedMethodNames);
      methodsContent.push(...assertionHelpers);
    }

    const pomFileName = `${parsedResponse.className}.ts`;
    const sidecarFileName = `${parsedResponse.className}.air.json`;
    const pomFilePath = path.join(outputDir, pomFileName);

    const pomContent = `import { AirBasePage } from '@air/reporter';
import metadata from './${sidecarFileName}';
import { Page, TestInfo } from '@playwright/test';

export class ${parsedResponse.className} extends AirBasePage {
  constructor(page: Page, testInfo: TestInfo) {
    super(page, testInfo, metadata as any);
  }

${methodsContent.join('\n\n')}
}
`;

    const sidecarContent: AirMetadata = {
      version: 1,
      session: session.sessionId,
      generatedAt: new Date().toISOString(),
      methods: sidecarMethods,
    };

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(pomFilePath, pomContent, 'utf-8');
    fs.writeFileSync(path.join(outputDir, sidecarFileName), JSON.stringify(sidecarContent, null, 2), 'utf-8');

    this.updateSessionMap(pomFilePath, session.sessionId, session.url, projectRoot);
  }

  private static toSafeMethodName(methodName: string, stepNumber: number): string {
    const trimmed = (methodName || '').trim();
    const candidate = trimmed.replace(/[^A-Za-z0-9_$]/g, '');
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate)) {
      return candidate;
    }
    return `step${stepNumber}`;
  }

  private static ensureUniqueMethodName(
    methodName: string,
    stepNumber: number,
    usedNames: Set<string>
  ): string {
    const base = this.toSafeMethodName(methodName, stepNumber);
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    const withStepSuffix = `${base}Step${stepNumber}`;
    if (!usedNames.has(withStepSuffix)) {
      usedNames.add(withStepSuffix);
      return withStepSuffix;
    }
    let i = 2;
    while (usedNames.has(`${withStepSuffix}_${i}`)) {
      i += 1;
    }
    const finalName = `${withStepSuffix}_${i}`;
    usedNames.add(finalName);
    return finalName;
  }

  private static cleanForComment(value: string | undefined | null): string {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static normalizeIntentText(value: string | undefined): string {
    return (value || '')
      .toLowerCase()
      .replace(/[_\-.]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static buildStepSignalText(step: CodegenStep): string {
    const attrs = step.fingerprint?.attributes ? Object.values(step.fingerprint.attributes).join(' ') : '';
    const parts = [
      step.intent || '',
      step.selector || '',
      step.resolvedSelector || '',
      step.fingerprint?.textExcerpt || '',
      attrs,
    ];
    return this.normalizeIntentText(parts.join(' '));
  }

  private static isUsernameLikeStep(step: CodegenStep): boolean {
    if (step.action !== 'input') return false;
    const signal = this.buildStepSignalText(step);
    const hasUser = /\b(username|user name|user|email|e mail|login id|userid)\b/.test(signal);
    const hasPassword = /\b(password|passcode|passwd|otp|pin)\b/.test(signal);
    return hasUser && !hasPassword;
  }

  private static isPasswordLikeStep(step: CodegenStep): boolean {
    if (step.action !== 'input') return false;
    const signal = this.buildStepSignalText(step);
    return /\b(password|passcode|passwd)\b/.test(signal);
  }

  private static isSubmitLikeStep(step: CodegenStep): boolean {
    if (step.action === 'submit') return true;
    if (step.action !== 'click') return false;
    const signal = this.buildStepSignalText(step);
    return /\b(login|log in|sign in|signin|submit|continue|next)\b/.test(signal);
  }

  private static selectorForStep(step: CodegenStep): string {
    return (step.resolvedSelector || step.selector || '').trim();
  }

  private static stepUrl(step: CodegenStep | undefined): string {
    if (!step) return '';
    return (step.normalizedUrl || step.pageUrl || '').trim();
  }

  private static looksLikePopupTransition(current: CodegenStep, next: CodegenStep | undefined): boolean {
    if (!next) return false;
    if (current.action !== 'click' && current.action !== 'submit') return false;

    const currentUrl = this.stepUrl(current);
    const nextUrl = this.stepUrl(next);
    if (!currentUrl || !nextUrl || currentUrl === nextUrl) return false;

    // Explicit navigation already modeled in canonical outcome path.
    if (current.outcomeType === 'navigation') return false;

    // Popup/new-tab often appears as no_change/state_refresh followed by next step on a new page context.
    return (
      current.outcomeType === 'no_change' ||
      current.outcomeType === 'state_refresh' ||
      current.outcomeType === 'immediate_action' ||
      current.outcomeType === undefined
    );
  }

  private static detectPopupTransitionSteps(steps: CodegenStep[]): Set<number> {
    const popupSteps = new Set<number>();
    for (let i = 0; i < steps.length - 1; i += 1) {
      const current = steps[i];
      const next = steps[i + 1];
      if (this.looksLikePopupTransition(current, next)) {
        popupSteps.add(current.step);
      }
    }
    return popupSteps;
  }

  private static buildCompositeMethods(steps: CodegenStep[], usedNames: Set<string>): string[] {
    const methods: string[] = [];
    if (steps.length < 3) return methods;

    const usernameIdx = steps.findIndex(step => this.isUsernameLikeStep(step));
    if (usernameIdx < 0) return methods;

    const passwordIdx = steps.findIndex((step, idx) =>
      idx > usernameIdx &&
      this.isPasswordLikeStep(step) &&
      (step.normalizedUrl || step.pageUrl) === (steps[usernameIdx].normalizedUrl || steps[usernameIdx].pageUrl)
    );
    if (passwordIdx < 0) return methods;

    const submitIdx = steps.findIndex((step, idx) =>
      idx > passwordIdx && this.isSubmitLikeStep(step)
    );
    if (submitIdx < 0) return methods;

    const usernameStep = steps[usernameIdx];
    const passwordStep = steps[passwordIdx];
    const submitStep = steps[submitIdx];

    const usernameSelector = this.selectorForStep(usernameStep);
    const passwordSelector = this.selectorForStep(passwordStep);
    const submitSelector = this.selectorForStep(submitStep);

    if (!usernameSelector || !passwordSelector) return methods;

    const methodName = this.ensureUniqueMethodName('login', submitStep.step, usedNames);
    const usernameLocator = `this.page.locator(${JSON.stringify(usernameSelector)})`;
    const passwordLocator = `this.page.locator(${JSON.stringify(passwordSelector)})`;
    const submitLocator = submitSelector
      ? `this.page.locator(${JSON.stringify(submitSelector)})`
      : null;

    const lines = [
      `  // AIR composite method derived from steps ${usernameStep.step}-${submitStep.step}`,
      `  async ${methodName}(username: string, password: string) {`,
      `    const usernameField = ${usernameLocator};`,
      `    await usernameField.waitFor({ state: 'visible' });`,
      `    await usernameField.fill(username);`,
      `    const passwordField = ${passwordLocator};`,
      `    await passwordField.waitFor({ state: 'visible' });`,
      `    await passwordField.fill(password);`,
    ];

    if (submitStep.action === 'submit' && (!submitSelector || /^form\b/i.test(submitSelector))) {
      lines.push(`    await passwordField.press('Enter');`);
    } else if (submitLocator) {
      lines.push(`    const submitTarget = ${submitLocator};`);
      lines.push(`    await submitTarget.waitFor({ state: 'visible' });`);
      lines.push(`    await submitTarget.click();`);
    } else {
      lines.push(`    await passwordField.press('Enter');`);
    }

    lines.push('  }');
    methods.push(lines.join('\n'));
    return methods;
  }

  private static toPascalCase(value: string): string {
    const normalized = (value || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .trim();
    if (!normalized) return '';
    return normalized
      .split(/\s+/)
      .filter(Boolean)
      .map(token => token.charAt(0).toUpperCase() + token.slice(1))
      .join('');
  }

  private static helperBaseName(methodName: string, stepNumber: number): string {
    const withoutVerb = (methodName || '').replace(
      /^(click|fill|type|enter|set|select|choose|open|close|hover|submit|press|tap|input|get|waitFor|is)/i,
      '',
    );
    const base = this.toPascalCase(withoutVerb) || `Step${stepNumber}`;
    return /^[A-Za-z]/.test(base) ? base : `Step${stepNumber}`;
  }

  private static supportsEnabledCheck(action: CodegenStep['action']): boolean {
    return ['click', 'input', 'submit', 'custom-select', 'hover'].includes(action);
  }

  private static buildAssertionHelpers(seeds: AssertionHelperSeed[], usedNames: Set<string>): string[] {
    const methods: string[] = [];
    const selectorSeen = new Set<string>();
    const MAX_HELPER_SELECTORS = 12;

    for (const seed of seeds) {
      const selector = (seed.selector || '').trim();
      if (!selector) continue;
      if (selectorSeen.has(selector)) continue;
      if (selectorSeen.size >= MAX_HELPER_SELECTORS) break;
      selectorSeen.add(selector);

      const base = this.helperBaseName(seed.methodName, seed.stepNumber);
      const locatorExpr = `this.page.locator(${JSON.stringify(selector)})`;

      const visibleName = this.ensureUniqueMethodName(`is${base}Visible`, seed.stepNumber, usedNames);
      methods.push(
        [
          `  // AIR assertion helper for step ${seed.stepNumber}`,
          `  async ${visibleName}() {`,
          `    const target = ${locatorExpr};`,
          `    return await target.isVisible();`,
          `  }`,
        ].join('\n'),
      );

      if (this.supportsEnabledCheck(seed.action)) {
        const enabledName = this.ensureUniqueMethodName(`is${base}Enabled`, seed.stepNumber, usedNames);
        methods.push(
          [
            `  async ${enabledName}() {`,
            `    const target = ${locatorExpr};`,
            `    return await target.isEnabled();`,
            `  }`,
          ].join('\n'),
        );
      }

      const textName = this.ensureUniqueMethodName(`get${base}Text`, seed.stepNumber, usedNames);
      methods.push(
        [
          `  async ${textName}() {`,
          `    const target = ${locatorExpr};`,
          `    return (await target.textContent()) ?? '';`,
          `  }`,
        ].join('\n'),
      );

      if (seed.action === 'input') {
        const valueName = this.ensureUniqueMethodName(`get${base}Value`, seed.stepNumber, usedNames);
        methods.push(
          [
            `  async ${valueName}() {`,
            `    const target = ${locatorExpr};`,
            `    return await target.inputValue();`,
            `  }`,
          ].join('\n'),
        );
      }
    }

    return methods;
  }

  private static isNavigableStartUrl(url: string): boolean {
    const trimmed = (url || '').trim();
    if (!trimmed || trimmed === 'unknown' || trimmed === 'about:blank') return false;
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private static buildNavigateMethod(startUrl: string): string | null {
    if (!this.isNavigableStartUrl(startUrl)) return null;
    const safeUrl = JSON.stringify(startUrl.trim());
    return [
      '  // AIR utility: navigate to the recorded start URL',
      '  async navigate() {',
      `    await this.page.goto(${safeUrl});`,
      '  }',
    ].join('\n');
  }

  private static detectLocatorFlavor(
    selector: string,
    selectorPriority: CodegenStep['selectorPriority']
  ): AirMethodMeta['locatorFlavor'] {
    const value = (selector || '').trim();
    if (!value) return 'unknown';
    if (selectorPriority === 'text' || value.startsWith('text=')) return 'text';
    if (selectorPriority === 'xpath' || value.startsWith('//') || value.startsWith('xpath=')) return 'xpath';
    if (value.includes('getBy')) return 'playwright';
    return 'css';
  }

  private static parseLocatorAction(action: string): ParsedLocatorAction | null {
    const trimmed = action.trim();
    const match = trimmed.match(
      /^(.*)\.(click|dblclick|fill|type|check|uncheck|hover|selectOption|press|tap|clear|focus|blur)\(([\s\S]*)\)$/
    );
    if (!match) return null;
    const locatorExpr = match[1]?.trim();
    const operation = match[2]?.trim();
    const args = (match[3] ?? '').trim();
    if (!locatorExpr || !operation) return null;
    return { locatorExpr, operation, args };
  }

  private static isQuotedStringLiteral(value: string): boolean {
    const trimmed = value.trim();
    return (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith('`') && trimmed.endsWith('`'))
    );
  }

  private static isUnsafeActionArgs(operation: string, args: string): boolean {
    const trimmedArgs = args.trim();
    const requiresValueArg = ['fill', 'type', 'press', 'selectOption'].includes(operation);
    if (!requiresValueArg) return false;
    if (!trimmedArgs) return true;

    if (operation === 'selectOption') {
      // Playwright accepts string, object, or arrays for selectOption.
      return !(
        this.isQuotedStringLiteral(trimmedArgs) ||
        trimmedArgs.startsWith('{') ||
        trimmedArgs.startsWith('[')
      );
    }

    // For fill/type/press we require explicit string literals to avoid undefined identifiers
    // (e.g. fill(username)) or unsafe expression output from LLM.
    return !this.isQuotedStringLiteral(trimmedArgs);
  }

  private static toCamelCase(value: string): string {
    const pascal = this.toPascalCase(value);
    if (!pascal) return '';
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
  }

  private static inferValueParameter(step: CodegenStep): ValueParameter {
    const signal = this.normalizeIntentText([
      step.intent || '',
      step.selector || '',
      step.fingerprint?.textExcerpt || '',
      step.fingerprint?.attributes?.name || '',
      step.fingerprint?.attributes?.placeholder || '',
      step.fingerprint?.attributes?.id || '',
    ].join(' '));

    let candidate = '';
    if (/\buser(name)?\b/.test(signal) && !/\bpassword\b/.test(signal)) {
      candidate = 'username';
    } else if (/\bpass(word|code)?\b/.test(signal)) {
      candidate = 'password';
    } else if (/\bemail\b/.test(signal)) {
      candidate = 'email';
    } else if (/\bsearch\b/.test(signal)) {
      candidate = 'searchText';
    } else if (/\b(date|calendar|day|month|year)\b/.test(signal)) {
      candidate = 'dateValue';
    } else if (step.action === 'custom-select') {
      candidate = 'optionValue';
    } else {
      candidate = 'value';
    }

    const safeName = this.toCamelCase(candidate) || 'value';
    return {
      name: safeName,
      defaultValue: this.resolveInputValue(step),
    };
  }

  private static hasCardinalityScope(locatorExpr: string): boolean {
    return /\.(first|last)\(\)|\.nth\(/.test(locatorExpr);
  }

  private static withCardinalityScope(locatorExpr: string): string {
    return locatorExpr;
  }

  private static shouldWaitForVisible(operation: string): boolean {
    return [
      'click',
      'dblclick',
      'fill',
      'type',
      'check',
      'uncheck',
      'hover',
      'tap',
      'clear',
      'focus',
      'press',
      'selectOption',
    ].includes(operation);
  }

  private static shouldUseFormSubmit(selector: string): boolean {
    const normalized = (selector || '').toLowerCase();
    return normalized.startsWith('form') || normalized.includes('form');
  }

  private static resolveInputValue(step: CodegenStep): string {
    const value = step.value?.trim();
    if (!value || value === '<LLM_GENERATE_MOCK_DATA>') {
      return `${step.intent || 'input'}_value`;
    }
    return value;
  }

  private static buildDeterministicLocatorAction(
    step: CodegenStep,
    selectorOverride?: string
  ): ParsedLocatorAction | null {
    const selector = (selectorOverride || step.selector || '').trim();
    if (!selector) return null;
    const locatorExpr = `locator(${JSON.stringify(selector)})`;

    switch (step.action) {
      case 'click':
        return { locatorExpr, operation: 'click', args: '' };
      case 'hover':
        return { locatorExpr, operation: 'hover', args: '' };
      case 'input':
        return { locatorExpr, operation: 'fill', args: JSON.stringify(this.resolveInputValue(step)) };
      case 'custom-select':
        return { locatorExpr, operation: 'selectOption', args: JSON.stringify(this.resolveInputValue(step)) };
      case 'submit':
        if (this.shouldUseFormSubmit(selector)) {
          return { locatorExpr, operation: 'press', args: `'Enter'` };
        }
        return { locatorExpr, operation: 'click', args: '' };
      default:
        return null;
    }
  }

  private static buildMethodCode(
    step: CodegenStep,
    methodName: string,
    llmAction: string,
    resolvedSelector?: string,
    resolvedSelectorSpec?: CodegenStep['resolvedSelectorSpec'],
    resolverMetadata?: AirMethodMeta['resolver'],
    popupAware = false
  ): EmittedMethod {
    const trimmedAction = llmAction.trim();
    const selectorUsed = (resolvedSelectorSpec?.selector || resolvedSelector || step.selector || '').trim();
    const selectorType = step.selectorPriority || 'unknown';
    const resolvedBy = resolverMetadata?.resolvedBy || 'unresolved';
    const score = Number((resolverMetadata?.bestScore ?? 0).toFixed(2));
    const warnings = resolverMetadata?.warningCodes?.length ? resolverMetadata.warningCodes.join('|') : 'none';
    const usedSelectorSpec = !!resolvedSelectorSpec;
    const exactLocatorExpr = renderLocatorExpressionFromSelectorSpec(resolvedSelectorSpec);
    const selectorSpecWarnings = getSelectorSpecRenderingWarnings(resolvedSelectorSpec);
    const missingSpecWarnings = usedSelectorSpec ? [] : ['selector-spec-missing-fallback'];
    const renderingWarnings = Array.from(new Set([
      ...selectorSpecWarnings,
      ...missingSpecWarnings,
    ]));
    const renderConfidently = resolvedSelectorSpec
      ? canRenderSelectorSpecConfidently(resolvedSelectorSpec)
      : !!selectorUsed;
    const emittedLocatorEngine = resolvedSelectorSpec?.engine ?? 'unknown';
    const emittedLocatorProofLevel = resolvedSelectorSpec?.proofLevel ?? 'unknown';
    const emittedLocatorSource = resolvedSelectorSpec?.source ?? (usedSelectorSpec ? 'unknown' : 'legacy-fallback');
    const legacyLocatorExpr = !usedSelectorSpec && selectorUsed
      ? `locator(${JSON.stringify(selectorUsed)})`
      : null;
    const preferredLocatorExpr = exactLocatorExpr ?? legacyLocatorExpr;

    const parsed = this.parseLocatorAction(trimmedAction);
    let fallbackReason: string | null = null;
    let effective: ParsedLocatorAction | null = parsed;

    if (effective && this.isUnsafeActionArgs(effective.operation, effective.args)) {
      effective = null;
      fallbackReason = 'llm-unsafe-action-args';
    }

    if (!effective) {
      const deterministic = this.buildDeterministicLocatorAction(step, selectorUsed);
      if (deterministic) {
        effective = deterministic;
        fallbackReason = fallbackReason ?? 'llm-action-invalid-or-noop';
      }
    }

    if (
      effective &&
      resolvedSelectorSpec &&
      renderConfidently &&
      exactLocatorExpr &&
      effective.locatorExpr !== exactLocatorExpr
    ) {
      effective = {
        ...effective,
        locatorExpr: exactLocatorExpr,
      };
      fallbackReason = fallbackReason ?? 'selector-spec-exact-render';
    }

    if (
      effective &&
      !usedSelectorSpec &&
      legacyLocatorExpr &&
      effective.locatorExpr !== legacyLocatorExpr
    ) {
      effective = {
        ...effective,
        locatorExpr: legacyLocatorExpr,
      };
      fallbackReason = fallbackReason ?? 'selector-spec-missing-fallback';
    }

    let lines: string[] = [];
    let fullAction = `this.page.${trimmedAction}`;
    let methodParams = '';

    if (effective && renderConfidently) {
      const scopedLocator = this.withCardinalityScope(effective.locatorExpr);
      let invocationArgs = effective.args;
      if (
        ['fill', 'type', 'selectOption'].includes(effective.operation) &&
        (step.action === 'input' || step.action === 'custom-select')
      ) {
        const valueParam = this.inferValueParameter(step);
        methodParams = `${valueParam.name}: string = ${JSON.stringify(valueParam.defaultValue)}`;
        invocationArgs = valueParam.name;
      }
      const invocation = `${effective.operation}(${invocationArgs})`;
      fullAction = `this.page.${scopedLocator}.${invocation}`;
      const popupAwareOperation = popupAware && ['click', 'dblclick', 'tap'].includes(effective.operation);
      if (popupAwareOperation) {
        lines = [
          `const context = this.page.context();`,
          `const popupPromise = context.waitForEvent('page', { timeout: 1500 }).catch(() => null);`,
          `const target = this.page.${scopedLocator};`,
        ];
        if (this.shouldWaitForVisible(effective.operation)) {
          lines.push(`await target.waitFor({ state: 'visible' });`);
        }
        lines.push(`await target.${invocation};`);
        lines.push(`const popupPage = await popupPromise;`);
        lines.push(`if (popupPage) {`);
        lines.push(`  await popupPage.waitForLoadState('domcontentloaded');`);
        lines.push(`  this.page = popupPage;`);
        lines.push(`}`);
      } else {
        lines = [
          `const target = this.page.${scopedLocator};`,
        ];
        if (this.shouldWaitForVisible(effective.operation)) {
          lines.push(`await target.waitFor({ state: 'visible' });`);
        }
        lines.push(`await target.${invocation};`);
      }
    } else if (resolvedSelectorSpec && !renderConfidently) {
      fallbackReason = fallbackReason ?? `selector-spec-${resolvedSelectorSpec.proofLevel}`;
      const blockedMessage = `AIR unresolved step ${step.step}: selector proof level "${resolvedSelectorSpec.proofLevel}" is not safe for confident codegen.`;
      fullAction = `throw new Error(${JSON.stringify(blockedMessage)})`;
      lines = [
        `// TODO[AIR]: Selector is ${resolvedSelectorSpec.proofLevel} and was not emitted as a confident action.`,
        `// Intended selector: ${this.cleanForComment(selectorUsed)} | engine=${resolvedSelectorSpec.engine} | source=${resolvedSelectorSpec.source}`,
        `throw new Error(${JSON.stringify(blockedMessage)});`,
      ];
    } else if (!trimmedAction) {
      fallbackReason = 'empty-llm-action';
      fullAction = 'this.page.waitForTimeout(0)';
      lines = ['await this.page.waitForTimeout(0);'];
    } else {
      lines = [`await this.page.${trimmedAction};`];
    }

    const inlineWarningLines = renderingWarnings.map(code => `  // WARNING: ${code}`);
    if (resolvedSelectorSpec && !renderConfidently && resolvedSelectorSpec.rejectReason) {
      inlineWarningLines.push(`  // WARNING: reject-reason=${this.cleanForComment(resolvedSelectorSpec.rejectReason)}`);
    }

    const methodLines = [
      `  // AIR step ${step.step} | action=${step.action} | selectorType=${selectorType} | resolvedBy=${resolvedBy} | score=${score}`,
      `  // selector: ${this.cleanForComment(selectorUsed)} | warnings: ${this.cleanForComment(warnings)}`,
      `  async ${methodName}(${methodParams}) {`,
      ...inlineWarningLines,
      ...lines.map(line => `    ${line}`),
      `  }`,
    ];

    return {
      methodCode: methodLines.join('\n'),
      fullAction,
      fallbackReason,
      selectorUsed,
      emittedLocator: renderConfidently ? preferredLocatorExpr : null,
      emittedLocatorEngine,
      emittedLocatorProofLevel,
      emittedLocatorSource,
      emittedLocatorWarnings: renderingWarnings,
      usedSelectorSpec,
    };
  }

  private static normalizeSelectorKey(selector: string): string {
    return (selector || '').trim().replace(/\s+/g, ' ');
  }

  private static toUrlPathHint(url: string): string {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`;
    } catch {
      return (url || '').trim();
    }
  }

  private static buildRepeatedSelectorHints(steps: CodegenStep[]): Array<{
    selector: string;
    occurrences: number;
    stepNumbers: number[];
    intents: string[];
    pageHints: string[];
  }> {
    const buckets = new Map<
      string,
      {
        selector: string;
        occurrences: number;
        stepNumbers: number[];
        intents: Set<string>;
        pageHints: Set<string>;
      }
    >();

    for (const step of steps) {
      const selector = this.normalizeSelectorKey(step.resolvedSelector || step.selector || '');
      if (!selector) continue;
      const bucket = buckets.get(selector) ?? {
        selector,
        occurrences: 0,
        stepNumbers: [],
        intents: new Set<string>(),
        pageHints: new Set<string>(),
      };
      bucket.occurrences += 1;
      bucket.stepNumbers.push(step.step);
      bucket.intents.add(step.intent || '');
      if (step.pageUrl) {
        bucket.pageHints.add(this.toUrlPathHint(step.pageUrl));
      }
      buckets.set(selector, bucket);
    }

    return Array.from(buckets.values())
      .filter(bucket => bucket.occurrences > 1)
      .map(bucket => ({
        selector: bucket.selector,
        occurrences: bucket.occurrences,
        stepNumbers: bucket.stepNumbers.slice(0, 8),
        intents: Array.from(bucket.intents).filter(Boolean).slice(0, 6),
        pageHints: Array.from(bucket.pageHints).filter(Boolean).slice(0, 4),
      }))
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 8);
  }

  private static buildFlowPromptContext(session: CodegenSession, steps: CodegenStep[]): Record<string, unknown> {
    const review = FlowReviewService.build(session);

    const pageJourney = review.pages.slice(0, 12).map(page => {
      const firstStep = page.steps[0]?.stepNumber ?? null;
      const lastStep = page.steps[page.steps.length - 1]?.stepNumber ?? null;
      return {
        visit: page.visitIndex,
        pageName: page.pageName,
        urlPath: page.urlPathname,
        stepRange: firstStep !== null && lastStep !== null ? `${firstStep}-${lastStep}` : null,
        hasNavigationOut: page.hasNavigation,
      };
    });

    const transitions = review.steps
      .filter(step => step.outcomeType === 'navigation' && !!step.navigatesTo)
      .slice(0, 16)
      .map(step => ({
        step: step.stepNumber,
        intent: step.rawIntent,
        to: step.navigatesTo,
      }));

    const keyWarnings = review.warnings.slice(0, 8).map(warning => ({
      severity: warning.severity,
      type: warning.type,
      step: warning.step ?? null,
      message: warning.message,
    }));

    const riskySelectorSteps = review.steps
      .filter(step => step.selectorQuality === 'fragile' || step.selectorQuality === 'unknown')
      .map(step => step.stepNumber)
      .slice(0, 20);

    return {
      flowTitle: review.flowTitle,
      startUrl: review.startUrl,
      flowConfidence: Number(review.flowConfidence.toFixed(3)),
      stats: {
        totalSteps: review.stats.totalSteps,
        totalPages: review.stats.totalPages,
        navigationCount: review.stats.navigationCount,
        assertionCount: review.stats.assertionCount,
      },
      pageJourney,
      transitions,
      repeatedSelectorHints: this.buildRepeatedSelectorHints(steps),
      riskySelectorSteps,
      keyWarnings,
    };
  }

  private static toPromptSteps(steps: CodegenStep[]): Array<Record<string, unknown>> {
    return steps.map(step => ({
      step: step.step,
      intent: step.intent,
      action: step.action,
      selector: step.selector,
      selectorPriority: step.selectorPriority,
      selectorRank: step.selectorRank,
      value: step.value,
      outcomeType: step.outcomeType,
      navigatesTo: step.navigatesTo,
      assertions: step.assertions,
      userAssertions: step.userAssertions,
      confidence: step.confidence,
      sampleSize: step.sampleSize,
      pageUrl: step.pageUrl,
      normalizedUrl: step.normalizedUrl,
      sourceNodeId: step.sourceNodeId,
    }));
  }

  private static buildPrompt(session: CodegenSession, steps: CodegenStep[]): string {
    const flowContext = this.buildFlowPromptContext(session, steps);
    return `
You are an expert SDET. Generate Playwright Page Object Model methods for the following recorded session.

STRICT CONTRACT:
1. You MUST return valid JSON matching the exact schema provided.
2. You MUST retain the exact "stepNumber" for each step. Do not alter it. You MUST return all ${steps.length} steps.
3. The "playwrightAction" MUST be a suffix chain that can be appended directly to "this.page.".
4. For element interactions, "playwrightAction" MUST end with a terminal action call (click/fill/type/check/uncheck/hover/selectOption/press).
5. NEVER return a bare locator expression without a terminal action.
6. Prefer stable locator strategies first: getByTestId, getByRole({ name }), getByLabel, then CSS attributes.
7. NEVER emit ".submit()". Playwright Locator does not support submit.
8. For fill/type/selectOption/press, ALWAYS pass explicit string literals in arguments.
9. Use FLOW CONTEXT to keep method intent aligned with the user journey.
10. If selectors repeat across multiple steps, disambiguate using step number + intent + page path.
11. For navigation-heavy flows, preserve progression order from earlier page visits to later ones.

EXAMPLES:
Valid: "getByTestId('login-btn').click()"
Valid: "goto('https://example.com')"
INVALID (Do not include await): "await getByTestId('btn').click()"
INVALID (Do not include page): "page.getByTestId('btn').click()"
INVALID (Do not include this): "this.page.getByTestId('btn').click()"

JSON SCHEMA:
{
  "className": "YourChosenClassName",
  "methods": [
    {
      "stepNumber": 1,
      "intent": "click_login_btn",
      "methodName": "clickLoginButton",
      "playwrightAction": "getByTestId('login-btn').click()"
    }
  ]
}

SESSION DATA:
${JSON.stringify(this.toPromptSteps(steps), null, 2)}

FLOW CONTEXT:
${JSON.stringify(flowContext, null, 2)}
`;
  }

  private static buildSelectorFallbackPrompt(request: LlmFallbackRequest): string {
    const selectorsPerStep = Math.max(1, request.config.llmMaxCandidatesPerStep ?? 3);
    return `
You are a selector recovery assistant for Playwright code generation.

Return ONLY a JSON array (no markdown) with objects shaped exactly as:
[{ "stepNumber": 1, "candidates": [{ "selector": "button[type=\\"submit\\"]" }, { "selector": "[aria-label=\\"submit\\"]" }, { "selector": "#submit" }] }]

Rules:
1. Include only steps that you are confident about.
2. Return concise, high-probability CSS selectors only.
3. Do not return markdown.
4. Do not return prose.
5. Do not return Playwright engine prefixes like css= or xpath=.
6. Prefer stable attributes/test IDs/ARIA-compatible CSS attributes first.
7. Return up to ${selectorsPerStep} candidates per step ordered from best to worst.
8. Deduplicate selectors for each step.
9. Avoid positional selectors (:nth-child, :nth-of-type) unless no better option exists.
10. Do not return overly deep descendant paths.
11. Use snapshotExcerpt as the ground truth for uniqueness.
12. Use action + intent to match control type (input/select vs button/link).
13. If excerptMode is "document-fallback", be conservative and prefer originalSelector-derived stable attributes.

UNRESOLVED STEPS:
${JSON.stringify(request.steps, null, 2)}
`;
  }

  private static buildSelectorCorrectiveRetryPrompt(request: LlmCorrectiveRetryRequest): string {
    return `
You are a selector correction assistant for Playwright code generation.

Return ONLY a JSON array (no markdown) with objects shaped exactly as:
[{ "stepNumber": 1, "selector": "input[name=\\"username\\"]" }]

Rules:
1. Return at most one CSS selector per step.
2. Include only steps that you are confident about.
3. Do not repeat rejected selectors.
4. Do not return markdown.
5. Do not return prose.
6. Do not return xpath=.
7. Do not return Playwright engine prefixes such as css=, locator=, or xpath=.
8. Prefer stable attributes first: data-testid, data-cy, data-qa, name, placeholder, aria-label, href, role-compatible CSS selectors.
9. If fixing a non-unique selector, do NOT use deep structural chains.
10. Do NOT use :nth-child or :nth-of-type.
11. Do NOT use body/html-root descendant paths.
12. Use fingerprint evidence like textExcerpt, href, aria-label, placeholder, role, and test IDs to correct semantic mismatches.
13. If fixing text_mismatch, align to expected textExcerpt/label evidence.
14. If fixing href_mismatch, align to expected href/path evidence.
15. If fixing control_family_mismatch, keep the same control family as the original target.
16. Do not become more positional or deep because of validator feedback.

RETRY TARGETS:
${JSON.stringify(request.steps, null, 2)}
`;
  }

  private static async requestSelectorFallback(request: LlmFallbackRequest): Promise<LlmFallbackSuggestion[]> {
    try {
      const prompt = this.buildSelectorFallbackPrompt(request);
      const responseJson = await this.callGeminiApi(prompt);
      const parsed = JSON.parse(responseJson);
      if (!Array.isArray(parsed)) return [];

      return normalizeLlmSuggestions(parsed, request.config.llmMaxCandidatesPerStep);
    } catch (error) {
      console.warn('[AIR] Selector fallback parsing failed:', error);
      return [];
    }
  }

  private static async requestSelectorCorrectiveRetry(
    request: LlmCorrectiveRetryRequest,
  ): Promise<ReturnType<typeof normalizeLlmRetrySuggestions>> {
    try {
      const prompt = this.buildSelectorCorrectiveRetryPrompt(request);
      const responseJson = await this.callGeminiApi(prompt);
      const parsed = JSON.parse(responseJson);
      if (!Array.isArray(parsed)) return [];

      return normalizeLlmRetrySuggestions(parsed);
    } catch (error) {
      console.warn('[AIR] Selector corrective retry parsing failed:', error);
      return [];
    }
  }

  private static updateSessionMap(
    pomFilePath: string,
    newSessionId: string,
    startingUrl: string,
    projectRoot: string
  ): void {
    const airDir = path.join(projectRoot, '.air');
    const mapPath = path.join(airDir, 'session-map.json');

    if (!fs.existsSync(airDir)) fs.mkdirSync(airDir, { recursive: true });

    let mapData = { version: 1, mappings: {} as Record<string, any> };

    if (fs.existsSync(mapPath)) {
      try {
        const rawData = fs.readFileSync(mapPath, 'utf-8');
        if (rawData.trim() !== '') mapData = JSON.parse(rawData);
      } catch (e) {
        console.error(`[AIR] Failed to parse session-map.json. Creating new map. Error: ${e}`);
      }
    }

    const relativePomPath = path.relative(projectRoot, pomFilePath).replace(/\\/g, '/');
    if (!mapData.mappings) mapData.mappings = {};

    const existingMapping = mapData.mappings[relativePomPath];
    const previousIds = existingMapping?.previousSessionIds || [];

    if (existingMapping?.canonicalSessionId && existingMapping.canonicalSessionId !== newSessionId) {
      previousIds.unshift(existingMapping.canonicalSessionId);
    }

    mapData.mappings[relativePomPath] = {
      canonicalSessionId: newSessionId,
      previousSessionIds: previousIds.slice(0, 5),
      lastUpdated: new Date().toISOString(),
      startingUrl: startingUrl,
    };

    const tempPath = `${mapPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(mapData, null, 2), 'utf-8');
    fs.renameSync(tempPath, mapPath);
  }

  private static async callGeminiApi(payload: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('[AIR] GEMINI_API_KEY environment variable is missing.');
    const modelName = process.env.AIR_GEMINI_MODEL || 'gemini-2.5-flash';
    const maxAttempts = 4;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log('[AIR] Sending session data to Gemini...', {
          model: modelName,
          attempt,
          maxAttempts,
        });
        const result = await model.generateContent(payload);
        const text = result.response.text();

        if (!text) throw new Error('[AIR] Gemini returned an empty response.');
        return text;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableGeminiError(error) || attempt === maxAttempts) {
          break;
        }

        const waitMs = Math.min(2000 * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 400);
        console.warn('[AIR] Gemini temporarily unavailable, retrying...', {
          attempt,
          nextRetryInMs: waitMs,
          status: (error as { status?: number })?.status,
        });
        await this.sleep(waitMs);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
