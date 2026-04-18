import type {
  CodegenSession,
  CodegenStep,
  ResolverMetadata,
  SelectorPriority,
  ResolverSnapshotSource,
} from './types';

export interface ResolverConfig {
  enableLLMFallback?: boolean;
  resolverMinScore?: number;
  maxSnapshotBytesForValidation?: number;
  maxSnapshotExcerptChars?: number;
  llmTimeoutMs?: number;
  maxLLMFallbackPerSession?: number;
}

export interface ResolvedResolverConfig {
  enableLLMFallback: boolean;
  resolverMinScore: number;
  maxSnapshotBytesForValidation: number;
  maxSnapshotExcerptChars: number;
  llmTimeoutMs: number;
  maxLLMFallbackPerSession?: number;
}

export interface SnapshotCache {
  get(nodeId: string, normalizedUrl?: string, controlSignature?: string): Document | null;
  getSource?: (
    nodeId: string,
    normalizedUrl?: string,
    controlSignature?: string
  ) => ResolverSnapshotSource;
  snapshotEngineAvailable?: boolean;
}

export interface CandidateValidation {
  totalMatchCount: number;
  visibleMatchCount: number;
  effectiveMatchCount: number;
  reason: 'unique-visible' | 'no-visible-match' | 'non-unique' | 'invalid-selector';
}

export interface RawCandidate {
  selector: string;
  source:
    | 'original'
    | 'id'
    | 'name'
    | 'testid'
    | 'aria'
    | 'placeholder'
    | 'role+name'
    | 'class'
    | 'text'
    | 'parent-scope';
  rank: number;
}

interface CandidateScore {
  candidate: RawCandidate;
  validation: CandidateValidation;
  score: number;
}

interface StepResolutionDraft {
  step: CodegenStep;
  snapshot: Document | null;
  resolvedSelector: string;
  metadata: ResolverMetadata;
  llmEligible: boolean;
}

interface ResolveContext {
  snapshotEngineAvailable: boolean;
}

export interface LlmFallbackStep {
  stepNumber: number;
  intent: string;
  originalSelector: string;
  snapshotExcerpt: string;
}

export interface LlmFallbackSuggestion {
  stepNumber: number;
  selector: string;
}

export interface LlmFallbackRequest {
  steps: LlmFallbackStep[];
  config: ResolvedResolverConfig;
}

export type SelectorFallbackProvider = (request: LlmFallbackRequest) => Promise<LlmFallbackSuggestion[]>;

export interface SelectorResolution {
  stepNumber: number;
  sourceNodeId: string | null;
  originalSelector: string;
  resolvedSelector: string;
  resolverMetadata: ResolverMetadata;
}

export interface SelectorResolverResult {
  resolutions: SelectorResolution[];
  unresolvedStepNumbers: number[];
  llmAttemptedStepNumbers: number[];
  llmAcceptedStepNumbers: number[];
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
  resolverMinScore: 0.7,
  maxSnapshotBytesForValidation: 2_000_000,
  maxSnapshotExcerptChars: 2000,
  llmTimeoutMs: 20_000,
};

function resolveConfig(config?: ResolverConfig): ResolvedResolverConfig {
  return {
    enableLLMFallback: config?.enableLLMFallback ?? DEFAULT_CONFIG.enableLLMFallback,
    resolverMinScore: config?.resolverMinScore ?? DEFAULT_CONFIG.resolverMinScore,
    maxSnapshotBytesForValidation: config?.maxSnapshotBytesForValidation ?? DEFAULT_CONFIG.maxSnapshotBytesForValidation,
    maxSnapshotExcerptChars: config?.maxSnapshotExcerptChars ?? DEFAULT_CONFIG.maxSnapshotExcerptChars,
    llmTimeoutMs: config?.llmTimeoutMs ?? DEFAULT_CONFIG.llmTimeoutMs,
    maxLLMFallbackPerSession: config?.maxLLMFallbackPerSession,
  };
}

function cssEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\t/g, '\\9 ');
}

function rankScore(rank: number): number {
  return RANK_SCORES[rank] ?? 0.3;
}

