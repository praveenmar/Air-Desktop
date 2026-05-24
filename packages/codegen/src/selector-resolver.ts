import type {
  CapturedCandidatePromotionDecision,
  CapturedSelectorCandidate,
  BoundedFieldSelectorSpec,
  CodegenSession,
  CodegenStep,
  EquivalentRendering,
  FlatSelectorEngine,
  LabelContextRenderStatus,
  LabelContextSelectorSpec,
  TriggerContextSelectorSpec,
  LlmResponseFormat,
  ResolverMetadata,
  SelectorCategory,
  SelectorEvaluation,
  SelectorPriority,
  ResolverSnapshotSource,
  SelectorSpec,
  ShadowEvaluationReport,
  SnapshotSelectionProvenance,
} from './types';
import {
  attachAssertionOutcomeSelections,
  type CandidateScore,
  type CandidateValidation,
  type ControlFamily,
  type LlmCorrectiveRetryRequest,
  type LlmCorrectiveRetryStep,
  type LlmFallbackRequest,
  type LlmFallbackStep,
  type LlmRetryFailedCandidate,
  type LlmRetryFingerprintSummary,
  type NormalizedLlmRetrySuggestion,
  type NormalizedLlmSuggestion,
  type LlmFallbackSuggestion,
  type RawCandidate,
  type ResolveContext,
  type ResolvedResolverConfig,
  type ResolverRejectReason,
  type ResolverConfig,
  type SelectorFallbackRequest,
  type SelectorFallbackProvider,
  type SelectorResolution,
  type SelectorResolverResult,
  type SnapshotCache,
  type StepResolutionDraft,
} from './resolver/types';
import {
  cssEscape,
  extractAttributeValue,
  escapeTextSelectorValue,
  extractStableParentSelector,
  extractTextExcerpt,
  findStableClassFromAttributes,
  getElementContextHints,
  getElementSemanticTextSignals,
  getElementTextSignals,
  inferStepSignalAttributes,
  isDynamicText,
  isLikelyCssSelector,
  isTextSelector,
  normalizeTextForMatch,
  textFromElement,
  type SemanticTextSignal,
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
import { validateRawCandidate } from './resolver/selector-spec-validator';
import {
  findExactVisibleLabelLikeDescendants,
  findTightFieldContainer,
  findTightTriggerContainer,
  getVisibleInputLikeControls,
  getVisibleTriggerLikeControls,
  isGenericContainerSelector,
  normalizeStructuredSelectorText,
} from './resolver/structured-selector-utils';
import { serializeSnapshotExcerpt } from './resolver/excerpt-builder';
import { buildSelectorSpec } from './selector-spec';
import { buildBoundedFieldSelectorSpec } from './selector-spec';
import {
  classifySelectorCategory,
  mapSelectorProofSource,
  proofScoreForValidation,
  stabilityBaseScoreForCategory,
  summarizeSelectorEvaluation,
} from './selector-evaluation';
import {
  buildBoundedFieldCandidates,
  buildBoundedFieldTriggerCandidates,
  diagnoseBoundedFieldInputCandidate,
  isWeakBoundedFieldInputCandidate,
} from './resolver/bounded-field';

export type {
  CandidateValidation,
  LlmFallbackRequest,
  LlmFallbackStep,
  LlmCorrectiveRetryRequest,
  LlmCorrectiveRetryStep,
  NormalizedLlmRetrySuggestion,
  NormalizedLlmSuggestion,
  LlmFallbackSuggestion,
  RawCandidate,
  ResolvedResolverConfig,
  ResolverConfig,
  SelectorFallbackRequest,
  SelectorFallbackProvider,
  SelectorResolution,
  SelectorResolverResult,
  SnapshotCache,
} from './resolver/types';
export { isVisibleElement, validateCSSCandidate, validateTextCandidate } from './resolver/visibility';
export { validateSelectorSpec, validateScopedSelectorSpec } from './resolver/selector-spec-validator';

export function hasSameAirTargetNodeId(
  resolvedElement: Element | null,
  targetNodeId?: string,
): boolean {
  return !!resolvedElement &&
    !!targetNodeId &&
    resolvedElement.getAttribute('data-air-node-id') === targetNodeId;
}

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
  enableCapturedCandidateShadowEvaluation: false,
  enableCapturedCandidateDirectPromotion: false,
  resolverMinScore: 0.7,
  intentMinScore: 0.6,
  maxSnapshotBytesForValidation: 2_000_000,
  maxSnapshotExcerptChars: 2000,
  llmTimeoutMs: 20_000,
  llmRetryTimeoutMs: 10_000,
  llmMaxCandidatesPerStep: 3,
  llmMaxRetriesPerStep: 3,
};

function resolveConfig(config?: ResolverConfig): ResolvedResolverConfig {
  const llmMaxCandidatesPerStep = Math.max(
    1,
    config?.llmMaxCandidatesPerStep ??
      config?.llmMaxRetriesPerStep ??
      DEFAULT_CONFIG.llmMaxCandidatesPerStep,
  );

  return {
    enableLLMFallback: config?.enableLLMFallback ?? DEFAULT_CONFIG.enableLLMFallback,
    enableCapturedCandidateShadowEvaluation:
      config?.enableCapturedCandidateShadowEvaluation ?? DEFAULT_CONFIG.enableCapturedCandidateShadowEvaluation,
    enableCapturedCandidateDirectPromotion:
      config?.enableCapturedCandidateDirectPromotion ?? DEFAULT_CONFIG.enableCapturedCandidateDirectPromotion,
    resolverMinScore: config?.resolverMinScore ?? DEFAULT_CONFIG.resolverMinScore,
    intentMinScore: config?.intentMinScore ?? DEFAULT_CONFIG.intentMinScore,
    maxSnapshotBytesForValidation: config?.maxSnapshotBytesForValidation ?? DEFAULT_CONFIG.maxSnapshotBytesForValidation,
    maxSnapshotExcerptChars: config?.maxSnapshotExcerptChars ?? DEFAULT_CONFIG.maxSnapshotExcerptChars,
    llmTimeoutMs: config?.llmTimeoutMs ?? DEFAULT_CONFIG.llmTimeoutMs,
    llmRetryTimeoutMs: config?.llmRetryTimeoutMs ?? DEFAULT_CONFIG.llmRetryTimeoutMs,
    maxLLMFallbackPerSession: config?.maxLLMFallbackPerSession,
    llmMaxCandidatesPerStep,
    llmMaxRetriesPerStep: llmMaxCandidatesPerStep,
  };
}

function rankScore(rank: number): number {
  return RANK_SCORES[rank] ?? 0.3;
}

function isSafeHashIdSelector(id: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(id);
}

function buildIdSelectors(id: string): string[] {
  const attributeSelector = `[id="${cssEscape(id)}"]`;
  if (!isSafeHashIdSelector(id)) {
    return [attributeSelector];
  }
  return [`#${cssEscape(id)}`, attributeSelector];
}

function candidateUsesIdSelector(candidate: RawCandidate): boolean {
  return candidate.source === 'id' || /\[id=(?:"[^"]+"|'[^']+')\]/i.test(candidate.selector) || /(?:^|\s)#/.test(candidate.selector);
}

function candidateUsesClassSelector(candidate: RawCandidate): boolean {
  return candidate.source === 'class' || /(?:^|[\s>])(?:[a-z0-9_-]+)?\.[a-z0-9:_-]+/i.test(candidate.selector);
}

function extractCandidateId(selector: string): string | null {
  const attrId = extractAttributeValue(selector, 'id');
  if (attrId) return attrId;
  if (!selector.startsWith('#')) return null;
  const match = selector.slice(1).match(/^[A-Za-z0-9_-]+/);
  return match?.[0] ?? null;
}

function tokenizeSemanticParts(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2);
}

function extractHrefTokens(href?: string): string[] {
  if (!href) return [];
  try {
    const url = new URL(href, 'https://air.local');
    return tokenizeSemanticParts(url.pathname);
  } catch {
    return tokenizeSemanticParts(href);
  }
}

function isVeryOpaqueMixedId(id: string): boolean {
  if (id.length < 18) return false;
  if (!/[a-z]/i.test(id) || !/\d/.test(id)) return false;
  if (!/^[a-z0-9_-]+$/i.test(id)) return false;
  const tokens = id.split(/[-_]/).filter(Boolean);
  if (tokens.length <= 1) {
    return /[a-z]{2,}\d{2,}[a-z0-9]{6,}/i.test(id);
  }
  return tokens.every(token => token.length >= 4 && /[a-z]/i.test(token) && /\d/.test(token));
}

function hasOpaqueHyphenatedSegments(id: string): boolean {
  const tokens = id.split(/[-_]/).filter(Boolean);
  if (tokens.length < 3) return false;
  const opaqueTokens = tokens.filter(token =>
    token.length >= 4 &&
    /[a-z]/i.test(token) &&
    (/\d/.test(token) || token.length >= 8) &&
    !/(user|admin|menu|nav|search|input|button|dialog|modal|form|table|row|col|step|line|email|name|leave|logout|login|address)/i.test(token),
  );
  return opaqueTokens.length >= 2;
}

function isUtilityClassToken(token: string): boolean {
  return (
    /^(?:flex|grid|block|hidden)$/i.test(token) ||
    /^(?:items|justify|content|self|place)-/i.test(token) ||
    /^(?:p|m)(?:[trblxy])?-\d+/i.test(token) ||
    /^(?:text|bg|border|rounded)-/i.test(token) ||
    /^(?:w|h|min|max)-/i.test(token) ||
    /^(?:gap|space-[xy]|inset|top|left|right|bottom)-/i.test(token) ||
    /^(?:hover|focus|active|disabled|group-hover|focus-within|focus-visible):/i.test(token)
  );
}

function isStateClassToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(?:is|has)-[a-z0-9:_-]+$/i.test(normalized)) return true;
  if (/--(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/i.test(normalized)) {
    return true;
  }
  if (normalized.includes('data-state') || normalized.includes('headlessui-state')) return true;
  const parts = tokenizeSemanticParts(normalized);
  if (parts.length === 0) return false;
  return parts.some(part =>
    /^(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/.test(part),
  );
}

function isFrameworkClassToken(token: string): boolean {
  return /^(?:oxd-|mui|ant-|chakra-|radix-|headlessui-)/i.test(token);
}

function isGenericShellClassToken(token: string): boolean {
  return /^(?:container|wrapper|row|item|content|layout|shell|panel|section|body|header|footer)$/i.test(token);
}

function isCssInJsClassToken(token: string): boolean {
  return /^(?:css-|sc-)/i.test(token);
}

function isBemLikeClassToken(token: string): boolean {
  return /(?:__|--)/.test(token);
}

function isHashedRandomClassToken(token: string): boolean {
  if (isCssInJsClassToken(token)) return true;
  if (token.length < 8) return false;
  if (!/[a-z]/i.test(token)) return false;
  if (/^(?:oxd-|mui|ant-|chakra-)/i.test(token)) return false;
  if (/^[a-z0-9_-]+$/i.test(token) && /\d/.test(token)) {
    const parts = token.split(/[-_]/).filter(Boolean);
    if (parts.length <= 1) {
      return /[a-z]{2,}\d{2,}[a-z0-9]{4,}/i.test(token);
    }
    return parts.every(part => part.length >= 3 && (/\d/.test(part) || /^[a-z]{6,}$/i.test(part)));
  }
  return false;
}

function extractCandidateClassTokens(selector: string): string[] {
  return Array.from(selector.matchAll(/\.([A-Za-z0-9:_-]+)/g))
    .map(match => match[1] ?? '')
    .filter(Boolean);
}

function extractClassContextTokens(step: CodegenStep): Set<string> {
  const attrs = inferStepSignalAttributes(step);
  return new Set<string>([
    ...tokenizeSemanticParts(step.fingerprint?.textExcerpt ?? extractTextExcerpt(step)),
    ...tokenizeSemanticParts(attrs.name),
    ...tokenizeSemanticParts(attrs.placeholder),
    ...extractHrefTokens(attrs.href),
    ...tokenizeSemanticParts(step.intent),
  ]);
}

function evaluateClassTokenEntropy(
  classToken: string,
  step: CodegenStep,
  candidate: RawCandidate,
): { adjustment: number; score: number; reasons: string[] } {
  let penalty = 0;
  const reasons: string[] = [];
  const addPenalty = (amount: number, reason: string): void => {
    if (reasons.includes(reason)) return;
    penalty += amount;
    reasons.push(reason);
  };

  if (isUtilityClassToken(classToken)) addPenalty(0.24, 'utility_class');
  if (isCssInJsClassToken(classToken)) addPenalty(0.22, 'css_in_js_class');
  if (isHashedRandomClassToken(classToken)) addPenalty(0.2, 'hashed_random_class');
  if (isStateClassToken(classToken)) addPenalty(0.18, 'state_class');
  if (isFrameworkClassToken(classToken)) addPenalty(0.14, 'framework_structural_class');
  if (isGenericShellClassToken(classToken)) addPenalty(0.12, 'generic_shell_class');

  penalty = Math.min(0.28, penalty);

  const contextTokens = extractClassContextTokens(step);
  const classTokens = tokenizeSemanticParts(classToken);
  let bonus = 0;
  if (isBemLikeClassToken(classToken)) {
    bonus += 0.03;
  }
  const overlapCount = classTokens.filter(token => contextTokens.has(token)).length;
  if (overlapCount >= 2) {
    bonus += 0.04;
  } else if (overlapCount === 1) {
    bonus += 0.02;
  }

  const calendarScopedClass =
    candidate.source === 'parent-scope' &&
    (looksDateValue(step.value) || step.action === 'input') &&
    classTokens.some(token => token === 'date' || token === 'calendar');
  if (calendarScopedClass) {
    bonus += 0.08;
  }

  const adjustment = Math.max(-0.28, Math.min(0.04, bonus - penalty));
  return {
    adjustment,
    score: adjustment,
    reasons,
  };
}

function computeClassEntropy(
  step: CodegenStep,
  candidate: RawCandidate,
  validation: CandidateValidation,
  snapshot?: Document,
): { adjustment: number; score: number; reasons: string[] } {
  if (!candidateUsesClassSelector(candidate)) {
    return { adjustment: 0, score: 0, reasons: [] };
  }

  const element =
    validation.resolvedElement ??
    (snapshot ? getCandidateElement(snapshot, candidate.selector) : null);
  const selectorClassTokens = extractCandidateClassTokens(candidate.selector);
  const elementClassTokens = (element?.getAttribute('class') || '')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  const candidateClassTokens = Array.from(new Set([
    ...selectorClassTokens,
    ...elementClassTokens,
  ]));

  if (candidateClassTokens.length === 0) {
    return { adjustment: 0, score: 0, reasons: [] };
  }

  const bestTokenEntropy = candidateClassTokens
    .map(classToken => evaluateClassTokenEntropy(classToken, step, candidate))
    .sort((left, right) => {
      if (right.adjustment !== left.adjustment) return right.adjustment - left.adjustment;
      return left.reasons.length - right.reasons.length;
    })[0];

  return bestTokenEntropy ?? { adjustment: 0, score: 0, reasons: [] };
}

function computeIdEntropy(
  step: CodegenStep,
  candidate: RawCandidate,
  validation: CandidateValidation,
  snapshot?: Document,
): { adjustment: number; score: number; reasons: string[] } {
  if (!candidateUsesIdSelector(candidate)) {
    return { adjustment: 0, score: 0, reasons: [] };
  }

  const element =
    validation.resolvedElement ??
    (snapshot ? getCandidateElement(snapshot, candidate.selector) : null);
  const candidateId = (
    element?.getAttribute('id') ||
    (element as HTMLElement | null)?.id ||
    extractCandidateId(candidate.selector) ||
    ''
  ).trim();

  if (!candidateId) {
    return { adjustment: 0, score: 0, reasons: [] };
  }

  let penalty = 0;
  const reasons: string[] = [];
  const normalizedId = candidateId.trim();

  const addPenalty = (amount: number, reason: string): void => {
    if (reasons.includes(reason)) return;
    penalty += amount;
    reasons.push(reason);
  };

  if (/^react-/i.test(normalizedId)) addPenalty(0.18, 'react_prefix');
  if (/^headlessui-/i.test(normalizedId)) addPenalty(0.22, 'headlessui_prefix');
  if (/^radix-/i.test(normalizedId)) addPenalty(0.22, 'radix_prefix');
  if (/^:[a-z0-9]+:$/i.test(normalizedId)) addPenalty(0.24, 'react_runtime_id');
  if (/[0-9a-f]{8}-[0-9a-f]{4}(?:-[0-9a-f]{4}){1,2}/i.test(normalizedId)) addPenalty(0.22, 'uuid_like');
  if (/^(?:css|sc)-[a-z0-9_-]+$/i.test(normalizedId)) addPenalty(0.2, 'css_hash');
  if (/\d{5,}/.test(normalizedId)) addPenalty(0.16, 'long_numeric_run');
  if (isVeryOpaqueMixedId(normalizedId)) addPenalty(0.12, 'opaque_mixed_alnum');
  if (hasOpaqueHyphenatedSegments(normalizedId)) addPenalty(0.1, 'opaque_hyphen_segments');

  penalty = Math.min(0.3, penalty);

  const attrs = inferStepSignalAttributes(step);
  const stepTokens = new Set<string>([
    ...tokenizeSemanticParts(attrs.id),
    ...tokenizeSemanticParts(attrs.name),
    ...tokenizeSemanticParts(attrs.placeholder),
    ...tokenizeSemanticParts(step.fingerprint?.textExcerpt ?? extractTextExcerpt(step)),
    ...extractHrefTokens(attrs.href),
    ...tokenizeSemanticParts(step.intent),
  ]);

  const idTokens = tokenizeSemanticParts(candidateId);
  let bonus = 0;
  if (attrs.id && attrs.id.toLowerCase() === candidateId.toLowerCase()) {
    bonus += 0.05;
  }
  if (attrs.name && candidateId.toLowerCase().includes(attrs.name.toLowerCase())) {
    bonus += 0.03;
  }
  const overlapCount = idTokens.filter(token => stepTokens.has(token)).length;
  if (overlapCount >= 2) {
    bonus += 0.04;
  } else if (overlapCount === 1) {
    bonus += 0.02;
  }

  bonus = Math.min(0.05, bonus);
  const adjustment = Math.max(-0.3, Math.min(0.05, bonus - penalty));
  return {
    adjustment,
    score: adjustment,
    reasons,
  };
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

function inferCapturedSelectorSource(
  selector: string,
  family: CapturedSelectorCandidate['family'],
  engine: CapturedSelectorCandidate['engine'],
): RawCandidate['source'] {
  if (family === 'test-id') return 'testid';
  if (family === 'id') return 'id';
  if (family === 'name') return 'name';
  if (family === 'aria-label') return 'aria';
  if (family === 'placeholder') return 'placeholder';
  if (family === 'href') return 'href';
  if (family === 'class') return 'class';
  if (family === 'text' || engine === 'text') return 'text';
  if (family === 'parent-scoped-css' || family === 'tight-container-css') return 'parent-scope';
  if (family === 'role-attr') return 'other';

  if (selector.startsWith('[data-testid=')) return 'testid';
  if (selector.startsWith('[data-cy=')) return 'data-cy';
  if (selector.startsWith('[data-qa=')) return 'data-qa';
  if (selector.startsWith('#') || selector.startsWith('[id=')) return 'id';
  if (selector.includes('[name=')) return 'name';
  if (selector.includes('[aria-label=')) return 'aria';
  if (selector.includes('[placeholder=')) return 'placeholder';
  if (selector.includes('[href=')) return 'href';
  if (selector.includes('[role=')) return 'role+name';
  if (selector.startsWith('.') || /(?:^|[\s>])(?:[a-z0-9_-]+)?\.[a-z0-9:_-]+/i.test(selector)) return 'class';
  if (engine === 'xpath' || selector.startsWith('//') || selector.startsWith('id("')) return 'path';
  return 'original';
}

function inferCapturedSelectorCategoryOverride(
  family: CapturedSelectorCandidate['family'],
): SelectorCategory | undefined {
  if (family === 'role-attr') return 'role-attr';
  if (family === 'parent-scoped-css') return 'parent-scoped';
  if (family === 'tight-container-css') return 'structural';
  return undefined;
}

/**
 * Converts one captured selector candidate into a resolver-native candidate
 * without mutating resolver behavior. This is used only for shadow evaluation.
 */
function convertCapturedCandidate(
  candidate: CapturedSelectorCandidate,
): RawCandidate | null {
  if (!candidate?.selector || typeof candidate.selector !== 'string') {
    return null;
  }

  const selector = candidate.selector.trim();
  if (!selector) return null;

  return {
    selector,
    source: inferCapturedSelectorSource(selector, candidate.family, candidate.engine),
    engine: candidate.engine === 'xpath' ? 'xpath' : candidate.engine,
    categoryOverride: inferCapturedSelectorCategoryOverride(candidate.family),
    rank: getSelectorRank(selector),
  };
}

interface ShadowEvaluatedCandidate {
  captured: CapturedSelectorCandidate;
  candidate: CandidateScore;
  semantic: SemanticCompatibilityEvaluation;
  selectorEvaluation: SelectorEvaluation;
  sameTargetEvidence: boolean;
}

function buildShadowEvaluationWinner(
  winner: ShadowEvaluatedCandidate,
): NonNullable<ShadowEvaluationReport['winner']> {
  return {
    selector: winner.candidate.candidate.selector,
    source: winner.candidate.candidate.source,
    engine: winner.candidate.candidate.engine,
    rank: winner.candidate.candidate.rank,
    score: winner.candidate.score,
    family: winner.captured.family,
    strength: winner.captured.strength,
    matchCount: winner.captured.matchCount ?? null,
    visibleMatchCount: winner.captured.visibleMatchCount ?? null,
    sameTargetEvidence: winner.sameTargetEvidence,
    warningCodes: winner.captured.warningCodes,
  };
}

/**
 * Computes a captured-candidate shadow winner using the existing validation
 * and semantic-rejection rails, while keeping emitted selector output unchanged.
 */
function computeCapturedCandidateShadowEvaluation(
  step: CodegenStep,
  snapshot: Document | null,
): ShadowEvaluationReport {
  const capturedCandidates = step.fingerprint?.selectorCandidates ?? [];
  if (capturedCandidates.length === 0) {
    return {
      status: 'skipped-no-candidates',
      candidateCount: 0,
      convertedCandidateCount: 0,
      uniqueCandidateCount: 0,
      semanticallySafeCandidateCount: 0,
      skippedReason: 'missing-selector-candidates',
    };
  }

  if (!snapshot) {
    return {
      status: 'skipped-no-snapshot',
      candidateCount: capturedCandidates.length,
      convertedCandidateCount: 0,
      uniqueCandidateCount: 0,
      semanticallySafeCandidateCount: 0,
      skippedReason: 'snapshot-unavailable',
    };
  }

  const converted = capturedCandidates
    .map(captured => {
      const rawCandidate = convertCapturedCandidate(captured);
      if (!rawCandidate) return null;

      const validation = validateCandidate(rawCandidate, snapshot, step);
      const baselineScore = computeBaselineCandidateScore(rawCandidate, validation, step, snapshot);
      const usesId = candidateUsesIdSelector(rawCandidate);
      const usesClass = candidateUsesClassSelector(rawCandidate);
      const idEntropy = computeIdEntropy(step, rawCandidate, validation, snapshot);
      const classEntropy = computeClassEntropy(step, rawCandidate, validation, snapshot);
      const sameTargetEvidence = hasSameAirTargetNodeId(validation.resolvedElement ?? null, step.targetNodeId);
      const selectorEvaluation = buildCandidateSelectorEvaluation({
        step,
        candidate: rawCandidate,
        validation,
        baselineScore,
        snapshotTargetEvidence: sameTargetEvidence || undefined,
        idEntropyScore: usesId ? idEntropy.score : undefined,
        idPenaltyReason: usesId ? idEntropy.reasons : undefined,
        classEntropyScore: usesClass ? classEntropy.score : undefined,
        classPenaltyReason: usesClass ? classEntropy.reasons : undefined,
        warningCodes: captured.warningCodes,
      });
      const candidateScore: CandidateScore = {
        candidate: rawCandidate,
        validation,
        score: selectorEvaluation.scoring.finalScore,
        selectorEvaluation,
        idEntropyScore: usesId ? idEntropy.score : undefined,
        idPenaltyReason: usesId ? idEntropy.reasons : undefined,
        classEntropyScore: usesClass ? classEntropy.score : undefined,
        classPenaltyReason: usesClass ? classEntropy.reasons : undefined,
      };
      const semantic = evaluateSemanticReject(step, candidateScore, snapshot);
      return {
        captured,
        candidate: candidateScore,
        semantic,
        selectorEvaluation: buildCandidateSelectorEvaluation({
          step,
          candidate: rawCandidate,
          validation,
          baselineScore: candidateScore.score,
          snapshotTargetEvidence: sameTargetEvidence || undefined,
          semanticScore: semantic.score,
          semanticReasons: semantic.reasons,
          semanticRejectReason: semantic.rejectReason,
          proofLevel: semantic.rejectReason === null ? 'semantic_validated' : 'unvalidated',
          proofSource: semantic.rejectReason === null ? 'semantic' : 'none',
          idEntropyScore: candidateScore.idEntropyScore,
          idPenaltyReason: candidateScore.idPenaltyReason,
          classEntropyScore: candidateScore.classEntropyScore,
          classPenaltyReason: candidateScore.classPenaltyReason,
          warningCodes: selectorEvaluation.warningCodes,
        }),
        sameTargetEvidence,
      } satisfies ShadowEvaluatedCandidate;
    })
    .filter((candidate): candidate is ShadowEvaluatedCandidate => candidate !== null);

  const uniqueCandidates = converted
    .filter(candidate => candidate.candidate.validation.effectiveMatchCount === 1);
  const semanticallySafeCandidates = uniqueCandidates
    .filter(candidate => candidate.semantic.rejectReason === null)
    .sort(compareSemanticCandidates);
  const rejectedCandidates = uniqueCandidates
    .filter(candidate => candidate.semantic.rejectReason !== null)
    .map(candidate => ({
      selector: candidate.candidate.candidate.selector,
      reason: candidate.semantic.rejectReason as ResolverRejectReason,
    }));
  const winner = semanticallySafeCandidates[0];

  return {
    status: 'computed',
    candidateCount: capturedCandidates.length,
    convertedCandidateCount: converted.length,
    uniqueCandidateCount: uniqueCandidates.length,
    semanticallySafeCandidateCount: semanticallySafeCandidates.length,
    winner: winner ? buildShadowEvaluationWinner(winner) : undefined,
    rejectedCandidates: rejectedCandidates.length > 0 ? rejectedCandidates : undefined,
    skippedReason: winner ? null : 'no-safe-captured-winner',
  };
}

const CAPTURED_DIRECT_PROMOTION_FAMILY_PRIORITY: Record<
  Extract<CapturedSelectorCandidate['family'], 'test-id' | 'id' | 'name' | 'href' | 'aria-label' | 'placeholder'>,
  number
> = {
  'test-id': 1,
  id: 2,
  name: 3,
  href: 4,
  'aria-label': 5,
  placeholder: 6,
};

const BLOCKED_CAPTURED_DIRECT_PROMOTION_WARNING_CODES = new Set<string>([
  'multiple-matches',
  'multiple-visible-matches',
  'target-not-in-matches',
  'too-many-matches-for-visible-index',
  'detached-target',
  'inside-shadow-dom',
  'shadow-boundary-crossed',
  'query-failed',
  'dynamic-class',
  'framework-class',
]);

const HIGH_TRUST_DIRECT_CATEGORIES = new Set<SelectorCategory>([
  'testid',
  'id',
  'name',
  'href',
  'placeholder',
  'aria-label',
]);

const CURRENT_WINNER_WEAK_WARNING_CODES = new Set<string>([
  'deterministic-low-score-fallback',
  'deterministic-below-threshold',
  'deterministic-low-score-available',
  'deterministic-low-score-rejected',
  'no-unique-candidate',
  'snapshot-target-missing',
  'blocked-generic-shell-override',
  'deterministic-semantic-reject',
  'invalid-original-selector',
  'trusted-original-snapshot-miss',
]);

type AllowlistedCapturedDirectFamily =
  Extract<CapturedSelectorCandidate['family'], 'test-id' | 'id' | 'name' | 'href' | 'aria-label' | 'placeholder'>;

interface CapturedDirectPromotionCandidate {
  captured: CapturedSelectorCandidate & { family: AllowlistedCapturedDirectFamily };
  rawCandidate: RawCandidate;
  score: number;
  sameTargetEvidence: boolean;
  selectorEvaluation?: SelectorEvaluation;
  validation?: CandidateValidation;
  proofLevel: 'recorded' | 'snapshot_validated' | 'semantic_validated';
  proofSource: SelectorEvaluation['proof']['proofSource'];
  reason: string;
}

function isAllowlistedCapturedDirectFamily(
  family: CapturedSelectorCandidate['family'],
): family is AllowlistedCapturedDirectFamily {
  return family === 'test-id' ||
    family === 'id' ||
    family === 'name' ||
    family === 'href' ||
    family === 'aria-label' ||
    family === 'placeholder';
}

function getBlockedCapturedPromotionWarningCode(
  warningCodes?: string[],
): string | null {
  for (const warningCode of warningCodes ?? []) {
    if (BLOCKED_CAPTURED_DIRECT_PROMOTION_WARNING_CODES.has(warningCode)) {
      return warningCode;
    }
  }
  return null;
}

function extractCapturedDirectCandidateValue(
  candidate: CapturedSelectorCandidate,
): string | null {
  switch (candidate.family) {
    case 'test-id':
      return extractAttributeValue(candidate.selector, 'data-testid')
        ?? extractAttributeValue(candidate.selector, 'data-cy')
        ?? extractAttributeValue(candidate.selector, 'data-qa');
    case 'id':
      return extractCandidateId(candidate.selector);
    case 'name':
      return extractAttributeValue(candidate.selector, 'name');
    case 'href':
      return extractAttributeValue(candidate.selector, 'href');
    case 'aria-label':
      return extractAttributeValue(candidate.selector, 'aria-label');
    case 'placeholder':
      return extractAttributeValue(candidate.selector, 'placeholder');
    default:
      return null;
  }
}

function isStableCapturedHrefValue(href: string | null): boolean {
  if (!href) return false;
  const normalized = href.trim();
  if (!normalized) return false;
  if (/^(?:#|javascript:|mailto:|tel:)/i.test(normalized)) return false;
  try {
    const parsed = new URL(normalized, 'https://air.local');
    if (parsed.hash) return false;
    if (parsed.search) return false;
    return true;
  } catch {
    return false;
  }
}

function matchesRecordedDirectSignal(
  step: CodegenStep,
  candidate: CapturedSelectorCandidate & { family: AllowlistedCapturedDirectFamily },
): boolean {
  const attrs = inferStepSignalAttributes(step);
  const candidateValue = extractCapturedDirectCandidateValue(candidate);
  if (!candidateValue) return false;

  switch (candidate.family) {
    case 'test-id':
      return candidateValue === attrs.dataTestId || candidateValue === attrs.dataCy || candidateValue === attrs.dataQa;
    case 'id':
      return candidateValue === attrs.id;
    case 'name':
      return candidateValue === attrs.name;
    case 'href': {
      const candidatePath = normalizeComparablePath(candidateValue);
      const stepPath = normalizeComparablePath(attrs.href);
      return !!candidatePath && !!stepPath && candidatePath === stepPath;
    }
    case 'aria-label':
      return candidateValue === attrs.ariaLabel;
    case 'placeholder':
      return candidateValue === attrs.placeholder;
    default:
      return false;
  }
}

function isStructuredRecoverySpec(selectorSpec?: SelectorSpec): boolean {
  return selectorSpec?.engine === 'bounded-field' ||
    selectorSpec?.engine === 'label-context' ||
    selectorSpec?.engine === 'trigger-context';
}

function isCurrentWinnerHighTrust(draft: StepResolutionDraft): boolean {
  if (isStructuredRecoverySpec(draft.resolvedSelectorSpec)) return true;

  const evaluation = draft.metadata.selectorEvaluation;
  if (!evaluation) return false;
  if (!HIGH_TRUST_DIRECT_CATEGORIES.has(evaluation.category)) return false;
  if (
    evaluation.proof.proofLevel !== 'snapshot_validated' &&
    evaluation.proof.proofLevel !== 'semantic_validated' &&
    evaluation.proof.proofLevel !== 'recorded'
  ) {
    return false;
  }
  if (evaluation.proof.proofSource === 'none') return false;

  const warningCodes = new Set<string>([
    ...(draft.metadata.warningCodes ?? []),
    ...(evaluation.warningCodes ?? []),
  ]);
  for (const warningCode of warningCodes) {
    if (CURRENT_WINNER_WEAK_WARNING_CODES.has(warningCode)) return false;
  }

  return true;
}

function compareCapturedDirectPromotionCandidates(
  left: CapturedDirectPromotionCandidate,
  right: CapturedDirectPromotionCandidate,
): number {
  const leftPriority = CAPTURED_DIRECT_PROMOTION_FAMILY_PRIORITY[left.captured.family];
  const rightPriority = CAPTURED_DIRECT_PROMOTION_FAMILY_PRIORITY[right.captured.family];
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (right.sameTargetEvidence !== left.sameTargetEvidence) {
    return Number(right.sameTargetEvidence) - Number(left.sameTargetEvidence);
  }
  if (right.score !== left.score) return right.score - left.score;
  return left.rawCandidate.rank - right.rawCandidate.rank;
}

function buildCapturedCandidatePromotionDecision(
  previousSelector: string,
  params: {
    promoted: boolean;
    selectedSelector?: string | null;
    selectedFamily?: AllowlistedCapturedDirectFamily | null;
    reason?: string | null;
    blockedReason?: string | null;
  },
): CapturedCandidatePromotionDecision {
  return {
    attempted: true,
    promoted: params.promoted,
    previousSelector,
    selectedSelector: params.selectedSelector ?? null,
    selectedFamily: params.selectedFamily ?? null,
    reason: params.reason ?? null,
    blockedReason: params.blockedReason ?? null,
  };
}

function evaluateCapturedDirectPromotionCandidate(
  step: CodegenStep,
  snapshot: Document | null,
  captured: CapturedSelectorCandidate & { family: AllowlistedCapturedDirectFamily },
): { candidate?: CapturedDirectPromotionCandidate; blockedReason?: string } {
  if (captured.matchCount !== 1) {
    return { blockedReason: 'match-count-not-unique' };
  }
  if (captured.visibleMatchCount !== 1) {
    return { blockedReason: 'visible-match-count-not-unique' };
  }
  const blockedWarningCode = getBlockedCapturedPromotionWarningCode(captured.warningCodes);
  if (blockedWarningCode) {
    return { blockedReason: `warning:${blockedWarningCode}` };
  }
  if (captured.usesIndex === true) {
    return { blockedReason: 'uses-index' };
  }
  if (captured.usesDynamicClass === true) {
    return { blockedReason: 'uses-dynamic-class' };
  }

  const rawCandidate = convertCapturedCandidate(captured);
  if (!rawCandidate) {
    return { blockedReason: 'unconvertible-candidate' };
  }

  if (captured.family === 'id') {
    const candidateId = extractCapturedDirectCandidateValue(captured);
    if (!candidateId) {
      return { blockedReason: 'missing-id-value' };
    }
    const idEntropy = computeIdEntropy(
      step,
      rawCandidate,
      {
        totalMatchCount: 1,
        visibleMatchCount: 1,
        effectiveMatchCount: 1,
        reason: 'unique-visible',
      },
      snapshot ?? undefined,
    );
    if (idEntropy.reasons.length > 0) {
      return { blockedReason: 'dynamic-or-opaque-id' };
    }
  }

  if (captured.family === 'href') {
    const hrefValue = extractCapturedDirectCandidateValue(captured);
    if (!isStableCapturedHrefValue(hrefValue)) {
      return { blockedReason: 'volatile-href' };
    }
  }

  if (!snapshot) {
    const pristineNoSnapshot =
      captured.strength === 'strong' &&
      matchesRecordedDirectSignal(step, captured);

    if (!pristineNoSnapshot) {
      return { blockedReason: 'no-snapshot-non-pristine-direct-candidate' };
    }

    const score = 0.85 + Math.max(0, 0.05 - (CAPTURED_DIRECT_PROMOTION_FAMILY_PRIORITY[captured.family] - 1) * 0.005);
    return {
      candidate: {
        captured,
        rawCandidate,
        score,
        sameTargetEvidence: false,
        proofLevel: 'recorded',
        proofSource: 'recorded',
        reason: 'pristine-direct-candidate',
      },
    };
  }

  const validation = validateCandidate(rawCandidate, snapshot, step);
  if (validation.effectiveMatchCount !== 1 || validation.reason !== 'unique-visible') {
    return { blockedReason: 'snapshot-validation-not-unique-visible' };
  }

  const idEntropy = computeIdEntropy(step, rawCandidate, validation, snapshot);
  if (captured.family === 'id' && idEntropy.reasons.length > 0) {
    return { blockedReason: 'dynamic-or-opaque-id' };
  }
  const classEntropy = computeClassEntropy(step, rawCandidate, validation, snapshot);
  const sameTargetEvidence = hasSameAirTargetNodeId(validation.resolvedElement ?? null, step.targetNodeId);
  const baselineScore = computeBaselineCandidateScore(rawCandidate, validation, step, snapshot);
  const selectorEvaluation = buildCandidateSelectorEvaluation({
    step,
    candidate: rawCandidate,
    validation,
    baselineScore,
    snapshotTargetEvidence: sameTargetEvidence || undefined,
    idEntropyScore: idEntropy.score,
    idPenaltyReason: idEntropy.reasons,
    classEntropyScore: classEntropy.score,
    classPenaltyReason: classEntropy.reasons,
    warningCodes: captured.warningCodes,
  });
  const candidateScore: CandidateScore = {
    candidate: rawCandidate,
    validation,
    score: selectorEvaluation.scoring.finalScore,
    selectorEvaluation,
    idEntropyScore: idEntropy.score,
    idPenaltyReason: idEntropy.reasons,
    classEntropyScore: classEntropy.score,
    classPenaltyReason: classEntropy.reasons,
  };
  const semantic = evaluateSemanticReject(step, candidateScore, snapshot);
  if (semantic.rejectReason !== null) {
    return { blockedReason: semantic.rejectReason };
  }

  return {
    candidate: {
      captured,
      rawCandidate,
      score: selectorEvaluation.scoring.finalScore,
      sameTargetEvidence,
      selectorEvaluation: buildCandidateSelectorEvaluation({
        step,
        candidate: rawCandidate,
        validation,
        baselineScore: candidateScore.score,
        snapshotTargetEvidence: sameTargetEvidence || undefined,
        semanticScore: semantic.score,
        semanticReasons: semantic.reasons,
        semanticRejectReason: semantic.rejectReason,
        proofLevel: sameTargetEvidence ? 'snapshot_validated' : 'semantic_validated',
        proofSource: sameTargetEvidence ? 'snapshot' : 'semantic',
        idEntropyScore: candidateScore.idEntropyScore,
        idPenaltyReason: candidateScore.idPenaltyReason,
        classEntropyScore: candidateScore.classEntropyScore,
        classPenaltyReason: candidateScore.classPenaltyReason,
        warningCodes: selectorEvaluation.warningCodes,
      }),
      validation,
      proofLevel: sameTargetEvidence ? 'snapshot_validated' : 'semantic_validated',
      proofSource: sameTargetEvidence ? 'snapshot' : 'semantic',
      reason: sameTargetEvidence ? 'same-target-direct-candidate' : 'semantic-direct-candidate',
    },
  };
}

function maybeApplyCapturedCandidateDirectPromotion(
  draft: StepResolutionDraft,
  config: ResolvedResolverConfig,
): void {
  if (!config.enableCapturedCandidateDirectPromotion) return;

  const capturedCandidates = draft.step.fingerprint?.selectorCandidates ?? [];
  if (capturedCandidates.length === 0) {
    draft.metadata.capturedCandidatePromotion = buildCapturedCandidatePromotionDecision(
      draft.resolvedSelector,
      {
        promoted: false,
        blockedReason: 'no-captured-candidates',
      },
    );
    return;
  }

  if (isStructuredRecoverySpec(draft.resolvedSelectorSpec)) {
    draft.metadata.capturedCandidatePromotion = buildCapturedCandidatePromotionDecision(
      draft.resolvedSelector,
      {
        promoted: false,
        blockedReason: 'structured-recovery-higher-proof',
      },
    );
    return;
  }

  if (isCurrentWinnerHighTrust(draft)) {
    draft.metadata.capturedCandidatePromotion = buildCapturedCandidatePromotionDecision(
      draft.resolvedSelector,
      {
        promoted: false,
        blockedReason: 'current-winner-already-strong',
      },
    );
    return;
  }

  const evaluatedCandidates = capturedCandidates
    .filter((candidate): candidate is CapturedSelectorCandidate & { family: AllowlistedCapturedDirectFamily } =>
      isAllowlistedCapturedDirectFamily(candidate.family),
    )
    .map(candidate => ({
      captured: candidate,
      evaluation: evaluateCapturedDirectPromotionCandidate(draft.step, draft.snapshot, candidate),
    }));

  const promotableCandidates = evaluatedCandidates
    .flatMap(entry => entry.evaluation.candidate ? [entry.evaluation.candidate] : [])
    .filter(candidate => candidate.rawCandidate.selector !== draft.resolvedSelector)
    .sort(compareCapturedDirectPromotionCandidates);

  const promotedCandidate = promotableCandidates[0];

  if (!promotedCandidate) {
    const blockedReason = evaluatedCandidates.find(entry => entry.evaluation.blockedReason)?.evaluation.blockedReason
      ?? 'no-eligible-direct-candidate';
    draft.metadata.capturedCandidatePromotion = buildCapturedCandidatePromotionDecision(
      draft.resolvedSelector,
      {
        promoted: false,
        blockedReason,
      },
    );
    return;
  }

  draft.resolvedSelector = promotedCandidate.rawCandidate.selector;
  draft.resolvedSelectorSpec = buildResolvedSelectorSpec({
    step: draft.step,
    selector: promotedCandidate.rawCandidate.selector,
    source: 'resolver',
    proofLevel: promotedCandidate.proofLevel,
    engine: promotedCandidate.rawCandidate.engine,
    rank: promotedCandidate.rawCandidate.rank,
    confidence: promotedCandidate.validation?.confidenceScore ?? promotedCandidate.score,
    warningCodes: [
      ...draft.metadata.warningCodes,
      'captured-direct-promotion',
    ],
  });
  draft.metadata = {
    ...draft.metadata,
    resolvedSelector: promotedCandidate.rawCandidate.selector,
    resolvedBy: 'deterministic-override',
    bestScore: promotedCandidate.score,
    effectiveMatchCount: promotedCandidate.validation?.effectiveMatchCount ?? 1,
    matchCount: promotedCandidate.validation?.matchCount ?? promotedCandidate.validation?.visibleMatchCount ?? 1,
    confidenceScore: promotedCandidate.validation?.confidenceScore ?? promotedCandidate.score,
    ambiguityReason: promotedCandidate.validation?.ambiguityReason ?? null,
    semanticCompatibilityScore: promotedCandidate.selectorEvaluation?.scoring.semanticScore ?? draft.metadata.semanticCompatibilityScore,
    semanticCompatibilityReasons: promotedCandidate.reason ? [promotedCandidate.reason] : draft.metadata.semanticCompatibilityReasons,
    snapshotTargetEvidence: promotedCandidate.sameTargetEvidence || undefined,
    snapshotTargetEvidenceReason: promotedCandidate.sameTargetEvidence ? 'captured_candidate_same_target' : null,
    warningCodes: [
      ...draft.metadata.warningCodes,
      'captured-direct-promotion',
    ],
    capturedCandidatePromotion: buildCapturedCandidatePromotionDecision(
      draft.metadata.resolvedSelector,
      {
        promoted: true,
        selectedSelector: promotedCandidate.rawCandidate.selector,
        selectedFamily: promotedCandidate.captured.family,
        reason: promotedCandidate.reason,
      },
    ),
  };
  draft.metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
    step: draft.step,
    selectorSpec: draft.resolvedSelectorSpec,
    metadata: draft.metadata,
    candidateEvaluation: promotedCandidate.selectorEvaluation,
    snapshotTargetEvidence: promotedCandidate.sameTargetEvidence || undefined,
    validation: promotedCandidate.validation,
  });
  draft.llmEligible = false;
}

function normalizeLabelContextText(value: string | null | undefined): string {
  return normalizeStructuredSelectorText(value);
}

function getFieldLabelText(step: CodegenStep): string | null {
  const value = inferStepSignalAttributes(step).fieldLabelText;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function hasStrongDirectSelectorEvidence(step: CodegenStep): boolean {
  const priority = step.selectorPriority;
  if (
    priority === 'data-testid' ||
    priority === 'id' ||
    priority === 'attribute' ||
    priority === 'text'
  ) {
    return true;
  }

  const attrs = inferStepSignalAttributes(step);
  return !!(
    attrs.dataTestId ||
    attrs.dataCy ||
    attrs.dataQa ||
    attrs.id ||
    attrs.name ||
    attrs.placeholder ||
    attrs.ariaLabel ||
    attrs.href
  );
}

function isStructuredContextSource(source: RawCandidate['source']): boolean {
  return source === 'label-context' || source === 'trigger-context' || source === 'bounded-field';
}

function buildTriggerResolutionStep(step: CodegenStep): CodegenStep {
  return {
    ...step,
    selector: step.triggerSelector ?? step.selector,
    selectorPriority: step.triggerSelectorPriority ?? step.selectorPriority,
    fingerprint: step.triggerFingerprint ?? step.fingerprint,
  };
}

function getTriggerContextLabel(step: CodegenStep): string | null {
  const triggerStep = buildTriggerResolutionStep(step);
  const attrs = inferStepSignalAttributes(triggerStep);
  const candidates = [
    attrs.fieldLabelText,
    attrs.associatedLabelText,
    attrs.wrappedLabelText,
    attrs.labelledByText,
    step.triggerFingerprint?.textExcerpt ?? undefined,
    step.fingerprint?.attributes?.fieldLabelText ?? undefined,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    if (trimmed === '-- Select --' || trimmed === 'Select') continue;
    if (step.optionText && normalizeLabelContextText(trimmed) === normalizeLabelContextText(step.optionText)) continue;
    if (step.optionValue && normalizeLabelContextText(trimmed) === normalizeLabelContextText(step.optionValue)) continue;
    return trimmed;
  }

  return null;
}

function isSelectLikeTriggerStep(step: CodegenStep): boolean {
  const family = (step.controlFamily || '').toLowerCase();
  return (
    step.action === 'custom-control-open' ||
    (step.action === 'custom-select' && ['combobox', 'listbox', 'select', 'dropdown'].includes(family))
  );
}

function isTriggerSelectorDirectAndStrong(step: CodegenStep): boolean {
  const triggerStep = buildTriggerResolutionStep(step);
  return hasStrongDirectSelectorEvidence(triggerStep);
}

function isWeakLabelContextFallbackCandidate(
  step: CodegenStep,
  snapshotSelection?: SnapshotSelectionProvenance,
): boolean {
  if (step.action !== 'input') return false;
  if (hasStrongDirectSelectorEvidence(step)) return false;
  if (!getFieldLabelText(step)) return false;
  if (snapshotSelection?.labelStructureEvidence !== true) return false;
  const priority = step.selectorPriority ?? 'unknown';
  return priority === 'class' || priority === 'path' || priority === 'unknown' || priority === 'other';
}

function findVisibleTargetForOriginalSelectorWithReason(
  step: CodegenStep,
  snapshot: Document,
): { target: Element | null; blockedReason?: string } {
  if (!step.selector || !isLikelyCssSelector(step.selector)) {
    return { target: null, blockedReason: 'label_structure_missing' };
  }
  try {
    const matches = Array.from(snapshot.querySelectorAll(step.selector)).filter(isVisibleElement);
    if (matches.length === 1) return { target: matches[0] ?? null };
    if (matches.length > 1) return { target: null, blockedReason: 'target_selector_ambiguous' };
    return { target: null, blockedReason: 'target_missing' };
  } catch {
    return { target: null, blockedReason: 'target_selector_ambiguous' };
  }
}

function findVisibleElementsForSelector(
  selector: string | null | undefined,
  snapshot: Document,
): { matches: Element[]; blockedReason?: string } {
  const normalized = (selector || '').trim();
  if (!normalized || !isLikelyCssSelector(normalized)) {
    return { matches: [], blockedReason: 'label_structure_missing' };
  }
  try {
    const matches = Array.from(snapshot.querySelectorAll(normalized)).filter(isVisibleElement);
    if (matches.length === 0) return { matches: [], blockedReason: 'target_missing' };
    return { matches };
  } catch {
    return { matches: [], blockedReason: 'target_selector_ambiguous' };
  }
}

function isStableRecoverableId(id: string | null | undefined): id is string {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!trimmed) return false;
  return !isVeryOpaqueMixedId(trimmed) && !hasOpaqueHyphenatedSegments(trimmed);
}

type ContainerSelectorKind = 'data-testid' | 'data-cy' | 'data-qa' | 'id' | 'semantic-class' | 'framework-class' | 'unsafe';

function classifySemanticContainerClass(stableClass: string | null | undefined): boolean {
  if (!stableClass) return false;
  return !(
    isUtilityClassToken(stableClass) ||
    isCssInJsClassToken(stableClass) ||
    isHashedRandomClassToken(stableClass) ||
    isStateClassToken(stableClass) ||
    isFrameworkClassToken(stableClass) ||
    isGenericShellClassToken(stableClass)
  );
}

function deriveSafeContainerSelector(container: Element): { selector: string | null; kind: ContainerSelectorKind } {
  const attrs = {
    id: container.getAttribute('id') || (container as HTMLElement).id || undefined,
    dataTestId: container.getAttribute('data-testid') || undefined,
    dataCy: container.getAttribute('data-cy') || undefined,
    dataQa: container.getAttribute('data-qa') || undefined,
    class: container.getAttribute('class') || undefined,
  };
  const tagName = container.tagName?.toLowerCase() || 'div';
  if (attrs.dataTestId) return { selector: `[data-testid="${cssEscape(attrs.dataTestId)}"]`, kind: 'data-testid' };
  if (attrs.dataCy) return { selector: `[data-cy="${cssEscape(attrs.dataCy)}"]`, kind: 'data-cy' };
  if (attrs.dataQa) return { selector: `[data-qa="${cssEscape(attrs.dataQa)}"]`, kind: 'data-qa' };
  if (isStableRecoverableId(attrs.id)) return { selector: buildIdSelectors(attrs.id)[0] ?? null, kind: 'id' };
  const stableClass = findStableClassFromAttributes(attrs.class);
  if (stableClass) {
    return {
      selector: `${tagName}.${cssEscape(stableClass)}`,
      kind: classifySemanticContainerClass(stableClass) ? 'semantic-class' : 'framework-class',
    };
  }
  return { selector: null, kind: 'unsafe' };
}

function summarizeContainer(container: Element): string {
  const tagName = container.tagName?.toLowerCase() || 'div';
  const className = (container.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
  if (className) return `${tagName}.${className}`;
  const role = container.getAttribute('role');
  if (role) return `${tagName}[role="${role}"]`;
  return tagName;
}

function buildLabelContextSyntheticSelector(labelContext: LabelContextSelectorSpec): string {
  const containerHint = labelContext.containerSelector || labelContext.boundedContainerSummary;
  if (containerHint) {
    return `label-context("${labelContext.labelText}" within ${containerHint} -> ${labelContext.targetTag})`;
  }
  return `label-context("${labelContext.labelText}" -> ${labelContext.targetTag})`;
}

function buildTriggerContextSyntheticSelector(triggerContext: TriggerContextSelectorSpec): string {
  const containerHint = triggerContext.containerSelector || triggerContext.boundedContainerSummary;
  if (containerHint) {
    return `trigger-context("${triggerContext.labelText}" within ${containerHint} -> ${triggerContext.triggerSelector})`;
  }
  return `trigger-context("${triggerContext.labelText}" -> ${triggerContext.triggerSelector})`;
}

function deriveSafeTriggerChildSelector(
  target: Element,
  triggerSelector: string,
  container: Element,
): string | null {
  const normalizedTrigger = (triggerSelector || '').trim();
  if (normalizedTrigger) {
    try {
      const matches = Array.from(container.querySelectorAll(normalizedTrigger)).filter(isVisibleElement);
      if (matches.length === 1 && matches[0] === target) return normalizedTrigger;
    } catch {
      // Ignore invalid selector fragments and continue to safer fallbacks.
    }
  }

  const tagName = target.tagName?.toLowerCase() || 'div';
  const role = (target.getAttribute('role') || '').toLowerCase();
  const hasPopup = (target.getAttribute('aria-haspopup') || '').toLowerCase();
  if (role === 'combobox') return '[role="combobox"]';
  if (role === 'button' && hasPopup) return `[role="button"][aria-haspopup="${cssEscape(hasPopup)}"]`;
  if (hasPopup === 'listbox' || hasPopup === 'combobox') return `[aria-haspopup="${cssEscape(hasPopup)}"]`;
  if (tagName === 'select') return 'select';

  const stableClass = findStableClassFromAttributes(target.getAttribute('class') || undefined);
  if (stableClass && classifySemanticContainerClass(stableClass)) {
    return `${tagName}.${cssEscape(stableClass)}`;
  }

  return null;
}

function findVisibleTargetForOriginalSelector(step: CodegenStep, snapshot: Document): Element | null {
  return findVisibleTargetForOriginalSelectorWithReason(step, snapshot).target;
}

function buildLabelContextCandidates(
  step: CodegenStep,
  snapshot: Document,
  snapshotSelection?: SnapshotSelectionProvenance,
): RawCandidate[] {
  if (!isWeakLabelContextFallbackCandidate(step, snapshotSelection)) return [];
  const fieldLabelText = getFieldLabelText(step);
  if (!fieldLabelText) return [];
  const targetResolution = findVisibleTargetForOriginalSelectorWithReason(step, snapshot);
  const target = targetResolution.target;
  if (!target) return [];

  const normalizedFieldLabel = normalizeLabelContextText(fieldLabelText);
  let labels: Element[] = [];
  try {
    labels = Array.from(snapshot.querySelectorAll('label')).filter(label =>
      normalizeLabelContextText(label.textContent || '') === normalizedFieldLabel,
    );
  } catch {
    labels = [];
  }
  if (labels.length !== 1) return [];

  const label = labels[0];
  const tagName = (target.tagName?.toLowerCase() || step.fingerprint?.tagName?.toLowerCase() || 'input') as LabelContextSelectorSpec['targetTag'];
  const baseLabelContext: Omit<LabelContextSelectorSpec, 'association'> = {
    source: 'snapshot-label-context',
    labelText: fieldLabelText,
    targetTag: tagName === 'textarea' || tagName === 'select' ? tagName : 'input',
    snapshotSource: snapshotSelection?.labelContextSnapshotSource ?? snapshotSelection?.source ?? 'unavailable',
    labelStructureEvidenceReason: snapshotSelection?.labelStructureEvidenceReason ?? null,
    recoveredFromSelector: step.selector,
  };

  const labelFor = label.getAttribute('for');
  const targetId = target.getAttribute('id') || (target as HTMLElement).id || null;
  if (labelFor && targetId && labelFor === targetId && isStableRecoverableId(targetId)) {
    const labelContext: LabelContextSelectorSpec = {
      ...baseLabelContext,
      association: 'label-for',
      targetId,
      renderStatus: 'clean-direct-selector',
      renderReason: 'label_for_stable_id',
      cleanChildSelector: buildIdSelectors(targetId)[0] ?? undefined,
    };
    return buildIdSelectors(targetId).map(selector => ({
      selector,
      source: 'label-context' as const,
      engine: 'css' as const,
      categoryOverride: 'id' as const,
      labelContext,
      rank: 2,
    }));
  }

  const ariaLabelledBy = target.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const ids = ariaLabelledBy.split(/\s+/).filter(Boolean);
    const referencedExact = ids.some(id => {
      const referenced = snapshot.getElementById?.(id) ?? null;
      return !!referenced && normalizeLabelContextText(referenced.textContent || '') === normalizedFieldLabel;
    });
    if (referencedExact) {
      const selector = `${baseLabelContext.targetTag}[aria-labelledby="${cssEscape(ariaLabelledBy)}"]`;
      return [{
        selector,
        source: 'label-context',
        engine: 'css',
        categoryOverride: 'aria-label',
        labelContext: {
          ...baseLabelContext,
          association: 'aria-labelledby',
          ariaLabelledBy,
          renderStatus: 'clean-direct-selector',
          renderReason: 'aria_labelledby_exact',
          cleanChildSelector: selector,
        },
        rank: 3,
      }];
    }
  }

  if (label.contains(target) && getVisibleInputLikeControls(label).length === 1) {
    const labelContext: LabelContextSelectorSpec = {
      ...baseLabelContext,
      association: 'wrapped-label',
      renderStatus: 'proven-structural-fallback',
      renderReason: 'wrapped_label_exact',
      warningCodes: ['label-context-structural-fallback'],
    };
    return [{
      selector: buildLabelContextSyntheticSelector(labelContext),
      source: 'label-context',
      engine: 'label-context',
      categoryOverride: 'label-context',
      labelContext,
      rank: 5,
    }];
  }

  const boundedContainer = findTightFieldContainer(label, target);
  if (!boundedContainer.container) return [];
  const visibleControls = getVisibleInputLikeControls(boundedContainer.container);
  if (visibleControls.length !== 1 || visibleControls[0] !== target) return [];
  const containerDescriptor = deriveSafeContainerSelector(boundedContainer.container);
  const containerSelector = containerDescriptor.selector;
  if (!containerSelector) return [];
  const matchingVisibleContainers = Array.from(snapshot.querySelectorAll(containerSelector)).filter(isVisibleElement);
  const cleanParentSelector =
    matchingVisibleContainers.length === 1 &&
    ['data-testid', 'data-cy', 'data-qa', 'id', 'semantic-class'].includes(containerDescriptor.kind)
      ? containerSelector
      : undefined;

  const labelContext: LabelContextSelectorSpec = {
    ...baseLabelContext,
    association: 'bounded-field',
    containerSelector,
    boundedContainerSummary: summarizeContainer(boundedContainer.container),
    renderStatus: cleanParentSelector ? 'clean-scoped-locator' : 'proven-structural-fallback',
    renderReason: cleanParentSelector ? 'clean_parent_unique_visible' : 'no_clean_parent_selector',
    cleanParentSelector,
    cleanChildSelector: tagName === 'textarea' || tagName === 'select' ? tagName : 'input',
    warningCodes: cleanParentSelector ? [] : ['label-context-structural-fallback', 'label-context-no-clean-parent'],
  };
  return [{
    selector: buildLabelContextSyntheticSelector(labelContext),
    source: 'label-context',
    engine: 'label-context',
    categoryOverride: 'label-context',
    labelContext,
    rank: 5,
  }];
}

function buildTriggerContextCandidates(
  step: CodegenStep,
  snapshot: Document,
  snapshotSelection?: SnapshotSelectionProvenance,
): RawCandidate[] {
  if (!isSelectLikeTriggerStep(step)) return [];
  const triggerSelector = (step.triggerSelector || '').trim();
  if (!triggerSelector || !isLikelyCssSelector(triggerSelector)) return [];
  if (isTriggerSelectorDirectAndStrong(step)) return [];

  const labelText = getTriggerContextLabel(step);
  if (!labelText) return [];

  const triggerMatches = findVisibleElementsForSelector(triggerSelector, snapshot);
  if (triggerMatches.matches.length <= 1) return [];

  const proofs: Array<{
    target: Element;
    container: Element;
    labelElement: Element;
  }> = [];
  for (const match of triggerMatches.matches) {
    const bounded = findTightTriggerContainer(match, labelText);
    if (bounded.container && bounded.labelElement) {
      proofs.push({
        target: match,
        container: bounded.container,
        labelElement: bounded.labelElement,
      });
      continue;
    }
  }

  if (proofs.length !== 1) return [];

  const proof = proofs[0];
  const containerDescriptor = deriveSafeContainerSelector(proof.container);
  const containerSelector = containerDescriptor.selector;
  if (!containerSelector) return [];

  const matchingVisibleContainers = Array.from(snapshot.querySelectorAll(containerSelector)).filter(isVisibleElement);
  const cleanParentSelector =
    matchingVisibleContainers.length === 1 &&
    ['data-testid', 'data-cy', 'data-qa', 'id', 'semantic-class'].includes(containerDescriptor.kind)
      ? containerSelector
      : undefined;

  const cleanChildSelector = deriveSafeTriggerChildSelector(proof.target, triggerSelector, proof.container);
  if (!cleanChildSelector) return [];

  const renderStatus: LabelContextRenderStatus = cleanParentSelector
    ? 'clean-scoped-locator'
    : 'proven-structural-fallback';
  const warningCodes = cleanParentSelector
    ? []
    : ['custom-control-trigger-structural-fallback'];

  const triggerContext: TriggerContextSelectorSpec = {
    source: 'snapshot-trigger-context',
    labelText,
    controlFamily: step.controlFamily,
    association: 'bounded-field',
    triggerSelector: cleanChildSelector,
    containerSelector,
    labelElementTag: proof.labelElement.tagName?.toLowerCase() || 'label',
    boundedContainerSummary: summarizeContainer(proof.container),
    snapshotSource: snapshotSelection?.source ?? 'unavailable',
    recoveredFromSelector: step.triggerSelector,
    renderStatus,
    renderReason: cleanParentSelector
      ? 'clean_parent_unique_visible'
      : 'no_clean_parent_selector',
    cleanParentSelector,
    cleanChildSelector,
    warningCodes,
  };

  return [{
    selector: buildTriggerContextSyntheticSelector(triggerContext),
    source: 'trigger-context',
    engine: 'trigger-context',
    categoryOverride: 'label-context',
    triggerContext,
    rank: 5,
  }];
}

function validateCandidate(
  selectorOrCandidate: string | RawCandidate,
  snapshot: Document,
  step?: CodegenStep,
): CandidateValidation {
  if (typeof selectorOrCandidate === 'string') {
    const selector = selectorOrCandidate;
    return isTextSelector(selector)
      ? validateTextCandidate(selector, snapshot, step)
      : validateCSSCandidate(selector, snapshot, step);
  }

  return validateRawCandidate(selectorOrCandidate, snapshot, step);
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
  if (isKnownShellSelector(candidateSelector)) return true;

  // Block generic parent-child overrides like "div input"
  const parts = candidateSelector.split(/\s+|>/);
  if (parts.length > 1) {
    const parent = parts[0].trim();
    if (isGenericContainerSelector(parent)) return true;
  }

  return false;
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

  if (
    step.action === 'click' ||
    step.action === 'custom-control-open' ||
    step.action === 'custom-select' ||
    step.action === 'custom-menu-select' ||
    step.action === 'hover'
  ) {
    return true;
  }

  return false;
}

export function shouldKeepOriginal(
  step: CodegenStep,
  snapshot: Document,
  config: ResolverConfig,
  snapshotSelection?: SnapshotSelectionProvenance,
): boolean {
  if (!step.selector) return false;
  if (isWeakBoundedFieldInputCandidate(step)) return false;
  if (isWeakLabelContextFallbackCandidate(step, snapshotSelection)) return false;
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
  extras: Partial<Pick<RawCandidate, 'engine' | 'categoryOverride' | 'boundedField' | 'labelContext' | 'triggerContext'>> = {},
): void {
  const normalized = (selector || '').trim();
  if (!normalized) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  candidates.push({ selector: normalized, source, rank, ...extras });
}

export function generateCandidates(
  step: CodegenStep,
  snapshot: Document,
  snapshotSelection?: SnapshotSelectionProvenance,
): RawCandidate[] {
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

  for (const candidate of buildBoundedFieldCandidates({ step, snapshot, snapshotSelection })) {
    pushCandidate(
      candidates,
      seen,
      candidate.selector,
      candidate.source,
      candidate.rank,
      {
        engine: candidate.engine,
        categoryOverride: candidate.categoryOverride,
        boundedField: candidate.boundedField,
      },
    );
  }

  for (const candidate of buildLabelContextCandidates(step, snapshot, snapshotSelection)) {
    pushCandidate(
      candidates,
      seen,
      candidate.selector,
      candidate.source,
      candidate.rank,
      {
        engine: candidate.engine,
        categoryOverride: candidate.categoryOverride,
        labelContext: candidate.labelContext,
      },
    );
  }

  if (attrs.dataTestId) {
    pushCandidate(candidates, seen, `[data-testid="${cssEscape(attrs.dataTestId)}"]`, 'testid', 1);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[data-testid="${cssEscape(attrs.dataTestId)}"]`, 'testid', 1);
    }
  }

  if (attrs.dataCy) {
    pushCandidate(candidates, seen, `[data-cy="${cssEscape(attrs.dataCy)}"]`, 'data-cy', 1);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[data-cy="${cssEscape(attrs.dataCy)}"]`, 'data-cy', 1);
    }
  }

  if (attrs.dataQa) {
    pushCandidate(candidates, seen, `[data-qa="${cssEscape(attrs.dataQa)}"]`, 'data-qa', 1);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[data-qa="${cssEscape(attrs.dataQa)}"]`, 'data-qa', 1);
    }
  }

  if (attrs.id) {
    for (const selector of buildIdSelectors(attrs.id)) {
      pushCandidate(candidates, seen, selector, 'id', 2);
    }
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

  if (attrs.ariaLabelledBy) {
    pushCandidate(candidates, seen, `[aria-labelledby="${cssEscape(attrs.ariaLabelledBy)}"]`, 'other', 4);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[aria-labelledby="${cssEscape(attrs.ariaLabelledBy)}"]`, 'other', 4);
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

  if (attrs.autocomplete) {
    pushCandidate(candidates, seen, `[autocomplete="${cssEscape(attrs.autocomplete)}"]`, 'other', 4);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[autocomplete="${cssEscape(attrs.autocomplete)}"]`, 'other', 4);
    }
  }

  if (attrs.title) {
    pushCandidate(candidates, seen, `[title="${cssEscape(attrs.title)}"]`, 'other', 4);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[title="${cssEscape(attrs.title)}"]`, 'other', 4);
    }
  }

  if (attrs.role) {
    pushCandidate(candidates, seen, `[role="${cssEscape(attrs.role)}"]`, 'role+name', 3);
  }

  if (attrs.href) {
    pushCandidate(candidates, seen, `[href="${cssEscape(attrs.href)}"]`, 'href', 3);
    if (tagName) {
      pushCandidate(candidates, seen, `${tagName}[href="${cssEscape(attrs.href)}"]`, 'href', 3);
    }
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
    if (attrs.dataCy) pushCandidate(candidates, seen, `${scopedBase} [data-cy="${cssEscape(attrs.dataCy)}"]`, 'parent-scope', 2);
    if (attrs.dataQa) pushCandidate(candidates, seen, `${scopedBase} [data-qa="${cssEscape(attrs.dataQa)}"]`, 'parent-scope', 2);
    if (attrs.id) {
      for (const selector of buildIdSelectors(attrs.id)) {
        pushCandidate(candidates, seen, `${scopedBase} ${selector}`, 'parent-scope', 2);
      }
    }
    if (attrs.name) pushCandidate(candidates, seen, `${scopedBase} [name="${cssEscape(attrs.name)}"]`, 'parent-scope', 4);
    if (attrs.href) pushCandidate(candidates, seen, `${scopedBase} [href="${cssEscape(attrs.href)}"]`, 'parent-scope', 4);
    if (attrs.ariaLabel) pushCandidate(candidates, seen, `${scopedBase} [aria-label="${cssEscape(attrs.ariaLabel)}"]`, 'parent-scope', 4);
    if (attrs.ariaLabelledBy) pushCandidate(candidates, seen, `${scopedBase} [aria-labelledby="${cssEscape(attrs.ariaLabelledBy)}"]`, 'parent-scope', 4);
    if (attrs.placeholder) pushCandidate(candidates, seen, `${scopedBase} [placeholder="${cssEscape(attrs.placeholder)}"]`, 'parent-scope', 4);
    if (attrs.autocomplete) pushCandidate(candidates, seen, `${scopedBase} [autocomplete="${cssEscape(attrs.autocomplete)}"]`, 'parent-scope', 4);
    if (attrs.title) pushCandidate(candidates, seen, `${scopedBase} [title="${cssEscape(attrs.title)}"]`, 'parent-scope', 4);
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

function normalizeComparablePath(href?: string | null): string | null {
  if (typeof href !== 'string') return null;
  const trimmed = href.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed, 'https://air.local');
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return pathname.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '') || '/';
  }
}

