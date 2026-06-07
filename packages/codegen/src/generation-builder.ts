import {
  GenerationContextSchemaV1,
  type GenerationAssertion,
  type GenerationContextV1,
  type GenerationGuidanceV1,
  type GenerationStepV1,
  type IgnoredGenerationStepV1,
  type IgnoredStepReasonV1,
} from './runtime-schemas';
import { CodegenSession, CodegenStep, GenerationEventMetadata, CodegenAssertion } from './types';

/**
 * Phase 3C + GC-1A: Pure GenerationContext Builder
 *
 * Derives a pristine GenerationContextV1 from an internal CodegenSession
 * and lightweight event metadata.
 *
 * Does NOT query the DB, load HTML snapshots, or interact with heavy services.
 * Purely deterministic transformation.
 *
 * GC-1A additions:
 *   - Classifies broad no_change container clicks → ignoredSteps
 *   - Emits generationGuidance with typed LLM rules
 */
export function deriveGenerationContext(input: {
  session: CodegenSession;
  eventsById: Map<string, GenerationEventMetadata>;
}): GenerationContextV1 {
  const { session, eventsById } = input;

  // Handle recordedAt safely
  let recordedAt = Date.now();
  if (typeof session.recordedAt === 'number') {
    recordedAt = session.recordedAt;
  } else if (typeof session.recordedAt === 'string') {
    const parsed = Date.parse(session.recordedAt);
    if (!isNaN(parsed)) {
      recordedAt = parsed;
    }
  }

  const replaySteps: GenerationStepV1[] = [];
  const ignoredSteps: IgnoredGenerationStepV1[] = [];

  session.steps.forEach((step, index) => {
    const metadata = step.eventId ? eventsById.get(step.eventId) : undefined;
    const selectorResolution = metadata?.selectorResolution;
    const nextStep = session.steps[index + 1];

    const isTargetNeeded = actionNeedsTarget(step.action, step);

    let locatorStatus: GenerationStepV1['locatorStatus'] = 'not_applicable';
    let resolvedTarget: GenerationStepV1['resolvedTarget'] = undefined;
    let fallbackHints: GenerationStepV1['fallbackHints'] = undefined;

    if (isTargetNeeded) {
      if (
        selectorResolution &&
        selectorResolution.status === 'resolved' &&
        selectorResolution.selected &&
        selectorResolution.selected.replaySafe === true &&
        typeof selectorResolution.selected.selector === 'string' &&
        selectorResolution.selected.selector.trim().length > 0 &&
        (selectorResolution.selected.engine === 'css' || selectorResolution.selected.engine === 'xpath')
      ) {
        locatorStatus = 'resolved';
        resolvedTarget = {
          kind: selectorResolution.selected.engine,
          value: selectorResolution.selected.selector,
          source: 'selectorResolution',
          replaySafe: true,
        };
      } else {
        locatorStatus = 'unresolved';

        // Build fallback hints
        const legacySelector = metadata?.fallbackHints?.legacySelector ?? step.selector;
        const elementText = metadata?.fallbackHints?.elementText ?? step.fingerprint?.textExcerpt;
        const tagName = metadata?.fallbackHints?.tagName ?? step.fingerprint?.tagName;

        const hints: NonNullable<GenerationStepV1['fallbackHints']> = {};
        if (legacySelector) hints.legacySelector = legacySelector;
        if (elementText) hints.elementText = elementText;
        if (tagName) hints.tagName = tagName;

        if (Object.keys(hints).length > 0) {
          fallbackHints = hints;
        }
      }
    }

    const assertions: GenerationAssertion[] = (step.assertions || [])
      .filter((assertion) => !shouldDropConflictingOutcomeUrlAssertion(assertion, nextStep))
      .map(mapAssertion);

    const mappedStep: GenerationStepV1 = {
      stepIndex: step.step,
      eventId: step.eventId,
      traceId: step.traceId,
      action: step.action,
      intent: step.intent,
      value: step.value,
      locatorStatus,
      resolvedTarget,
      fallbackHints,
      selectorResolution,
      assertions,
      pageUrl: step.pageUrl,
      normalizedUrl: step.normalizedUrl,
      outcomeType: step.outcomeType,
      confidence: step.confidence,
    };

    const cleanStep = stripUndefined(mappedStep) as GenerationStepV1;

    // GC-1A: Classify whether this step should move to ignoredSteps
    const noiseClassification = classifyNoiseStep(step, cleanStep);

    if (noiseClassification !== null) {
      const ignoredStep: IgnoredGenerationStepV1 = {
        ...cleanStep,
        ignoredReason: noiseClassification.reason,
        ignoredExplanation: noiseClassification.explanation,
      };
      ignoredSteps.push(ignoredStep);
    } else {
      replaySteps.push(cleanStep);
    }
  });
  const context: GenerationContextV1 = {
    schemaVersion: 'air:generation-context:v1',
    sessionId: session.sessionId,
    url: session.url,
    recordedAt,
    steps: replaySteps,
    ignoredSteps,
    generationGuidance: buildGenerationGuidance(),
    metadata: {
      generatedAt: Date.now(),
      source: 'air-db',
    },
  };

  return GenerationContextSchemaV1.parse(context);
}