function getSelectorRank(
  selector: string,
  selectorPriority?: SelectorPriority,
  selectorRank?: number
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

function isLikelyCssSelector(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('text=')) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('xpath=')) return false;
  if (/^id\(".*"\)$/i.test(trimmed)) return false;
  return true;
}

function isTextSelector(selector: string): boolean {
  const trimmed = selector.trim();
  return trimmed.startsWith('text=') || /:has-text\((?:"[^"]*"|'[^']*')\)/i.test(trimmed);
}

function extractAttributeValue(selector: string, attribute: string): string | null {
  const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = selector.match(new RegExp(`\\[${escaped}=(?:"([^"]*)"|'([^']*)')\\]`, 'i'));
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

function extractId(selector: string): string | null {
  const attrId = extractAttributeValue(selector, 'id');
  if (attrId) return attrId;
  if (!selector.startsWith('#')) return null;
  const match = selector.slice(1).match(/^[a-zA-Z0-9_-]+/);
  return match?.[0] ?? null;
}

function extractClass(selector: string): string | null {
  const match = selector.match(/\.([a-zA-Z0-9_-]+)/);
  return match?.[1] ?? null;
}

function extractTextExcerpt(step: CodegenStep): string | null {
  const hasTextMatch = step.selector.match(/:has-text\((?:"([^"]*)"|'([^']*)')\)/i);
  if (hasTextMatch) {
    return hasTextMatch[1] ?? hasTextMatch[2] ?? null;
  }
  if (step.selector.startsWith('text=')) {
    return step.selector.slice(5).trim() || null;
  }
  const intentParts = step.intent.split('_').slice(1).join(' ').trim();
  return intentParts.length > 1 ? intentParts : null;
}

interface StepSignalAttributes {
  id?: string;
  name?: string;
  dataTestId?: string;
  ariaLabel?: string;
  placeholder?: string;
  role?: string;
  class?: string;
  tagName?: string;
  parentSelector?: string | null;
}

function inferStepSignalAttributes(step: CodegenStep): StepSignalAttributes {
  const attrs: StepSignalAttributes = {};
  const selector = step.selector || '';
  const fingerprint = step.fingerprint;
  const fpAttrs = fingerprint?.attributes;

  attrs.id = fpAttrs?.id || extractId(selector) || undefined;
  attrs.name = fpAttrs?.name || extractAttributeValue(selector, 'name') || undefined;
  attrs.dataTestId =
    fpAttrs?.dataTestId ||
    fpAttrs?.['data-testid'] ||
    extractAttributeValue(selector, 'data-testid') ||
    undefined;
  attrs.ariaLabel =
    fpAttrs?.ariaLabel ||
    fpAttrs?.['aria-label'] ||
    extractAttributeValue(selector, 'aria-label') ||
    undefined;
  attrs.placeholder =
    fpAttrs?.placeholder || extractAttributeValue(selector, 'placeholder') || undefined;
  attrs.role = fpAttrs?.role || extractAttributeValue(selector, 'role') || undefined;
  attrs.class = extractClass(selector) ?? undefined;
  attrs.tagName = fingerprint?.tagName?.toLowerCase();
  attrs.parentSelector = fingerprint?.parentSelector ?? undefined;

  return attrs;
}

function textFromElement(element: Element): string | null {
  const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.slice(0, 80);
}

function enrichSignalAttributesFromElement(attrs: StepSignalAttributes, element: Element): void {
  const htmlElement = element as HTMLElement;
  if (!attrs.id && htmlElement.id) attrs.id = htmlElement.id;
  if (!attrs.name) {
    const name = htmlElement.getAttribute('name');
    if (name) attrs.name = name;
  }
  if (!attrs.dataTestId) {
    const testId = htmlElement.getAttribute('data-testid');
    if (testId) attrs.dataTestId = testId;
  }
  if (!attrs.ariaLabel) {
    const aria = htmlElement.getAttribute('aria-label');
    if (aria) attrs.ariaLabel = aria;
  }
  if (!attrs.placeholder) {
    const placeholder = htmlElement.getAttribute('placeholder');
    if (placeholder) attrs.placeholder = placeholder;
  }
  if (!attrs.role) {
    const role = htmlElement.getAttribute('role');
    if (role) attrs.role = role;
  }
  if (!attrs.class && htmlElement.className) {
    attrs.class = htmlElement.className;
  }
}

function findSeedElements(step: CodegenStep, snapshot: Document): Element[] {
  const seeds: Element[] = [];
  if (step.selector && isLikelyCssSelector(step.selector)) {
    try {
      seeds.push(...Array.from(snapshot.querySelectorAll(step.selector)).slice(0, 5));
    } catch {
      // ignore invalid selector
    }
  }

  if (seeds.length > 0) return seeds;

  const tokens = step.intent.toLowerCase().split(/[^a-z0-9]+/).filter(token => token.length >= 3);
  if (tokens.length === 0) return seeds;

  const pool = Array.from(snapshot.querySelectorAll('*')).slice(0, 200);
  for (const element of pool) {
    const text = (element.textContent || '').toLowerCase();
    const aria = (element.getAttribute('aria-label') || '').toLowerCase();
    if (tokens.some(token => text.includes(token) || aria.includes(token))) {
      seeds.push(element);
      if (seeds.length >= 5) break;
    }
  }

  return seeds;
}

function findStableClassFromAttributes(classAttr?: string): string | null {
  if (!classAttr) return null;
  const classes = classAttr.split(/\s+/).filter(Boolean);
  if (classes.length === 0) return null;

  const bannedPatterns = [
    /\d{4,}/,
    /^css-/,
    /^sc-/,
    /^Mui/,
    /^ant-/,
    /^chakra-/,
  ];
  const utilityPrefixes = ['mt-', 'mb-', 'pt-', 'pb-', 'flex', 'text-', 'bg-'];

  const filtered = classes.filter(cls => !bannedPatterns.some(re => re.test(cls)));
  if (filtered.length === 0) return null;

  filtered.sort((a, b) => {
    const aUtility = utilityPrefixes.some(prefix => a.startsWith(prefix));
    const bUtility = utilityPrefixes.some(prefix => b.startsWith(prefix));
    if (aUtility && !bUtility) return 1;
    if (!aUtility && bUtility) return -1;
    return a.length - b.length;
  });

  return filtered[0] ?? null;
}

function isDynamicText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 80) return true;
  if (/\d{4,}/.test(trimmed)) return true;
  if (/(?:uuid|guid|session|token|timestamp)/i.test(trimmed)) return true;
  return false;
}

function normalizeTextForMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function unquoteTextLiteral(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function escapeTextSelectorValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractStableParentSelector(step: CodegenStep, attrs?: StepSignalAttributes): string | null {
  if (attrs?.parentSelector && isLikelyCssSelector(attrs.parentSelector)) {
    return attrs.parentSelector;
  }

  const selector = step.selector;
  if (!selector) return null;

  const splitByChild = selector.split(' > ');
  if (splitByChild.length > 1) {
    return splitByChild.slice(0, -1).join(' > ').trim() || null;
  }

  const splitByDescendant = selector.split(/\s+/);
  if (splitByDescendant.length > 1) {
    return splitByDescendant.slice(0, -1).join(' ').trim() || null;
  }

  return null;
}

export function isVisibleElement(el: Element): boolean {
  const htmlEl = el as HTMLElement;

  if (htmlEl.hasAttribute('hidden')) return false;
  if (htmlEl.getAttribute('aria-hidden') === 'true') return false;
  const style = (htmlEl.getAttribute('style') || '').toLowerCase();
  if (style.includes('display:none')) return false;
  if (style.includes('visibility:hidden')) return false;

  return true;
}

export function validateCSSCandidate(selector: string, snapshot: Document): CandidateValidation {
  if (!isLikelyCssSelector(selector)) {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
    };
  }

  let matches: NodeListOf<Element>;
  try {
    matches = snapshot.querySelectorAll(selector);
  } catch {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
    };
  }

  const visibleMatches = Array.from(matches).filter(isVisibleElement);
  const effective = visibleMatches.length;
  return {
    totalMatchCount: matches.length,
    visibleMatchCount: visibleMatches.length,
    effectiveMatchCount: effective,
    reason: effective === 1 ? 'unique-visible' : effective === 0 ? 'no-visible-match' : 'non-unique',
  };
}