function normalizeSemanticText(value?: string | null): string {
  if (typeof value !== 'string') return '';
  return normalizeTextForMatch(value.replace(/[^\w\s-]+/g, ' '));
}

function extractOriginalMeaningfulText(step: CodegenStep): string | null {
  const text = step.fingerprint?.textExcerpt
    || (isTextSelector(step.selector) ? extractTextExcerpt(step) : null);
  if (typeof text !== 'string') return null;
  const normalized = normalizeSemanticText(text);
  if (!normalized || normalized.length < 2) return null;
  return normalized;
}

function normalizeSignalValue(signal: SemanticTextSignal | string): string {
  return typeof signal === 'string'
    ? normalizeSemanticText(signal)
    : normalizeSemanticText(signal.value);
}

function textSignalsAlign(
  originalSignals: Array<SemanticTextSignal | string>,
  candidateSignals: Array<SemanticTextSignal | string>,
): { matched: boolean; reasons: string[] } {
  const normalizedOriginals = originalSignals
    .map(signal => ({
      source: typeof signal === 'string' ? 'text' : signal.source,
      value: normalizeSignalValue(signal),
    }))
    .filter(signal => signal.value.length > 0);
  const normalizedCandidates = candidateSignals
    .map(signal => ({
      source: typeof signal === 'string' ? 'text' : signal.source,
      value: normalizeSignalValue(signal),
    }))
    .filter(signal => signal.value.length > 0);

  if (normalizedOriginals.length === 0 || normalizedCandidates.length === 0) {
    return { matched: false, reasons: [] };
  }

  const reasons = new Set<string>();
  for (const original of normalizedOriginals) {
    const originalTokens = original.value.split(/\s+/).filter(Boolean);
    const compactOriginal = original.value.replace(/\s+/g, '');
    for (const candidate of normalizedCandidates) {
      const compactCandidate = candidate.value.replace(/\s+/g, '');
      if (
        compactCandidate === compactOriginal ||
        candidate.value === original.value ||
        candidate.value.includes(original.value) ||
        original.value.includes(candidate.value)
      ) {
        reasons.add(`text_match:${candidate.source}`);
        return { matched: true, reasons: Array.from(reasons) };
      }
      const candidateTokens = new Set(candidate.value.split(/\s+/).filter(Boolean));
      if (originalTokens.length > 0 && originalTokens.every(token => candidateTokens.has(token))) {
        reasons.add(`text_match:${candidate.source}`);
        return { matched: true, reasons: Array.from(reasons) };
      }
    }
  }

  return { matched: false, reasons: [] };
}

