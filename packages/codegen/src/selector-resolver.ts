import type {
  CodegenSession,
  CodegenStep,
  ResolverMetadata,
  SelectorPriority,
  ResolverSnapshotSource,
} from './types';
import {
  attachAssertionOutcomeSelections,
  type CandidateScore,
  type CandidateValidation,
  type LlmFallbackRequest,
  type LlmFallbackStep,
  type LlmFallbackSuggestion,
  type RawCandidate,
  type ResolveContext,
  type ResolvedResolverConfig,
  type ResolverConfig,
  type SelectorFallbackProvider,
  type SelectorResolution,
  type SelectorResolverResult,
  type SnapshotCache,
  type StepResolutionDraft,
} from './resolver/types';
import {
  cssEscape,
  escapeTextSelectorValue,
  extractStableParentSelector,
  extractTextExcerpt,
  findStableClassFromAttributes,
  getElementTextSignals,
  inferStepSignalAttributes,
  isDynamicText,
  isLikelyCssSelector,
  isTextSelector,
  textFromElement,
} from './resolver/text-matching';
import {
  enrichSignalAttributesFromElement,
  evaluateIntentMatch,
  extractCalendarTextTarget,
  findSeedElements,
  getCalendarScopeSelectors,
  getCandidateElement,
  hasFieldIntent,
  isCalendarContext,
  isLowScoreFallbackCandidateSafe,
  looksDateValue,
  matchesIntent as internalMatchesIntent,
} from './resolver/element-ranking';
import {
  isVisibleElement,
  validateCSSCandidate,
  validateTextCandidate,
} from './resolver/visibility';
import { serializeSnapshotExcerpt } from './resolver/excerpt-builder';

export type {
  CandidateValidation,
  LlmFallbackRequest,
  LlmFallbackStep,
  LlmFallbackSuggestion,
  RawCandidate,
  ResolvedResolverConfig,
  ResolverConfig,
  SelectorFallbackProvider,
  SelectorResolution,
  SelectorResolverResult,
  SnapshotCache,
} from './resolver/types';
export { isVisibleElement, validateCSSCandidate, validateTextCandidate } from './resolver/visibility';

const SELECTOR_RANK_MAP: Record<string, number> = {
  'data-testid': 1,
  id: 2,
  attribute: 3,
  class: 7,
  text: 8,
  path: 10,
  xpath: 10,
  other: 10,
  chained: 10,
  unknown: 10,
};

const RANK_SCORES: Record<number, number> = {
  1: 0.7,
  2: 0.65,
  3: 0.6,
  4: 0.55,
  5: 0.5,
  6: 0.45,
  7: 0.4,
  8: 0.35,
};

const DEFAULT_CONFIG: ResolvedResolverConfig = {
  enableLLMFallback: false,
  resolverMinScore: 0.7,
  intentMinScore: 0.6,
  maxSnapshotBytesForValidation: 2_000_000,
  maxSnapshotExcerptChars: 2000,
  llmTimeoutMs: 20_000,
  llmMaxRetriesPerStep: 2,
};

function resolveConfig(config?: ResolverConfig): ResolvedResolverConfig {
  return {
    enableLLMFallback: config?.enableLLMFallback ?? DEFAULT_CONFIG.enableLLMFallback,
    resolverMinScore: config?.resolverMinScore ?? DEFAULT_CONFIG.resolverMinScore,
    intentMinScore: config?.intentMinScore ?? DEFAULT_CONFIG.intentMinScore,
    maxSnapshotBytesForValidation: config?.maxSnapshotBytesForValidation ?? DEFAULT_CONFIG.maxSnapshotBytesForValidation,
    maxSnapshotExcerptChars: config?.maxSnapshotExcerptChars ?? DEFAULT_CONFIG.maxSnapshotExcerptChars,
    llmTimeoutMs: config?.llmTimeoutMs ?? DEFAULT_CONFIG.llmTimeoutMs,
    maxLLMFallbackPerSession: config?.maxLLMFallbackPerSession,
    llmMaxRetriesPerStep: config?.llmMaxRetriesPerStep ?? DEFAULT_CONFIG.llmMaxRetriesPerStep,
  };
}

function rankScore(rank: number): number {
  return RANK_SCORES[rank] ?? 0.3;
}