export function validateTextCandidate(selector: string, snapshot: Document): CandidateValidation {
  const trimmed = selector.trim();
  let pool: Element[] = [];
  let targetText = '';

  if (trimmed.startsWith('text=')) {
    targetText = unquoteTextLiteral(trimmed.slice(5));
    if (!targetText) {
      return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'invalid-selector',
      };
    }
    try {
      pool = Array.from(snapshot.querySelectorAll('*'));
    } catch {
      return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'invalid-selector',
      };
    }
  } else {
    const hasTextMatch = trimmed.match(/^(.*?):has-text\((?:"([^"]*)"|'([^']*)')\)$/i);
    if (!hasTextMatch) {
      return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'invalid-selector',
      };
    }

    const baseSelector = hasTextMatch[1].trim() || '*';
    targetText = hasTextMatch[2] ?? hasTextMatch[3] ?? '';
    if (!targetText.trim()) {
      return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'invalid-selector',
      };
    }

    try {
      pool = Array.from(snapshot.querySelectorAll(baseSelector));
    } catch {
      return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'invalid-selector',
      };
    }
  }

  const normalizedNeedle = normalizeTextForMatch(targetText);
  if (!normalizedNeedle) {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
    };
  }

  const matches = pool.filter(element => {
    const haystack = normalizeTextForMatch(element.textContent || '');
    return haystack.includes(normalizedNeedle);
  });
  const visibleMatches = matches.filter(isVisibleElement);
  const effective = visibleMatches.length;

  return {
    totalMatchCount: matches.length,
    visibleMatchCount: visibleMatches.length,
    effectiveMatchCount: effective,
    reason: effective === 1 ? 'unique-visible' : effective === 0 ? 'no-visible-match' : 'non-unique',
  };
}