// ─────────────────────────────────────────────────────────────────────────────
// GC-1A: NOISE STEP CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

interface NoiseClassification {
  reason: IgnoredStepReasonV1;
  explanation: string;
}

/**
 * Determines whether a mapped step should be moved to ignoredSteps.
 *
 * Returns null if the step is replay-safe and must stay in steps.
 * Returns a NoiseClassification if the step should be ignored.
 *
 * GC-1A only handles: broad_no_change_container_click
 * GC-2 will add: duplicate_lower_quality_action
 *
 * Safety rules (NEVER ignore these):
 *   - Any action other than 'click'
 *   - Any click with assertions
 *   - Any click with outcomeType !== 'no_change'
 *   - Concrete interactive controls (button, a[href], input, select, role controls)
 *   - custom-control-open / custom-select / custom-menu-select
 *   - input / submit / navigate / scroll actions
 *
 * When uncertain, returns null (keep in steps).
 */
function classifyNoiseStep(
  rawStep: CodegenStep,
  mappedStep: GenerationStepV1,
): NoiseClassification | null {
  // Only 'click' actions can be noise-classified in GC-1A
  if (rawStep.action !== 'click') {
    return null;
  }

  // Steps with assertions must stay in steps — they carry verification data
  if (mappedStep.assertions.length > 0) {
    return null;
  }

  // Only classify no_change outcome — state_refresh and navigation are meaningful
  if (rawStep.outcomeType !== 'no_change') {
    return null;
  }

  // Determine the effective selector for classification
  const effectiveSelector = (
    mappedStep.resolvedTarget?.value ??
    mappedStep.fallbackHints?.legacySelector ??
    rawStep.selector ??
    ''
  ).trim();

  if (!effectiveSelector) {
    return null;
  }

  // Concrete controls must never be ignored
  if (looksLikeConcreteControl(effectiveSelector)) {
    return null;
  }

  // Broad container check — the only GC-1A classification
  if (isBroadContainerSelector(effectiveSelector)) {
    return {
      reason: 'broad_no_change_container_click',
      explanation: `Click on broad container selector "${effectiveSelector}" with no_change outcome and no assertions. Not recommended for replay.`,
    };
  }

  return null;
}

/**
 * Returns true if the selector targets an element that looks like a concrete
 * interactive control — these must never be moved to ignoredSteps.
 *
 * Checks (CSS-based, order matters):
 *   1. tag-based: button, a, input, select, textarea
 *   2. attribute-based: [href], [role="button"], [role="menuitem"], [role="option"],
 *      [role="tab"], [role="link"], [role="checkbox"], [role="radio"]
 *   3. ID-based: #anything (IDs almost always target concrete elements)
 *   4. action-text-based: :has-text patterns on tags
 *   5. type attribute selectors: [type="submit"], [type="button"]
 */
