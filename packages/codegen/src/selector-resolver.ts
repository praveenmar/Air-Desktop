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
  type ControlFamily,
  type LlmFallbackRequest,
  type LlmFallbackStep,
  type LlmFallbackSuggestion,
  type RawCandidate,
  type ResolveContext,
  type ResolvedResolverConfig,
  type ResolverRejectReason,
  type ResolverConfig,
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
    /^(?:hover|focus|active|disabled):/i.test(token)
  );
}

function isStateClassToken(token: string): boolean {
  return /^(?:active|selected|open|disabled|expanded|collapsed|checked|focused)$/i.test(token);
}

function isFrameworkClassToken(token: string): boolean {
  return /^(?:oxd-|mui|ant-|chakra-)/i.test(token);
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
    if (attrs.id) {
      for (const selector of buildIdSelectors(attrs.id)) {
        pushCandidate(candidates, seen, `${scopedBase} ${selector}`, 'parent-scope', 2);
      }
    }
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
  push(attrs.placeholder, 'fingerprint_placeholder');
  push(attrs.title, 'fingerprint_title');
  push(attrs.alt, 'fingerprint_alt');

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
  left: { candidate: CandidateScore; semantic: SemanticCompatibilityEvaluation },
  right: { candidate: CandidateScore; semantic: SemanticCompatibilityEvaluation },
): number {
  if (right.candidate.score !== left.candidate.score) {
    return right.candidate.score - left.candidate.score;
  }
  if (right.semantic.score !== left.semantic.score) {
    return right.semantic.score - left.semantic.score;
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
    step.action === 'custom-select' ||
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

  const element = candidate.validation.resolvedElement ?? getCandidateElement(snapshot, candidate.candidate.selector);
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

export function scoreCandidate(
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

  score += (validation.confidenceScore ?? 0) * 0.25;
  score -= complexityPenalty(candidate.selector);
  score -= volatilityPenalty(candidate.selector);

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

  if (
    snapshotSelection?.temporalClass !== 'outcome_state' &&
    snapshotSelection?.snapshotTargetEvidence === false
  ) {
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: {
        ...baseMetadata,
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
      },
      llmEligible: false,
    };
  }

  const candidateScores: CandidateScore[] = generateCandidates(step, snapshot).map(candidate => {
    const validation = validateCandidate(candidate.selector, snapshot, step);
    const idEntropy = computeIdEntropy(step, candidate, validation, snapshot);
    const usesId = candidateUsesIdSelector(candidate);
    const classEntropy = computeClassEntropy(step, candidate, validation, snapshot);
    const usesClass = candidateUsesClassSelector(candidate);
    return {
      candidate,
      validation,
      score: scoreCandidate(candidate, validation, step, snapshot),
      idEntropyScore: usesId ? idEntropy.score : undefined,
      idPenaltyReason: usesId ? idEntropy.reasons : undefined,
      classEntropyScore: usesClass ? classEntropy.score : undefined,
      classPenaltyReason: usesClass ? classEntropy.reasons : undefined,
    };
  });

  const uniqueCandidates = candidateScores
    .filter(candidate => candidate.validation.effectiveMatchCount === 1)
    .sort(compareCandidates);

  const semanticEvaluations = uniqueCandidates.map(candidate => ({
    candidate,
    semantic: evaluateSemanticReject(step, candidate, snapshot),
  }));

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
    const bestAvailableCandidate = lowScoreFallbackCandidates[0] ?? uniqueCandidates[0];
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
        rejectedCandidates: baseMetadata.rejectedCandidates,
        semanticCompatibilityScore: baseMetadata.semanticCompatibilityScore,
        semanticCompatibilityReasons: baseMetadata.semanticCompatibilityReasons,
        semanticRejectReason: baseMetadata.semanticRejectReason,
        idEntropyScore: baseMetadata.idEntropyScore,
        idPenaltyReason: baseMetadata.idPenaltyReason,
        classEntropyScore: baseMetadata.classEntropyScore,
        classPenaltyReason: baseMetadata.classPenaltyReason,
      },
      llmEligible: true,
      lowScoreFallback,
    };
  }

  return {
    step,
    snapshot,
    resolvedSelector: winner.candidate.candidate.selector,
    metadata: {
      ...baseMetadata,
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
        ...(winner.candidate.validation.ambiguityReason ? ['deterministic-dom-order-tiebreaker'] : []),
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
    idEntropyScore: draft.lowScoreFallback.idEntropyScore,
    idPenaltyReason: draft.lowScoreFallback.idPenaltyReason,
    classEntropyScore: draft.lowScoreFallback.classEntropyScore,
    classPenaltyReason: draft.lowScoreFallback.classPenaltyReason,
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
