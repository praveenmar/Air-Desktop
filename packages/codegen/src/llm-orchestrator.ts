import * as fs from 'fs';
import * as path from 'path';
import { CodegenSession, CodegenStep } from './types';
import type {
  BoundedFieldSelectorSpec,
  FingerprintSelectorAmbiguity,
  LabelContextRenderStatus,
  LabelContextSelectorSpec,
  TriggerContextSelectorSpec,
} from './types';
import { AirMetadata, AirMethodMeta } from './sidecar.types';
import { computeActionChecksum } from './checksum.utils';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { FlowReviewService } from './flow-review.service';
import {
  canRenderSelectorSpecConfidently,
  getSelectorSpecRenderingWarnings,
  inferSelectorEngine,
  pickPreferredEquivalentRendering,
  renderLocatorExpressionFromEquivalentRendering,
  renderLocatorExpressionFromSelectorSpec,
} from './selector-spec';
import {
  buildBoundedFieldWarningComments,
  classifyBoundedFieldRenderStatus,
} from './resolver/bounded-field/render-bounded-field';
import {
  normalizeLlmRetrySuggestions,
  normalizeLlmSuggestions,
  resolveSelectorsForSession,
} from './selector-resolver';
import { generatePlaywrightCandidates } from './resolver/playwright-candidates';
import { evaluatePlaywrightCandidates } from './resolver/playwright-evaluator';
import { buildPlaywrightCandidateReport } from './resolver/playwright-candidate-report';
import { PlaywrightNativeCandidateReportEntry } from './types';
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
  equivalentRenderingUsed: boolean;
  equivalentLocator: string | null;
  equivalentLocatorEngine: AirMethodMeta['equivalentLocatorEngine'];
  equivalentProofLevel: AirMethodMeta['equivalentProofLevel'];
  equivalentProofSource: AirMethodMeta['equivalentProofSource'];
  equivalentSourceSelector: string | null;
  preferredRenderings: AirMethodMeta['preferredRenderings'];
  labelContextRenderStatus?: LabelContextRenderStatus;
  labelContextRenderReason?: string | null;
  labelText?: string | null;
  relationType?: AirMethodMeta['relationType'];
  boundedContainerSummary?: string | null;
  cleanParentSelector?: string | null;
  cleanChildSelector?: string | null;
  structuralFallbackLocator?: string | null;
  recoveredFromSelector?: string | null;
  triggerContextRenderStatus?: LabelContextRenderStatus;
  triggerContextRenderReason?: string | null;
  triggerContextLabel?: string | null;
  triggerBoundedContainerSummary?: string | null;
  triggerStructuralFallbackLocator?: string | null;
  boundedFieldRenderStatus?: LabelContextRenderStatus;
  boundedFieldRenderReason?: string | null;
  boundedFieldLabelText?: string | null;
  boundedFieldRelation?: AirMethodMeta['boundedFieldRelation'];
  boundedFieldControlKind?: AirMethodMeta['boundedFieldControlKind'];
  boundedFieldMatchedContainerSummary?: string | null;
  boundedFieldOriginalSelector?: string | null;
  emittedWeakFallback?: boolean;
  weakFallbackReason?: string;
  weakFallbackSelector?: string;
  weakFallbackLocator?: string;
  weakFallbackIndex?: number | null;
  weakFallbackIndexKind?: AirMethodMeta['weakFallbackIndexKind'];
  weakFallbackUsedVisibleFilter?: boolean;
  weakFallbackMatchCount?: number | null;
  weakFallbackVisibleMatchCount?: number | null;
  weakFallbackSource?: AirMethodMeta['weakFallbackSource'];
  weakFallbackWarnings?: string[];
  extraWarningComments?: string[];
  extraWarningCodes?: string[];
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

type WeakFallbackSource = NonNullable<AirMethodMeta['weakFallbackSource']>;
type WeakFallbackIndexKind = NonNullable<AirMethodMeta['weakFallbackIndexKind']>;

interface WeakFallbackSelectorCandidate {
  selector?: string | null;
  selectorSpec?: CodegenStep['selectorSpec'];
  recordedAmbiguity?: FingerprintSelectorAmbiguity;
  validationMatchCount?: number | null;
  validationVisibleMatchCount?: number | null;
  selectorOrigin: 'resolved-selector' | 'recorded-selector' | 'trigger-selector';
}

interface WeakFallbackRenderResult {
  locatorExpression: string;
  selector: string;
  index: number | null;
  indexKind: WeakFallbackIndexKind | null;
  usedVisibleFilter: boolean;
  matchCount: number | null;
  visibleMatchCount: number | null;
  recordedMatchCount: number | null;
  recordedVisibleMatchCount: number | null;
  reason: string;
  source: WeakFallbackSource;
  warnings: string[];
}

interface WeakFallbackBuildFailure {
  debugReason: string;
}

interface WeakFallbackActionRenderResult {
  lines: string[];
  fullAction: string;
  methodParams: string;
}

interface CustomControlOptionFallbackRenderResult {
  lines: string[];
  fullAction: string;
  warningLines: string[];
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
    console.error('[DEBUG] snapshotCache received, engineAvailable:', !!(snapshotCache as any).snapshotEngineAvailable);
    const debugTrace = /^(1|true|yes)$/i.test(process.env.AIR_DEBUG_RESOLVER_TRACE || '');