function looksLikeConcreteControl(selector: string): boolean {
  const s = selector.trim().toLowerCase();

  // Concrete HTML tags
  if (/^(button|a|input|select|textarea)[\s,\[.:#>~+]/.test(s)) return true;
  if (/^(button|a|input|select|textarea)$/.test(s)) return true;

  // Interactive role attributes
  if (/\[role=["'](button|menuitem|option|tab|link|checkbox|radio|switch|menuitemcheckbox|menuitemradio)["']/.test(s)) return true;

  // ID selectors — IDs reliably point to concrete elements
  if (s.startsWith('#')) return true;

  // href attribute — only links have these
  if (/\[href/.test(s)) return true;

  // Type attribute for form controls
  if (/\[type=["'](submit|button|reset|checkbox|radio)["']/.test(s)) return true;

  // :has-text() on a concrete tag
  if (/^(button|a|input|select|textarea|span|label)[^{]*:has-text\(/.test(s)) return true;

  // data-testid selectors — these are always deliberate
  if (/\[data-testid/.test(s) || /\[data-cy/.test(s) || /\[data-qa/.test(s)) return true;

  return false;
}

/**
 * Returns true if the selector looks like a broad layout/container element
 * with no interactive semantics.
 *
 * Uses a conservative token list. Generic layout tokens indicate a
 * broad container, not a concrete control.
 *
 * Rules:
 *   - Checks class names and element names for layout tokens, including hyphenated names
 *   - Does NOT hardcode any app names or app-specific class names
 *   - If uncertain, returns false (keep in steps is the safe default)
 */
function isBroadContainerSelector(selector: string): boolean {
  // Extract all word-boundary tokens (class names, tag names, identifiers)
  // Split each token by '-' to handle hyphenated names like 'background-container'
  const tokenPattern = /[\w-]+/g;
  const rawTokens = (selector.match(tokenPattern) ?? []).map((t) => t.toLowerCase());

  if (rawTokens.length === 0) return false;

  // Expand hyphenated and underscored tokens into their sub-components
  // e.g. 'background-container' → ['background', 'container']
  const tokens = rawTokens.flatMap((t) => t.split(/[-_]/));

  // Broad layout container tokens — app-agnostic
  // These are conservative: only add tokens that reliably indicate a
  // non-interactive layout wrapper across many apps.
  const BROAD_CONTAINER_TOKENS = new Set([
    'container',
    'background',
    'wrapper',
    'layout',
    'content',
    'main',
    'section',
    'page',
    'panel',
    'overlay',
    'backdrop',
    'scaffold',
    'shell',
    'frame',
    'region',
    'area',
    'body',
    'surface',
    'canvas',
  ]);

  // Check if any sub-token in the selector is a broad container token
  const hasBroadToken = tokens.some((token) => BROAD_CONTAINER_TOKENS.has(token));

  if (!hasBroadToken) return false;

  // Double-check: even with a broad token, if the selector has a concrete
  // sub-part, treat it as a concrete target (e.g. .container button)
  // The presence of whitespace (descendant combinator) or > means it's scoped
  if (/[\s>~+]/.test(selector.trim())) return false;

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GC-1B: GENERATION GUIDANCE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a static, typed GenerationGuidanceV1 payload.
 *
 * These rules are emitted into every GenerationContext so the IDE LLM
 * has explicit directives without needing a perfect user prompt.
 *
 * Rules are ordered by priority:
 *   1. Fundamental replay rules
 *   2. ignoredSteps policy
 *   3. Locator strategy
 *   4. Assertions and values
 *   5. Framework style
 */
function buildGenerationGuidance(): GenerationGuidanceV1 {
  return {
    replaySource: 'steps',
    ignoredStepsPolicy: 'context_only',
    rules: [
      'Generate replay code only from steps, in order.',
      'Do not generate code from ignoredSteps by default.',
      'Use ignoredSteps only for context, diagnostics, or fallback explanation.',
      'Do not skip or reorder steps unless the user explicitly instructs it.',
      'Preserve custom-control-open steps; they are required for dropdown and menu visibility before selection.',
      'Use resolvedTarget.value as the locator when locatorStatus is "resolved".',
      'Use fallbackHints.legacySelector only when locatorStatus is "unresolved".',
      'Do not invent or guess selectors.',
      'Replace <LLM_GENERATE_MOCK_DATA> with safe mock data or environment-backed test data.',
      'Generate code in the current repository\'s test framework style.',
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shallow-strips undefined fields from a plain object.
 * Keeps null values intact — null is semantically meaningful in some fields.
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };
  for (const key of Object.keys(result) as Array<keyof T>) {
    if (result[key] === undefined) {
      delete result[key];
    }
  }
  return result;
}

/**
 * Determines whether an action inherently needs a targeted element locator.
 */
function actionNeedsTarget(action: string, step?: CodegenStep): boolean {
  if (['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select', 'hover'].includes(action)) {
    return true;
  }
  if (action === 'scroll') {
    return !!step?.selector;
  }
  if (action === 'navigate') {
    return false;
  }
  // Default to true for any unknown/future actions to avoid hiding unresolved target problems
  return true;
}

/**
 * Maps internal assertions to the public generation contract shape.
 */
function mapAssertion(assertion: CodegenAssertion): GenerationAssertion {
  let type: GenerationAssertion['type'] = 'custom';
  if (['url', 'element_visible', 'element_text', 'title', 'custom'].includes(assertion.type)) {
    type = assertion.type as GenerationAssertion['type'];
  }

  let source: GenerationAssertion['source'] = undefined;
  if (assertion.source) {
    if (['url', 'url_change', 'navigation', 'outcome'].includes(assertion.source)) {
      source = 'outcome';
    } else if (assertion.source === 'anchor') {
      source = 'anchor';
    } else if (assertion.source === 'user_defined') {
      source = 'user_defined';
    } else {
      source = 'anchor'; // Safe default per requirements
    }
  }

  const mapped: GenerationAssertion = {
    type,
    value: assertion.value,
    selector: assertion.selector,
    confidence: assertion.confidence,
    source,
  };

  return stripUndefined(mapped as unknown as Record<string, unknown>) as GenerationAssertion;
}

function shouldDropConflictingOutcomeUrlAssertion(
  assertion: CodegenAssertion,
  nextStep?: Pick<CodegenStep, 'pageUrl' | 'normalizedUrl'>,
): boolean {
  if (assertion.type !== 'url') return false;
  // Bug fix: URL assertions from parseAnchorsToAssertions use 'url_change' or 'navigation'
  if (assertion.source && !['outcome', 'url_change', 'navigation'].includes(assertion.source)) return false;
  if (!nextStep) return false;

  const nextPageUrl = typeof nextStep.pageUrl === 'string' ? nextStep.pageUrl : '';
  const nextNormalizedUrl = typeof nextStep.normalizedUrl === 'string' ? nextStep.normalizedUrl : '';
  if (!nextPageUrl && !nextNormalizedUrl) return false;

  return urlsClearlyConflict(assertion.value, nextPageUrl, nextNormalizedUrl);
}

function urlsClearlyConflict(
  assertionUrl: string,
  nextPageUrl?: string,
  nextNormalizedUrl?: string,
): boolean {
  const assertionTrimmed = assertionUrl.trim();
  const nextPageTrimmed = (nextPageUrl ?? '').trim();
  const nextNormalizedTrimmed = (nextNormalizedUrl ?? '').trim();

  if (!assertionTrimmed || (!nextPageTrimmed && !nextNormalizedTrimmed)) {
    return false;
  }

  if (assertionTrimmed === nextPageTrimmed || assertionTrimmed === nextNormalizedTrimmed) {
    return false;
  }

  const parsedAssertion = tryParseUrl(assertionTrimmed);
  const parsedNextPage = tryParseUrl(nextPageTrimmed);
  const parsedNextNormalized = tryParseUrl(nextNormalizedTrimmed);

  if (parsedAssertion && parsedNextPage && urlsMatch(parsedAssertion, parsedNextPage)) {
    return false;
  }

  if (parsedAssertion && parsedNextNormalized && urlsMatch(parsedAssertion, parsedNextNormalized)) {
    return false;
  }

  if (parsedAssertion && (parsedNextPage || parsedNextNormalized)) {
    const comparableNext = (parsedNextPage ?? parsedNextNormalized)!;
    return !urlsMatch(parsedAssertion, comparableNext);
  }

  return false;
}

function urlsMatch(left: URL, right: URL): boolean {
  if (left.href === right.href) return true;
  if (left.pathname === right.pathname && left.search === right.search) return true;
  return false;
}

function tryParseUrl(value: string): URL | null {
  if (!value) return null;

  try {
    return new URL(value);
  } catch {
    return null;
  }
}