function validateCandidate(selector: string, snapshot: Document): CandidateValidation {
  return isTextSelector(selector)
    ? validateTextCandidate(selector, snapshot)
    : validateCSSCandidate(selector, snapshot);
}

export function shouldKeepOriginal(step: CodegenStep, snapshot: Document, config: ResolverConfig): boolean {
  if (!step.selector) return false;
  const validation = validateCandidate(step.selector, snapshot);
  if (validation.effectiveMatchCount !== 1) return false;
  const rank = getSelectorRank(step.selector, step.selectorPriority, step.selectorRank);
  const score = rankScore(rank) + 0.3;
  const minScore = config.resolverMinScore ?? DEFAULT_CONFIG.resolverMinScore;
  const effectiveMinScore = isTextSelector(step.selector)
    ? Math.min(minScore, 0.65)
    : minScore;
  return (score + 1e-9) >= effectiveMinScore;
}

export function generateCandidates(step: CodegenStep, snapshot: Document): RawCandidate[] {
  const candidates: RawCandidate[] = [];
  const attrs = inferStepSignalAttributes(step);
  const seedElements = findSeedElements(step, snapshot);
  let textExcerpt = extractTextExcerpt(step);

  for (const seedElement of seedElements) {
    enrichSignalAttributesFromElement(attrs, seedElement);
    if (!textExcerpt) {
      const extracted = textFromElement(seedElement);
      if (extracted) textExcerpt = extracted;
    }
  }

  const selector = step.selector;

  if (selector) {
    candidates.push({
      selector,
      source: 'original',
      rank: getSelectorRank(selector, step.selectorPriority, step.selectorRank),
    });
  }

  if (attrs.id) {
    candidates.push({ selector: `[id="${cssEscape(attrs.id)}"]`, source: 'id', rank: 2 });
  }

  if (attrs.name) {
    candidates.push({ selector: `[name="${cssEscape(attrs.name)}"]`, source: 'name', rank: 6 });
  }

  if (attrs.dataTestId) {
    candidates.push({ selector: `[data-testid="${cssEscape(attrs.dataTestId)}"]`, source: 'testid', rank: 1 });
  }

  if (attrs.ariaLabel) {
    candidates.push({ selector: `[aria-label="${cssEscape(attrs.ariaLabel)}"]`, source: 'aria', rank: 3 });
  }

  if (attrs.placeholder) {
    candidates.push({ selector: `[placeholder="${cssEscape(attrs.placeholder)}"]`, source: 'placeholder', rank: 5 });
  }

  if (attrs.role && attrs.name) {
    candidates.push({
      selector: `[role="${cssEscape(attrs.role)}"][name="${cssEscape(attrs.name)}"]`,
      source: 'role+name',
      rank: 4,
    });
  }

  const stableClass = findStableClassFromAttributes(attrs.class);
  if (stableClass) {
    candidates.push({ selector: `.${cssEscape(stableClass)}`, source: 'class', rank: 7 });
  }

  if (textExcerpt && !isDynamicText(textExcerpt)) {
    const escapedText = escapeTextSelectorValue(textExcerpt);
    if (escapedText) {
      candidates.push({
        selector: `text=${escapedText}`,
        source: 'text',
        rank: 6,
      });

      if (selector && isLikelyCssSelector(selector)) {
        candidates.push({
          selector: `${selector}:has-text("${escapedText}")`,
          source: 'text',
          rank: 6,
        });
      }

      if (attrs.tagName && /^[a-z][a-z0-9-]*$/i.test(attrs.tagName)) {
        candidates.push({
          selector: `${attrs.tagName}:has-text("${escapedText}")`,
          source: 'text',
          rank: 6,
        });
      }
    }
  }

  const stableParent = extractStableParentSelector(step, attrs);
  if (stableParent && selector) {
    candidates.push({
      selector: `${stableParent} ${selector}`,
      source: 'parent-scope',
      rank: 8,
    });
  } else if (seedElements.length > 0 && selector) {
    const parent = seedElements[0].parentElement;
    const parentTestId = parent?.getAttribute('data-testid');
    const parentId = parent?.id;
    if (parentTestId) {
      candidates.push({
        selector: `[data-testid="${cssEscape(parentTestId)}"] ${selector}`,
        source: 'parent-scope',
        rank: 8,
      });
    } else if (parentId) {
      candidates.push({
        selector: `[id="${cssEscape(parentId)}"] ${selector}`,
        source: 'parent-scope',
        rank: 8,
      });
    }
  }

  const seen = new Set<string>();
  return candidates.filter(candidate => {
    if (seen.has(candidate.selector)) return false;
    seen.add(candidate.selector);
    return true;
  }).slice(0, 10);
}