    if (debugTrace) {
      console.error('--- SESSION STEPS ---');
      for (const step of session.steps) {
        console.error({
          step: step.step,
          selector: step.selector,
          sourceNodeId: step.sourceNodeId ?? null,
        });
      }

      console.error('--- SNAPSHOT AVAILABILITY ---');
      for (const step of session.steps) {
        const nodeId = step.sourceNodeId;
        const snapshot = snapshotCache.get(nodeId ?? '', step.normalizedUrl, step.controlSignature);
        console.error(`Step ${step.step} snapshot:`, snapshot ? 'YES' : 'NO');
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
    console.error('[AIR] Resolver summary', {
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
      console.error('--- RESOLVER OUTPUT ---');
      for (const resolution of resolverResult.resolutions) {
        console.error({
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
        triggerResolvedSelector: resolution?.resolverMetadata.triggerResolvedSelector ?? step.triggerResolvedSelector,
        triggerSelectorSpec: resolution?.resolverMetadata.triggerResolvedSelectorSpec ?? step.triggerSelectorSpec,
      };
    });
    const generationStepMap = new Map(generationSteps.map(step => [step.step, step]));

    if (debugTrace) {
      console.error('--- FINAL SELECTORS USED ---');
      for (const step of generationSteps) {
        console.error({
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
      const generationStep = generationStepMap.get(generatedMethod.stepNumber);
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
        generationStep ?? originalStep,
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
      const generatedTriggerSpec = (generationStep ?? originalStep).triggerSelectorSpec;
      const generatedTriggerBoundedField = generatedTriggerSpec?.engine === 'bounded-field'
        ? generatedTriggerSpec.boundedField
        : undefined;

      let playwrightNativeCandidates: PlaywrightNativeCandidateReportEntry[] | undefined;
      try {
        const snapshotSelection = snapshotCache.selectForStep?.(originalStep, 'action');
        const snapshot = snapshotSelection?.snapshot;
        if (originalStep.fingerprint && snapshot) {
          const candidates = generatePlaywrightCandidates(originalStep.fingerprint);
          const evaluated = evaluatePlaywrightCandidates(candidates, { root: snapshot });
          playwrightNativeCandidates = buildPlaywrightCandidateReport(evaluated, { maxEntries: 10 });
        }
      } catch (err) {
        // Safe reporting: do not fail codegen if candidate generation fails
        console.warn('[AIR] [REPORT] Failed to generate Playwright native candidates for sidecar', {
          step: originalStep.step,
          error: err,
        });
      }

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
        recordedSelectorCandidates: originalStep.fingerprint?.selectorCandidates?.length
          ? originalStep.fingerprint.selectorCandidates
          : undefined,
        fieldLabelText: typeof originalStep.fingerprint?.attributes?.fieldLabelText === 'string'
          ? originalStep.fingerprint.attributes.fieldLabelText
          : undefined,
        locatorFlavor: this.detectLocatorFlavor(emittedMethod.selectorUsed, originalStep.selectorPriority),
        emittedLocator: emittedMethod.emittedLocator ?? undefined,
        emittedLocatorEngine: emittedMethod.emittedLocatorEngine,
        emittedLocatorProofLevel: emittedMethod.emittedLocatorProofLevel,
        emittedLocatorSource: emittedMethod.emittedLocatorSource,
        emittedLocatorWarnings: emittedMethod.emittedLocatorWarnings,
        usedSelectorSpec: emittedMethod.usedSelectorSpec,
        controlFamily: originalStep.controlFamily,
        triggerOriginalSelector: originalStep.triggerSelector,
        triggerFieldLabelText: typeof originalStep.triggerFingerprint?.attributes?.fieldLabelText === 'string'
          ? originalStep.triggerFingerprint.attributes.fieldLabelText
          : (typeof originalStep.fingerprint?.attributes?.fieldLabelText === 'string'
              ? originalStep.fingerprint.attributes.fieldLabelText
              : undefined),
        triggerSelector: originalStep.triggerSelector,
        triggerSelectorPriority: originalStep.triggerSelectorPriority,
        triggerResolvedSelector: (generationStep ?? originalStep).triggerResolvedSelector,
        triggerSelectorSpec: (generationStep ?? originalStep).triggerSelectorSpec,
        triggerContextProof: ((generationStep ?? originalStep).triggerSelectorSpec as any)?.triggerContext,
        triggerContextLabel: emittedMethod.triggerContextLabel ?? undefined,
        triggerContextRenderStatus: emittedMethod.triggerContextRenderStatus,
        triggerContextRenderReason: emittedMethod.triggerContextRenderReason ?? undefined,
        triggerBoundedContainerSummary: emittedMethod.triggerBoundedContainerSummary ?? undefined,
        triggerStructuralFallbackLocator: emittedMethod.triggerStructuralFallbackLocator ?? undefined,
        triggerWarningCodes: (generatedTriggerSpec as any)?.triggerContext?.warningCodes
          ?? generatedTriggerBoundedField?.warningCodes
          ?? resolverForSidecar?.triggerWarningCodes,
        boundedFieldProof: resolution?.resolvedSelectorSpec?.engine === 'bounded-field'
          ? resolution.resolvedSelectorSpec.boundedField
          : undefined,
        boundedFieldLabelText: emittedMethod.boundedFieldLabelText ?? undefined,
        boundedFieldRelation: emittedMethod.boundedFieldRelation,
        boundedFieldControlKind: emittedMethod.boundedFieldControlKind,
        boundedFieldRenderStatus: emittedMethod.boundedFieldRenderStatus,
        boundedFieldRenderReason: emittedMethod.boundedFieldRenderReason ?? undefined,
        boundedFieldOriginalSelector: emittedMethod.boundedFieldOriginalSelector ?? undefined,
        boundedFieldTargetSelectorSpec: resolution?.resolvedSelectorSpec?.engine === 'bounded-field'
          ? resolution.resolvedSelectorSpec.boundedField.target
          : undefined,
        boundedFieldMatchedContainerSummary: emittedMethod.boundedFieldMatchedContainerSummary ?? undefined,
        boundedFieldWarningCodes: resolution?.resolvedSelectorSpec?.engine === 'bounded-field'
          ? resolution.resolvedSelectorSpec.boundedField.warningCodes
          : undefined,
        boundedFieldRejectReason: resolution?.resolvedSelectorSpec?.engine === 'bounded-field'
          ? resolution.resolvedSelectorSpec.boundedField.rejectReason ?? resolution.resolvedSelectorSpec.rejectReason
          : undefined,
        optionSelector: originalStep.optionSelector,
        optionText: originalStep.optionText,
        optionValue: originalStep.optionValue,
        optionResolvedSelector: originalStep.optionResolvedSelector,
        optionSelectorSpec: originalStep.optionSelectorSpec,
        absorbedOpenEventId: originalStep.absorbedOpenEventId,
        absorbedOpenTraceId: originalStep.absorbedOpenTraceId,
        compressedFromEvents: originalStep.compressedFromEvents,
        equivalentRenderingUsed: emittedMethod.equivalentRenderingUsed,
        equivalentLocator: emittedMethod.equivalentLocator ?? undefined,
        equivalentLocatorEngine: emittedMethod.equivalentLocatorEngine,
        equivalentProofLevel: emittedMethod.equivalentProofLevel,
        equivalentProofSource: emittedMethod.equivalentProofSource,
        equivalentSourceSelector: emittedMethod.equivalentSourceSelector ?? undefined,
        preferredRenderings: emittedMethod.preferredRenderings,
        labelContextProof: (resolution?.resolvedSelectorSpec as any)?.labelContext,
        labelContextRenderStatus: emittedMethod.labelContextRenderStatus,
        labelContextRenderReason: emittedMethod.labelContextRenderReason ?? undefined,
        labelText: emittedMethod.labelText ?? undefined,
        relationType: emittedMethod.relationType,
        boundedContainerSummary: emittedMethod.boundedContainerSummary ?? undefined,
        cleanParentSelector: emittedMethod.cleanParentSelector ?? undefined,
        cleanChildSelector: emittedMethod.cleanChildSelector ?? undefined,
        structuralFallbackLocator: emittedMethod.structuralFallbackLocator ?? undefined,
        recoveredFromSelector: emittedMethod.recoveredFromSelector ?? undefined,
        emittedWeakFallback: emittedMethod.emittedWeakFallback,
        weakFallbackReason: emittedMethod.weakFallbackReason,
        weakFallbackSelector: emittedMethod.weakFallbackSelector,
        weakFallbackLocator: emittedMethod.weakFallbackLocator,
        weakFallbackIndex: emittedMethod.weakFallbackIndex,
        weakFallbackIndexKind: emittedMethod.weakFallbackIndexKind,
        weakFallbackUsedVisibleFilter: emittedMethod.weakFallbackUsedVisibleFilter,
        weakFallbackMatchCount: emittedMethod.weakFallbackMatchCount,
        weakFallbackVisibleMatchCount: emittedMethod.weakFallbackVisibleMatchCount,
        weakFallbackSource: emittedMethod.weakFallbackSource,
        weakFallbackWarnings: emittedMethod.weakFallbackWarnings,
        warningCodes: Array.from(new Set([
          ...(emittedMethod.emittedLocatorWarnings ?? []),
          ...(emittedMethod.extraWarningCodes ?? []),
          ...(((resolution?.resolvedSelectorSpec as any)?.labelContext?.warningCodes) ?? []),
          ...((((generationStep ?? originalStep).triggerSelectorSpec as any)?.triggerContext?.warningCodes) ?? []),
          ...(resolverForSidecar?.triggerWarningCodes ?? []),
        ])),
        playwrightNativeCandidates,
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

  private async __airCaptureRepairEvidence(methodName: string, error: unknown) {
    try {
      const methods = (metadata as any)?.methods ?? {};
      const meta = methods[methodName] ?? {};
      const payload = {
        capturedAt: new Date().toISOString(),
        methodName,
        errorMessage: error instanceof Error ? error.message : String(error ?? ''),
        currentUrl: typeof this.page?.url === 'function' ? this.page.url() : null,
        pageTitle: await this.page.title().catch(() => null),
        html: await this.page.content().catch(() => null),
        methodMeta: {
          step: meta.step ?? null,
          intent: meta.intent ?? null,
          originalSelector: meta.originalSelector ?? null,
          selectorUsed: meta.selectorUsed ?? null,
          actionType: meta.actionType ?? null,
          fieldLabelText: meta.fieldLabelText ?? meta.labelText ?? null,
          triggerOriginalSelector: meta.triggerOriginalSelector ?? meta.triggerSelector ?? null,
          triggerFieldLabelText: meta.triggerFieldLabelText ?? meta.triggerContextLabel ?? null,
          optionText: meta.optionText ?? null,
          optionValue: meta.optionValue ?? null,
          warningCodes: meta.warningCodes ?? [],
          triggerWarningCodes: meta.triggerWarningCodes ?? [],
          emittedLocator: meta.emittedLocator ?? null,
          emittedLocatorWarnings: meta.emittedLocatorWarnings ?? [],
          emittedWeakFallback: meta.emittedWeakFallback ?? false,
          weakFallbackReason: meta.weakFallbackReason ?? null,
          weakFallbackSelector: meta.weakFallbackSelector ?? null,
          weakFallbackLocator: meta.weakFallbackLocator ?? null,
          weakFallbackIndex: meta.weakFallbackIndex ?? null,
          weakFallbackIndexKind: meta.weakFallbackIndexKind ?? null,
          weakFallbackUsedVisibleFilter: meta.weakFallbackUsedVisibleFilter ?? false,
          weakFallbackMatchCount: meta.weakFallbackMatchCount ?? null,
          weakFallbackVisibleMatchCount: meta.weakFallbackVisibleMatchCount ?? null,
          weakFallbackSource: meta.weakFallbackSource ?? null,
          weakFallbackWarnings: meta.weakFallbackWarnings ?? [],
          labelContextRenderStatus: meta.labelContextRenderStatus ?? null,
          labelContextRenderReason: meta.labelContextRenderReason ?? null,
          triggerContextRenderStatus: meta.triggerContextRenderStatus ?? null,
          triggerContextRenderReason: meta.triggerContextRenderReason ?? null,
        },
      };
      await this.testInfo.attach('air-repair-' + String(meta.step ?? methodName) + '.json', {
        body: Buffer.from(JSON.stringify(payload, null, 2), 'utf8'),
        contentType: 'application/json',
      });
    } catch {
      // Never hide the original action failure because of AIR repair evidence capture.
    }
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
    return ['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select', 'hover'].includes(action);
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
    if (value.includes('getBy') || value.startsWith('label-context(')) return 'playwright';
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
    } else if (step.action === 'custom-select' || step.action === 'custom-menu-select') {
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
      case 'custom-control-open':
        return { locatorExpr, operation: 'click', args: '' };
      case 'custom-select':
        return { locatorExpr, operation: 'selectOption', args: JSON.stringify(this.resolveInputValue(step)) };
      case 'custom-menu-select':
        return { locatorExpr, operation: 'click', args: '' };
      case 'submit':
        if (this.shouldUseFormSubmit(selector)) {
          return { locatorExpr, operation: 'press', args: `'Enter'` };
        }
        return { locatorExpr, operation: 'click', args: '' };
      default:
        return null;
    }
  }

  private static buildRecordedLocatorExpr(
    selector?: string | null,
    selectorSpec?: CodegenStep['selectorSpec'],
  ): string | null {
    const exact = renderLocatorExpressionFromSelectorSpec(selectorSpec);
    if (exact) return exact;
    if (
      selectorSpec?.engine === 'label-context' ||
      selectorSpec?.engine === 'trigger-context' ||
      selectorSpec?.engine === 'bounded-field' ||
      selectorSpec?.engine === 'scoped'
    ) {
      return null;
    }
    const normalized = (selector || '').trim();
    return normalized ? `locator(${JSON.stringify(normalized)})` : null;
  }

  private static buildStructuralFallbackWarningComments(
    labelContext?: LabelContextSelectorSpec,
  ): string[] {
    if (!labelContext) return [];
    const renderStatus = this.classifyLabelContextRenderStatus(labelContext);
    if (renderStatus !== 'proven-structural-fallback') return [];
    return [
      `// AIR WARNING: Structural label-context fallback.`,
      `// Reason: ${labelContext.renderReason || `no stable direct selector was available for field "${labelContext.labelText}".`}`,
      `// Proof: exact label + one visible ${labelContext.targetTag} inside bounded field container.`,
      `// Consider adding data-testid/name/aria-label for a cleaner locator.`,
    ];
  }

  private static buildBoundedFieldFallbackWarningComments(
    boundedField?: BoundedFieldSelectorSpec,
  ): string[] {
    return buildBoundedFieldWarningComments(boundedField);
  }

  private static buildTriggerStructuralFallbackWarningComments(
    triggerContext?: TriggerContextSelectorSpec,
  ): string[] {
    if (!triggerContext) return [];
    if ((triggerContext.renderStatus ?? 'proof-only-no-clean-render') !== 'proven-structural-fallback') return [];
    return [
      `// AIR WARNING: Structural custom-control trigger fallback.`,
      `// Reason: ${triggerContext.renderReason || `no stable direct trigger selector was available for field "${triggerContext.labelText}".`}`,
      `// Proof: exact field label + one visible trigger inside bounded field container.`,
      `// Consider adding data-testid/id/aria-label on the trigger wrapper for a cleaner locator.`,
    ];
  }

  private static buildWeakTriggerFallbackWarningComments(
    triggerSelector: string,
  ): string[] {
    return [
      `// AIR WARNING: Weak custom-control trigger fallback.`,
      `// Reason: no bounded trigger-context proof was available, so AIR is using the recorded trigger selector.`,
      `// Trigger selector: ${this.cleanForComment(triggerSelector)}`,
      `// Consider adding data-testid/id/aria-label on the trigger wrapper for a cleaner locator.`,
    ];
  }

  private static isStructuredSelectorSpec(
    selectorSpec?: CodegenStep['selectorSpec'],
  ): boolean {
    return (
      selectorSpec?.engine === 'label-context' ||
      selectorSpec?.engine === 'trigger-context' ||
      selectorSpec?.engine === 'bounded-field' ||
      selectorSpec?.engine === 'scoped'
    );
  }

  private static looksLikeRenderedLocatorExpression(selector: string): boolean {
    return /^(?:locator|getBy(?:TestId|Role|Label|Placeholder|Text))\(/.test(selector.trim());
  }

  private static matchRecordedAmbiguityToSelector(
    selector: string,
    ambiguity?: FingerprintSelectorAmbiguity | null,
  ): FingerprintSelectorAmbiguity | undefined {
    if (!ambiguity) return undefined;
    const originalSelector = this.normalizeSelectorKey(ambiguity.originalSelector || '');
    const candidateSelector = this.normalizeSelectorKey(selector);
    if (!originalSelector || !candidateSelector) return undefined;
    return originalSelector === candidateSelector ? ambiguity : undefined;
  }

  private static buildWeakFallbackBaseLocatorExpr(
    selector?: string | null,
    selectorSpec?: CodegenStep['selectorSpec'],
  ): { selector: string; locatorExpression: string; supportsVisibleFilter: boolean } | null {
    const normalized = (selector || selectorSpec?.selector || '').trim();
    if (!normalized) return null;
    if (this.looksLikeRenderedLocatorExpression(normalized)) {
      return {
        selector: normalized,
        locatorExpression: normalized,
        supportsVisibleFilter: false,
      };
    }
    if (this.isStructuredSelectorSpec(selectorSpec)) return null;
    return {
      selector: normalized,
      locatorExpression: `locator(${JSON.stringify(normalized)})`,
      supportsVisibleFilter: this.canApplyVisibleFilterToWeakFallbackSelector(normalized, selectorSpec),
    };
  }

  private static canApplyVisibleFilterToWeakFallbackSelector(
    selector: string,
    selectorSpec?: CodegenStep['selectorSpec'],
  ): boolean {
    const normalized = (selector || '').trim();
    if (!normalized) return false;
    if (this.looksLikeRenderedLocatorExpression(normalized)) return false;
    if (this.isStructuredSelectorSpec(selectorSpec)) return false;

    const engine = selectorSpec?.engine ?? inferSelectorEngine(normalized);
    if (engine !== 'css') return false;
    if (/^(?:css|xpath|text|id|nth|visible|internal)=/i.test(normalized)) return false;
    if (normalized.includes('>>')) return false;
    if (normalized.includes(',')) return false;
    return true;
  }

  private static buildVisibleFilteredWeakFallbackLocatorExpression(
    selector: string,
    selectorSpec?: CodegenStep['selectorSpec'],
  ): string | null {
    if (!this.canApplyVisibleFilterToWeakFallbackSelector(selector, selectorSpec)) return null;
    const normalized = selector.trim();
    const visibleSelector = /:visible\b/.test(normalized) ? normalized : `${normalized}:visible`;
    return `locator(${JSON.stringify(visibleSelector)})`;
  }

  private static buildVisibleIndexedWeakFallbackLocator(args: {
    selector: string;
    selectorSpec?: CodegenStep['selectorSpec'];
    baseLocatorExpression: string;
    index: number;
    supportsVisibleFilter: boolean;
    warnings: string[];
  }): { locatorExpression: string; usedVisibleFilter: boolean } {
    if (args.supportsVisibleFilter) {
      const visibleFilteredLocatorExpression = this.buildVisibleFilteredWeakFallbackLocatorExpression(
        args.selector,
        args.selectorSpec,
      );
      if (visibleFilteredLocatorExpression) {
        return {
          locatorExpression: `${visibleFilteredLocatorExpression}.nth(${args.index})`,
          usedVisibleFilter: true,
        };
      }
    }

    args.warnings.push(
      'AIR WARNING: Recorded index is based on visible matches; raw nth may be unsafe if hidden matches exist.',
    );
    return {
      locatorExpression: `${args.baseLocatorExpression}.nth(${args.index})`,
      usedVisibleFilter: false,
    };
  }

  private static describeWeakFallbackReason(args: {
    proofLevel?: string | null;
    renderStatus?: string | null;
    trigger?: boolean;
    blockedReason?: string | null;
  }): string {
    if (args.trigger) {
      if (args.blockedReason === 'custom-control-trigger-target-binding-ambiguous') {
        return 'trigger selector was ambiguous during recording.';
      }
      if (args.renderStatus === 'blocked-unsafe-render') {
        return 'trigger selector was not safe for confident rendering.';
      }
      if (args.blockedReason) {
        return `trigger selector fallback was required (${this.cleanForComment(args.blockedReason)}).`;
      }
      return 'trigger selector was not confidently validated.';
    }

    switch (args.proofLevel) {
      case 'blocked':
        return 'selector was blocked for confident codegen.';
      case 'unvalidated':
        return 'selector was not confidently validated.';
      case 'inferred_unproven':
        return 'selector was inferred but not proven.';
      case 'weak_but_usable':
        return 'selector was marked weak and AIR is preserving the recorded selector.';
      default:
        if (args.renderStatus === 'blocked-unsafe-render') {
          return 'selector rendering was blocked as unsafe.';
        }
        if (args.renderStatus === 'proof-only-no-clean-render') {
          return 'selector proof did not have a clean render path.';
        }
        return 'selector was ambiguous or not confidently validated.';
    }
  }

  private static buildWeakFallbackLocatorExpression(args: {
    methodName: string;
    reason: string;
    candidates: WeakFallbackSelectorCandidate[];
  }): WeakFallbackRenderResult | WeakFallbackBuildFailure {
    const candidateFailures: string[] = [];

    for (const candidate of args.candidates) {
      const base = this.buildWeakFallbackBaseLocatorExpr(candidate.selector, candidate.selectorSpec);
      if (!base) {
        const sourceLabel = candidate.selectorOrigin.replace(/-/g, ' ');
        const selectorLabel = (candidate.selector || candidate.selectorSpec?.selector || '').trim();
        candidateFailures.push(
          selectorLabel
            ? `${sourceLabel} selector "${this.cleanForComment(selectorLabel)}" could not be rendered as a locator`
            : `no ${sourceLabel} selector available`,
        );
        continue;
      }

      const recordedAmbiguity = this.matchRecordedAmbiguityToSelector(base.selector, candidate.recordedAmbiguity);
      const recordedMatchCount = typeof recordedAmbiguity?.matchCount === 'number'
        ? recordedAmbiguity.matchCount
        : null;
      const recordedVisibleMatchCount = typeof recordedAmbiguity?.visibleMatchCount === 'number'
        ? recordedAmbiguity.visibleMatchCount
        : null;
      const positionInMatches = typeof recordedAmbiguity?.positionInMatches === 'number'
        ? recordedAmbiguity.positionInMatches
        : null;
      const validationMatchCount = typeof candidate.validationMatchCount === 'number'
        ? candidate.validationMatchCount
        : null;
      const validationVisibleMatchCount = typeof candidate.validationVisibleMatchCount === 'number'
        ? candidate.validationVisibleMatchCount
        : null;
      const matchCount = recordedMatchCount ?? validationMatchCount;
      const visibleMatchCount = recordedVisibleMatchCount ?? validationVisibleMatchCount;
      const warnings: string[] = [];

      let locatorExpression = base.locatorExpression;
      let source: WeakFallbackSource;
      let indexKind: WeakFallbackIndexKind | null = null;
      let usedVisibleFilter = false;
      if (
        !this.hasCardinalityScope(locatorExpression) &&
        typeof positionInMatches === 'number' &&
        positionInMatches >= 0 &&
        (visibleMatchCount ?? 0) > 1
      ) {
        const visibleIndexedLocator = this.buildVisibleIndexedWeakFallbackLocator({
          selector: base.selector,
          selectorSpec: candidate.selectorSpec,
          baseLocatorExpression: locatorExpression,
          index: positionInMatches,
          supportsVisibleFilter: base.supportsVisibleFilter,
          warnings,
        });
        locatorExpression = visibleIndexedLocator.locatorExpression;
        indexKind = 'visible';
        usedVisibleFilter = visibleIndexedLocator.usedVisibleFilter;
        source = 'indexed-fallback';
      } else if (
        !this.hasCardinalityScope(locatorExpression) &&
        (visibleMatchCount ?? 0) > 1
      ) {
        locatorExpression = `${locatorExpression}.first()`;
        source = 'first-fallback';
        warnings.push('No recorded index was available. AIR used first() as a best-effort fallback.');
      } else if (matchCount == null && visibleMatchCount == null) {
        source = 'plain-locator';
        warnings.push('Match count was unavailable when AIR emitted this fallback.');
      } else {
        source = candidate.selectorOrigin;
      }

        return {
        locatorExpression,
        selector: base.selector,
        index: positionInMatches,
        indexKind,
        usedVisibleFilter,
        matchCount,
        visibleMatchCount,
        recordedMatchCount,
        recordedVisibleMatchCount,
        reason: args.reason,
        source,
        warnings,
      };
    }

    const failureDetail = candidateFailures.length
      ? candidateFailures.join('; ')
      : 'no recorded selector or trigger selector available';
    return {
      debugReason: `AIR could not build weak fallback for method ${args.methodName}: ${failureDetail}.`,
    };
  }

  private static renderAirWeakSelectorWarning(args: {
    fallback: WeakFallbackRenderResult;
    proofLevel?: string | null;
    renderStatus?: string | null;
  }): string[] {
    const lines = [
      `// AIR WARNING: Weak selector fallback.`,
      `// Reason: ${this.cleanForComment(args.fallback.reason)}`,
      `// Selector: ${JSON.stringify(args.fallback.selector)}`,
      `// Match count during recording: ${args.fallback.recordedMatchCount ?? 'unavailable'}`,
      `// Visible match count during recording: ${args.fallback.recordedVisibleMatchCount ?? 'unavailable'}`,
    ];

    if (args.fallback.recordedMatchCount == null && args.fallback.matchCount != null) {
      lines.push(`// Match count during validation: ${args.fallback.matchCount}`);
    }
    if (
      args.fallback.recordedVisibleMatchCount == null &&
      args.fallback.visibleMatchCount != null
    ) {
      lines.push(`// Visible match count during validation: ${args.fallback.visibleMatchCount}`);
    }

    if (typeof args.fallback.index === 'number' && args.fallback.index >= 0) {
      lines.push(`// Recorded index used: ${args.fallback.index}`);
    } else if (args.fallback.source === 'first-fallback') {
      lines.push(`// No recorded index was available. AIR used first() as a best-effort fallback.`);
    } else {
      lines.push(`// Recorded index used: unavailable`);
    }

    if (args.proofLevel) {
      lines.push(`// Proof level: ${args.proofLevel}`);
    }
    if (args.renderStatus) {
      lines.push(`// Render status: ${args.renderStatus}`);
    }
    for (const warning of args.fallback.warnings) {
      if (
        warning === 'No recorded index was available. AIR used first() as a best-effort fallback.' ||
        warning === 'Match count was unavailable when AIR emitted this fallback.'
      ) {
        continue;
      }
      lines.push(`// ${this.cleanForComment(warning)}`);
    }
    lines.push(`// Review recommended if flaky. Prefer adding a stable data-testid.`);
    return lines;
  }

  private static renderWeakFallbackAction(args: {
    step: CodegenStep;
    selector: string;
    locatorExpression: string;
    methodName: string;
    popupAware: boolean;
    operationOverride?: ParsedLocatorAction['operation'];
    overrideArgs?: string;
    targetVariableName?: string;
  }): WeakFallbackActionRenderResult | WeakFallbackBuildFailure {
    const deterministic = args.operationOverride
      ? {
          locatorExpr: args.locatorExpression,
          operation: args.operationOverride,
          args: args.overrideArgs ?? '',
        }
      : this.buildDeterministicLocatorAction(args.step, args.selector);
    if (!deterministic) {
      return {
        debugReason: `AIR could not build weak fallback for method ${args.methodName}: action "${args.step.action}" has no deterministic fallback renderer.`,
      };
    }

    const action = {
      ...deterministic,
      locatorExpr: args.locatorExpression,
    };

    let invocationArgs = action.args;
    let methodParams = '';
    if (
      ['fill', 'type', 'selectOption'].includes(action.operation) &&
      (args.step.action === 'input' || args.step.action === 'custom-select' || args.step.action === 'custom-menu-select')
    ) {
      const valueParam = this.inferValueParameter(args.step);
      methodParams = `${valueParam.name}: string = ${JSON.stringify(valueParam.defaultValue)}`;
      invocationArgs = valueParam.name;
    }

    const invocation = `${action.operation}(${invocationArgs})`;
    const fullAction = `this.page.${action.locatorExpr}.${invocation}`;
    const popupAwareOperation = args.popupAware && ['click', 'dblclick', 'tap'].includes(action.operation);
    const targetVariableName = args.targetVariableName || 'target';

    if (popupAwareOperation) {
      return {
        methodParams,
        fullAction,
        lines: [
          `const context = this.page.context();`,
          `const popupPromise = context.waitForEvent('page', { timeout: 1500 }).catch(() => null);`,
          `const ${targetVariableName} = this.page.${action.locatorExpr};`,
          `await ${targetVariableName}.waitFor({ state: 'visible', timeout: 5000 });`,
          `await ${targetVariableName}.${invocation};`,
          `const popupPage = await popupPromise;`,
          `if (popupPage) {`,
          `  await popupPage.waitForLoadState('domcontentloaded');`,
          `  this.page = popupPage;`,
          `}`,
        ],
      };
    }

    return {
      methodParams,
      fullAction,
      lines: [
        `const ${targetVariableName} = this.page.${action.locatorExpr};`,
        `await ${targetVariableName}.waitFor({ state: 'visible', timeout: 5000 });`,
        `await ${targetVariableName}.${invocation};`,
      ],
    };
  }

  private static buildWeakCustomControlOptionAction(args: {
    step: CodegenStep;
    methodName: string;
    optionLocatorExpr: string | null;
  }): CustomControlOptionFallbackRenderResult | WeakFallbackBuildFailure {
    const optionSelector = (
      args.step.optionResolvedSelector ||
      args.step.optionSelector ||
      args.step.selector ||
      ''
    ).trim();
    const optionSelectorSpec = args.step.optionSelectorSpec;

    if (args.optionLocatorExpr) {
      const actionRender = this.renderWeakFallbackAction({
        step: args.step,
        selector: optionSelector || args.optionLocatorExpr,
        locatorExpression: args.optionLocatorExpr,
        methodName: args.methodName,
        popupAware: false,
        operationOverride: 'click',
        targetVariableName: 'optionTarget',
      });
      if (!('lines' in actionRender)) {
        return actionRender;
      }

      const warningLines = [
        `// AIR WARNING: Weak trigger selector fallback.`,
        `// AIR preserved the recorded option selection below.`,
      ];
      if (optionSelectorSpec && !canRenderSelectorSpecConfidently(optionSelectorSpec)) {
        warningLines.push(
          `// AIR WARNING: Option selector is also weak. AIR is preserving the recorded option selector below.`,
        );
      }

      return {
        lines: actionRender.lines,
        fullAction: actionRender.fullAction,
        warningLines,
      };
    }

    const optionRoleName = (args.step.optionText || args.step.optionValue || '').trim();
    if (optionRoleName) {
      const actionRender = this.renderWeakFallbackAction({
        step: args.step,
        selector: optionRoleName,
        locatorExpression: `getByRole("option", { name: ${JSON.stringify(optionRoleName)}, exact: true })`,
        methodName: args.methodName,
        popupAware: false,
        operationOverride: 'click',
        targetVariableName: 'optionTarget',
      });
      if (!('lines' in actionRender)) {
        return actionRender;
      }

      return {
        lines: actionRender.lines,
        fullAction: actionRender.fullAction,
        warningLines: [
          `// AIR WARNING: Weak trigger selector fallback.`,
          `// AIR preserved the recorded option selection below.`,
          `// AIR WARNING: Recorded option selector was unavailable. AIR reconstructed the option click using role/name evidence.`,
        ],
      };
    }

    const optionText = (args.step.optionText || '').trim();
    if (optionText) {
      const actionRender = this.renderWeakFallbackAction({
        step: args.step,
        selector: optionText,
        locatorExpression: `locator("[role=\\"option\\"]").filter({ hasText: ${JSON.stringify(optionText)} })`,
        methodName: args.methodName,
        popupAware: false,
        operationOverride: 'click',
        targetVariableName: 'optionTarget',
      });
      if (!('lines' in actionRender)) {
        return actionRender;
      }

      return {
        lines: actionRender.lines,
        fullAction: actionRender.fullAction,
        warningLines: [
          `// AIR WARNING: Weak trigger selector fallback.`,
          `// AIR preserved the recorded option selection below.`,
          `// AIR WARNING: Recorded option selector was unavailable. AIR reconstructed the option click using [role="option"] text filtering.`,
        ],
      };
    }

    return {
      debugReason: `AIR could not reconstruct option selection for method ${args.methodName}: no recorded option selector, option label/value, or option text available.`,
    };
  }

  private static classifyLabelContextRenderStatus(
    labelContext?: LabelContextSelectorSpec | null,
  ): LabelContextRenderStatus | undefined {
    if (!labelContext) return undefined;
    if (labelContext.renderStatus) return labelContext.renderStatus;
    if (labelContext.association === 'label-for' || labelContext.association === 'aria-labelledby') {
      return 'clean-direct-selector';
    }
    if (labelContext.cleanParentSelector) {
      return 'clean-scoped-locator';
    }
    return 'proven-structural-fallback';
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
    const preferredRendering = pickPreferredEquivalentRendering(
      resolverMetadata?.selectorEvaluation?.preferredRenderings,
    );
    const preferredEquivalentLocatorExpr = renderLocatorExpressionFromEquivalentRendering(
      preferredRendering ?? undefined,
    );
    const selectorSpecWarnings = getSelectorSpecRenderingWarnings(resolvedSelectorSpec);
    const preferredRenderingWarnings = preferredRendering?.warningCodes ?? [];
    const missingSpecWarnings = usedSelectorSpec ? [] : ['selector-spec-missing-fallback'];
    const renderingWarnings = Array.from(new Set([
      ...selectorSpecWarnings,
      ...preferredRenderingWarnings,
      ...missingSpecWarnings,
    ]));
    const renderConfidently = resolvedSelectorSpec
      ? canRenderSelectorSpecConfidently(resolvedSelectorSpec)
      : !!selectorUsed;
    const canUsePreferredEquivalentRendering = !!preferredEquivalentLocatorExpr;
    const emittedLocatorEngine = preferredRendering?.engine ?? resolvedSelectorSpec?.engine ?? 'unknown';
    const emittedLocatorProofLevel = preferredRendering?.proofLevel ?? resolvedSelectorSpec?.proofLevel ?? 'unknown';
    const emittedLocatorSource = preferredRendering ? 'resolver' : (resolvedSelectorSpec?.source ?? (usedSelectorSpec ? 'unknown' : 'legacy-fallback'));
    const legacyLocatorExpr = !usedSelectorSpec && selectorUsed
      ? `locator(${JSON.stringify(selectorUsed)})`
      : null;
    const preferredLocatorExpr = preferredEquivalentLocatorExpr ?? exactLocatorExpr ?? legacyLocatorExpr;
    const triggerLocatorExpr = this.buildRecordedLocatorExpr(
      step.triggerResolvedSelector ?? step.triggerSelector,
      step.triggerSelectorSpec,
    );
    const triggerContext = (step.triggerSelectorSpec as any)?.triggerContext;
    const triggerBoundedField = step.triggerSelectorSpec?.engine === 'bounded-field'
      ? step.triggerSelectorSpec.boundedField
      : undefined;
    const boundedField = resolvedSelectorSpec?.engine === 'bounded-field'
      ? resolvedSelectorSpec.boundedField
      : undefined;
    const labelContext = (resolvedSelectorSpec as any)?.labelContext;
    const labelContextRenderStatus = this.classifyLabelContextRenderStatus(labelContext) ?? undefined;
    const labelContextRenderReason = labelContext?.renderReason ?? null;
    const labelText = labelContext?.labelText ?? null;
    const relationType = labelContext?.association;
    const boundedContainerSummary = labelContext?.boundedContainerSummary ?? null;
    const cleanParentSelector = labelContext?.cleanParentSelector ?? null;
    const cleanChildSelector = labelContext?.cleanChildSelector ?? null;
    const structuralFallbackLocator = labelContext?.structuralFallbackLocator ?? exactLocatorExpr ?? null;
    const recoveredFromSelector = labelContext?.recoveredFromSelector ?? null;
    const boundedFieldRenderStatus = classifyBoundedFieldRenderStatus(boundedField) ?? undefined;
    const boundedFieldRenderReason = boundedField?.renderReason ?? null;
    const boundedFieldLabelText = boundedField?.labelText ?? null;
    const boundedFieldRelation = boundedField?.relation;
    const boundedFieldControlKind = boundedField?.controlKind;
    const boundedFieldMatchedContainerSummary = boundedField?.boundedContainerSummary ?? null;
    const boundedFieldOriginalSelector = boundedField?.originalSelector ?? null;
    const triggerWarningCodes = Array.from(new Set([
      ...(triggerContext?.warningCodes ?? []),
      ...(triggerBoundedField?.warningCodes ?? []),
      ...(resolverMetadata?.triggerWarningCodes ?? []),
    ]));
    const triggerContextRenderStatus = triggerContext?.renderStatus
      ?? classifyBoundedFieldRenderStatus(triggerBoundedField)
      ?? resolverMetadata?.triggerContextRenderStatus
      ?? undefined;
    const triggerContextRenderReason = triggerContext?.renderReason
      ?? triggerBoundedField?.renderReason
      ?? resolverMetadata?.triggerContextRenderReason
      ?? null;
    const triggerContextLabel = triggerContext?.labelText
      ?? triggerBoundedField?.labelText
      ?? resolverMetadata?.triggerContextLabel
      ?? null;
    const triggerBoundedContainerSummary = triggerContext?.boundedContainerSummary
      ?? triggerBoundedField?.boundedContainerSummary
      ?? resolverMetadata?.triggerBoundedContainerSummary
      ?? null;
    const triggerStructuralFallbackLocator = triggerContext?.structuralFallbackLocator
      ?? triggerBoundedField?.structuralFallbackLocator
      ?? resolverMetadata?.triggerStructuralFallbackLocator
      ?? triggerLocatorExpr
      ?? null;
    const optionLocatorExpr = preferredLocatorExpr ?? this.buildRecordedLocatorExpr(
      step.optionResolvedSelector ?? step.optionSelector ?? selectorUsed,
      step.optionSelectorSpec ?? resolvedSelectorSpec ?? step.selectorSpec,
    );
    const triggerRenderBlocked =
      triggerContextRenderStatus === 'blocked-unsafe-render' ||
      triggerWarningCodes.includes('custom-control-trigger-target-binding-ambiguous');
    const isCompressedCustomControlSelection =
      (step.action === 'custom-select' || step.action === 'custom-menu-select') &&
      Array.isArray(step.compressedFromEvents) &&
      step.compressedFromEvents.length >= 2;
    const isCompressedCustomSelect =
      isCompressedCustomControlSelection &&
      Array.isArray(step.compressedFromEvents) &&
      !!triggerLocatorExpr &&
      !!optionLocatorExpr;
    const blockedCompressedCustomSelect =
      isCompressedCustomControlSelection &&
      (
        triggerRenderBlocked ||
        (!!step.triggerSelectorSpec && !triggerLocatorExpr)
      );
    const weakCompressedCustomSelect =
      isCompressedCustomSelect &&
      !blockedCompressedCustomSelect &&
      !triggerContextRenderStatus &&
      !!step.triggerSelector &&
      (step.triggerSelectorPriority === 'class' || step.triggerSelectorPriority === 'path' || step.triggerSelectorPriority === 'other' || step.triggerSelectorPriority === 'unknown');

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
      (renderConfidently || canUsePreferredEquivalentRendering) &&
      preferredLocatorExpr &&
      effective.locatorExpr !== preferredLocatorExpr
    ) {
      effective = {
        ...effective,
        locatorExpr: preferredLocatorExpr,
      };
      fallbackReason = fallbackReason ?? (preferredRendering ? 'selector-spec-equivalent-render' : 'selector-spec-exact-render');
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
    let weakFallback: WeakFallbackRenderResult | null = null;
    const extraWarningCodes = weakCompressedCustomSelect ? ['custom-control-trigger-weak-fallback'] : [];
    const nonConfidentRenderStatus = labelContextRenderStatus ?? boundedFieldRenderStatus ?? null;
    let selectorUsedForOutput = selectorUsed;

    if (blockedCompressedCustomSelect) {
      const optionLabel = step.optionText || step.optionValue || step.intent || `step ${step.step}`;
      const blockedReason = triggerWarningCodes[0] || triggerContextRenderReason || 'custom-control-trigger-blocked';
      const weakTriggerFallback = this.buildWeakFallbackLocatorExpression({
        methodName,
        reason: this.describeWeakFallbackReason({
          trigger: true,
          renderStatus: triggerContextRenderStatus,
          blockedReason,
        }),
        candidates: [
          {
            selector: step.triggerResolvedSelector,
            selectorSpec: step.triggerSelectorSpec,
            recordedAmbiguity: step.triggerFingerprint?.selectorAmbiguity,
            selectorOrigin: 'trigger-selector',
          },
          {
            selector: step.triggerSelector,
            recordedAmbiguity: step.triggerFingerprint?.selectorAmbiguity,
            selectorOrigin: 'trigger-selector',
          },
        ],
      });

      if ('locatorExpression' in weakTriggerFallback) {
        const actionRender = this.renderWeakFallbackAction({
          step,
          selector: weakTriggerFallback.selector,
          locatorExpression: weakTriggerFallback.locatorExpression,
          methodName,
          popupAware,
          operationOverride: 'click',
          targetVariableName: 'triggerTarget',
        });
        if ('lines' in actionRender) {
          const optionActionRender = this.buildWeakCustomControlOptionAction({
            step,
            methodName,
            optionLocatorExpr,
          });
          if ('lines' in optionActionRender) {
            weakFallback = weakTriggerFallback;
            fallbackReason = 'custom-control-trigger-weak-fallback';
            extraWarningCodes.push('custom-control-trigger-weak-fallback');
            selectorUsedForOutput = weakTriggerFallback.selector;
            fullAction = `${actionRender.fullAction}; ${optionActionRender.fullAction}`;
            methodParams = actionRender.methodParams;
            lines = [
              ...this.renderAirWeakSelectorWarning({
                fallback: weakTriggerFallback,
                renderStatus: triggerContextRenderStatus ?? null,
              }),
              ...actionRender.lines,
              ...optionActionRender.warningLines,
              ...optionActionRender.lines,
            ];
          } else {
            fallbackReason = 'custom-control-trigger-blocked-unsafe-render';
            const optionSelectionFailureMessage = `AIR unresolved ${step.action} step ${step.step}: option selection could not be reconstructed after weak trigger fallback.`;
            fullAction = `throw new Error(${JSON.stringify(optionSelectionFailureMessage)})`;
            lines = [
              ...this.renderAirWeakSelectorWarning({
                fallback: weakTriggerFallback,
                renderStatus: triggerContextRenderStatus ?? null,
              }),
              `// AIR WARNING: Weak trigger selector fallback.`,
              `// AIR WARNING: AIR could not reconstruct the option selection for "${this.cleanForComment(optionLabel)}".`,
              `// Debug: ${this.cleanForComment(optionActionRender.debugReason)}`,
              `throw new Error(${JSON.stringify(optionSelectionFailureMessage)});`,
            ];
          }
        } else {
          fallbackReason = 'custom-control-trigger-blocked-unsafe-render';
          const blockedMessage = `AIR could not prove a safe trigger selector for custom-select ${optionLabel}`;
          fullAction = `throw new Error(${JSON.stringify(blockedMessage)})`;
          lines = [
            `// TODO[AIR]: Cannot safely open custom control for "${this.cleanForComment(optionLabel)}".`,
            `// Reason: ${this.cleanForComment(blockedReason)}.`,
            `// Debug: ${this.cleanForComment(actionRender.debugReason)}`,
            `throw new Error(${JSON.stringify(blockedMessage)});`,
          ];
        }
      } else {
        fallbackReason = 'custom-control-trigger-blocked-unsafe-render';
        const blockedMessage = `AIR could not prove a safe trigger selector for custom-select ${optionLabel}`;
        fullAction = `throw new Error(${JSON.stringify(blockedMessage)})`;
        lines = [
          `// TODO[AIR]: Cannot safely open custom control for "${this.cleanForComment(optionLabel)}".`,
          `// Reason: ${this.cleanForComment(blockedReason)}.`,
          `// Debug: ${this.cleanForComment(weakTriggerFallback.debugReason)}`,
          `throw new Error(${JSON.stringify(blockedMessage)});`,
        ];
      }
    } else if (isCompressedCustomSelect && renderConfidently) {
      fullAction = `this.page.${triggerLocatorExpr}.click(); this.page.${optionLocatorExpr}.click()`;
      lines = [
        `const triggerTarget = this.page.${triggerLocatorExpr};`,
        `await triggerTarget.waitFor({ state: 'visible' });`,
        `await triggerTarget.click();`,
        `const optionTarget = this.page.${optionLocatorExpr};`,
        `await optionTarget.waitFor({ state: 'visible' });`,
        `await optionTarget.click();`,
      ];
      fallbackReason = 'compressed-custom-control-select';
    } else if (effective && (renderConfidently || canUsePreferredEquivalentRendering)) {
      const scopedLocator = this.withCardinalityScope(effective.locatorExpr);
      let invocationArgs = effective.args;
      if (
        ['fill', 'type', 'selectOption'].includes(effective.operation) &&
        (step.action === 'input' || step.action === 'custom-select' || step.action === 'custom-menu-select')
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
      const weakSelectorFallback = this.buildWeakFallbackLocatorExpression({
        methodName,
        reason: this.describeWeakFallbackReason({
          proofLevel: resolvedSelectorSpec.proofLevel,
          renderStatus: nonConfidentRenderStatus,
        }),
        candidates: [
          {
            selector: resolvedSelectorSpec.selector || resolvedSelector || step.resolvedSelector || step.selector,
            selectorSpec: resolvedSelectorSpec,
            recordedAmbiguity: step.fingerprint?.selectorAmbiguity,
            validationMatchCount: resolverMetadata?.matchCount ?? null,
            validationVisibleMatchCount: resolverMetadata?.effectiveMatchCount ?? null,
            selectorOrigin: 'resolved-selector',
          },
          {
            selector: step.selectorSpec?.selector ?? step.fingerprint?.selectorAmbiguity?.originalSelector ?? step.selector,
            selectorSpec: step.selectorSpec,
            recordedAmbiguity: step.fingerprint?.selectorAmbiguity,
            selectorOrigin: 'recorded-selector',
          },
        ],
      });

      if ('locatorExpression' in weakSelectorFallback) {
        const actionRender = this.renderWeakFallbackAction({
          step,
          selector: weakSelectorFallback.selector,
          locatorExpression: weakSelectorFallback.locatorExpression,
          methodName,
          popupAware,
        });
        if ('lines' in actionRender) {
          weakFallback = weakSelectorFallback;
          fallbackReason = fallbackReason ?? `selector-spec-${resolvedSelectorSpec.proofLevel}-weak-fallback`;
          extraWarningCodes.push('weak-selector-fallback');
          selectorUsedForOutput = weakSelectorFallback.selector;
          fullAction = actionRender.fullAction;
          methodParams = actionRender.methodParams;
          lines = [
            ...this.renderAirWeakSelectorWarning({
              fallback: weakSelectorFallback,
              proofLevel: resolvedSelectorSpec.proofLevel,
              renderStatus: nonConfidentRenderStatus,
            }),
            ...actionRender.lines,
          ];
        } else {
          fallbackReason = fallbackReason ?? `selector-spec-${resolvedSelectorSpec.proofLevel}`;
          const blockedMessage = `AIR unresolved step ${step.step}: selector proof level "${resolvedSelectorSpec.proofLevel}" is not safe for confident codegen.`;
          fullAction = `throw new Error(${JSON.stringify(blockedMessage)})`;
          lines = [
            `// TODO[AIR]: Selector is ${resolvedSelectorSpec.proofLevel} and was not emitted as a confident action.`,
            `// Intended selector: ${this.cleanForComment(selectorUsed)} | engine=${resolvedSelectorSpec.engine} | source=${resolvedSelectorSpec.source}`,
            `// Debug: ${this.cleanForComment(actionRender.debugReason)}`,
            `throw new Error(${JSON.stringify(blockedMessage)});`,
          ];
        }
      } else {
        fallbackReason = fallbackReason ?? `selector-spec-${resolvedSelectorSpec.proofLevel}`;
        const blockedMessage = `AIR unresolved step ${step.step}: selector proof level "${resolvedSelectorSpec.proofLevel}" is not safe for confident codegen.`;
        fullAction = `throw new Error(${JSON.stringify(blockedMessage)})`;
        lines = [
          `// TODO[AIR]: Selector is ${resolvedSelectorSpec.proofLevel} and was not emitted as a confident action.`,
          `// Intended selector: ${this.cleanForComment(selectorUsed)} | engine=${resolvedSelectorSpec.engine} | source=${resolvedSelectorSpec.source}`,
          `// Debug: ${this.cleanForComment(weakSelectorFallback.debugReason)}`,
          `throw new Error(${JSON.stringify(blockedMessage)});`,
        ];
      }
    } else if (!trimmedAction) {
      fallbackReason = 'empty-llm-action';
      fullAction = 'this.page.waitForTimeout(0)';
      lines = ['await this.page.waitForTimeout(0);'];
    } else {
      lines = [`await this.page.${trimmedAction};`];
    }

    const inlineWarningLines = renderingWarnings.map(code => `  // WARNING: ${code}`);
    for (const line of this.buildStructuralFallbackWarningComments(labelContext)) {
      inlineWarningLines.push(`  ${line}`);
    }
    for (const line of this.buildBoundedFieldFallbackWarningComments(boundedField)) {
      inlineWarningLines.push(`  ${line}`);
    }
    for (const line of this.buildTriggerStructuralFallbackWarningComments(triggerContext)) {
      inlineWarningLines.push(`  ${line}`);
    }
    for (const line of this.buildBoundedFieldFallbackWarningComments(triggerBoundedField)) {
      inlineWarningLines.push(`  ${line}`);
    }
    if (weakCompressedCustomSelect) {
      inlineWarningLines.push(`  // WARNING: custom-control-trigger-weak-fallback`);
      for (const line of this.buildWeakTriggerFallbackWarningComments(step.triggerSelector || '')) {
        inlineWarningLines.push(`  ${line}`);
      }
    }
    if (resolvedSelectorSpec && !renderConfidently && resolvedSelectorSpec.rejectReason) {
      inlineWarningLines.push(`  // WARNING: reject-reason=${this.cleanForComment(resolvedSelectorSpec.rejectReason)}`);
    }

    const methodLines = [
      `  // AIR step ${step.step} | action=${step.action} | selectorType=${selectorType} | resolvedBy=${resolvedBy} | score=${score}`,
      `  // selector: ${this.cleanForComment(selectorUsedForOutput)} | warnings: ${this.cleanForComment(warnings)}`,
      `  async ${methodName}(${methodParams}) {`,
      ...inlineWarningLines,
      `    try {`,
      ...lines.map(line => `      ${line}`),
      `    } catch (error) {`,
      `      await this.__airCaptureRepairEvidence(${JSON.stringify(methodName)}, error);`,
      `      throw error;`,
      `    }`,
      `  }`,
    ];

    return {
      methodCode: methodLines.join('\n'),
      fullAction,
      fallbackReason,
      selectorUsed: selectorUsedForOutput,
      emittedLocator: blockedCompressedCustomSelect
        ? null
        : ((renderConfidently || canUsePreferredEquivalentRendering) ? preferredLocatorExpr : null),
      emittedLocatorEngine,
      emittedLocatorProofLevel,
      emittedLocatorSource,
      emittedLocatorWarnings: renderingWarnings,
      usedSelectorSpec,
      equivalentRenderingUsed: !!preferredRendering,
      equivalentLocator: preferredEquivalentLocatorExpr,
      equivalentLocatorEngine: preferredRendering?.engine ?? 'unknown',
      equivalentProofLevel: preferredRendering?.proofLevel ?? 'unknown',
      equivalentProofSource: preferredRendering?.proofSource ?? 'unknown',
      equivalentSourceSelector: preferredRendering?.sourceSelector ?? null,
      preferredRenderings: resolverMetadata?.selectorEvaluation?.preferredRenderings?.slice(0, 3),
      labelContextRenderStatus,
      labelContextRenderReason,
      labelText,
      relationType,
      boundedContainerSummary,
      cleanParentSelector,
      cleanChildSelector,
      structuralFallbackLocator,
      recoveredFromSelector,
      triggerContextRenderStatus,
      triggerContextRenderReason,
      triggerContextLabel,
      triggerBoundedContainerSummary,
      triggerStructuralFallbackLocator,
      boundedFieldRenderStatus,
      boundedFieldRenderReason,
      boundedFieldLabelText,
      boundedFieldRelation,
      boundedFieldControlKind,
      boundedFieldMatchedContainerSummary,
      boundedFieldOriginalSelector,
      emittedWeakFallback: weakFallback ? true : undefined,
      weakFallbackReason: weakFallback?.reason,
      weakFallbackSelector: weakFallback?.selector,
      weakFallbackLocator: weakFallback?.locatorExpression,
      weakFallbackIndex: weakFallback ? weakFallback.index : undefined,
      weakFallbackIndexKind: weakFallback?.indexKind ?? undefined,
      weakFallbackUsedVisibleFilter: weakFallback?.indexKind ? weakFallback.usedVisibleFilter : undefined,
      weakFallbackMatchCount: weakFallback ? weakFallback.matchCount : undefined,
      weakFallbackVisibleMatchCount: weakFallback ? weakFallback.visibleMatchCount : undefined,
      weakFallbackSource: weakFallback?.source,
      weakFallbackWarnings: weakFallback?.warnings,
      extraWarningComments: this.buildStructuralFallbackWarningComments(labelContext),
      extraWarningCodes,
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
      controlFamily: step.controlFamily,
      triggerSelector: step.triggerSelector,
      triggerSelectorPriority: step.triggerSelectorPriority,
      triggerResolvedSelector: step.triggerResolvedSelector,
      triggerSelectorSpec: step.triggerSelectorSpec,
      optionSelector: step.optionSelector,
      optionText: step.optionText,
      optionValue: step.optionValue,
      optionResolvedSelector: step.optionResolvedSelector,
      optionSelectorSpec: step.optionSelectorSpec,
      absorbedOpenEventId: step.absorbedOpenEventId,
      absorbedOpenTraceId: step.absorbedOpenTraceId,
      compressedFromEvents: step.compressedFromEvents,
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
        console.error('[AIR] Sending session data to Gemini...', {
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