function collectStepPrimarySemanticSignals(step: CodegenStep): SemanticTextSignal[] {
  const attrs = inferStepSignalAttributes(step);
  const signals: SemanticTextSignal[] = [];
  const push = (value: string | undefined | null, source: string): void => {
    const normalized = normalizeSemanticText(value);
    if (!normalized) return;
    if (signals.some(signal => signal.value === normalized && signal.source === source)) return;
    signals.push({ value: normalized, source });
  };

  push(step.fingerprint?.textExcerpt || undefined, 'fingerprint_text');
  push(attrs.ariaLabel, 'fingerprint_aria_label');
  push(attrs.labelledByText, 'fingerprint_labelledby_text');
  push(attrs.associatedLabelText, 'fingerprint_associated_label');
  push(attrs.wrappedLabelText, 'fingerprint_wrapped_label');
  push(attrs.fieldLabelText, 'fingerprint_field_label');
  push(attrs.placeholder, 'fingerprint_placeholder');
  push(attrs.autocomplete, 'fingerprint_autocomplete');
  push(attrs.title, 'fingerprint_title');
  push(attrs.alt, 'fingerprint_alt');
  push(attrs.describedByText, 'fingerprint_describedby_text');

  return signals;
}

function collectStepPositiveSemanticSignals(step: CodegenStep): SemanticTextSignal[] {
  const attrs = inferStepSignalAttributes(step);
  const signals = collectStepPrimarySemanticSignals(step);
  const normalizedValue = normalizeSemanticText(attrs.value);
  if (normalizedValue) {
    signals.push({ value: normalizedValue, source: 'fingerprint_value' });
  }
  return signals;
}

function collectCandidatePrimarySemanticSignals(element: Element, snapshot: Document): SemanticTextSignal[] {
  return getElementSemanticTextSignals(element, snapshot)
    .filter(signal => signal.source !== 'value' && signal.source !== 'parent_wrapper_text');
}

function collectCandidatePositiveSemanticSignals(element: Element, snapshot: Document): SemanticTextSignal[] {
  return getElementSemanticTextSignals(element, snapshot)
    .filter(signal => signal.source !== 'parent_wrapper_text');
}

function hasParentSelectorMatch(step: CodegenStep, element: Element, snapshot: Document): boolean {
  const parentSelector = step.fingerprint?.parentSelector;
  if (!parentSelector || !isLikelyCssSelector(parentSelector)) return false;
  try {
    const scopes = Array.from(snapshot.querySelectorAll(parentSelector)).slice(0, 25);
    let current: Element | null = element;
    while (current) {
      if (scopes.includes(current)) return true;
      current = current.parentElement;
    }
  } catch {
    return false;
  }
  return false;
}

function collectContextCompatibilityReasons(
  step: CodegenStep,
  element: Element,
  snapshot: Document,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const stepParentTag = (step.fingerprint?.context?.parentTag || '').toLowerCase();
  const stepNearestContainerTag = (step.fingerprint?.context?.nearestContainerTag || '').toLowerCase();
  const elementHints = getElementContextHints(element);

  if (stepParentTag && elementHints.parentTag && stepParentTag === elementHints.parentTag) {
    score += 0.08;
    reasons.push(`parent_tag_match:${stepParentTag}`);
  }

  if (
    stepNearestContainerTag &&
    elementHints.nearestContainerTag &&
    stepNearestContainerTag === elementHints.nearestContainerTag
  ) {
    score += 0.1;
    reasons.push(`nearest_container_match:${stepNearestContainerTag}`);
  }

  if (hasParentSelectorMatch(step, element, snapshot)) {
    score += 0.12;
    reasons.push('parent_selector_match');
  }

  return { score, reasons };
}

interface SemanticCompatibilityEvaluation {
  score: number;
  reasons: string[];
  rejectReason: ResolverRejectReason | null;
}

function collectCompatibilityEvidence(
  step: CodegenStep,
  element: Element,
  snapshot: Document,
): SemanticCompatibilityEvaluation {
  const originalAttrs = inferStepSignalAttributes(step);
  const originalHref = normalizeComparablePath(originalAttrs.href);
  const candidateHref = normalizeComparablePath(element.getAttribute('href'));
  if (originalHref && candidateHref && originalHref !== candidateHref) {
    return {
      score: 0,
      reasons: ['href_mismatch'],
      rejectReason: 'href_mismatch',
    };
  }

  const originalFamily = inferStepControlFamily(step);
  const candidateFamily = inferElementControlFamily(element);
  if (shouldRejectControlFamily(originalFamily, candidateFamily)) {
    return {
      score: 0,
      reasons: [`control_family_mismatch:${originalFamily}->${candidateFamily}`],
      rejectReason: 'control_family_mismatch',
    };
  }

  const primaryOriginalSignals = collectStepPrimarySemanticSignals(step);
  const primaryCandidateSignals = collectCandidatePrimarySemanticSignals(element, snapshot);
  const primaryTextMatch = textSignalsAlign(primaryOriginalSignals, primaryCandidateSignals);
  if (
    primaryOriginalSignals.length > 0 &&
    primaryCandidateSignals.length > 0 &&
    !primaryTextMatch.matched
  ) {
    return {
      score: 0,
      reasons: ['text_mismatch'],
      rejectReason: 'text_mismatch',
    };
  }

  let score = 0.25;
  const reasons: string[] = [];

  if (originalFamily === candidateFamily || (originalFamily === 'button' && candidateFamily === 'icon-button')) {
    score += 0.2;
    reasons.push(`control_family_match:${candidateFamily}`);
  }

  if (originalHref && candidateHref && originalHref === candidateHref) {
    score += 0.2;
    reasons.push('href_match');
  }

  if (primaryTextMatch.matched) {
    score += 0.3;
    reasons.push(...primaryTextMatch.reasons);
  }

  const positiveTextMatch = textSignalsAlign(
    collectStepPositiveSemanticSignals(step),
    collectCandidatePositiveSemanticSignals(element, snapshot),
  );
  if (positiveTextMatch.matched) {
    score += 0.08;
    reasons.push(...positiveTextMatch.reasons.filter(reason => !reasons.includes(reason)));
  }

  const contextCompatibility = collectContextCompatibilityReasons(step, element, snapshot);
  score += contextCompatibility.score;
  reasons.push(...contextCompatibility.reasons);

  return {
    score: Math.max(0, Math.min(1, score)),
    reasons,
    rejectReason: null,
  };
}