export function complexityPenalty(selector: string): number {
  let penalty = 0;
  const combinators = (selector.match(/[>+~]/g) || []).length;
  penalty += combinators * 0.05;
  if (/:nth-(?:child|of-type)/.test(selector)) penalty += 0.05;
  if (selector.length > 80) penalty += 0.1;
  return Math.min(penalty, 0.2);
}

export function volatilityPenalty(step: CodegenStep): number {
  let penalty = 0;
  const attrs = inferStepSignalAttributes(step);
  const id = attrs.id;
  if (id && (/^\d/.test(id) || /[-_]\d{4,}/.test(id) || /(uuid|guid)/i.test(id))) {
    penalty += 0.2;
  }

  const classAttr = attrs.class || '';
  const utilityPatterns = ['^mt-', '^mb-', '^pt-', '^pb-', '^flex', '^text-', '^bg-'];
  const utilityCount = classAttr
    .split(/\s+/)
    .filter(Boolean)
    .filter(cls => utilityPatterns.some(pattern => new RegExp(pattern).test(cls)))
    .length;
  penalty += utilityCount * 0.05;
  return Math.min(penalty, 0.3);
}

export function scoreCandidate(
  candidate: RawCandidate,
  validation: CandidateValidation,
  step: CodegenStep
): number {
  const candidateRank = candidate.rank ?? 10;
  const rank = rankScore(candidateRank);
  const uniqueBonus = validation.effectiveMatchCount === 1 ? 0.3 : 0;
  const intentMatch = step.intent &&
    candidate.selector.toLowerCase().includes(step.intent.toLowerCase())
      ? 0.1
      : 0;
  const complexity = complexityPenalty(candidate.selector);
  const volatility = volatilityPenalty(step);
  return Math.max(0, rank + uniqueBonus + intentMatch - complexity - volatility);
}