function getSelectorRank(
  selector: string,
  selectorPriority?: SelectorPriority,
  selectorRank?: number,
): number {
  if (typeof selectorRank === 'number' && Number.isFinite(selectorRank)) {
    return selectorRank;
  }
  if (selectorPriority) {
    return SELECTOR_RANK_MAP[selectorPriority] ?? 10;
  }
  if (selector.startsWith('[data-testid=')) return 1;
  if (selector.startsWith('#') || selector.startsWith('[id=')) return 2;
  if (selector.includes('[aria-label=') || selector.includes('[name=') || selector.includes('[role=')) {
    return 3;
  }
  if (selector.startsWith('.')) return 7;
  if (selector.startsWith('text=') || selector.includes(':has-text(')) return 8;
  if (selector.startsWith('//') || selector.startsWith('id("')) return 10;
  return 10;
}

function validateCandidate(selector: string, snapshot: Document, step?: CodegenStep): CandidateValidation {
  return isTextSelector(selector)
    ? validateTextCandidate(selector, snapshot, step)
    : validateCSSCandidate(selector, snapshot, step);
}

function hasStrongAttributeSignal(selector: string): boolean {
  const patterns = [
    /\[data-testid=(?:"[^"]+"|'[^']+')\]/i,
    /\[id=(?:"[^"]+"|'[^']+')\]/i,
    /\[name=(?:"[^"]+"|'[^']+')\]/i,
    /\[aria-label=(?:"[^"]+"|'[^']+')\]/i,
    /\[placeholder=(?:"[^"]+"|'[^']+')\]/i,
    /\[type=(?:"submit"|'submit')\]/i,
    /\[href=(?:"[^"]+"|'[^']+')\]/i,
    /\[role=(?:"[^"]+"|'[^']+')\]/i,
  ];
  return patterns.some(pattern => pattern.test(selector));
}

function normalizeSelectorForShellCheck(selector?: string | null): string {
  return (selector || '').trim().toLowerCase();
}

function isKnownShellSelector(selector?: string | null): boolean {
  const normalized = normalizeSelectorForShellCheck(selector);
  if (!normalized) return false;
  if (normalized === 'html' || normalized === 'body' || normalized === '#app' || normalized === '[id="app"]') {
    return true;
  }
  if (/(?:layout|shell|container|wrapper)/i.test(normalized) && !/(?:button|input|textarea|select|a\[|\[role=)/i.test(normalized)) {
    return true;
  }
  return false;
}

function shouldBlockGenericShellOverride(originalSelector?: string | null, candidateSelector?: string | null): boolean {
  if (!candidateSelector || candidateSelector === originalSelector) return false;
  return isKnownShellSelector(candidateSelector);
}

function shouldTrustOriginalOnSnapshotMiss(
  step: CodegenStep,
  originalValidation: CandidateValidation,
): boolean {
  const selector = step.selector || '';
  if (!selector) return false;
  if (!isLikelyCssSelector(selector)) return false;
  if (isKnownShellSelector(selector)) return false;
  if (originalValidation.effectiveMatchCount !== 0) return false;
  if (isTextSelector(selector)) return false;

  const strongPriority = step.selectorPriority === 'data-testid' || step.selectorPriority === 'id';
  const strongSignal = strongPriority || hasStrongAttributeSignal(selector) || selector.startsWith('#');
  if (!strongSignal) return false;

  const normalized = selector.toLowerCase();
  if (step.action === 'input') {
    return normalized.startsWith('input') ||
      normalized.startsWith('textarea') ||
      normalized.startsWith('select') ||
      /\[(?:name|id|placeholder)=/i.test(selector);
  }

  if (step.action === 'submit') {
    return normalized.startsWith('button') ||
      normalized.startsWith('input') ||
      /\[type=(?:"submit"|'submit')\]/i.test(selector);
  }

  if (step.action === 'click' || step.action === 'custom-select' || step.action === 'hover') {
    return true;
  }

  return false;
}

export function shouldKeepOriginal(step: CodegenStep, snapshot: Document, config: ResolverConfig): boolean {
  if (!step.selector) return false;
  const validation = validateCandidate(step.selector, snapshot, step);
  if (validation.reason !== 'unique-visible') return false;
  const rank = getSelectorRank(step.selector, step.selectorPriority, step.selectorRank);
  const score = rankScore(rank) + 0.3;
  const minScore = config.resolverMinScore ?? DEFAULT_CONFIG.resolverMinScore;
  const effectiveMinScore = isTextSelector(step.selector)
    ? Math.min(minScore, 0.65)
    : minScore;
  return (score + 1e-9) >= effectiveMinScore;
}

export function matchesIntent(
  el: Element,
  intent: string | CodegenStep,
  defaultIntentMinScore = DEFAULT_CONFIG.intentMinScore,
): boolean {
  return internalMatchesIntent(el, intent, defaultIntentMinScore);
}

function pushCandidate(
  candidates: RawCandidate[],
  seen: Set<string>,
  selector: string | null | undefined,
  source: RawCandidate['source'],
  rank: number,
): void {
  const normalized = (selector || '').trim();
  if (!normalized) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push({ selector: normalized, source, rank });
}

export function generateCandidates(step: CodegenStep, snapshot: Document): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  const seen = new Set<string>();
  const attrs = inferStepSignalAttributes(step);
  const seedElements = findSeedElements(step, snapshot);
  let textExcerpt = extractTextExcerpt(step);

  pushCandidate(
    candidates,
    seen,
    step.selector,
    'original',
    getSelectorRank(step.selector, step.selectorPriority, step.selectorRank),
  );

  for (const seedElement of seedElements) {
    enrichSignalAttributesFromElement(attrs, seedElement);
    if (!textExcerpt) {
      const extracted = textFromElement(seedElement);
      if (extracted) textExcerpt = extracted;
    }
  }

  const tagName = attrs.tagName || step.fingerprint?.tagName?.toLowerCase();

  if (attrs.dataTestId) {
    pushCandidate(candidates, seen, `[data-testid="${cssEscape(attrs.dataTestId)}"]`, 'testid', 1);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[data-testid="${cssEscape(attrs.dataTestId)}"]`, 'testid', 1);
    }
  }

  if (attrs.id) {
    pushCandidate(candidates, seen, `#${cssEscape(attrs.id)}`, 'id', 2);
    pushCandidate(candidates, seen, `[id="${cssEscape(attrs.id)}"]`, 'id', 2);
  }

  if (attrs.name) {
    pushCandidate(candidates, seen, `[name="${cssEscape(attrs.name)}"]`, 'name', 3);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[name="${cssEscape(attrs.name)}"]`, 'name', 3);
    }
  }

  if (attrs.ariaLabel) {
    pushCandidate(candidates, seen, `[aria-label="${cssEscape(attrs.ariaLabel)}"]`, 'aria', 3);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[aria-label="${cssEscape(attrs.ariaLabel)}"]`, 'aria', 3);
    }
  }

  if (attrs.placeholder) {
    pushCandidate(candidates, seen, `[placeholder="${cssEscape(attrs.placeholder)}"]`, 'placeholder', 4);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[placeholder="${cssEscape(attrs.placeholder)}"]`, 'placeholder', 4);
    }
    if (/yyyy/i.test(attrs.placeholder)) {
      pushCandidate(candidates, seen, 'input[placeholder*="yyyy"]', 'placeholder', 4);
    }
  }

  if (attrs.role) {
    pushCandidate(candidates, seen, `[role="${cssEscape(attrs.role)}"]`, 'role+name', 3);
  }

  const stableClass = findStableClassFromAttributes(attrs.class);
  if (stableClass) {
    pushCandidate(candidates, seen, `.${stableClass}`, 'class', 7);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}.${stableClass}`, 'class', 7);
    }
  }

  const calendarMode = isCalendarContext(step, snapshot, attrs, seedElements);
  const allowNumericText = calendarMode || !!extractCalendarTextTarget(step, textExcerpt);
  const stableText = textExcerpt?.trim() || '';
  if (stableText && !isDynamicText(stableText, { allowNumericText })) {
    const escapedText = escapeTextSelectorValue(stableText.toLowerCase());
    pushCandidate(candidates, seen, `text=${escapedText}`, 'text', 8);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}:has-text("${escapeTextSelectorValue(stableText)}")`, 'text', 8);
    }
    if (attrs.role) {
      pushCandidate(candidates, seen, `[role="${cssEscape(attrs.role)}"]:has-text("${escapeTextSelectorValue(stableText)}")`, 'role+name', 4);
    }
  }

  const parentSelector = extractStableParentSelector(step, attrs);
  const scopedBase = parentSelector && isLikelyCssSelector(parentSelector)
    ? parentSelector
    : attrs.parentSelector;
  if (scopedBase && isLikelyCssSelector(scopedBase)) {
    if (attrs.dataTestId) pushCandidate(candidates, seen, `${scopedBase} [data-testid="${cssEscape(attrs.dataTestId)}"]`, 'parent-scope', 2);
    if (attrs.id) pushCandidate(candidates, seen, `${scopedBase} #${cssEscape(attrs.id)}`, 'parent-scope', 2);
    if (attrs.name) pushCandidate(candidates, seen, `${scopedBase} [name="${cssEscape(attrs.name)}"]`, 'parent-scope', 4);
    if (attrs.ariaLabel) pushCandidate(candidates, seen, `${scopedBase} [aria-label="${cssEscape(attrs.ariaLabel)}"]`, 'parent-scope', 4);
    if (tagName) pushCandidate(candidates, seen, `${scopedBase} ${tagName}`, 'parent-scope', 6);
    if (step.selector && isLikelyCssSelector(step.selector)) {
      pushCandidate(candidates, seen, `${scopedBase} ${step.selector}`, 'parent-scope', Math.min(getSelectorRank(step.selector, step.selectorPriority, step.selectorRank), 6));
    }
  }

  if (calendarMode) {
    const calendarScopes = getCalendarScopeSelectors(step, attrs);
    for (const scope of calendarScopes) {
      if (step.selector && isLikelyCssSelector(step.selector)) {
        pushCandidate(candidates, seen, `${scope} ${step.selector}`, 'parent-scope', 5);
      }
      if (tagName) {
        pushCandidate(candidates, seen, `${scope} ${tagName}`, 'parent-scope', 5);
      }
      if (step.action === 'input') {
        pushCandidate(candidates, seen, `${scope} input`, 'parent-scope', 4);
        if (attrs.class) {
          const classToken = attrs.class.split(/\s+/).find(Boolean);
          if (classToken) pushCandidate(candidates, seen, `${scope} .${cssEscape(classToken)}`, 'parent-scope', 5);
        }
      }
    }

    const calendarText = extractCalendarTextTarget(step, textExcerpt);
    if (calendarText) {
      for (const scope of calendarScopes) {
        if (tagName) {
          pushCandidate(candidates, seen, `${scope} ${tagName}:has-text("${escapeTextSelectorValue(calendarText)}")`, 'parent-scope', 4);
        }
        if (attrs.role) {
          pushCandidate(candidates, seen, `${scope} [role="${cssEscape(attrs.role)}"]:has-text("${escapeTextSelectorValue(calendarText)}")`, 'parent-scope', 4);
        }
        if (step.selector && isLikelyCssSelector(step.selector)) {
          pushCandidate(candidates, seen, `${scope} ${step.selector}:has-text("${escapeTextSelectorValue(calendarText)}")`, 'parent-scope', 4);
        }
      }
      if (tagName) {
        pushCandidate(candidates, seen, `${tagName}:has-text("${escapeTextSelectorValue(calendarText)}")`, 'text', 8);
      }
    }
  }

  return candidates.slice(0, 20);
}

export function complexityPenalty(selector: string): number {
  const descendantPenalty = Math.max(0, (selector.match(/\s+/g)?.length ?? 0) * 0.03);
  const childPenalty = Math.max(0, (selector.match(/>/g)?.length ?? 0) * 0.05);
  const pseudoPenalty = Math.max(0, (selector.match(/:has-text\(/g)?.length ?? 0) * 0.04);
  return descendantPenalty + childPenalty + pseudoPenalty;
}

export function volatilityPenalty(selector: string): number {
  let penalty = 0;
  if (/nth-child|nth-of-type/i.test(selector)) penalty += 0.2;
  if (/\.(?:css-|sc-|Mui|ant-|chakra-)/.test(selector)) penalty += 0.12;
  if (/\d{4,}/.test(selector)) penalty += 0.1;
  return penalty;
}

export function scoreCandidate(
  candidate: RawCandidate,
  validation: CandidateValidation,
  step: CodegenStep,
): number {
  let score = rankScore(candidate.rank);
  if (validation.effectiveMatchCount === 1) score += 0.3;

  const excerpt = (extractTextExcerpt(step) || '').toLowerCase();
  if (excerpt && candidate.selector.toLowerCase().includes(excerpt)) score += 0.08;

  const tagName = step.fingerprint?.tagName?.toLowerCase();
  if (tagName && candidate.selector.toLowerCase().startsWith(tagName)) score += 0.06;
  if (candidate.source === 'parent-scope') score += 0.04;
  if (candidate.source === 'text') score += 0.02;

  score += (validation.confidenceScore ?? 0) * 0.25;
  score -= complexityPenalty(candidate.selector);
  score -= volatilityPenalty(candidate.selector);

  if (validation.reason === 'resolved-multi-match') score -= 0.08;
  if (validation.reason === 'too-broad') score -= 0.12;
  if (validation.ambiguityReason) score -= 0.22;

  return Math.max(0, Math.min(1.5, score));
}

function compareCandidates(left: CandidateScore, right: CandidateScore): number {
  if (right.score !== left.score) return right.score - left.score;
  if (right.validation.effectiveMatchCount !== left.validation.effectiveMatchCount) {
    return right.validation.effectiveMatchCount - left.validation.effectiveMatchCount;
  }
  if ((right.validation.confidenceScore ?? 0) !== (left.validation.confidenceScore ?? 0)) {
    return (right.validation.confidenceScore ?? 0) - (left.validation.confidenceScore ?? 0);
  }
  return left.candidate.rank - right.candidate.rank;
}

function deriveDeterministicResolution(
  step: CodegenStep,
  snapshot: Document | null,
  config: ResolvedResolverConfig,
  ctx: ResolveContext,
  snapshotSource?: ResolverSnapshotSource,
  snapshotSelection?: ResolverMetadata['snapshotSelection'],
  evaluatedCandidates?: ResolverMetadata['evaluatedCandidates'],
): StepResolutionDraft {
  const baseMetadata: ResolverMetadata = {
    resolvedSelector: step.selector,
    resolvedBy: 'unresolved',
    bestScore: 0,
    effectiveMatchCount: 0,
    snapshotSource: snapshotSource ?? (snapshot ? 'latest' : 'unavailable'),
    validationMethod: 'css-query-static-visibility-element-ranking-v1',
    llmAttempted: false,
    llmAccepted: false,
    llmAlternative: null,
    rejectReason: null,
    warningCodes: [],
    resolverVersion: 1,
    temporalClass: snapshotSelection?.temporalClass,
    selectionReason: snapshotSelection?.reason ?? null,
    snapshotSelection,
    evaluatedCandidates,
  };

  if (!snapshot) {
    baseMetadata.warningCodes.push('snapshot-unavailable');
    if (!ctx.snapshotEngineAvailable) {
      baseMetadata.warningCodes.push('snapshot-engine-unavailable');
    }
    return {
      step,
      snapshot: null,
      resolvedSelector: step.selector,
      metadata: baseMetadata,
      llmEligible: false,
    };
  }

  if (!step.selector) {
    baseMetadata.warningCodes.push('missing-original-selector');
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: baseMetadata,
      llmEligible: false,
    };
  }

  const originalValidation = validateCandidate(step.selector, snapshot, step);
  if (shouldTrustOriginalOnSnapshotMiss(step, originalValidation)) {
    const rank = getSelectorRank(step.selector, step.selectorPriority, step.selectorRank);
    const score = Math.max(rankScore(rank), 0.65);
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: {
        ...baseMetadata,
        resolvedSelector: step.selector,
        resolvedBy: 'kept-original',
        bestScore: score,
        effectiveMatchCount: originalValidation.effectiveMatchCount,
        matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
        confidenceScore: originalValidation.confidenceScore ?? score,
        ambiguityReason: originalValidation.ambiguityReason ?? null,
        warningCodes: [...baseMetadata.warningCodes, 'trusted-original-snapshot-miss'],
      },
      llmEligible: false,
    };
  }

  if (shouldKeepOriginal(step, snapshot, config)) {
    const rank = getSelectorRank(step.selector, step.selectorPriority, step.selectorRank);
    const score = rankScore(rank) + 0.3;
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: {
        ...baseMetadata,
        resolvedSelector: step.selector,
        resolvedBy: 'kept-original',
        bestScore: score,
        effectiveMatchCount: originalValidation.effectiveMatchCount,
        matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
        confidenceScore: originalValidation.confidenceScore ?? score,
        ambiguityReason: originalValidation.ambiguityReason ?? null,
      },
      llmEligible: false,
    };
  }

  const candidateScores: CandidateScore[] = generateCandidates(step, snapshot).map(candidate => {
    const validation = validateCandidate(candidate.selector, snapshot, step);
    return {
      candidate,
      validation,
      score: scoreCandidate(candidate, validation, step),
    };
  });

  const uniqueCandidates = candidateScores
    .filter(candidate => candidate.validation.effectiveMatchCount === 1)
    .sort(compareCandidates);

  const highScoreCandidates = uniqueCandidates
    .filter(candidate => candidate.score >= config.resolverMinScore);

  const winner = highScoreCandidates[0];

  const lowScoreFallbackCandidates = uniqueCandidates.filter(candidate =>
    candidate.candidate.selector !== step.selector &&
    !shouldBlockGenericShellOverride(step.selector, candidate.candidate.selector),
  );

  const lowScoreFallback = lowScoreFallbackCandidates.find(candidate =>
    isLowScoreFallbackCandidateSafe(step, snapshot, candidate, config),
  );

  const hadRejectedLowScoreFallback = lowScoreFallbackCandidates.length > 0 && !lowScoreFallback;

  if (winner && shouldBlockGenericShellOverride(step.selector, winner.candidate.selector)) {
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: {
        ...baseMetadata,
        resolvedSelector: step.selector,
        effectiveMatchCount: originalValidation.effectiveMatchCount,
        matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
        confidenceScore: originalValidation.confidenceScore ?? 0,
        ambiguityReason: originalValidation.ambiguityReason ?? null,
        warningCodes: [...baseMetadata.warningCodes, 'blocked-generic-shell-override'],
      },
      llmEligible: true,
      lowScoreFallback,
    };
  }

  if (!winner) {
    if (uniqueCandidates.length === 0) {
      baseMetadata.warningCodes.push('no-unique-candidate');
    } else {
      baseMetadata.warningCodes.push('deterministic-below-threshold');
      if (lowScoreFallback) {
        baseMetadata.warningCodes.push('deterministic-low-score-available');
      } else if (hadRejectedLowScoreFallback) {
        baseMetadata.warningCodes.push('deterministic-low-score-rejected');
      }
    }
    if (originalValidation.reason === 'invalid-selector') {
      baseMetadata.warningCodes.push('invalid-original-selector');
    }
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: {
        ...baseMetadata,
        effectiveMatchCount: originalValidation.effectiveMatchCount,
        matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
        confidenceScore: originalValidation.confidenceScore ?? 0,
        ambiguityReason: originalValidation.ambiguityReason ?? null,
      },
      llmEligible: true,
      lowScoreFallback,
    };
  }

  const resolvedBy = winner.candidate.selector === step.selector
    ? 'kept-original'
    : 'deterministic-override';

  return {
    step,
    snapshot,
    resolvedSelector: winner.candidate.selector,
    metadata: {
      ...baseMetadata,
      resolvedSelector: winner.candidate.selector,
      resolvedBy,
      bestScore: winner.score,
      effectiveMatchCount: winner.validation.effectiveMatchCount,
      matchCount: winner.validation.matchCount ?? winner.validation.visibleMatchCount,
      confidenceScore: winner.validation.confidenceScore ?? winner.score,
      ambiguityReason: winner.validation.ambiguityReason ?? null,
      warningCodes: winner.candidate.selector === step.selector
        ? baseMetadata.warningCodes
        : [
          ...baseMetadata.warningCodes,
          'deterministic-override',
          ...(winner.validation.ambiguityReason ? ['deterministic-dom-order-tiebreaker'] : []),
        ],
    },
    llmEligible: false,
  };
}