function compareSemanticCandidates(
  left: { candidate: CandidateScore; semantic: SemanticCompatibilityEvaluation; selectorEvaluation: SelectorEvaluation },
  right: { candidate: CandidateScore; semantic: SemanticCompatibilityEvaluation; selectorEvaluation: SelectorEvaluation },
): number {
  if (right.selectorEvaluation.scoring.proofScore !== left.selectorEvaluation.scoring.proofScore) {
    return right.selectorEvaluation.scoring.proofScore - left.selectorEvaluation.scoring.proofScore;
  }
  if (right.semantic.score !== left.semantic.score) {
    return right.semantic.score - left.semantic.score;
  }
  if (right.selectorEvaluation.scoring.finalScore !== left.selectorEvaluation.scoring.finalScore) {
    return right.selectorEvaluation.scoring.finalScore - left.selectorEvaluation.scoring.finalScore;
  }
  if (right.selectorEvaluation.scoring.stabilityScore !== left.selectorEvaluation.scoring.stabilityScore) {
    return right.selectorEvaluation.scoring.stabilityScore - left.selectorEvaluation.scoring.stabilityScore;
  }
  return compareCandidates(left.candidate, right.candidate);
}

function inferStepControlFamily(step: CodegenStep): ControlFamily {
  const attrs = inferStepSignalAttributes(step);
  const selector = (step.selector || step.fingerprint?.selector || '').toLowerCase();
  const text = normalizeSemanticText(step.fingerprint?.textExcerpt || '');
  const role = (attrs.role || '').toLowerCase();
  const tagName = (step.fingerprint?.tagName || attrs.tagName || '').toLowerCase();
  const type = (attrs.type || '').toLowerCase();
  const hasPopup = normalizeSemanticText((step.fingerprint?.attributes?.['aria-haspopup']) || '');

  if ((role === 'button' || tagName === 'button') && !text && (attrs.ariaLabel || attrs.title || attrs.alt)) {
    return 'icon-button';
  }
  if (role === 'menuitem') return 'menuitem';
  if (role === 'link') return 'nav-link';
  if (role === 'combobox') return 'combobox';
  if (type === 'password') return 'password-input';
  if (type === 'submit' || step.action === 'submit') return 'submit-button';
  if (attrs.href || tagName === 'a' || selector.startsWith('a') || selector.includes('[href=')) return 'nav-link';
  if (role === 'button' || tagName === 'button') return 'button';
  if (tagName === 'select') return 'combobox';
  if (role === 'textbox' || role === 'searchbox' || tagName === 'input' || tagName === 'textarea') {
    return type === 'password' ? 'password-input' : 'text-input';
  }
  if (
    step.action === 'custom-control-open' ||
    step.action === 'custom-select' ||
    step.action === 'custom-menu-select' ||
    text === '-- select --' ||
    selector.includes('select') ||
    role === 'listbox' ||
    hasPopup === 'listbox' ||
    hasPopup === 'combobox'
  ) {
    return 'select-trigger';
  }
  return 'generic-container';
}

function inferElementControlFamily(element: Element | null): ControlFamily {
  if (!element) return 'generic-container';
  const tagName = (((element as HTMLElement).tagName) || '').toLowerCase();
  const role = (element.getAttribute('role') || '').toLowerCase();
  const type = (element.getAttribute('type') || '').toLowerCase();
  const placeholder = normalizeSemanticText(element.getAttribute('placeholder') || '');
  const hasPopup = normalizeSemanticText(element.getAttribute('aria-haspopup') || '');
  const signals = getElementSemanticTextSignals(element);
  const hasExplicitIconText = signals.some(signal =>
    ['aria_label', 'title', 'alt', 'icon_child_svg_title', 'icon_child_alt', 'icon_child_aria_label', 'icon_child_title'].includes(signal.source),
  );

  if (role === 'menuitem') return 'menuitem';
  if (role === 'link') return 'nav-link';
  if (role === 'combobox' || role === 'listbox' || tagName === 'select') return 'combobox';
  if (type === 'password') return 'password-input';
  if (type === 'submit') return 'submit-button';
  if (tagName === 'a' || !!element.getAttribute('href')) return 'nav-link';
  if ((tagName === 'button' || role === 'button') && hasExplicitIconText && !(element.textContent || '').trim()) {
    return 'icon-button';
  }
  if (tagName === 'button' || role === 'button') return 'button';
  if (tagName === 'input' || tagName === 'textarea' || role === 'textbox' || role === 'searchbox') {
    if (placeholder.includes('search') || type === 'search') return 'text-input';
    return 'text-input';
  }
  if (placeholder === '-- select --' || hasPopup === 'listbox' || hasPopup === 'combobox') return 'select-trigger';
  return 'generic-container';
}

function shouldRejectControlFamily(
  originalFamily: ControlFamily,
  candidateFamily: ControlFamily,
): boolean {
  if (originalFamily === candidateFamily) return false;
  if (originalFamily === 'icon-button') {
    return !['icon-button', 'button'].includes(candidateFamily);
  }
  if (originalFamily === 'select-trigger') {
    return candidateFamily === 'text-input' || candidateFamily === 'password-input' || candidateFamily === 'nav-link';
  }
  if (originalFamily === 'menuitem') {
    return candidateFamily !== 'menuitem';
  }
  if (originalFamily === 'nav-link') {
    return candidateFamily !== 'nav-link' && candidateFamily !== 'menuitem';
  }
  if (originalFamily === 'password-input') {
    return candidateFamily !== 'password-input';
  }
  if (originalFamily === 'text-input') {
    return !['text-input', 'password-input', 'combobox'].includes(candidateFamily);
  }
  if (originalFamily === 'submit-button') {
    return !['submit-button', 'button'].includes(candidateFamily);
  }
  return false;
}