function compareCandidates(a: CandidateScore, b: CandidateScore): number {
  if (b.score !== a.score) return b.score - a.score;

  const aPrimary = a.candidate.source === 'original' ? 0 : 1;
  const bPrimary = b.candidate.source === 'original' ? 0 : 1;
  if (aPrimary !== bPrimary) return aPrimary - bPrimary;

  if (a.candidate.rank !== b.candidate.rank) return a.candidate.rank - b.candidate.rank;

  if (a.candidate.selector.length !== b.candidate.selector.length) {
    return a.candidate.selector.length - b.candidate.selector.length;
  }

  return a.candidate.selector.localeCompare(b.candidate.selector);
}

function normalizeSelectorForShellCheck(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ').toLowerCase();
}

function isKnownShellSelector(selector: string): boolean {
  const normalized = normalizeSelectorForShellCheck(selector);
  if (!normalized) return false;

  if (normalized === 'html' || normalized === 'body') return true;
  if (normalized === '#app' || normalized === '#root') return true;
  if (normalized === '[id="app"]' || normalized === "[id='app']") return true;
  if (normalized === '[id="root"]' || normalized === "[id='root']") return true;
  if (normalized === '.oxd-layout' || normalized === '.oxd-layout-container') return true;

  return false;
}

function shouldBlockGenericShellOverride(originalSelector: string, candidateSelector: string): boolean {
  if (!candidateSelector || candidateSelector === originalSelector) return false;
  if (!isKnownShellSelector(candidateSelector)) return false;
  if (isKnownShellSelector(originalSelector)) return false;
  return true;
}

export function matchesIntent(el: Element, intent: string): boolean {
  const tokens = intent.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const text = (el.textContent || '').toLowerCase();
  const aria = (el.getAttribute('aria-label') || '').toLowerCase();
  return tokens.some(token => text.includes(token) || aria.includes(token));
}

// selector-resolver.ts

/**
 * Extracts a focused HTML excerpt around the target element, preferring a subtree
 * (element + up to 2 parents) that fits within maxChars. Strips scripts/styles.
 * Redaction is applied after extraction, then truncation.
 */
function serializeSnapshotExcerpt(
  snapshot: Document,
  targetSelector: string,
  maxChars: number
): string {
  // Helper to strip noise (scripts, styles)
  const stripNoise = (html: string): string => {
  if (typeof html !== 'string') {
    return '';
  }
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');
};

  // Guard: ensure we have a valid CSS selector
  if (!targetSelector || !isLikelyCssSelector(targetSelector)) {
    // Fallback to whole document
    const fullHtml = snapshot.documentElement?.outerHTML || snapshot.body?.outerHTML || '';
    const cleaned = stripNoise(fullHtml);
    const redacted = redactSnapshot(cleaned);
    return redacted.slice(0, maxChars);
  }

  let targetElement: Element | null = null;
  try {
    targetElement = snapshot.querySelector(targetSelector);
  } catch {
    // Invalid selector – fallback to whole document
    const fullHtml = snapshot.documentElement?.outerHTML || snapshot.body?.outerHTML || '';
    const cleaned = stripNoise(fullHtml);
    const redacted = redactSnapshot(cleaned);
    return redacted.slice(0, maxChars);
  }

  if (!targetElement) {
    // Element not found – fallback to whole document
    const fullHtml = snapshot.documentElement?.outerHTML || snapshot.body?.outerHTML || '';
    const cleaned = stripNoise(fullHtml);
    const redacted = redactSnapshot(cleaned);
    return redacted.slice(0, maxChars);
  }

  // Collect candidate snippets: element itself, then up to 2 parents
  const candidates: string[] = [];
  candidates.push(targetElement.outerHTML);

  let parent = targetElement.parentElement;
  let depth = 0;
  while (parent && depth < 2) {
    candidates.push(parent.outerHTML);
    parent = parent.parentElement;
    depth++;
  }

  // Strip noise from each candidate
  const cleanedCandidates = candidates.map(stripNoise);

  // Pick the largest candidate that fits within maxChars (after redaction)
  let bestHtml = '';
  for (const html of cleanedCandidates) {
    const redacted = redactSnapshot(html);
    if (redacted.length <= maxChars && redacted.length > bestHtml.length) {
      bestHtml = redacted;
    }
  }

  // If none fit (unlikely but possible), fall back to first candidate truncated
  if (!bestHtml) {
    const firstRedacted = redactSnapshot(cleanedCandidates[0]);
    bestHtml = firstRedacted.slice(0, maxChars);
  }

  return bestHtml;
}