function buildLlmCap(totalSteps: number, config: ResolvedResolverConfig): number {
  if (typeof config.maxLLMFallbackPerSession === 'number') {
    return Math.max(0, config.maxLLMFallbackPerSession);
  }
  return Math.max(2, Math.min(5, Math.ceil(totalSteps * 0.3)));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Selector fallback timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function normalizeSuggestedSelector(selector?: string | null): string | null {
  if (typeof selector !== 'string') return null;
  const normalized = selector.trim();
  return normalized.length > 0 ? normalized : null;
}

function dedupeSelectors(selectors: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const selector of selectors) {
    const normalized = normalizeSuggestedSelector(selector);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function selectorsFromSuggestion(suggestion: LlmFallbackSuggestion): string[] {
  const selectors = [suggestion.selector, ...(Array.isArray(suggestion.selectors) ? suggestion.selectors : [])];
  return dedupeSelectors(selectors);
}

function pushWarningCode(metadata: ResolverMetadata, code: string): void {
  if (!metadata.warningCodes.includes(code)) {
    metadata.warningCodes.push(code);
  }
}

function applyLowScoreFallback(draft: StepResolutionDraft): void {
  if (!draft.lowScoreFallback) return;
  draft.resolvedSelector = draft.lowScoreFallback.candidate.selector;
  draft.metadata = {
    ...draft.metadata,
    resolvedSelector: draft.lowScoreFallback.candidate.selector,
    resolvedBy: 'deterministic-override',
    bestScore: draft.lowScoreFallback.score,
    effectiveMatchCount: draft.lowScoreFallback.validation.effectiveMatchCount,
    matchCount: draft.lowScoreFallback.validation.matchCount ?? draft.lowScoreFallback.validation.visibleMatchCount,
    confidenceScore: draft.lowScoreFallback.validation.confidenceScore ?? draft.lowScoreFallback.score,
    ambiguityReason: draft.lowScoreFallback.validation.ambiguityReason ?? null,
    llmAccepted: false,
  };
  pushWarningCode(draft.metadata, 'deterministic-low-score-fallback');
}

export async function resolveSelectorsForSession(
  session: CodegenSession,
  snapshotCache: SnapshotCache,
  config?: ResolverConfig,
  llmFallbackProvider?: SelectorFallbackProvider,
): Promise<SelectorResolverResult> {
  const resolvedConfig = resolveConfig(config);
  const snapshotEngineAvailable = snapshotCache.snapshotEngineAvailable ?? true;

  attachAssertionOutcomeSelections(session, snapshotCache);

  const drafts = session.steps.map(step => {
    let snapshot: Document | null = null;
    let snapshotSource: ResolverSnapshotSource | undefined;
    let snapshotSelection: ResolverMetadata['snapshotSelection'];
    let evaluatedCandidates: ResolverMetadata['evaluatedCandidates'];

    try {
      if (snapshotCache.selectForStep) {
        const selection = snapshotCache.selectForStep(step, 'action');
        snapshot = selection.snapshot;
        snapshotSource = selection.provenance.source;
        snapshotSelection = selection.provenance;
        evaluatedCandidates = selection.evaluatedCandidates;
      }
    } catch {
      snapshot = null;
    }

    if (!snapshotSelection) {
      const nodeId = step.sourceNodeId ?? '';
      snapshot = snapshot ?? snapshotCache.get(nodeId, step.normalizedUrl, step.controlSignature);
      snapshotSource = snapshotCache.getSource
        ? snapshotCache.getSource(nodeId, step.normalizedUrl, step.controlSignature)
        : (snapshot ? 'latest' : 'unavailable');
      snapshotSelection = {
        source: snapshotSource,
        temporalClass: 'unknown',
        reason: snapshot ? 'legacy_snapshot_cache_selection' : 'legacy_snapshot_cache_unavailable',
        eventId: step.eventId,
        sourceNodeId: step.sourceNodeId,
        confidenceScore: snapshot ? 0.5 : 0,
      };
      evaluatedCandidates = [
        {
          source: snapshotSource,
          temporalClass: 'unknown',
          selected: !!snapshot,
          reason: snapshot ? 'legacy_snapshot_cache_selection' : undefined,
          skipReason: snapshot ? undefined : 'snapshot-unavailable',
          eventId: step.eventId,
          sourceNodeId: step.sourceNodeId,
          confidenceScore: snapshot ? 0.5 : 0,
        },
      ];
    }

    return deriveDeterministicResolution(
      step,
      snapshot,
      resolvedConfig,
      { snapshotEngineAvailable },
      snapshotSource,
      snapshotSelection,
      evaluatedCandidates,
    );
  });

  const hasAnySnapshot = drafts.some(draft => draft.snapshot !== null);
  if (!hasAnySnapshot) {
    console.warn('[AIR] No snapshots available for entire session');
  }

  const llmAttemptedStepNumbers: number[] = [];
  const llmAcceptedStepNumbers: number[] = [];
  const llmEnabled = resolvedConfig.enableLLMFallback && typeof llmFallbackProvider === 'function';
  const llmEligible = drafts.filter(draft => draft.llmEligible && !!draft.snapshot);
  const llmCap = buildLlmCap(session.steps.length, resolvedConfig);
  const llmTargets = llmEnabled ? llmEligible.slice(0, llmCap) : [];

  if (llmEnabled && llmEligible.length > llmTargets.length) {
    for (const skipped of llmEligible.slice(llmTargets.length)) {
      pushWarningCode(skipped.metadata, 'llm-circuit-breaker');
    }
  }

  if (llmEnabled && llmTargets.length > 0 && llmFallbackProvider) {
    for (const draft of llmTargets) {
      draft.metadata.llmAttempted = true;
      llmAttemptedStepNumbers.push(draft.step.step);
    }

    const request: LlmFallbackRequest = {
      steps: llmTargets.map(draft => {
        const excerptInfo = serializeSnapshotExcerpt(
          draft.snapshot as Document,
          draft.step,
          resolvedConfig.maxSnapshotExcerptChars,
        );
        draft.metadata = {
          ...draft.metadata,
          excerptBuildTotalMs: excerptInfo.metrics.excerptBuildTotalMs,
          pruneMs: excerptInfo.metrics.pruneMs,
          redactMs: excerptInfo.metrics.redactMs,
          finalExcerptChars: excerptInfo.metrics.finalExcerptChars,
        };
        return {
          stepNumber: draft.step.step,
          intent: draft.step.intent,
          action: draft.step.action,
          originalSelector: draft.step.selector,
          snapshotExcerpt: excerptInfo.excerpt,
          normalizedUrl: draft.step.normalizedUrl,
          snapshotSource: draft.metadata.snapshotSource,
          excerptChars: excerptInfo.metrics.finalExcerptChars,
          excerptMode: excerptInfo.mode,
          selectorPriority: draft.step.selectorPriority,
        } satisfies LlmFallbackStep;
      }),
      config: resolvedConfig,
    };

    try {
      const suggestions = await withTimeout(llmFallbackProvider(request), resolvedConfig.llmTimeoutMs);
      const seenSteps = new Set<number>();

      for (const suggestion of suggestions) {
        if (seenSteps.has(suggestion.stepNumber)) continue;
        seenSteps.add(suggestion.stepNumber);

        const target = llmTargets.find(draft => draft.step.step === suggestion.stepNumber);
        if (!target || !target.snapshot) continue;

        const suggestedSelectors = selectorsFromSuggestion(suggestion);
        if (suggestedSelectors.length === 0) {
          target.metadata.rejectReason = 'invalid-llm-selector';
          pushWarningCode(target.metadata, 'llm-invalid-selector');
          continue;
        }

        const limitedSelectors = suggestedSelectors.slice(0, resolvedConfig.llmMaxRetriesPerStep);
        if (suggestedSelectors.length > limitedSelectors.length) {
          pushWarningCode(target.metadata, 'llm-retry-cap-reached');
        }

        let accepted = false;
        for (const selector of limitedSelectors) {
          target.metadata.llmAlternative = selector;
          const validation = validateCandidate(selector, target.snapshot, target.step);
          if (validation.reason === 'invalid-selector') {
            target.metadata.rejectReason = 'invalid-llm-selector';
            pushWarningCode(target.metadata, 'llm-invalid-selector');
            continue;
          }
          if (validation.effectiveMatchCount !== 1) {
            target.metadata.rejectReason = 'llm-selector-not-unique';
            pushWarningCode(target.metadata, 'llm-non-unique');
            continue;
          }

          const match = getCandidateElement(target.snapshot, selector) ??
            (isLikelyCssSelector(selector) ? target.snapshot.querySelector(selector) : null);
          if (!match || !matchesIntent(match, target.step, resolvedConfig.intentMinScore)) {
            target.metadata.rejectReason = 'llm-intent-mismatch';
            pushWarningCode(target.metadata, 'llm-intent-mismatch');
            continue;
          }

          target.resolvedSelector = selector;
          target.metadata = {
            ...target.metadata,
            resolvedSelector: selector,
            resolvedBy: 'llm-accepted',
            bestScore: Math.max(target.metadata.bestScore, 0.95),
            effectiveMatchCount: validation.effectiveMatchCount,
            matchCount: validation.matchCount ?? validation.visibleMatchCount,
            confidenceScore: validation.confidenceScore ?? 0.95,
            ambiguityReason: validation.ambiguityReason ?? null,
            llmAccepted: true,
            rejectReason: null,
          };
          llmAcceptedStepNumbers.push(target.step.step);
          accepted = true;
          break;
        }

        if (!accepted) {
          if (suggestedSelectors.length > 0) {
            pushWarningCode(target.metadata, 'llm-retries-exhausted');
          }
          if (target.lowScoreFallback) {
            applyLowScoreFallback(target);
          }
        }
      }

      for (const target of llmTargets) {
        if (!target.metadata.llmAccepted && !target.metadata.rejectReason) {
          target.metadata.rejectReason = 'llm-no-valid-suggestion';
          pushWarningCode(target.metadata, 'llm-no-valid-suggestion');
          if (target.lowScoreFallback) {
            applyLowScoreFallback(target);
          }
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const target of llmTargets) {
        target.metadata.rejectReason = reason;
        pushWarningCode(target.metadata, 'llm-error');
        if (target.lowScoreFallback) {
          applyLowScoreFallback(target);
        }
      }
    }
  }

  const resolutions: SelectorResolution[] = drafts.map(draft => ({
    stepNumber: draft.step.step,
    sourceNodeId: draft.step.sourceNodeId ?? null,
    originalSelector: draft.step.selector,
    resolvedSelector: draft.resolvedSelector || draft.step.selector,
    resolverMetadata: {
      ...draft.metadata,
      resolvedSelector: draft.resolvedSelector || draft.step.selector,
    },
  }));

  return {
    resolutions,
    unresolvedStepNumbers: resolutions
      .filter(resolution => resolution.resolverMetadata.resolvedBy === 'unresolved')
      .map(resolution => resolution.stepNumber),
    llmAttemptedStepNumbers,
    llmAcceptedStepNumbers,
  };
}