function evaluateSemanticReject(
  step: CodegenStep,
  candidate: CandidateScore,
  snapshot: Document,
): SemanticCompatibilityEvaluation {
  if (candidate.candidate.selector === step.selector) {
    return {
      score: 0.5,
      reasons: ['original-selector-candidate'],
      rejectReason: null,
    };
  }

  const validation = candidate.validation;
  const element = validation.resolvedElement ?? getCandidateElement(snapshot, candidate.candidate.selector);
  if (!element) {
    return {
      score: 0,
      reasons: ['candidate-element-missing'],
      rejectReason: null,
    };
  }

  return collectCompatibilityEvidence(step, element, snapshot);
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

function selectorDepth(selector: string): number {
  return Math.max(0, (selector.match(/\s+/g)?.length ?? 0) + (selector.match(/>/g)?.length ?? 0));
}

function computeBrittlenessPenalty(selector: string, category: SelectorCategory): { penalty: number; reasons: string[] } {
  if (category === 'label-context') {
    return { penalty: 0.02, reasons: ['snapshot-label-context'] };
  }
  let penalty = 0;
  const reasons: string[] = [];
  const addPenalty = (amount: number, reason: string): void => {
    if (reasons.includes(reason)) return;
    penalty += amount;
    reasons.push(reason);
  };

  if (/nth-child|nth-of-type/i.test(selector)) addPenalty(0.22, 'nth-index-selector');
  const depth = selectorDepth(selector);
  if (depth >= 4) {
    addPenalty(0.14, 'deep-descendant-selector');
  } else if (depth >= 2) {
    addPenalty(0.05, 'descendant-selector');
  }
  if (selector.length >= 96) {
    addPenalty(0.12, 'very-long-selector');
  } else if (selector.length >= 56) {
    addPenalty(0.06, 'long-selector');
  }
  if (category === 'structural') addPenalty(0.16, 'structural-selector');
  if (category === 'parent-scoped' && depth >= 3) addPenalty(0.04, 'deep-parent-scope');
  if (/\.(?:container|wrapper|row|item|content|layout|shell|panel|section|body|header|footer)\b/i.test(selector)) {
    addPenalty(0.08, 'generic-shell-class');
  }

  return { penalty: Math.min(0.4, penalty), reasons };
}

function computeEvaluationFinalScore(params: {
  baselineScore: number;
  proofScore: number;
  stabilityScore: number;
  semanticScore: number;
  brittlenessPenalty: number;
  entropyPenalty: number;
}): number {
  return Math.max(0, Math.min(1.5, params.baselineScore));
}

function equivalentRenderingPriority(engine: EquivalentRendering['engine']): number {
  switch (engine) {
    case 'testid':
      return 1;
    case 'placeholder':
      return 2;
    case 'text':
      return 3;
    default:
      return 10;
  }
}

function sortPreferredRenderings(renderings: EquivalentRendering[]): EquivalentRendering[] {
  return [...renderings].sort((left, right) => {
    const leftPriority = equivalentRenderingPriority(left.engine);
    const rightPriority = equivalentRenderingPriority(right.engine);
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.locator.localeCompare(right.locator);
  });
}

function buildPreferredEquivalentRenderings(params: {
  selectorSpec: SelectorSpec;
  category: SelectorCategory;
  validation: CandidateValidation;
  resolvedElement?: Element | null;
}): EquivalentRendering[] {
  if (params.validation.effectiveMatchCount !== 1 || params.validation.reason !== 'unique-visible') {
    return [];
  }

  if (
    params.selectorSpec.engine === 'scoped' ||
    params.selectorSpec.engine === 'bounded-field' ||
    params.selectorSpec.engine === 'label-context' ||
    params.selectorSpec.engine === 'trigger-context'
  ) {
    return [];
  }

  const selector = params.selectorSpec.selector.trim();
  const renderings: EquivalentRendering[] = [];
  const addRendering = (rendering: EquivalentRendering): void => {
    if (renderings.some(existing => existing.engine === rendering.engine && existing.locator === rendering.locator)) {
      return;
    }
    renderings.push(rendering);
  };

  const exactTestId = extractAttributeValue(selector, 'data-testid');
  const hasAlternateTestIdAttr =
    /\[data-cy=(?:"[^"]+"|'[^']+')\]/i.test(selector) ||
    /\[data-qa=(?:"[^"]+"|'[^']+')\]/i.test(selector);
  if (params.category === 'testid' && exactTestId && !hasAlternateTestIdAttr) {
    addRendering({
      engine: 'testid',
      locator: `getByTestId(${JSON.stringify(exactTestId)})`,
      proofLevel: 'proven_equivalent',
      proofSource: 'attribute-equivalence',
      sourceSelector: selector,
      sourceEngine: params.selectorSpec.engine,
    });
  }

  const exactPlaceholder = extractAttributeValue(selector, 'placeholder');
  const resolvedTagName = params.resolvedElement?.tagName?.toLowerCase() ?? null;
  const explicitPlaceholderTagMatch = selector.match(/^\s*([a-z0-9_-]+)\s*\[placeholder=/i);
  const explicitPlaceholderTag = explicitPlaceholderTagMatch?.[1]?.toLowerCase() ?? null;
  const placeholderTagFamily = explicitPlaceholderTag ?? resolvedTagName;
  if (
    params.category === 'placeholder' &&
    exactPlaceholder &&
    (placeholderTagFamily === 'input' || placeholderTagFamily === 'textarea')
  ) {
    addRendering({
      engine: 'placeholder',
      locator: `getByPlaceholder(${JSON.stringify(exactPlaceholder)}, { exact: true })`,
      proofLevel: 'proven_equivalent',
      proofSource: 'attribute-equivalence',
      sourceSelector: selector,
      sourceEngine: params.selectorSpec.engine,
    });
  }

  if (
    params.category === 'text' &&
    selector.startsWith('text=') &&
    !/:has-text\(/i.test(selector)
  ) {
    const matchedText = params.resolvedElement
      ? textFromElement(params.resolvedElement)?.trim()
      : '';
    if (matchedText) {
      addRendering({
        engine: 'text',
        locator: `getByText(${JSON.stringify(matchedText)}, { exact: true })`,
        proofLevel: 'proven_equivalent',
        proofSource: 'text-equivalence',
        sourceSelector: selector,
        sourceEngine: params.selectorSpec.engine,
      });
    }
  }

  return sortPreferredRenderings(renderings).slice(0, 3);
}

function buildCandidateSelectorEvaluation(params: {
  step: CodegenStep;
  candidate: RawCandidate;
  validation: CandidateValidation;
  baselineScore: number;
  snapshotTargetEvidence?: boolean;
  semanticScore?: number;
  semanticReasons?: string[];
  semanticRejectReason?: string | null;
  proofLevel?: 'snapshot_validated' | 'semantic_validated' | 'unvalidated';
  proofSource?: 'snapshot' | 'semantic' | 'llm-validator' | 'none';
  source?: 'resolver' | 'llm';
  idEntropyScore?: number;
  idPenaltyReason?: string[];
  classEntropyScore?: number;
  classPenaltyReason?: string[];
  warningCodes?: string[];
}): SelectorEvaluation {
  const category = params.candidate.categoryOverride
    ?? classifySelectorCategory(params.candidate.selector, params.source ?? params.candidate.source);
  const proofLevel = params.proofLevel ?? (
    params.candidate.engine === 'bounded-field' &&
    params.candidate.boundedField?.source === 'recorded-bounded-field' &&
    !params.validation.resolvedElement &&
    params.validation.effectiveMatchCount === 1
      ? 'recorded'
      : (params.validation.effectiveMatchCount === 1 ? 'snapshot_validated' : 'unvalidated')
  );
  const selectorSpec = params.candidate.engine === 'bounded-field' && params.candidate.boundedField
    ? buildBoundedFieldSelectorSpec({
        selector: params.candidate.selector,
        boundedField: params.candidate.boundedField,
        source: params.source ?? 'resolver',
        proofLevel,
        rank: params.candidate.rank,
        confidence: params.validation.confidenceScore ?? params.baselineScore,
        warningCodes: params.warningCodes,
        rejectReason: params.semanticRejectReason ?? undefined,
      })
    : buildSelectorSpec({
        selector: params.candidate.selector,
        engine: params.candidate.engine as FlatSelectorEngine | undefined,
        source: params.source ?? 'resolver',
        proofLevel,
        labelContext: params.candidate.labelContext,
        triggerContext: params.candidate.triggerContext,
        rank: params.candidate.rank,
        confidence: params.validation.confidenceScore ?? params.baselineScore,
        warningCodes: params.warningCodes,
        rejectReason: params.semanticRejectReason ?? undefined,
      });
  let proofScore = proofScoreForValidation(params.validation);
  if (proofLevel === 'recorded') {
    proofScore = Math.max(proofScore, 1.0);
  }
  const brittleness = computeBrittlenessPenalty(params.candidate.selector, category);
  const entropyPenalty = Math.max(0, -(params.idEntropyScore ?? 0)) + Math.max(0, -(params.classEntropyScore ?? 0));
  const stabilityScore = Math.max(0, Math.min(1, stabilityBaseScoreForCategory(category) - (brittleness.penalty * 0.45) - (entropyPenalty * 0.35)));
  const semanticScore = Math.max(
    0,
    Math.min(
      1,
      params.semanticScore ??
        Math.max(
          params.validation.confidenceScore ?? 0,
          params.validation.effectiveMatchCount === 1 ? 0.5 : 0.2,
        ),
    ),
  );
  const reasons = Array.from(new Set([
    `category:${category}`,
    `proof:${proofLevel}`,
    ...(params.semanticReasons ?? []),
    ...(params.idPenaltyReason ?? []).map(reason => `id:${reason}`),
    ...(params.classPenaltyReason ?? []).map(reason => `class:${reason}`),
    ...brittleness.reasons,
  ]));
  const preferredRenderings = buildPreferredEquivalentRenderings({
    selectorSpec,
    category,
    validation: params.validation,
    resolvedElement: params.validation.resolvedElement,
  });

  return summarizeSelectorEvaluation(selectorSpec, {
    category,
    validation: {
      valid: params.validation.reason !== 'invalid-selector' && params.validation.visibleMatchCount > 0,
      matchCount: params.validation.matchCount ?? params.validation.totalMatchCount,
      visibleMatchCount: params.validation.visibleMatchCount,
      uniqueVisible: params.validation.effectiveMatchCount === 1,
      invalidReason: params.validation.reason === 'invalid-selector' ? 'invalid-selector' : undefined,
    },
    proofSource: params.proofSource ?? mapSelectorProofSource({ source: params.source ?? 'resolver', proofLevel }),
    snapshotTargetEvidence: params.snapshotTargetEvidence,
    proofScore,
    stabilityScore,
    semanticScore,
    brittlenessPenalty: brittleness.penalty,
    entropyPenalty,
    finalScore: computeEvaluationFinalScore({
      baselineScore: params.baselineScore,
      proofScore,
      stabilityScore,
      semanticScore,
      brittlenessPenalty: brittleness.penalty,
      entropyPenalty,
    }),
    reasons,
    warningCodes: params.warningCodes,
    rejectReason: params.semanticRejectReason,
    preferredRenderings,
  });
}

function computeBaselineCandidateScore(
  candidate: RawCandidate,
  validation: CandidateValidation,
  step: CodegenStep,
  snapshot?: Document,
): number {
  let score = rankScore(candidate.rank);
  if (validation.effectiveMatchCount === 1) score += 0.3;

  const excerpt = (extractTextExcerpt(step) || '').toLowerCase();
  if (excerpt && candidate.selector.toLowerCase().includes(excerpt)) score += 0.08;

  const tagName = step.fingerprint?.tagName?.toLowerCase();
  if (tagName && candidate.selector.toLowerCase().startsWith(tagName)) score += 0.06;
  if (candidate.source === 'parent-scope') score += 0.04;
  if (candidate.source === 'text') score += 0.02;
  if (isStructuredContextSource(candidate.source)) score += 0.16;

  score += (validation.confidenceScore ?? 0) * 0.25;
  if (!isStructuredContextSource(candidate.source)) {
    score -= complexityPenalty(candidate.selector);
    score -= volatilityPenalty(candidate.selector);
  }

  if (validation.reason === 'resolved-multi-match') score -= 0.08;
  if (validation.reason === 'too-broad') score -= 0.12;
  if (validation.ambiguityReason) score -= 0.22;

  const idEntropy = computeIdEntropy(step, candidate, validation, snapshot);
  score += idEntropy.adjustment;
  if (candidateUsesIdSelector(candidate)) {
    score = Math.max(score, 0.52);
  }

  const classEntropy = computeClassEntropy(step, candidate, validation, snapshot);
  score += classEntropy.adjustment;
  if (
    candidate.source === 'parent-scope' &&
    candidateUsesClassSelector(candidate) &&
    step.action === 'input' &&
    /\.[A-Za-z0-9:_-]*(?:date|calendar)[A-Za-z0-9:_-]*/i.test(candidate.selector)
  ) {
    score += 0.03;
  }
  if (candidateUsesClassSelector(candidate)) {
    score = Math.max(score, 0.44);
  }
  if (isStructuredContextSource(candidate.source)) {
    score = Math.max(score, 0.86);
  }

  return Math.max(0, Math.min(1.5, score));
}

export function scoreCandidate(
  candidate: RawCandidate,
  validation: CandidateValidation,
  step: CodegenStep,
  snapshot?: Document,
): number {
  const baselineScore = computeBaselineCandidateScore(candidate, validation, step, snapshot);
  const idEntropy = computeIdEntropy(step, candidate, validation, snapshot);
  const classEntropy = computeClassEntropy(step, candidate, validation, snapshot);
  const selectorEvaluation = buildCandidateSelectorEvaluation({
    step,
    candidate,
    validation,
    baselineScore,
    snapshotTargetEvidence: true,
    idEntropyScore: candidateUsesIdSelector(candidate) ? idEntropy.score : undefined,
    idPenaltyReason: candidateUsesIdSelector(candidate) ? idEntropy.reasons : undefined,
    classEntropyScore: candidateUsesClassSelector(candidate) ? classEntropy.score : undefined,
    classPenaltyReason: candidateUsesClassSelector(candidate) ? classEntropy.reasons : undefined,
  });

  return selectorEvaluation.scoring.finalScore;
}

function compareCandidates(left: CandidateScore, right: CandidateScore): number {
  const leftEvaluation = left.selectorEvaluation;
  const rightEvaluation = right.selectorEvaluation;
  if (
    leftEvaluation &&
    rightEvaluation &&
    rightEvaluation.scoring.proofScore !== leftEvaluation.scoring.proofScore
  ) {
    return rightEvaluation.scoring.proofScore - leftEvaluation.scoring.proofScore;
  }
  if (right.score !== left.score) return right.score - left.score;
  if (
    leftEvaluation &&
    rightEvaluation &&
    rightEvaluation.scoring.stabilityScore !== leftEvaluation.scoring.stabilityScore
  ) {
    return rightEvaluation.scoring.stabilityScore - leftEvaluation.scoring.stabilityScore;
  }
  if (
    leftEvaluation &&
    rightEvaluation &&
    rightEvaluation.scoring.semanticScore !== leftEvaluation.scoring.semanticScore
  ) {
    return rightEvaluation.scoring.semanticScore - leftEvaluation.scoring.semanticScore;
  }
  if (right.validation.effectiveMatchCount !== left.validation.effectiveMatchCount) {
    return right.validation.effectiveMatchCount - left.validation.effectiveMatchCount;
  }
  if ((right.validation.confidenceScore ?? 0) !== (left.validation.confidenceScore ?? 0)) {
    return (right.validation.confidenceScore ?? 0) - (left.validation.confidenceScore ?? 0);
  }
  return left.candidate.rank - right.candidate.rank;
}

function getOriginalSelectorSpec(step: CodegenStep) {
  if (step.selectorSpec) return step.selectorSpec;
  return buildSelectorSpec({
    selector: step.selector,
    selectorPriority: step.selectorPriority,
    source: 'interceptor',
    proofLevel: 'recorded',
    rank: step.selectorRank,
  });
}

function buildResolvedSelectorSpec(params: {
  step: CodegenStep;
  selector: string;
  source: 'interceptor' | 'resolver' | 'llm';
  proofLevel: 'recorded' | 'snapshot_validated' | 'semantic_validated' | 'blocked' | 'unvalidated';
  engine?: 'css' | 'xpath' | 'text' | 'testid' | 'role' | 'label' | 'label-context' | 'trigger-context' | 'bounded-field' | 'placeholder' | 'playwright' | 'playwright-locator';
  boundedField?: BoundedFieldSelectorSpec;
  labelContext?: LabelContextSelectorSpec;
  triggerContext?: TriggerContextSelectorSpec;
  rank?: number;
  confidence?: number;
  rejectReason?: string | null;
  warningCodes?: string[];
}) {
  if (params.engine === 'bounded-field' && params.boundedField) {
    return buildBoundedFieldSelectorSpec({
      selector: params.selector,
      boundedField: params.boundedField,
      source: params.source,
      proofLevel: params.proofLevel,
      rank: params.rank,
      confidence: params.confidence,
      rejectReason: params.rejectReason,
      warningCodes: params.warningCodes,
    });
  }

  return buildSelectorSpec({
    selector: params.selector,
    selectorPriority: params.source === 'interceptor' ? params.step.selectorPriority : undefined,
    engine: params.engine as FlatSelectorEngine | undefined,
    source: params.source,
    proofLevel: params.proofLevel,
    labelContext: params.labelContext,
    triggerContext: params.triggerContext,
    rank: params.rank,
    confidence: params.confidence,
    rejectReason: params.rejectReason,
    warningCodes: params.warningCodes,
  });
}

function buildResolutionSelectorEvaluation(params: {
  step: CodegenStep;
  selectorSpec: NonNullable<ReturnType<typeof buildResolvedSelectorSpec>>;
  metadata: ResolverMetadata;
  candidateEvaluation?: SelectorEvaluation;
  snapshotTargetEvidence?: boolean;
  validation?: CandidateValidation;
}): SelectorEvaluation {
  if (params.candidateEvaluation) {
    const mergedSelectorSpec = {
      ...params.candidateEvaluation.selectorSpec,
      ...params.selectorSpec,
    } as SelectorSpec;
    return summarizeSelectorEvaluation(
      mergedSelectorSpec,
      {
        category: params.candidateEvaluation.category,
        validation: params.candidateEvaluation.validation,
        proofSource: mapSelectorProofSource({
          source: params.selectorSpec.source,
          proofLevel: params.selectorSpec.proofLevel,
        }),
        snapshotTargetEvidence: params.snapshotTargetEvidence,
        proofScore: params.candidateEvaluation.scoring.proofScore,
        stabilityScore: params.candidateEvaluation.scoring.stabilityScore,
        semanticScore: params.metadata.semanticCompatibilityScore ?? params.candidateEvaluation.scoring.semanticScore,
        brittlenessPenalty: params.candidateEvaluation.scoring.brittlenessPenalty,
        entropyPenalty: params.candidateEvaluation.scoring.entropyPenalty,
        finalScore: params.metadata.bestScore || params.candidateEvaluation.scoring.finalScore,
        reasons: params.candidateEvaluation.reasons,
        warningCodes: params.metadata.warningCodes,
        rejectReason: params.metadata.rejectReason,
        preferredRenderings: params.candidateEvaluation.preferredRenderings,
      },
    );
  }

  const category = params.selectorSpec.engine === 'label-context' || params.selectorSpec.engine === 'trigger-context'
    ? 'label-context'
    : params.selectorSpec.engine === 'bounded-field'
      ? 'bounded-field'
    : classifySelectorCategory(params.selectorSpec.selector, params.selectorSpec.source);
  const proofSource = mapSelectorProofSource({
    source: params.selectorSpec.source,
    proofLevel: params.selectorSpec.proofLevel,
  });
  const fallbackValidation = {
    valid: params.selectorSpec.proofLevel !== 'blocked' && params.selectorSpec.proofLevel !== 'unvalidated',
    matchCount: params.metadata.matchCount,
    visibleMatchCount: params.metadata.effectiveMatchCount,
    uniqueVisible: params.metadata.effectiveMatchCount === 1,
    invalidReason: params.metadata.rejectReason ?? undefined,
  };
  const preferredRenderings = params.validation
    ? buildPreferredEquivalentRenderings({
        selectorSpec: params.selectorSpec,
        category,
        validation: params.validation,
        resolvedElement: params.validation.resolvedElement,
      })
    : [];
  const proofScore =
    params.selectorSpec.proofLevel === 'recorded'
      ? 0.6
      : params.selectorSpec.proofLevel === 'blocked' || params.selectorSpec.proofLevel === 'unvalidated'
        ? 0
        : 1;
  const stabilityScore = stabilityBaseScoreForCategory(category);

  return summarizeSelectorEvaluation(params.selectorSpec, {
    category,
    validation: fallbackValidation,
    proofSource,
    snapshotTargetEvidence: params.snapshotTargetEvidence,
    proofScore,
    stabilityScore,
    semanticScore: params.metadata.semanticCompatibilityScore ?? (fallbackValidation.valid ? 0.5 : 0),
    brittlenessPenalty: complexityPenalty(params.selectorSpec.selector) + volatilityPenalty(params.selectorSpec.selector),
    entropyPenalty: Math.max(0, -(params.metadata.idEntropyScore ?? 0)) + Math.max(0, -(params.metadata.classEntropyScore ?? 0)),
    finalScore: params.metadata.bestScore,
    reasons: [
      `category:${category}`,
      `proof:${params.selectorSpec.proofLevel}`,
      ...(params.metadata.semanticCompatibilityReasons ?? []),
    ],
    warningCodes: params.metadata.warningCodes,
    rejectReason: params.metadata.rejectReason,
    preferredRenderings,
  });
}

function getOriginalTriggerSelectorSpec(step: CodegenStep): SelectorSpec | undefined {
  if (step.triggerSelectorSpec) return step.triggerSelectorSpec;
  const selector = (step.triggerSelector || '').trim();
  if (!selector) return undefined;
  return buildSelectorSpec({
    selector,
    selectorPriority: step.triggerSelectorPriority,
    source: 'interceptor',
    proofLevel: 'recorded',
  });
}

function resolveTriggerContextForStep(
  step: CodegenStep,
  snapshot: Document | null,
  snapshotSelection?: ResolverMetadata['snapshotSelection'],
): Pick<
  ResolverMetadata,
  | 'triggerResolvedSelector'
  | 'triggerResolvedSelectorSpec'
  | 'triggerContextLabel'
  | 'triggerContextRenderStatus'
  | 'triggerContextRenderReason'
  | 'triggerBoundedContainerSummary'
  | 'triggerStructuralFallbackLocator'
  | 'triggerWarningCodes'
> {
  if (!snapshot || !isSelectLikeTriggerStep(step)) return {};

  const triggerSelector = (step.triggerSelector || '').trim();
  if (!triggerSelector) return {};

  const labelText = getTriggerContextLabel(step);
  const originalSpec = getOriginalTriggerSelectorSpec(step);
  const triggerMatches = findVisibleElementsForSelector(triggerSelector, snapshot);

  if (triggerMatches.matches.length === 1) {
    return {
      triggerResolvedSelector: triggerSelector,
      triggerResolvedSelectorSpec: originalSpec,
      triggerContextLabel: labelText,
      triggerWarningCodes: [],
    };
  }

  const warningCodes = new Set<string>();
  const blockedReason =
    triggerMatches.matches.length > 1
      ? 'target_selector_ambiguous'
      : (triggerMatches.blockedReason ?? 'label_structure_missing');

  if (!labelText) {
    warningCodes.add('custom-control-trigger-target-binding-ambiguous');
    return {
      triggerContextRenderStatus: 'blocked-unsafe-render',
      triggerContextRenderReason: blockedReason,
      triggerWarningCodes: Array.from(warningCodes),
    };
  }

  const candidates = buildTriggerContextCandidates(step, snapshot, snapshotSelection);
  const boundedCandidates = buildBoundedFieldTriggerCandidates({ step, snapshot, snapshotSelection });
  const candidate = boundedCandidates[0] ?? candidates[0];
  if (!candidate) {
    warningCodes.add('custom-control-trigger-target-binding-ambiguous');
    return {
      triggerContextLabel: labelText,
      triggerContextRenderStatus: 'blocked-unsafe-render',
      triggerContextRenderReason: blockedReason,
      triggerWarningCodes: Array.from(warningCodes),
    };
  }

  const validation = validateCandidate(candidate, snapshot, buildTriggerResolutionStep(step));
  const boundedField = candidate.boundedField;
  const isRecordedValid = (boundedField && boundedField.source === 'recorded-bounded-field') || 
                          ((candidate as any).source === 'interceptor' && candidate.triggerContext) ||
                          ((candidate as any).source === 'trigger-context');
  if (
    (validation.reason !== 'unique-visible' && !isRecordedValid) ||
    validation.effectiveMatchCount !== 1 ||
    (!candidate.triggerContext && !boundedField)
  ) {
    warningCodes.add('custom-control-trigger-target-binding-ambiguous');
    return {
      triggerContextLabel: labelText,
      triggerContextRenderStatus: 'blocked-unsafe-render',
      triggerContextRenderReason:
        validation.reason === 'non-unique'
          ? 'multiple_input_like_targets'
          : 'target_not_bound_to_label_container',
      triggerWarningCodes: Array.from(warningCodes),
    };
  }

  const renderStatus = candidate.triggerContext?.renderStatus
    ?? boundedField?.renderStatus
    ?? 'proof-only-no-clean-render';
  if (renderStatus === 'proven-structural-fallback') {
    warningCodes.add('custom-control-trigger-structural-fallback');
  }
  if (renderStatus === 'proof-only-no-clean-render') {
    warningCodes.add('custom-control-trigger-proof-only');
  }

  const resolvedSelectorSpec = buildResolvedSelectorSpec({
    step,
    selector: candidate.selector,
    source: 'resolver',
    proofLevel: 'semantic_validated',
    engine: candidate.engine === 'bounded-field' ? 'bounded-field' : 'trigger-context',
    boundedField: boundedField
      ? {
          ...boundedField,
          warningCodes: Array.from(new Set([
            ...(boundedField.warningCodes ?? []),
            ...Array.from(warningCodes),
          ])),
        }
      : undefined,
    triggerContext: candidate.triggerContext
      ? {
          ...candidate.triggerContext,
          warningCodes: Array.from(new Set([
            ...(candidate.triggerContext.warningCodes ?? []),
            ...Array.from(warningCodes),
          ])),
        }
      : undefined,
    rank: candidate.rank,
    confidence: validation.confidenceScore ?? 0.88,
    warningCodes: Array.from(warningCodes),
  });

  return {
    triggerResolvedSelector: candidate.selector,
    triggerResolvedSelectorSpec: resolvedSelectorSpec,
    triggerContextLabel: boundedField?.labelText ?? labelText,
    triggerContextRenderStatus: renderStatus,
    triggerContextRenderReason: candidate.triggerContext?.renderReason ?? boundedField?.renderReason ?? null,
    triggerBoundedContainerSummary: candidate.triggerContext?.boundedContainerSummary ?? boundedField?.boundedContainerSummary ?? null,
    triggerStructuralFallbackLocator: candidate.triggerContext?.structuralFallbackLocator ?? boundedField?.structuralFallbackLocator ?? null,
    triggerWarningCodes: Array.from(new Set([
      ...Array.from(warningCodes),
      ...(candidate.triggerContext?.warningCodes ?? []),
      ...(boundedField?.warningCodes ?? []),
    ])),
  };
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
  const originalSelectorSpec = getOriginalSelectorSpec(step);
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
    llmCandidatesReturned: undefined,
    llmCandidatesTried: undefined,
    llmAcceptedRank: null,
    llmRejectedCandidates: undefined,
    llmResponseFormat: undefined,
    llmRetryTriggered: false,
    llmRetrySelector: null,
    llmRetryRejectReason: null,
    llmRetryAccepted: false,
    llmRetryTimeoutMs: undefined,
    llmRetryStatus: 'not-eligible',
    rejectReason: null,
    semanticRejectReason: null,
    warningCodes: [],
    resolverVersion: 1,
    temporalClass: snapshotSelection?.temporalClass,
    selectionReason: snapshotSelection?.reason ?? null,
    snapshotSelection,
    evaluatedCandidates,
    snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
    snapshotTargetEvidenceReason: snapshotSelection?.snapshotTargetEvidenceReason ?? null,
    semanticCompatibilityScore: undefined,
    semanticCompatibilityReasons: undefined,
    idEntropyScore: undefined,
    idPenaltyReason: undefined,
    classEntropyScore: undefined,
    classPenaltyReason: undefined,
  };

  if (config.enableCapturedCandidateShadowEvaluation) {
    try {
      baseMetadata.shadowEvaluation = computeCapturedCandidateShadowEvaluation(step, snapshot);
    } catch (error) {
      baseMetadata.shadowEvaluation = {
        status: 'failed',
        candidateCount: step.fingerprint?.selectorCandidates?.length ?? 0,
        convertedCandidateCount: 0,
        uniqueCandidateCount: 0,
        semanticallySafeCandidateCount: 0,
        failureReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!snapshot) {
    baseMetadata.warningCodes.push('snapshot-unavailable');
    if (!ctx.snapshotEngineAvailable) {
      baseMetadata.warningCodes.push('snapshot-engine-unavailable');
    }
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'resolver',
      proofLevel: 'unvalidated',
      rank: step.selectorRank,
      confidence: 0,
      warningCodes: baseMetadata.warningCodes,
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
    });
    return {
      step,
      snapshot: null,
      selectorSpec: originalSelectorSpec,
      resolvedSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: false,
    };
  }

  if (!step.selector) {
    baseMetadata.warningCodes.push('missing-original-selector');
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'resolver',
      proofLevel: 'unvalidated',
      rank: step.selectorRank,
      confidence: 0,
      warningCodes: baseMetadata.warningCodes,
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
    });
    return {
      step,
      snapshot,
      selectorSpec: originalSelectorSpec,
      resolvedSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: false,
    };
  }

  const triggerResolution = resolveTriggerContextForStep(step, snapshot, snapshotSelection);
  const originalValidation = validateCandidate(step.selector, snapshot, step);
  if (shouldTrustOriginalOnSnapshotMiss(step, originalValidation)) {
    const rank = getSelectorRank(step.selector, step.selectorPriority, step.selectorRank);
    const score = Math.max(rankScore(rank), 0.65);
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'interceptor',
      proofLevel: 'recorded',
      rank,
      confidence: originalValidation.confidenceScore ?? score,
      warningCodes: [...baseMetadata.warningCodes, 'trusted-original-snapshot-miss'],
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
      ...triggerResolution,
      resolvedSelector: step.selector,
      resolvedBy: 'kept-original',
      bestScore: score,
      effectiveMatchCount: originalValidation.effectiveMatchCount,
      matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
      confidenceScore: originalValidation.confidenceScore ?? score,
      ambiguityReason: originalValidation.ambiguityReason ?? null,
      warningCodes: [...baseMetadata.warningCodes, 'trusted-original-snapshot-miss'],
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
      validation: originalValidation,
    });
    return {
      step,
      snapshot,
      selectorSpec: originalSelectorSpec,
      resolvedSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: false,
    };
  }

  if (shouldKeepOriginal(step, snapshot, config, snapshotSelection)) {
    const rank = getSelectorRank(step.selector, step.selectorPriority, step.selectorRank);
    const score = rankScore(rank) + 0.3;
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'interceptor',
      proofLevel: 'snapshot_validated',
      rank,
      confidence: originalValidation.confidenceScore ?? score,
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
      ...triggerResolution,
      resolvedSelector: step.selector,
      resolvedBy: 'kept-original',
      bestScore: score,
      effectiveMatchCount: originalValidation.effectiveMatchCount,
      matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
      confidenceScore: originalValidation.confidenceScore ?? score,
      ambiguityReason: originalValidation.ambiguityReason ?? null,
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
      validation: originalValidation,
    });
    return {
      step,
      snapshot,
      selectorSpec: originalSelectorSpec,
      resolvedSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: false,
    };
  }

  if (
    snapshotSelection?.temporalClass !== 'outcome_state' &&
    snapshotSelection?.snapshotTargetEvidence === false
  ) {
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'resolver',
      proofLevel: 'blocked',
      rank: step.selectorRank,
      confidence: originalValidation.confidenceScore ?? 0,
      rejectReason: 'snapshot_target_missing',
      warningCodes: [...baseMetadata.warningCodes, 'snapshot-target-missing'],
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
      ...triggerResolution,
      resolvedSelector: step.selector,
      resolvedBy: 'blocked-snapshot-target-missing',
      effectiveMatchCount: originalValidation.effectiveMatchCount,
      matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
      confidenceScore: originalValidation.confidenceScore ?? 0,
      ambiguityReason: originalValidation.ambiguityReason ?? null,
      rejectReason: 'snapshot_target_missing',
      semanticRejectReason: 'snapshot_target_missing',
      semanticCompatibilityScore: 0,
      semanticCompatibilityReasons: ['snapshot_target_missing'],
      warningCodes: [...baseMetadata.warningCodes, 'snapshot-target-missing'],
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
    });
    return {
      step,
      snapshot,
      selectorSpec: originalSelectorSpec,
      resolvedSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: false,
    };
  }

  const candidateScores: CandidateScore[] = generateCandidates(step, snapshot, snapshotSelection).map(candidate => {
    const validation = validateCandidate(candidate, snapshot, step);
    const idEntropy = computeIdEntropy(step, candidate, validation, snapshot);
    const usesId = candidateUsesIdSelector(candidate);
    const classEntropy = computeClassEntropy(step, candidate, validation, snapshot);
    const usesClass = candidateUsesClassSelector(candidate);
    const baselineScore = computeBaselineCandidateScore(candidate, validation, step, snapshot);
    const selectorEvaluation = buildCandidateSelectorEvaluation({
      step,
      candidate,
      validation,
      baselineScore,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
      idEntropyScore: usesId ? idEntropy.score : undefined,
      idPenaltyReason: usesId ? idEntropy.reasons : undefined,
      classEntropyScore: usesClass ? classEntropy.score : undefined,
      classPenaltyReason: usesClass ? classEntropy.reasons : undefined,
    });
    return {
      candidate,
      validation,
      score: selectorEvaluation.scoring.finalScore,
      selectorEvaluation,
      idEntropyScore: usesId ? idEntropy.score : undefined,
      idPenaltyReason: usesId ? idEntropy.reasons : undefined,
      classEntropyScore: usesClass ? classEntropy.score : undefined,
      classPenaltyReason: usesClass ? classEntropy.reasons : undefined,
    };
  });

  const uniqueCandidates = candidateScores
    .filter(candidate => candidate.validation.effectiveMatchCount === 1)
    .sort(compareCandidates);

  const semanticEvaluations = uniqueCandidates.map(candidate => {
    const semantic = evaluateSemanticReject(step, candidate, snapshot);
    return {
      candidate,
      semantic,
      selectorEvaluation: buildCandidateSelectorEvaluation({
        step,
        candidate: candidate.candidate,
        validation: candidate.validation,
        baselineScore: candidate.score,
        snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
        semanticScore: semantic.score,
        semanticReasons: semantic.reasons,
        semanticRejectReason: semantic.rejectReason,
        proofLevel: semantic.rejectReason === null ? 'semantic_validated' : 'unvalidated',
        proofSource: semantic.rejectReason === null ? 'semantic' : 'none',
        idEntropyScore: candidate.idEntropyScore,
        idPenaltyReason: candidate.idPenaltyReason,
        classEntropyScore: candidate.classEntropyScore,
        classPenaltyReason: candidate.classPenaltyReason,
        warningCodes: candidate.selectorEvaluation?.warningCodes,
      }),
    };
  });

  const rejectedCandidates = semanticEvaluations
    .filter(evaluation => evaluation.semantic.rejectReason !== null)
    .map(evaluation => ({
      selector: evaluation.candidate.candidate.selector,
      reason: evaluation.semantic.rejectReason as ResolverRejectReason,
    }));

  const semanticallySafeCandidates = semanticEvaluations
    .filter(evaluation => evaluation.semantic.rejectReason === null)
    .sort(compareSemanticCandidates);

  const highScoreCandidates = semanticallySafeCandidates
    .filter(evaluation => evaluation.candidate.candidate.selector !== step.selector)
    .filter(evaluation => evaluation.candidate.score >= config.resolverMinScore);

  const winner = highScoreCandidates[0];

  const lowScoreFallbackCandidates = semanticallySafeCandidates
    .map(evaluation => evaluation.candidate)
    .filter(candidate =>
      candidate.candidate.selector !== step.selector &&
      !shouldBlockGenericShellOverride(step.selector, candidate.candidate.selector),
  );

  const lowScoreFallback = lowScoreFallbackCandidates.find(candidate =>
    isLowScoreFallbackCandidateSafe(step, snapshot, candidate, config),
  );

  const hadRejectedLowScoreFallback = lowScoreFallbackCandidates.length > 0 && !lowScoreFallback;

  if (winner && shouldBlockGenericShellOverride(step.selector, winner.candidate.candidate.selector)) {
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'resolver',
      proofLevel: 'unvalidated',
      rank: step.selectorRank,
      confidence: originalValidation.confidenceScore ?? 0,
      warningCodes: [...baseMetadata.warningCodes, 'blocked-generic-shell-override'],
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
      ...triggerResolution,
      resolvedSelector: step.selector,
      effectiveMatchCount: originalValidation.effectiveMatchCount,
      matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
      confidenceScore: originalValidation.confidenceScore ?? 0,
      ambiguityReason: originalValidation.ambiguityReason ?? null,
      warningCodes: [...baseMetadata.warningCodes, 'blocked-generic-shell-override'],
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      candidateEvaluation: winner.selectorEvaluation,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
    });
    return {
      step,
      snapshot,
      selectorSpec: originalSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: true,
      resolvedSelectorSpec,
      lowScoreFallback,
    };
  }

  if (!winner) {
    const bestAvailableCandidate = lowScoreFallbackCandidates[0] ?? uniqueCandidates[0];
    const boundedFieldRejectReason = isWeakBoundedFieldInputCandidate(step)
      ? diagnoseBoundedFieldInputCandidate({ step, snapshot, snapshotSelection }) ?? null
      : null;
    if (rejectedCandidates.length > 0) {
      const blockedEvaluation = semanticEvaluations.find(evaluation => evaluation.semantic.rejectReason !== null);
      baseMetadata.warningCodes.push('deterministic-semantic-reject');
      baseMetadata.rejectReason = rejectedCandidates[0]?.reason ?? 'control_family_mismatch';
      baseMetadata.semanticRejectReason = baseMetadata.rejectReason;
      baseMetadata.rejectedCandidates = rejectedCandidates;
      baseMetadata.semanticCompatibilityScore = blockedEvaluation?.semantic.score;
      baseMetadata.semanticCompatibilityReasons = blockedEvaluation?.semantic.reasons;
      baseMetadata.idEntropyScore = blockedEvaluation?.candidate.idEntropyScore;
      baseMetadata.idPenaltyReason = blockedEvaluation?.candidate.idPenaltyReason;
      baseMetadata.classEntropyScore = blockedEvaluation?.candidate.classEntropyScore;
      baseMetadata.classPenaltyReason = blockedEvaluation?.candidate.classPenaltyReason;
      baseMetadata.resolvedBy = 'blocked-semantic-mismatch';
    }
    if (rejectedCandidates.length === 0 && bestAvailableCandidate) {
      baseMetadata.idEntropyScore = bestAvailableCandidate.idEntropyScore;
      baseMetadata.idPenaltyReason = bestAvailableCandidate.idPenaltyReason;
      baseMetadata.classEntropyScore = bestAvailableCandidate.classEntropyScore;
      baseMetadata.classPenaltyReason = bestAvailableCandidate.classPenaltyReason;
    }
    if (uniqueCandidates.length === 0) {
      baseMetadata.warningCodes.push('no-unique-candidate');
      if (boundedFieldRejectReason) {
        baseMetadata.warningCodes.push(boundedFieldRejectReason);
        baseMetadata.rejectReason = baseMetadata.rejectReason ?? boundedFieldRejectReason;
      }
    } else if (rejectedCandidates.length === 0) {
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
    const resolvedSelectorSpec = buildResolvedSelectorSpec({
      step,
      selector: step.selector,
      source: 'resolver',
      proofLevel: baseMetadata.resolvedBy === 'blocked-semantic-mismatch' ? 'blocked' : 'unvalidated',
      rank: step.selectorRank,
      confidence: originalValidation.confidenceScore ?? 0,
      rejectReason: baseMetadata.rejectReason,
      warningCodes: baseMetadata.warningCodes,
    });
    const metadata: ResolverMetadata = {
      ...baseMetadata,
      ...triggerResolution,
      effectiveMatchCount: originalValidation.effectiveMatchCount,
      matchCount: originalValidation.matchCount ?? originalValidation.visibleMatchCount,
      confidenceScore: originalValidation.confidenceScore ?? 0,
      ambiguityReason: originalValidation.ambiguityReason ?? null,
      rejectedCandidates: baseMetadata.rejectedCandidates,
      semanticCompatibilityScore: baseMetadata.semanticCompatibilityScore,
      semanticCompatibilityReasons: baseMetadata.semanticCompatibilityReasons,
      semanticRejectReason: baseMetadata.semanticRejectReason,
      idEntropyScore: baseMetadata.idEntropyScore,
      idPenaltyReason: baseMetadata.idPenaltyReason,
      classEntropyScore: baseMetadata.classEntropyScore,
      classPenaltyReason: baseMetadata.classPenaltyReason,
    };
    metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
      step,
      selectorSpec: resolvedSelectorSpec,
      metadata,
      candidateEvaluation: bestAvailableCandidate?.selectorEvaluation,
      snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
    });
    return {
      step,
      snapshot,
      selectorSpec: originalSelectorSpec,
      resolvedSelectorSpec,
      resolvedSelector: step.selector,
      metadata,
      llmEligible: true,
      lowScoreFallback,
    };
  }

  const resolvedSelectorSpec = buildResolvedSelectorSpec({
    step,
    selector: winner.candidate.candidate.selector,
    source: 'resolver',
    proofLevel: 'semantic_validated',
    engine: winner.candidate.candidate.engine,
    boundedField: winner.candidate.candidate.boundedField,
    labelContext: winner.candidate.candidate.labelContext,
    triggerContext: winner.candidate.candidate.triggerContext,
    rank: winner.candidate.candidate.rank,
    confidence: winner.candidate.validation.confidenceScore ?? winner.candidate.score,
    warningCodes: [
      ...baseMetadata.warningCodes,
      'deterministic-override',
      ...(winner.candidate.candidate.source === 'bounded-field' ? ['bounded-field-recovery'] : []),
      ...(winner.candidate.candidate.source === 'label-context' ? ['label-context-recovery'] : []),
      ...(winner.candidate.candidate.source === 'trigger-context' ? ['custom-control-trigger-bounded-context-recovery'] : []),
      ...(winner.candidate.validation.ambiguityReason ? ['deterministic-dom-order-tiebreaker'] : []),
    ],
  });
  const metadata: ResolverMetadata = {
    ...baseMetadata,
    ...triggerResolution,
    resolvedSelector: winner.candidate.candidate.selector,
    resolvedBy: 'deterministic-override',
    bestScore: winner.candidate.score,
    effectiveMatchCount: winner.candidate.validation.effectiveMatchCount,
    matchCount: winner.candidate.validation.matchCount ?? winner.candidate.validation.visibleMatchCount,
    confidenceScore: winner.candidate.validation.confidenceScore ?? winner.candidate.score,
    ambiguityReason: winner.candidate.validation.ambiguityReason ?? null,
    semanticCompatibilityScore: winner.semantic.score,
    semanticCompatibilityReasons: winner.semantic.reasons,
    idEntropyScore: winner.candidate.idEntropyScore,
    idPenaltyReason: winner.candidate.idPenaltyReason,
    classEntropyScore: winner.candidate.classEntropyScore,
    classPenaltyReason: winner.candidate.classPenaltyReason,
    rejectedCandidates: rejectedCandidates.length > 0 ? rejectedCandidates : undefined,
    warningCodes: [
      ...baseMetadata.warningCodes,
      'deterministic-override',
      ...(winner.candidate.candidate.source === 'bounded-field' ? ['bounded-field-recovery'] : []),
      ...(winner.candidate.candidate.source === 'label-context' ? ['label-context-recovery'] : []),
      ...(winner.candidate.candidate.source === 'trigger-context' ? ['custom-control-trigger-bounded-context-recovery'] : []),
      ...(winner.candidate.validation.ambiguityReason ? ['deterministic-dom-order-tiebreaker'] : []),
    ],
  };
  metadata.selectorEvaluation = buildResolutionSelectorEvaluation({
    step,
    selectorSpec: resolvedSelectorSpec,
    metadata,
    candidateEvaluation: winner.selectorEvaluation,
    snapshotTargetEvidence: snapshotSelection?.snapshotTargetEvidence,
  });
  return {
    step,
    snapshot,
    selectorSpec: originalSelectorSpec,
    resolvedSelectorSpec,
    resolvedSelector: winner.candidate.candidate.selector,
    metadata,
    llmEligible: false,
  };
}