function redactSnapshot(html: string): string {
  return html
    .replace(/<input[^>]*value="[^"]*"[^>]*>/gi, '<input value="REDACTED">')
    .replace(/<textarea[^>]*>[\s\S]*?<\/textarea>/gi, '<textarea>REDACTED</textarea>')
    .replace(/\b\d{6,}\b/g, 'REDACTED')
    .replace(/\b[\w.-]+@[\w.-]+\.\w+\b/g, 'REDACTED');
}

function deriveDeterministicResolution(
  step: CodegenStep,
  snapshot: Document | null,
  config: ResolvedResolverConfig,
  ctx: ResolveContext,
  snapshotSource?: ResolverSnapshotSource
): StepResolutionDraft {
  const baseMetadata: ResolverMetadata = {
    resolvedSelector: step.selector,
    resolvedBy: 'unresolved',
    bestScore: 0,
    effectiveMatchCount: 0,
    snapshotSource: snapshotSource ?? (snapshot ? 'latest' : 'unavailable'),
    validationMethod: 'css-query-visible-offset-parent-v1',
    llmAttempted: false,
    llmAccepted: false,
    llmAlternative: null,
    rejectReason: null,
    warningCodes: [],
    resolverVersion: 1,
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

  const originalValidation = validateCandidate(step.selector, snapshot);
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
      },
      llmEligible: false,
    };
  }

  const candidateScores: CandidateScore[] = generateCandidates(step, snapshot).map(candidate => {
    const validation = validateCandidate(candidate.selector, snapshot);
    return {
      candidate,
      validation,
      score: scoreCandidate(candidate, validation, step),
    };
  });

  const winner = candidateScores
    .filter(candidate => candidate.validation.effectiveMatchCount === 1)
    .filter(candidate => candidate.score >= config.resolverMinScore)
    .sort(compareCandidates)[0];

  if (!winner) {
    baseMetadata.warningCodes.push('no-unique-candidate');
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
      },
      llmEligible: true,
    };
  }

  if (winner.candidate.selector !== step.selector &&
      shouldBlockGenericShellOverride(step.selector, winner.candidate.selector)) {
    return {
      step,
      snapshot,
      resolvedSelector: step.selector,
      metadata: {
        ...baseMetadata,
        resolvedSelector: step.selector,
        effectiveMatchCount: originalValidation.effectiveMatchCount,
        warningCodes: [...baseMetadata.warningCodes, 'blocked-generic-shell-override'],
      },
      llmEligible: true,
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
      warningCodes: winner.candidate.selector === step.selector
        ? baseMetadata.warningCodes
        : [...baseMetadata.warningCodes, 'deterministic-override'],
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
      }
    );
  });
}

export async function resolveSelectorsForSession(
  session: CodegenSession,
  snapshotCache: SnapshotCache,
  config?: ResolverConfig,
  llmFallbackProvider?: SelectorFallbackProvider
): Promise<SelectorResolverResult> {
  const resolvedConfig = resolveConfig(config);
  const snapshotEngineAvailable = snapshotCache.snapshotEngineAvailable ?? true;
  // Debug: count how many snapshots are present in the cache for session steps
  const stepLookups = session.steps.map(step => ({
    nodeId: step.sourceNodeId ?? '',
    normalizedUrl: step.normalizedUrl,
    controlSignature: step.controlSignature,
  }));
  let availableCount = 0;
  for (const lookup of stepLookups) {
    try {
      if (snapshotCache.get(lookup.nodeId, lookup.normalizedUrl, lookup.controlSignature)) availableCount++;
    } catch (err) {
      // ignore
    }
  }
  console.log(`[DEBUG] resolveSelectorsForSession: steps=${session.steps.length}, snapshotEngineAvailable=${snapshotEngineAvailable}, snapshotsAvailable=${availableCount}/${stepLookups.length}`);

  const drafts: StepResolutionDraft[] = [];
  for (const step of session.steps) {
    const nodeId = step.sourceNodeId ?? '';
    const snapshot = snapshotCache.get(nodeId, step.normalizedUrl, step.controlSignature);
    const snapshotSource = snapshotCache.getSource
      ? snapshotCache.getSource(nodeId, step.normalizedUrl, step.controlSignature)
      : (snapshot ? 'latest' : 'unavailable');
    console.log(
      `[DEBUG] resolveSelectorsForSession: step ${step.step}, nodeId=${nodeId || '<none>'}, normalizedUrl=${step.normalizedUrl || '<none>'}, snapshot=${!!snapshot}, source=${snapshotSource}`
    );
    drafts.push(
      deriveDeterministicResolution(
        step,
        snapshot,
        resolvedConfig,
        { snapshotEngineAvailable },
        snapshotSource
      )
    );
  }

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
      skipped.metadata.warningCodes.push('llm-circuit-breaker');
    }
  }

  if (llmEnabled && llmTargets.length > 0) {
    for (const draft of llmTargets) {
      draft.metadata.llmAttempted = true;
      llmAttemptedStepNumbers.push(draft.step.step);
    }

    const request: LlmFallbackRequest = {
      steps: llmTargets.map(draft => ({
        stepNumber: draft.step.step,
        intent: draft.step.intent,
        originalSelector: draft.step.selector,
        snapshotExcerpt: redactSnapshot(
          serializeSnapshotExcerpt(draft.snapshot as Document, draft.step.selector, resolvedConfig.maxSnapshotExcerptChars),
        ),
      })),
      config: resolvedConfig,
    };

    try {
      const suggestions = await withTimeout(
        (llmFallbackProvider as SelectorFallbackProvider)(request),
        resolvedConfig.llmTimeoutMs
      );
      const seenSteps = new Set<number>();

      for (const suggestion of suggestions) {
        if (seenSteps.has(suggestion.stepNumber)) continue;
        seenSteps.add(suggestion.stepNumber);

        const target = llmTargets.find(draft => draft.step.step === suggestion.stepNumber);
        if (!target || !target.snapshot) continue;

        target.metadata.llmAlternative = suggestion.selector || null;

        if (!suggestion.selector || typeof suggestion.selector !== 'string') {
          target.metadata.rejectReason = 'invalid-llm-selector';
          target.metadata.warningCodes.push('llm-invalid-selector');
          continue;
        }

        const validation = validateCSSCandidate(suggestion.selector, target.snapshot);
        if (validation.effectiveMatchCount !== 1) {
          target.metadata.rejectReason = 'llm-selector-not-unique';
          target.metadata.warningCodes.push('llm-non-unique');
          continue;
        }

        const match = target.snapshot.querySelector(suggestion.selector);
        if (!match || !matchesIntent(match, target.step.intent)) {
          target.metadata.rejectReason = 'llm-intent-mismatch';
          target.metadata.warningCodes.push('llm-intent-mismatch');
          continue;
        }

        target.resolvedSelector = suggestion.selector;
        target.metadata = {
          ...target.metadata,
          resolvedSelector: suggestion.selector,
          resolvedBy: 'llm-accepted',
          bestScore: Math.max(target.metadata.bestScore, 0.95),
          effectiveMatchCount: validation.effectiveMatchCount,
          llmAccepted: true,
          rejectReason: null,
        };
        llmAcceptedStepNumbers.push(target.step.step);
      }

      for (const target of llmTargets) {
        if (!target.metadata.llmAccepted && !target.metadata.rejectReason) {
          target.metadata.rejectReason = 'llm-no-valid-suggestion';
          target.metadata.warningCodes.push('llm-no-valid-suggestion');
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const target of llmTargets) {
        target.metadata.rejectReason = reason;
        target.metadata.warningCodes.push('llm-error');
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