function buildLlmCap(totalSteps: number, config: ResolvedResolverConfig): number {
  if (typeof config.maxLLMFallbackPerSession === 'number') {
    return Math.max(0, config.maxLLMFallbackPerSession);
  }
  return Math.max(2, Math.min(5, Math.ceil(totalSteps * 0.3)));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label = 'Selector fallback'): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
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

function unwrapSingleCodeFence(selector: string): string {
  const trimmed = selector.trim();
  const fenceMatch = trimmed.match(/^```[a-z0-9_-]*\s*([\s\S]*?)\s*```$/i);
  return fenceMatch?.[1]?.trim() ?? trimmed;
}

function unwrapQuotedSelector(selector: string): string {
  const trimmed = selector.trim();
  if (
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function unwrapLocatorPrefix(selector: string): string {
  let normalized = selector.trim();
  normalized = normalized.replace(/^css\s*=\s*/i, '');
  normalized = normalized.replace(/^locator\s*=\s*/i, '');
  return normalized.trim();
}

function unwrapLocatorCall(selector: string): string {
  const trimmed = selector.trim();
  const callMatch = trimmed.match(/^locator\(\s*(['"`])([\s\S]*?)\1\s*\)$/i);
  if (callMatch?.[2]) {
    return callMatch[2].trim();
  }
  const bareMatch = trimmed.match(/^locator\(\s*([^()]+?)\s*\)$/i);
  return bareMatch?.[1]?.trim() ?? trimmed;
}

function looksLikeProse(selector: string): boolean {
  if (!selector) return true;
  if (/^(?:use|try|selector|best|candidate|the|this|choose|prefer)\b/i.test(selector)) {
    return true;
  }
  if (/[.!?]$/.test(selector) && !/[)\]"']$/.test(selector)) {
    return true;
  }
  return false;
}

export function normalizeLlmSelector(selector?: string | null): string | null {
  if (typeof selector !== 'string') return null;

  let normalized = selector.trim();
  if (!normalized) return null;

  normalized = unwrapSingleCodeFence(normalized);
  normalized = unwrapQuotedSelector(normalized);
  normalized = unwrapLocatorPrefix(normalized);
  normalized = unwrapLocatorCall(normalized);
  normalized = normalized.trim().replace(/\s+/g, ' ');

  if (!normalized) return null;
  if (/^xpath\s*=/i.test(normalized)) return null;
  if (looksLikeProse(normalized)) return null;
  if (!isLikelyCssSelector(normalized)) return null;

  return normalized;
}

function normalizeLlmResponseFormat(item: Record<string, unknown>): LlmResponseFormat {
  if (Array.isArray(item.candidates)) return 'candidates-v2';
  if (Array.isArray(item.selectors)) return 'legacy-selectors';
  return 'legacy-selector';
}

function collectRawSuggestionCandidates(item: Record<string, unknown>): Array<string | null> {
  const selectors: Array<string | null> = [];
  if (Array.isArray(item.candidates)) {
    for (const candidate of item.candidates) {
      if (typeof candidate === 'string') {
        selectors.push(candidate);
      } else if (candidate && typeof candidate === 'object' && typeof (candidate as { selector?: unknown }).selector === 'string') {
        selectors.push((candidate as { selector: string }).selector);
      }
    }
  }
  if (Array.isArray(item.selectors)) {
    for (const selector of item.selectors) {
      selectors.push(typeof selector === 'string' ? selector : null);
    }
  }
  if (typeof item.selector === 'string') {
    selectors.push(item.selector);
  }
  return selectors;
}

export function normalizeLlmSuggestions(
  suggestions: unknown[],
  maxCandidatesPerStep: number,
): NormalizedLlmSuggestion[] {
  const cappedMax = Math.max(1, maxCandidatesPerStep);
  const merged = new Map<number, NormalizedLlmSuggestion>();

  for (const item of suggestions) {
    if (!item || typeof item !== 'object') continue;
    const stepNumber = Number((item as { stepNumber?: unknown }).stepNumber);
    if (!Number.isFinite(stepNumber) || stepNumber <= 0) continue;

    const responseFormat = normalizeLlmResponseFormat(item as Record<string, unknown>);
    const normalizedCandidates: string[] = [];
    const seen = new Set<string>();
    for (const rawSelector of collectRawSuggestionCandidates(item as Record<string, unknown>)) {
      const normalized = normalizeLlmSelector(rawSelector);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      normalizedCandidates.push(normalized);
    }
    if (normalizedCandidates.length === 0) continue;

    const existing = merged.get(stepNumber);
    if (!existing) {
      merged.set(stepNumber, {
        stepNumber,
        candidates: normalizedCandidates.slice(0, cappedMax),
        responseFormat,
        truncated: normalizedCandidates.length > cappedMax,
      });
      continue;
    }

    const combined = [...existing.candidates];
    const combinedSeen = new Set(existing.candidates);
    for (const candidate of normalizedCandidates) {
      if (combinedSeen.has(candidate)) continue;
      combinedSeen.add(candidate);
      combined.push(candidate);
      if (combined.length >= cappedMax) break;
    }

    existing.candidates = combined.slice(0, cappedMax);
    existing.truncated = existing.truncated === true || normalizedCandidates.length > cappedMax || combined.length > cappedMax;
    if (existing.responseFormat !== 'candidates-v2') {
      existing.responseFormat =
        responseFormat === 'candidates-v2'
          ? 'candidates-v2'
          : existing.responseFormat === 'legacy-selectors' || responseFormat === 'legacy-selectors'
            ? 'legacy-selectors'
            : 'legacy-selector';
    }
  }

  return Array.from(merged.values()).sort((left, right) => left.stepNumber - right.stepNumber);
}

export function normalizeLlmRetrySuggestions(
  suggestions: unknown[],
): NormalizedLlmRetrySuggestion[] {
  const normalized: NormalizedLlmRetrySuggestion[] = [];
  const seenSteps = new Set<number>();

  for (const item of suggestions) {
    if (!item || typeof item !== 'object') continue;
    const stepNumber = Number((item as { stepNumber?: unknown }).stepNumber);
    if (!Number.isFinite(stepNumber) || stepNumber <= 0 || seenSteps.has(stepNumber)) continue;

    const selector = normalizeLlmSelector((item as { selector?: unknown }).selector as string | undefined);
    if (!selector) continue;

    seenSteps.add(stepNumber);
    normalized.push({ stepNumber, selector });
  }

  return normalized.sort((left, right) => left.stepNumber - right.stepNumber);
}

function isSafeRetryParentSelector(selector?: string | null): boolean {
  if (typeof selector !== 'string') return false;
  const trimmed = selector.trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (/^(?:html|body)\b/i.test(trimmed)) return false;
  return isLikelyCssSelector(trimmed);
}

function buildRetryFingerprintSummary(step: CodegenStep): LlmRetryFingerprintSummary | undefined {
  if (!step.fingerprint) return undefined;

  const attrs = inferStepSignalAttributes(step);
  const summary: LlmRetryFingerprintSummary = {
    tagName: step.fingerprint.tagName?.toLowerCase() || attrs.tagName,
    textExcerpt: step.fingerprint.textExcerpt || undefined,
    href: attrs.href,
    role: attrs.role,
    ariaLabel: attrs.ariaLabel,
    name: attrs.name,
    placeholder: attrs.placeholder,
    type: attrs.type,
    dataTestId: attrs.dataTestId,
    dataCy: attrs.dataCy,
    dataQa: attrs.dataQa,
    controlFamily: inferStepControlFamily(step),
  };

  const parentSelector = step.fingerprint.parentSelector ?? attrs.parentSelector;
  if (isSafeRetryParentSelector(parentSelector)) {
    summary.parentSelector = parentSelector ?? undefined;
  }

  return Object.values(summary).some(value => value != null && value !== '')
    ? summary
    : undefined;
}

function buildRetryFailedCandidates(metadata: ResolverMetadata): LlmRetryFailedCandidate[] {
  return (metadata.llmRejectedCandidates ?? [])
    .slice(0, 3)
    .map(candidate => ({
      selector: candidate.selector,
      rejectReason: candidate.rejectReason,
    }));
}

function isRetryValidationFailure(reason: string | null | undefined): boolean {
  return [
    'invalid-llm-selector',
    'llm-selector-too-complex',
    'llm-selector-not-unique',
    'llm-intent-mismatch',
    'href_mismatch',
    'control_family_mismatch',
    'text_mismatch',
  ].includes(reason ?? '');
}

type LlmCandidateValidationResult = {
  accepted: boolean;
  rejectReason: string | null;
  warningCode: string | null;
  validation: CandidateValidation | null;
  selectorEvaluation?: SelectorEvaluation;
};

function validateLlmCandidateSelector(
  draft: StepResolutionDraft,
  selector: string,
  config: ResolvedResolverConfig,
): LlmCandidateValidationResult {
  let rejectReason: string | null = null;
  let warningCode: string | null = null;

  if (isLlmSelectorTooComplex(selector)) {
    rejectReason = 'llm-selector-too-complex';
    warningCode = 'llm-selector-too-complex';
  }

  const validation = rejectReason ? null : validateCandidate(selector, draft.snapshot as Document, draft.step);
  if (!rejectReason && validation?.reason === 'invalid-selector') {
    rejectReason = 'invalid-llm-selector';
    warningCode = 'llm-invalid-selector';
  }
  if (
    !rejectReason &&
    validation &&
    (
      validation.effectiveMatchCount !== 1 ||
      validation.reason !== 'unique-visible'
    )
  ) {
    rejectReason = 'llm-selector-not-unique';
    warningCode = 'llm-non-unique';
  }

  const match = !rejectReason && validation
    ? validation.resolvedElement ??
      getCandidateElement(draft.snapshot as Document, selector) ??
      (isLikelyCssSelector(selector) ? (draft.snapshot as Document).querySelector(selector) : null)
    : null;

  if (!rejectReason && (!match || !matchesIntent(match, draft.step, config.intentMinScore))) {
    rejectReason = 'llm-intent-mismatch';
    warningCode = 'llm-intent-mismatch';
  }

  if (!rejectReason && shouldBlockGenericShellOverride(draft.step.selector, selector)) {
    rejectReason = 'llm-intent-mismatch';
    warningCode = 'blocked-generic-shell-override';
  }

  if (!rejectReason && validation) {
    const llmCandidateEvaluation = evaluateSemanticReject(
      draft.step,
      {
        candidate: {
          selector,
          source: 'other',
          rank: 10,
        },
        validation,
        score: 0,
      },
      draft.snapshot as Document,
    );
    if (llmCandidateEvaluation.rejectReason) {
      rejectReason = llmCandidateEvaluation.rejectReason;
      warningCode = 'llm-semantic-reject';
    }
  }

  const selectorEvaluation = validation
    ? buildCandidateSelectorEvaluation({
        step: draft.step,
        candidate: {
          selector,
          source: 'other',
          rank: 10,
        },
        validation,
        baselineScore: 0.6,
        snapshotTargetEvidence: draft.metadata.snapshotTargetEvidence,
        semanticScore: rejectReason ? 0 : 0.75,
        semanticReasons: rejectReason ? [rejectReason] : ['llm-validated'],
        semanticRejectReason: rejectReason,
        proofLevel: rejectReason ? 'unvalidated' : 'semantic_validated',
        proofSource: rejectReason ? 'none' : 'llm-validator',
        source: 'llm',
        warningCodes: warningCode ? [warningCode] : [],
      })
    : undefined;

  return {
    accepted: rejectReason === null,
    rejectReason,
    warningCode,
    validation,
    selectorEvaluation,
  };
}

function isLlmSelectorTooComplex(selector: string): boolean {
  if (selector.length > 160) return true;
  if (/^(?:html|body)\b/i.test(selector)) return true;
  if (/(?:^|\s)(?:html|body)\s*>/i.test(selector)) return true;

  const nthHeavyCount = (selector.match(/:nth-(?:child|of-type)\(/gi) ?? []).length;
  if (nthHeavyCount >= 2) return true;

  const depthCount =
    (selector.match(/\s+>\s+/g) ?? []).length +
    (selector.match(/\s+(?![>+~])/g) ?? []).length;
  if (depthCount >= 5) return true;

  return false;
}

function pushWarningCode(metadata: ResolverMetadata, code: string): void {
  if (!metadata.warningCodes.includes(code)) {
    metadata.warningCodes.push(code);
  }
}

function applyLowScoreFallback(draft: StepResolutionDraft): void {
  if (!draft.lowScoreFallback) return;
  draft.resolvedSelector = draft.lowScoreFallback.candidate.selector;
  draft.resolvedSelectorSpec = buildResolvedSelectorSpec({
    step: draft.step,
    selector: draft.lowScoreFallback.candidate.selector,
    source: 'resolver',
    proofLevel: 'semantic_validated',
    rank: draft.lowScoreFallback.candidate.rank,
    confidence: draft.lowScoreFallback.validation.confidenceScore ?? draft.lowScoreFallback.score,
  });
  const nextMetadata: ResolverMetadata = {
    ...draft.metadata,
    resolvedSelector: draft.lowScoreFallback.candidate.selector,
    resolvedBy: 'deterministic-override',
    bestScore: draft.lowScoreFallback.score,
    effectiveMatchCount: draft.lowScoreFallback.validation.effectiveMatchCount,
    matchCount: draft.lowScoreFallback.validation.matchCount ?? draft.lowScoreFallback.validation.visibleMatchCount,
    confidenceScore: draft.lowScoreFallback.validation.confidenceScore ?? draft.lowScoreFallback.score,
    ambiguityReason: draft.lowScoreFallback.validation.ambiguityReason ?? null,
    idEntropyScore: draft.lowScoreFallback.idEntropyScore,
    idPenaltyReason: draft.lowScoreFallback.idPenaltyReason,
    classEntropyScore: draft.lowScoreFallback.classEntropyScore,
    classPenaltyReason: draft.lowScoreFallback.classPenaltyReason,
    llmAccepted: false,
  };
  pushWarningCode(nextMetadata, 'deterministic-low-score-fallback');
  nextMetadata.selectorEvaluation = buildResolutionSelectorEvaluation({
    step: draft.step,
    selectorSpec: draft.resolvedSelectorSpec,
    metadata: nextMetadata,
    candidateEvaluation: draft.lowScoreFallback.selectorEvaluation,
    snapshotTargetEvidence: draft.metadata.snapshotTargetEvidence,
  });
  draft.metadata = nextMetadata;
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

    const draft = deriveDeterministicResolution(
      step,
      snapshot,
      resolvedConfig,
      { snapshotEngineAvailable },
      snapshotSource,
      snapshotSelection,
      evaluatedCandidates,
    );
    maybeApplyCapturedCandidateDirectPromotion(draft, resolvedConfig);
    return draft;
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

    const excerptByStep = new Map<number, { excerpt: string }>();
    const request: LlmFallbackRequest = {
      mode: 'initial',
      steps: llmTargets.map(draft => {
        const excerptInfo = serializeSnapshotExcerpt(
          draft.snapshot as Document,
          draft.step,
          resolvedConfig.maxSnapshotExcerptChars,
        );
        excerptByStep.set(draft.step.step, { excerpt: excerptInfo.excerpt });
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
      const providerSuggestions = await withTimeout(
        llmFallbackProvider(request),
        resolvedConfig.llmTimeoutMs,
        'Selector fallback',
      );
      const suggestions = normalizeLlmSuggestions(providerSuggestions as unknown[], resolvedConfig.llmMaxCandidatesPerStep);
      const suggestionsByStep = new Map(suggestions.map(suggestion => [suggestion.stepNumber, suggestion]));
      const retryEligibleTargets: StepResolutionDraft[] = [];

      for (const target of llmTargets) {
        const suggestion = suggestionsByStep.get(target.step.step);
        target.metadata.llmCandidatesReturned = suggestion?.candidates ?? [];
        target.metadata.llmCandidatesTried = [];
        target.metadata.llmRejectedCandidates = [];
        target.metadata.llmAcceptedRank = null;
        target.metadata.llmResponseFormat = suggestion?.responseFormat;
        target.metadata.llmRetryStatus = 'not-eligible';
        if (suggestion?.truncated) {
          pushWarningCode(target.metadata, 'llm-retry-cap-reached');
        }
      }

      for (const suggestion of suggestions) {
        const target = llmTargets.find(draft => draft.step.step === suggestion.stepNumber);
        if (!target || !target.snapshot) continue;

        let accepted = false;
        for (const [index, selector] of suggestion.candidates.entries()) {
          target.metadata.llmAlternative = selector;
          target.metadata.llmCandidatesTried?.push(selector);

          const candidateResult = validateLlmCandidateSelector(target, selector, resolvedConfig);
          const { rejectReason, warningCode, validation } = candidateResult;

          if (rejectReason) {
            target.metadata.rejectReason = rejectReason;
            target.metadata.llmRejectedCandidates?.push({ selector, rejectReason });
            if (warningCode) {
              pushWarningCode(target.metadata, warningCode);
            }
            continue;
          }

          target.resolvedSelector = selector;
          target.resolvedSelectorSpec = buildResolvedSelectorSpec({
            step: target.step,
            selector,
            source: 'llm',
            proofLevel: 'semantic_validated',
            confidence: validation?.confidenceScore ?? 0.95,
          });
          const nextMetadata: ResolverMetadata = {
            ...target.metadata,
            resolvedSelector: selector,
            resolvedBy: 'llm-accepted',
            bestScore: Math.max(target.metadata.bestScore, 0.95),
            effectiveMatchCount: validation?.effectiveMatchCount ?? 1,
            matchCount: validation?.matchCount ?? validation?.visibleMatchCount,
            confidenceScore: validation?.confidenceScore ?? 0.95,
            ambiguityReason: validation?.ambiguityReason ?? null,
            llmAccepted: true,
            llmAcceptedRank: index + 1,
            llmAlternative: selector,
            rejectReason: null,
            semanticRejectReason: null,
          };
          nextMetadata.selectorEvaluation = buildResolutionSelectorEvaluation({
            step: target.step,
            selectorSpec: target.resolvedSelectorSpec,
            metadata: nextMetadata,
            candidateEvaluation: candidateResult.selectorEvaluation,
            snapshotTargetEvidence: target.metadata.snapshotTargetEvidence,
          });
          target.metadata = nextMetadata;
          llmAcceptedStepNumbers.push(target.step.step);
          accepted = true;
          break;
        }

        if (!accepted) {
          if (suggestion.candidates.length > 0) {
            pushWarningCode(target.metadata, 'llm-retries-exhausted');
          }
          if (target.lowScoreFallback) {
            applyLowScoreFallback(target);
          }
        }
      }

      for (const target of llmTargets) {
        const suggestion = suggestionsByStep.get(target.step.step);
        const returnedCandidates = suggestion?.candidates ?? [];
        const rejectedCandidates = target.metadata.llmRejectedCandidates ?? [];
        const retryEligible =
          !target.metadata.llmAccepted &&
          returnedCandidates.length > 0 &&
          rejectedCandidates.length === returnedCandidates.length &&
          rejectedCandidates.every(candidate => isRetryValidationFailure(candidate.rejectReason));

        if (retryEligible) {
          target.metadata.llmRetryTriggered = true;
          target.metadata.llmRetryTimeoutMs = resolvedConfig.llmRetryTimeoutMs;
          target.metadata.llmRetryStatus = 'triggered';
          retryEligibleTargets.push(target);
          continue;
        }

        if (!target.metadata.llmAccepted && !target.metadata.rejectReason) {
          target.metadata.rejectReason = 'llm-no-valid-suggestion';
          target.metadata.llmRetryStatus = 'skipped-empty-response';
          pushWarningCode(target.metadata, 'llm-no-valid-suggestion');
          pushWarningCode(target.metadata, 'llm-retry-skipped-empty-response');
        }

        if (!target.metadata.llmAccepted && target.lowScoreFallback) {
          applyLowScoreFallback(target);
        }
      }

      if (retryEligibleTargets.length > 0) {
        const retryRequest: LlmCorrectiveRetryRequest = {
          mode: 'retry',
          steps: retryEligibleTargets.map(target => ({
            stepNumber: target.step.step,
            action: target.step.action,
            intent: target.step.intent,
            originalSelector: target.step.selector,
            fingerprint: buildRetryFingerprintSummary(target.step),
            snapshotExcerpt:
              excerptByStep.get(target.step.step)?.excerpt ??
              serializeSnapshotExcerpt(
                target.snapshot as Document,
                target.step,
                resolvedConfig.maxSnapshotExcerptChars,
              ).excerpt,
            failedCandidates: buildRetryFailedCandidates(target.metadata),
          }) satisfies LlmCorrectiveRetryStep),
          config: resolvedConfig,
        };

        try {
          const retrySuggestions = await withTimeout(
            llmFallbackProvider(retryRequest),
            resolvedConfig.llmRetryTimeoutMs,
            'Selector corrective retry',
          );
          const normalizedRetrySuggestions = normalizeLlmRetrySuggestions(retrySuggestions as unknown[]);
          const retryByStep = new Map(normalizedRetrySuggestions.map(suggestion => [suggestion.stepNumber, suggestion]));

          for (const target of retryEligibleTargets) {
            const retrySuggestion = retryByStep.get(target.step.step);
            if (!retrySuggestion) {
              target.metadata.llmRetryStatus = 'skipped-empty-response';
              pushWarningCode(target.metadata, 'llm-retry-skipped-empty-response');
              if (target.lowScoreFallback) {
                applyLowScoreFallback(target);
              }
              continue;
            }

            target.metadata.llmRetrySelector = retrySuggestion.selector;
            target.metadata.llmAlternative = retrySuggestion.selector;
            const retryResult = validateLlmCandidateSelector(target, retrySuggestion.selector, resolvedConfig);

            if (!retryResult.accepted) {
              target.metadata.rejectReason = retryResult.rejectReason;
              target.metadata.llmRetryRejectReason = retryResult.rejectReason;
              target.metadata.llmRetryAccepted = false;
              target.metadata.llmRetryStatus = 'rejected';
              if (retryResult.warningCode) {
                pushWarningCode(target.metadata, retryResult.warningCode);
              }
              pushWarningCode(target.metadata, 'llm-retry-rejected');
              if (target.lowScoreFallback) {
                applyLowScoreFallback(target);
              }
              continue;
            }

            target.resolvedSelector = retrySuggestion.selector;
            target.resolvedSelectorSpec = buildResolvedSelectorSpec({
              step: target.step,
              selector: retrySuggestion.selector,
              source: 'llm',
              proofLevel: 'semantic_validated',
              confidence: retryResult.validation?.confidenceScore ?? 0.95,
            });
            const nextMetadata: ResolverMetadata = {
              ...target.metadata,
              resolvedSelector: retrySuggestion.selector,
              resolvedBy: 'llm-accepted',
              bestScore: Math.max(target.metadata.bestScore, 0.95),
              effectiveMatchCount: retryResult.validation?.effectiveMatchCount ?? 1,
              matchCount: retryResult.validation?.matchCount ?? retryResult.validation?.visibleMatchCount,
              confidenceScore: retryResult.validation?.confidenceScore ?? 0.95,
              ambiguityReason: retryResult.validation?.ambiguityReason ?? null,
              llmAccepted: true,
              llmAlternative: retrySuggestion.selector,
              llmRetrySelector: retrySuggestion.selector,
              llmRetryRejectReason: null,
              llmRetryAccepted: true,
              llmRetryStatus: 'accepted',
              rejectReason: null,
              semanticRejectReason: null,
            };
            nextMetadata.selectorEvaluation = buildResolutionSelectorEvaluation({
              step: target.step,
              selectorSpec: target.resolvedSelectorSpec,
              metadata: nextMetadata,
              candidateEvaluation: retryResult.selectorEvaluation,
              snapshotTargetEvidence: target.metadata.snapshotTargetEvidence,
            });
            target.metadata = nextMetadata;
            pushWarningCode(target.metadata, 'llm-retry-accepted');
            llmAcceptedStepNumbers.push(target.step.step);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const timedOut = /timed out/i.test(reason);
          for (const target of retryEligibleTargets) {
            target.metadata.llmRetryAccepted = false;
            target.metadata.llmRetryRejectReason = reason;
            target.metadata.llmRetryStatus = timedOut ? 'skipped-timeout' : 'skipped-provider-error';
            pushWarningCode(target.metadata, timedOut ? 'llm-retry-timeout' : 'llm-retry-error');
            if (target.lowScoreFallback) {
              applyLowScoreFallback(target);
            }
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
    selectorSpec: draft.selectorSpec,
    resolvedSelector: draft.resolvedSelector || draft.step.selector,
    resolvedSelectorSpec: draft.resolvedSelectorSpec,
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
