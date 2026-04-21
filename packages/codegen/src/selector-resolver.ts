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
  intentMinScore?: number;
  maxSnapshotBytesForValidation?: number;
  maxSnapshotExcerptChars?: number;
  llmTimeoutMs?: number;
  maxLLMFallbackPerSession?: number;
  llmMaxRetriesPerStep?: number;
}

export interface ResolvedResolverConfig {
  enableLLMFallback: boolean;
  resolverMinScore: number;
  intentMinScore: number;
  maxSnapshotBytesForValidation: number;
  maxSnapshotExcerptChars: number;
  llmTimeoutMs: number;
  maxLLMFallbackPerSession?: number;
  llmMaxRetriesPerStep: number;
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
  lowScoreFallback?: CandidateScore;
}

interface ResolveContext {
  snapshotEngineAvailable: boolean;
}

export interface LlmFallbackStep {
  stepNumber: number;
  intent: string;
  action: CodegenStep['action'];
  originalSelector: string;
  snapshotExcerpt: string;
  normalizedUrl?: string;
  snapshotSource?: ResolverSnapshotSource;
  excerptChars?: number;
  excerptMode?: 'target-selector' | 'seed-element' | 'document-fallback';
  selectorPriority?: SelectorPriority;
}

export interface LlmFallbackSuggestion {
  stepNumber: number;
  selector: string;
  selectors?: string[];
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
  const MAX_SEEDS = 5;
  const seen = new Set<Element>();

  const pushSeed = (element: Element): void => {
    if (!element) return;
    if (seen.has(element)) return;
    if (isOverlyBroadSeedElement(element)) return;
    seen.add(element);
  };

  const byIntentTokens = tokenizeIntentText(step.intent || '').filter(
    token => token.length >= 3 && !INTENT_STOP_TOKENS.has(token),
  );

  const tokenMatchScore = (element: Element): number => {
    if (byIntentTokens.length === 0) return 0;
    const haystack = [
      textFromElement(element) || '',
      element.getAttribute('aria-label') || '',
      element.getAttribute('name') || '',
      element.getAttribute('placeholder') || '',
      element.getAttribute('id') || '',
      element.getAttribute('class') || '',
      element.getAttribute('role') || '',
      element.getAttribute('href') || '',
      element.getAttribute('title') || '',
      element.getAttribute('data-testid') || '',
    ]
      .join(' ')
      .toLowerCase();
    let matched = 0;
    for (const token of byIntentTokens) {
      if (haystack.includes(token)) matched += 1;
    }
    return matched / byIntentTokens.length;
  };

  const attributeSignalScore = (element: Element): number => {
    let score = 0;
    if (element.getAttribute('data-testid')) score += 0.4;
    if (element.getAttribute('id')) score += 0.3;
    if (element.getAttribute('name')) score += 0.25;
    if (element.getAttribute('aria-label')) score += 0.25;
    if (element.getAttribute('placeholder')) score += 0.2;
    if (element.getAttribute('href')) score += 0.15;
    if (element.getAttribute('role')) score += 0.1;
    return Math.min(score, 0.7);
  };

  const seedScore = (element: Element): number => {
    const intentScore = evaluateIntentMatch(element, step).score;
    const tokenScore = tokenMatchScore(element);
    const interactiveBonus = elementLooksInteractive(element) ? 0.2 : 0;
    const inputBonus = step.action === 'input' && elementLooksInputLike(element) ? 0.3 : 0;
    const selectBonus = step.action === 'custom-select' && elementLooksInteractive(element) ? 0.15 : 0;
    const attrsBonus = attributeSignalScore(element);
    return (tokenScore * 0.5) + (intentScore * 0.35) + interactiveBonus + inputBonus + selectBonus + attrsBonus;
  };

  if (step.selector && isLikelyCssSelector(step.selector)) {
    try {
      for (const element of Array.from(snapshot.querySelectorAll(step.selector)).slice(0, MAX_SEEDS)) {
        pushSeed(element);
      }
    } catch {
      // ignore invalid selector
    }
  }

  const hintedAttrs = inferStepSignalAttributes(step);
  const hintedSelectors: string[] = [];
  if (hintedAttrs.dataTestId) hintedSelectors.push(`[data-testid="${cssEscape(hintedAttrs.dataTestId)}"]`);
  if (hintedAttrs.id) hintedSelectors.push(`#${cssEscape(hintedAttrs.id)}`);
  if (hintedAttrs.name) hintedSelectors.push(`[name="${cssEscape(hintedAttrs.name)}"]`);
  if (hintedAttrs.ariaLabel) hintedSelectors.push(`[aria-label="${cssEscape(hintedAttrs.ariaLabel)}"]`);
  if (hintedAttrs.placeholder) hintedSelectors.push(`[placeholder="${cssEscape(hintedAttrs.placeholder)}"]`);
  if (hintedAttrs.role) hintedSelectors.push(`[role="${cssEscape(hintedAttrs.role)}"]`);

  for (const selector of hintedSelectors) {
    if (seen.size >= MAX_SEEDS) break;
    try {
      for (const element of Array.from(snapshot.querySelectorAll(selector)).slice(0, 2)) {
        pushSeed(element);
      }
    } catch {
      // ignore selector errors
    }
  }

  if (seen.size >= MAX_SEEDS) {
    return Array.from(seen).slice(0, MAX_SEEDS);
  }

  let pool: Element[] = [];
  try {
    pool = Array.from(snapshot.querySelectorAll('*')).slice(0, 350);
  } catch {
    pool = [];
  }
  const ranked = pool
    .filter(element => !isOverlyBroadSeedElement(element))
    .map(element => ({ element, score: seedScore(element), tokenScore: tokenMatchScore(element) }))
    .filter(candidate => {
      if (byIntentTokens.length === 0) {
        return candidate.score >= 0.45;
      }
      return candidate.tokenScore > 0 || candidate.score >= 0.6;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEEDS);

  for (const candidate of ranked) {
    if (seen.size >= MAX_SEEDS) break;
    pushSeed(candidate.element);
  }

  return Array.from(seen).slice(0, MAX_SEEDS);
}

function isOverlyBroadSeedElement(element: Element): boolean {
  const tag = ((element as HTMLElement).tagName || '').toLowerCase();
  if (tag === 'html' || tag === 'body' || tag === 'head') {
    return true;
  }

  const textLength = (element.textContent || '').replace(/\s+/g, ' ').trim().length;
  const childCount = element.children?.length ?? 0;
  let descendantCount = 0;
  try {
    descendantCount = element.querySelectorAll('*').length;
  } catch {
    descendantCount = childCount;
  }

  if (['main', 'section', 'article', 'div', 'ul', 'ol', 'table'].includes(tag)) {
    if (descendantCount > 60) return true;
    if (textLength > 1500 && descendantCount > 20) return true;
  }

  return false;
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

function isDynamicText(text: string, options?: { allowNumericText?: boolean }): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.length > 80) return true;
  if (options?.allowNumericText) {
    if (/\d{6,}/.test(trimmed)) return true;
  } else if (/\d{4,}/.test(trimmed)) {
    return true;
  }
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

const CALENDAR_INTENT_HINTS = new Set([
  'calendar',
  'date',
  'day',
  'month',
  'year',
  'timesheet',
  'time',
  'today',
  'tomorrow',
  'yesterday',
]);

const CALENDAR_SELECTOR_HINTS = [
  'calendar',
  'datepicker',
  'date-picker',
  'dateinput',
  'date-input',
  'date-input',
  'oxd-date-input',
  'oxd-calendar',
  'timesheet',
];

const CALENDAR_SCOPE_SELECTORS = [
  '.oxd-date-input',
  '.oxd-date-input-container',
  '.oxd-calendar-wrapper',
  '.oxd-calendar-selector',
  '.oxd-calendar-selector-year',
  '.oxd-calendar-selector-month',
  '.oxd-calendar-dropdown',
  '.oxd-calendar-dates-grid',
  '.react-datepicker',
  '.datepicker',
  '[role="dialog"]',
];

function containsCalendarHint(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return CALENDAR_SELECTOR_HINTS.some(hint => normalized.includes(hint));
}

function isNumericIntentToken(token: string): boolean {
  return /^\d{1,4}$/.test(token);
}

function intentTokensForStep(step: CodegenStep): string[] {
  return tokenizeIntentText(step.intent || '');
}

function hasCalendarIntent(step: CodegenStep): boolean {
  const tokens = intentTokensForStep(step);
  if (tokens.some(token => CALENDAR_INTENT_HINTS.has(token))) return true;
  if (tokens.some(isNumericIntentToken) && (step.action === 'click' || step.action === 'input')) return true;
  return false;
}

function hasCalendarSnapshotMarkers(snapshot: Document): boolean {
  return CALENDAR_SCOPE_SELECTORS.some(selector => {
    try {
      return !!snapshot.querySelector(selector);
    } catch {
      return false;
    }
  });
}

function isCalendarContext(step: CodegenStep, snapshot: Document, attrs: StepSignalAttributes, seedElements: Element[]): boolean {
  if (hasCalendarIntent(step)) return true;
  if (containsCalendarHint(step.selector)) return true;
  if (containsCalendarHint(attrs.class)) return true;
  if (containsCalendarHint(attrs.parentSelector)) return true;
  if (containsCalendarHint(step.fingerprint?.selector)) return true;
  if (containsCalendarHint(step.fingerprint?.parentSelector || undefined)) return true;

  for (const element of seedElements) {
    const className = (element.getAttribute('class') || '').toLowerCase();
    const id = (element.getAttribute('id') || '').toLowerCase();
    const aria = (element.getAttribute('aria-label') || '').toLowerCase();
    if (containsCalendarHint(className) || containsCalendarHint(id) || containsCalendarHint(aria)) {
      return true;
    }
  }

  if (step.action === 'click' || step.action === 'input') {
    return hasCalendarSnapshotMarkers(snapshot);
  }

  return false;
}

function getCalendarScopeSelectors(step: CodegenStep, attrs: StepSignalAttributes): string[] {
  const scopes: string[] = [];
  const stableParent = extractStableParentSelector(step, attrs);
  const maybeScoped = [attrs.parentSelector, stableParent];
  for (const selector of maybeScoped) {
    if (!selector) continue;
    if (!isLikelyCssSelector(selector)) continue;
    if (!containsCalendarHint(selector)) continue;
    scopes.push(selector);
  }
  scopes.push(...CALENDAR_SCOPE_SELECTORS);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const scope of scopes) {
    if (!scope) continue;
    if (seen.has(scope)) continue;
    seen.add(scope);
    unique.push(scope);
  }
  return unique.slice(0, 8);
}

function extractCalendarTextTarget(step: CodegenStep, textExcerpt?: string | null): string | null {
  const raw = textExcerpt?.trim() || '';
  if (raw) return raw;
  const numericToken = intentTokensForStep(step).find(isNumericIntentToken);
  return numericToken ?? null;
}

function looksDateValue(value?: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed);
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

function shouldTrustOriginalOnSnapshotMiss(
  step: CodegenStep,
  originalValidation: CandidateValidation
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
  const calendarContext = isCalendarContext(step, snapshot, attrs, seedElements);
  const calendarScopes = calendarContext ? getCalendarScopeSelectors(step, attrs) : [];
  const calendarTextTarget = calendarContext ? extractCalendarTextTarget(step, textExcerpt) : null;

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

  if (textExcerpt && !isDynamicText(textExcerpt, { allowNumericText: calendarContext })) {
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

  if (calendarContext && selector && isLikelyCssSelector(selector)) {
    for (const scope of calendarScopes) {
      candidates.push({
        selector: `${scope} ${selector}`,
        source: 'parent-scope',
        rank: 3,
      });
    }
  }

  if (calendarContext && calendarTextTarget) {
    const escapedCalendarText = escapeTextSelectorValue(calendarTextTarget);
    if (escapedCalendarText) {
      candidates.push({
        selector: `text=${escapedCalendarText}`,
        source: 'text',
        rank: 3,
      });

      if (selector && isLikelyCssSelector(selector)) {
        candidates.push({
          selector: `${selector}:has-text("${escapedCalendarText}")`,
          source: 'text',
          rank: 3,
        });
      }

      for (const scope of calendarScopes) {
        if (selector && isLikelyCssSelector(selector)) {
          candidates.push({
            selector: `${scope} ${selector}:has-text("${escapedCalendarText}")`,
            source: 'parent-scope',
            rank: 2,
          });
        }
        candidates.push({
          selector: `${scope} *:has-text("${escapedCalendarText}")`,
          source: 'text',
          rank: 3,
        });
      }
    }
  }

  if (calendarContext && step.action === 'input') {
    for (const scope of calendarScopes) {
      candidates.push({ selector: `${scope} input`, source: 'parent-scope', rank: 2 });
      candidates.push({ selector: `${scope} .oxd-input`, source: 'parent-scope', rank: 3 });
    }
    if (looksDateValue(step.value)) {
      candidates.push({ selector: 'input[placeholder*="yyyy"]', source: 'placeholder', rank: 3 });
      candidates.push({ selector: 'input[placeholder*="mm"]', source: 'placeholder', rank: 4 });
      candidates.push({ selector: 'input[placeholder*="dd"]', source: 'placeholder', rank: 4 });
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
  }).slice(0, 20);
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

type IntentActionHint =
  | 'click'
  | 'input'
  | 'submit'
  | 'custom-select'
  | 'hover'
  | 'scroll'
  | 'navigate'
  | 'unknown';

interface IntentScore {
  score: number;
  tokenScore: number;
  roleScore: number;
  tagScore: number;
  matchedTokens: string[];
  tokens: string[];
  actionHint: IntentActionHint;
}

const INTENT_STOP_TOKENS = new Set([
  'click',
  'input',
  'type',
  'custom',
  'select',
  'hover',
  'scroll',
  'navigate',
  'navigation',
  'immediate',
  'action',
  'state',
  'refresh',
  'no',
  'change',
  'page',
  'root',
  'icon',
  'btn',
  'button',
  'menu',
  'item',
  'node',
  'step',
  'oxd',
  'focus',
  'active',
  'field',
  'open',
  'close',
]);

function tokenizeIntentText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => token.length >= 2);
}

function inferActionHint(step: CodegenStep, tokens: string[]): IntentActionHint {
  if (step.action) return step.action;
  if (tokens.includes('custom') && tokens.includes('select')) return 'custom-select';
  if (tokens.includes('submit')) return 'submit';
  if (tokens.includes('hover')) return 'hover';
  if (tokens.includes('scroll')) return 'scroll';
  if (tokens.includes('navigate') || tokens.includes('navigation')) return 'navigate';
  if (tokens.includes('input') || tokens.includes('type')) return 'input';
  if (tokens.includes('click')) return 'click';
  return 'unknown';
}

function actionTagHints(actionHint: IntentActionHint, calendarMode = false): Set<string> {
  switch (actionHint) {
    case 'click':
      return calendarMode
        ? new Set(['button', 'a', 'label', 'input', 'option', 'summary', 'i', 'svg'])
        : new Set(['button', 'a', 'label', 'input', 'option', 'summary']);
    case 'input':
      return new Set(['input', 'textarea', 'select']);
    case 'submit':
      return new Set(['button', 'input']);
    case 'custom-select':
      return new Set(['select', 'option', 'input', 'button', 'a']);
    case 'hover':
      return new Set(['button', 'a', 'label', 'div', 'li']);
    default:
      return new Set();
  }
}

function collectIntentHaystack(el: Element): string {
  const attrs = [
    'aria-label',
    'name',
    'placeholder',
    'id',
    'data-testid',
    'href',
    'value',
    'data-value',
    'data-id',
    'title',
    'role',
    'class',
  ];
  const text = (el.textContent || '').trim();
  const attrValues = attrs
    .map(name => el.getAttribute(name) || '')
    .filter(Boolean);
  return `${text} ${attrValues.join(' ')}`.toLowerCase();
}

function computeTokenScore(tokens: string[], haystack: string): { score: number; matchedTokens: string[] } {
  if (tokens.length === 0) {
    return { score: 0.5, matchedTokens: [] };
  }

  const matchedTokens = tokens.filter(token => haystack.includes(token));
  const ratio = matchedTokens.length / tokens.length;
  return {
    score: Math.max(0, Math.min(1, ratio)),
    matchedTokens,
  };
}

function computeRoleScore(actionHint: IntentActionHint, role: string, tagName: string, calendarMode = false): number {
  const roleLower = role.toLowerCase();
  const tagLower = tagName.toLowerCase();
  if (!roleLower && !tagLower) return 0.5;

  if (actionHint === 'unknown' || actionHint === 'navigate' || actionHint === 'scroll') {
    return 0.5;
  }

  if (actionHint === 'input') {
    if (['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(roleLower)) return 1;
    if (['input', 'textarea', 'select'].includes(tagLower)) return 1;
    return 0.2;
  }

  if (actionHint === 'submit') {
    if (roleLower === 'button' || tagLower === 'button') return 1;
    if (tagLower === 'input') return 0.8;
    return 0.2;
  }

  if (actionHint === 'custom-select') {
    if (['option', 'listbox', 'combobox', 'menuitem'].includes(roleLower)) return 1;
    if (['select', 'option', 'input', 'button', 'a'].includes(tagLower)) return 0.9;
    return 0.3;
  }

  if (actionHint === 'click' || actionHint === 'hover') {
    if (['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch'].includes(roleLower)) return 1;
    if (calendarMode && ['img', 'presentation'].includes(roleLower)) return 0.75;
    if (['button', 'a', 'label', 'input', 'option', 'summary'].includes(tagLower)) return 0.85;
    if (calendarMode && ['i', 'svg'].includes(tagLower)) return 0.8;
    return 0.3;
  }

  return 0.5;
}

function computeTagScore(actionHint: IntentActionHint, tagName: string, calendarMode = false): number {
  if (!tagName) return 0.5;
  const expected = actionTagHints(actionHint, calendarMode);
  if (expected.size === 0) return 0.5;
  return expected.has(tagName.toLowerCase()) ? 1 : 0;
}

function evaluateIntentMatch(el: Element, step: CodegenStep): IntentScore {
  const rawTokens = tokenizeIntentText(step.intent || '');
  const semanticTokens = rawTokens.filter(token => !INTENT_STOP_TOKENS.has(token));
  const calendarMode = hasCalendarIntent(step) || containsCalendarHint(step.selector);
  const actionHint = inferActionHint(step, rawTokens);
  const haystack = collectIntentHaystack(el);
  const tagName = ((el as HTMLElement).tagName || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const token = computeTokenScore(semanticTokens, haystack);
  const roleScore = computeRoleScore(actionHint, role, tagName, calendarMode);
  const tagScore = computeTagScore(actionHint, tagName, calendarMode);
  let score = Math.max(0, Math.min(1, (token.score * 0.6) + (roleScore * 0.2) + (tagScore * 0.2)));

  // Prevent LLM false positives that pass only on role/tag shape without any intent-token evidence.
  if (semanticTokens.length > 0 && token.matchedTokens.length === 0 && !calendarMode) {
    score = Math.min(score, 0.49);
  }

  return {
    score,
    tokenScore: token.score,
    roleScore,
    tagScore,
    matchedTokens: token.matchedTokens,
    tokens: semanticTokens,
    actionHint,
  };
}

function selectorLooksInputLike(selector: string): boolean {
  const normalized = selector.trim().toLowerCase();
  return (
    normalized.startsWith('input') ||
    normalized.startsWith('textarea') ||
    normalized.startsWith('select') ||
    normalized.includes('[name=') ||
    normalized.includes('[placeholder=') ||
    normalized.includes('[type=')
  );
}

function selectorLooksInteractive(selector: string): boolean {
  const normalized = selector.trim().toLowerCase();
  return (
    normalized.startsWith('button') ||
    normalized.startsWith('a') ||
    normalized.startsWith('input') ||
    normalized.startsWith('textarea') ||
    normalized.startsWith('select') ||
    normalized.includes('[role=') ||
    normalized.includes('[href=') ||
    normalized.includes('[aria-label=') ||
    normalized.includes(':has-text(') ||
    normalized.startsWith('text=')
  );
}

function elementLooksInputLike(el: Element | null): boolean {
  if (!el) return false;
  const tagName = ((el as HTMLElement).tagName || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const contentEditable = (el.getAttribute('contenteditable') || '').toLowerCase();
  return (
    ['input', 'textarea', 'select'].includes(tagName) ||
    ['textbox', 'searchbox', 'combobox', 'spinbutton'].includes(role) ||
    contentEditable === 'true'
  );
}

function elementLooksInteractive(el: Element | null): boolean {
  if (!el) return false;
  const tagName = ((el as HTMLElement).tagName || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  const href = el.getAttribute('href');
  const onclick = el.getAttribute('onclick');
  const tabIndex = el.getAttribute('tabindex');

  if (elementLooksInputLike(el)) return true;
  if (['button', 'a', 'label', 'summary', 'option'].includes(tagName)) return true;
  if (
    ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'radio', 'switch', 'combobox', 'listbox'].includes(role)
  ) {
    return true;
  }
  if (href || onclick) return true;
  if (typeof tabIndex === 'string' && tabIndex.trim() !== '' && tabIndex.trim() !== '-1') return true;
  return false;
}

function hasFieldIntent(step: CodegenStep): boolean {
  const tokens = tokenizeIntentText(step.intent || '');
  const fieldHints = new Set([
    'username',
    'password',
    'email',
    'search',
    'date',
    'first',
    'last',
    'name',
    'phone',
    'mobile',
    'otp',
    'pin',
    'code',
  ]);
  return tokens.some(token => fieldHints.has(token));
}

function getCandidateElement(snapshot: Document, selector: string): Element | null {
  try {
    return snapshot.querySelector(selector);
  } catch {
    return null;
  }
}

function isLowScoreFallbackCandidateSafe(
  step: CodegenStep,
  snapshot: Document,
  candidate: CandidateScore,
  config: ResolvedResolverConfig
): boolean {
  const selector = candidate.candidate.selector;
  if (!selector || selector === step.selector) return false;

  const source = candidate.candidate.source;
  const element = getCandidateElement(snapshot, selector);
  const intentScore = element ? evaluateIntentMatch(element, step).score : 0;
  const inputLike = selectorLooksInputLike(selector) || elementLooksInputLike(element);
  const interactive = selectorLooksInteractive(selector) || elementLooksInteractive(element);

  if (step.action === 'input') {
    return inputLike;
  }

  if (step.action === 'submit') {
    return interactive;
  }

  if (step.action === 'custom-select') {
    return interactive || intentScore >= config.intentMinScore;
  }

  if (step.action === 'click' && hasFieldIntent(step)) {
    return inputLike;
  }

  if (source === 'class' || source === 'parent-scope') {
    return interactive && intentScore >= config.intentMinScore;
  }

  return interactive || intentScore >= config.intentMinScore;
}

export function matchesIntent(el: Element, intent: string | CodegenStep): boolean {
  const step = typeof intent === 'string'
    ? ({
      step: 0,
      intent,
      action: 'click',
      selector: '',
      selectorPriority: 'unknown',
      assertions: [],
      userAssertions: [],
      confidence: 1,
      sampleSize: 1,
      pageUrl: '',
    } as CodegenStep)
    : intent;
  return evaluateIntentMatch(el, step).score >= DEFAULT_CONFIG.intentMinScore;
}

// selector-resolver.ts

/**
 * Extracts a focused HTML excerpt around the target element, preferring a subtree
 * (element + up to 2 parents) that fits within maxChars. Strips scripts/styles.
 * Redaction is applied after extraction, then truncation.
 */
function serializeSnapshotExcerpt(
  snapshot: Document,
  step: CodegenStep,
  maxChars: number
): {
  excerpt: string;
  mode: 'target-selector' | 'seed-element' | 'document-fallback';
} {
  const stripNoise = (html: string): string => {
    if (typeof html !== 'string') {
      return '';
    }
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<link\b[^>]*>/gi, '')
      .replace(/<meta\b[^>]*>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  };

  const serializeFromElement = (
    targetElement: Element,
    strategy: 'max-context' | 'focused' = 'max-context'
  ): string => {
    const candidateElements: Element[] = [];
    candidateElements.push(targetElement);

    let parent = targetElement.parentElement;
    let depth = 0;
    while (parent && depth < 2) {
      candidateElements.push(parent);
      parent = parent.parentElement;
      depth++;
    }

    const cleanedCandidates = candidateElements.map(element => stripNoise(element.outerHTML));

    const redactedCandidates = cleanedCandidates.map(html => redactSnapshot(html));

    if (strategy === 'focused') {
      // Prefer the closest element-local context instead of large page wrappers.
      for (let index = 0; index < redactedCandidates.length; index += 1) {
        const redacted = redactedCandidates[index];
        const tagName = ((candidateElements[index] as HTMLElement).tagName || '').toLowerCase();
        if (tagName === 'html' || tagName === 'body') continue;
        if (redacted.length >= 60 && redacted.length <= maxChars) {
          return redacted;
        }
      }
      for (let index = 0; index < redactedCandidates.length; index += 1) {
        const tagName = ((candidateElements[index] as HTMLElement).tagName || '').toLowerCase();
        if (tagName === 'html' || tagName === 'body') continue;
        const candidate = redactedCandidates[index] || '';
        if (candidate.length > 0) return candidate.slice(0, maxChars);
      }
      const firstRedacted = redactedCandidates[0] || '';
      return firstRedacted.slice(0, maxChars);
    }

    let bestHtml = '';
    for (const redacted of redactedCandidates) {
      if (redacted.length <= maxChars && redacted.length > bestHtml.length) {
        bestHtml = redacted;
      }
    }

    if (!bestHtml) {
      const firstRedacted = redactedCandidates[0] || '';
      bestHtml = firstRedacted.slice(0, maxChars);
    }

    return bestHtml;
  };

  const fallbackDocumentExcerpt = (): string => {
    const interactiveSelectors = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[data-testid]',
      '[data-id]',
      '[class*="btn"]',
      '[class*="button"]',
    ];

    const interactiveCandidates: Element[] = [];
    const seenCandidates = new Set<Element>();
    const addCandidate = (element: Element | null): void => {
      if (!element) return;
      if (seenCandidates.has(element)) return;
      seenCandidates.add(element);
      interactiveCandidates.push(element);
    };

    for (const selector of interactiveSelectors) {
      try {
        const matches = Array.from(snapshot.querySelectorAll(selector)).slice(0, 4);
        for (const match of matches) {
          addCandidate(match);
        }
      } catch {
        // Ignore invalid selector errors and continue probing.
      }
    }

    if (interactiveCandidates.length > 0) {
      const ranked = interactiveCandidates
        .map(element => ({
          element,
          score: evaluateIntentMatch(element, step).score,
        }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.element;
      if (best) {
        return serializeFromElement(best, 'focused');
      }
    }

    const fullHtml = snapshot.body?.outerHTML || snapshot.documentElement?.outerHTML || '';
    const cleaned = stripNoise(fullHtml);
    const redacted = redactSnapshot(cleaned);
    return redacted.slice(0, maxChars);
  };

  const targetSelector = step.selector || '';
  if (targetSelector && isLikelyCssSelector(targetSelector)) {
    try {
      const targetElement = snapshot.querySelector(targetSelector);
      if (targetElement) {
        return {
          excerpt: serializeFromElement(targetElement),
          mode: 'target-selector',
        };
      }
    } catch {
      // Ignore and continue with seed search.
    }
  }

  const seedElements = findSeedElements(step, snapshot);
  if (seedElements.length > 0) {
    const rankedSeed = seedElements
      .map(element => ({
        element,
        score: evaluateIntentMatch(element, step).score,
      }))
      .sort((a, b) => b.score - a.score)[0]?.element;

    if (rankedSeed) {
      return {
        excerpt: serializeFromElement(rankedSeed),
        mode: 'seed-element',
      };
    }
  }

  return {
    excerpt: fallbackDocumentExcerpt(),
    mode: 'document-fallback',
  };
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

function normalizeSuggestedSelector(selector: string): string {
  return selector.trim().replace(/\s+/g, ' ');
}

function dedupeSelectors(selectors: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const selector of selectors) {
    const normalized = normalizeSuggestedSelector(selector);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function selectorsFromSuggestion(suggestion: LlmFallbackSuggestion): string[] {
  const raw: string[] = [];
  if (Array.isArray(suggestion.selectors)) {
    for (const value of suggestion.selectors) {
      if (typeof value === 'string') raw.push(value);
    }
  }
  if (typeof suggestion.selector === 'string' && suggestion.selector.trim()) {
    raw.push(suggestion.selector);
  }
  return dedupeSelectors(raw);
}

function pushWarningCode(metadata: ResolverMetadata, warningCode: string): void {
  if (!metadata.warningCodes.includes(warningCode)) {
    metadata.warningCodes.push(warningCode);
  }
}

function applyLowScoreFallback(target: StepResolutionDraft, triggerReason: string): boolean {
  if (!target.lowScoreFallback) return false;

  const fallbackSelector = target.lowScoreFallback.candidate.selector;
  target.resolvedSelector = fallbackSelector;
  target.metadata.resolvedSelector = fallbackSelector;
  target.metadata.resolvedBy = 'deterministic-override';
  target.metadata.bestScore = target.lowScoreFallback.score;
  target.metadata.effectiveMatchCount = target.lowScoreFallback.validation.effectiveMatchCount;
  target.metadata.rejectReason = triggerReason;
  pushWarningCode(target.metadata, 'deterministic-low-score-fallback');
  pushWarningCode(target.metadata, 'llm-retries-exhausted');

  console.warn('[AIR] [RESOLVER] Applied low-score deterministic fallback', {
    step: target.step.step,
    selector: fallbackSelector,
    score: Number(target.lowScoreFallback.score.toFixed(3)),
    triggerReason,
  });
  return true;
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
  const llmFallbackStepNumbers: number[] = [];

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
    const maxAttemptsPerStep = Math.max(1, resolvedConfig.llmMaxRetriesPerStep + 1);
    const llmRetryCounts = new Map<number, number>();
    const llmTargetMap = new Map<number, StepResolutionDraft>(
      llmTargets.map(target => [target.step.step, target]),
    );

    for (const draft of llmTargets) {
      draft.metadata.llmAttempted = true;
      llmAttemptedStepNumbers.push(draft.step.step);
    }

    console.log('[AIR] [RESOLVER] LLM fallback started', {
      targets: llmTargets.length,
      cap: llmCap,
      maxRetriesPerStep: resolvedConfig.llmMaxRetriesPerStep,
      maxAttemptsPerStep,
      intentMinScore: resolvedConfig.intentMinScore,
    });

    const request: LlmFallbackRequest = {
      steps: llmTargets.map(draft => {
        const excerptInfo = serializeSnapshotExcerpt(
          draft.snapshot as Document,
          draft.step,
          resolvedConfig.maxSnapshotExcerptChars,
        );
        const snapshotExcerpt = excerptInfo.excerpt;
        return {
          stepNumber: draft.step.step,
          intent: draft.step.intent,
          action: draft.step.action,
          originalSelector: draft.step.selector,
          snapshotExcerpt,
          normalizedUrl: draft.step.normalizedUrl,
          snapshotSource: draft.metadata.snapshotSource,
          excerptChars: snapshotExcerpt.length,
          excerptMode: excerptInfo.mode,
          selectorPriority: draft.step.selectorPriority,
        };
      }),
      config: resolvedConfig,
    };

    const excerptLengths = request.steps.map(step => step.excerptChars ?? step.snapshotExcerpt.length);
    const minExcerptChars = excerptLengths.length > 0 ? Math.min(...excerptLengths) : 0;
    const maxExcerptChars = excerptLengths.length > 0 ? Math.max(...excerptLengths) : 0;
    const avgExcerptChars = excerptLengths.length > 0
      ? Number((excerptLengths.reduce((sum, value) => sum + value, 0) / excerptLengths.length).toFixed(1))
      : 0;
    const sourceBreakdown = request.steps.reduce<Record<string, number>>((acc, step) => {
      const source = step.snapshotSource ?? 'unknown';
      acc[source] = (acc[source] ?? 0) + 1;
      return acc;
    }, {});
    const excerptModeBreakdown = request.steps.reduce<Record<string, number>>((acc, step) => {
      const mode = step.excerptMode ?? 'unknown';
      acc[mode] = (acc[mode] ?? 0) + 1;
      return acc;
    }, {});
    console.log('[AIR] [RESOLVER] LLM request snapshot context', {
      targetSteps: request.steps.length,
      minExcerptChars,
      maxExcerptChars,
      avgExcerptChars,
      sourceBreakdown,
      excerptModeBreakdown,
    });

    const debugSnapshotContext = /^(1|true|yes)$/i.test(process.env.AIR_DEBUG_LLM_SNAPSHOT_CONTEXT || '');
    if (debugSnapshotContext) {
      for (const step of request.steps) {
        const preview = step.snapshotExcerpt.slice(0, 200);
        console.log('[AIR] [RESOLVER] LLM step context', {
          step: step.stepNumber,
          source: step.snapshotSource ?? 'unknown',
          mode: step.excerptMode ?? 'unknown',
          normalizedUrl: step.normalizedUrl ?? null,
          excerptChars: step.excerptChars ?? step.snapshotExcerpt.length,
          excerptPreview: preview,
        });
      }
    }

    try {
      const suggestionsRaw = await withTimeout(
        (llmFallbackProvider as SelectorFallbackProvider)(request),
        resolvedConfig.llmTimeoutMs
      );

      const suggestionsByStep = new Map<number, string[]>();
      for (const suggestion of suggestionsRaw) {
        if (!Number.isFinite(suggestion.stepNumber)) continue;
        if (!llmTargetMap.has(suggestion.stepNumber)) continue;
        const current = suggestionsByStep.get(suggestion.stepNumber) ?? [];
        const merged = dedupeSelectors([...current, ...selectorsFromSuggestion(suggestion)]);
        suggestionsByStep.set(suggestion.stepNumber, merged);
      }

      for (const target of llmTargets) {
        if (!target.snapshot) continue;
        const stepNumber = target.step.step;
        const selectorQueue = suggestionsByStep.get(stepNumber) ?? [];

        if (selectorQueue.length === 0) {
          target.metadata.rejectReason = 'llm-no-valid-suggestion';
          pushWarningCode(target.metadata, 'llm-no-valid-suggestion');
          console.warn('[AIR] [RESOLVER] No valid LLM suggestions for step', { step: stepNumber });
          if (applyLowScoreFallback(target, target.metadata.rejectReason)) {
            llmFallbackStepNumbers.push(stepNumber);
          }
          continue;
        }

        if (selectorQueue.length > maxAttemptsPerStep) {
          pushWarningCode(target.metadata, 'llm-retry-cap-reached');
        }

        let accepted = false;
        let attemptCount = 0;

        for (const suggestedSelector of selectorQueue) {
          if (attemptCount >= maxAttemptsPerStep) {
            break;
          }
          attemptCount += 1;
          llmRetryCounts.set(stepNumber, Math.max(0, attemptCount - 1));
          target.metadata.llmAlternative = suggestedSelector;

          console.log('[AIR] [RESOLVER] Validating LLM selector', {
            step: stepNumber,
            attempt: attemptCount,
            maxAttemptsPerStep,
            selector: suggestedSelector,
          });

          try {
            const validation = validateCSSCandidate(suggestedSelector, target.snapshot);
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

            const match = target.snapshot.querySelector(suggestedSelector);
            if (!match) {
              target.metadata.rejectReason = 'llm-selector-not-found';
              pushWarningCode(target.metadata, 'llm-selector-not-found');
              continue;
            }

            const intentScore = evaluateIntentMatch(match, target.step);
            if (intentScore.score < resolvedConfig.intentMinScore) {
              target.metadata.rejectReason = 'llm-intent-mismatch';
              pushWarningCode(target.metadata, 'llm-intent-mismatch');
              console.warn('[AIR] [RESOLVER] LLM selector rejected by intent score', {
                step: stepNumber,
                selector: suggestedSelector,
                score: Number(intentScore.score.toFixed(3)),
                tokenScore: Number(intentScore.tokenScore.toFixed(3)),
                roleScore: Number(intentScore.roleScore.toFixed(3)),
                tagScore: Number(intentScore.tagScore.toFixed(3)),
                threshold: resolvedConfig.intentMinScore,
                matchedTokens: intentScore.matchedTokens,
              });
              continue;
            }

            target.resolvedSelector = suggestedSelector;
            target.metadata = {
              ...target.metadata,
              resolvedSelector: suggestedSelector,
              resolvedBy: 'llm-accepted',
              bestScore: Math.max(target.metadata.bestScore, 0.95),
              effectiveMatchCount: validation.effectiveMatchCount,
              llmAccepted: true,
              rejectReason: null,
            };
            llmAcceptedStepNumbers.push(stepNumber);
            accepted = true;
            console.log('[AIR] [RESOLVER] LLM selector accepted', {
              step: stepNumber,
              attempt: attemptCount,
              selector: suggestedSelector,
            });
            break;
          } catch (error) {
            target.metadata.rejectReason = 'llm-validation-error';
            pushWarningCode(target.metadata, 'llm-validation-error');
            console.warn('[AIR] [RESOLVER] LLM selector validation failed', {
              step: stepNumber,
              attempt: attemptCount,
              selector: suggestedSelector,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        if (!accepted) {
          if (!target.metadata.rejectReason) {
            target.metadata.rejectReason = 'llm-no-valid-suggestion';
            pushWarningCode(target.metadata, 'llm-no-valid-suggestion');
          }
          if (applyLowScoreFallback(target, target.metadata.rejectReason)) {
            llmFallbackStepNumbers.push(stepNumber);
          }
        }
      }

      for (const target of llmTargets) {
        if (!target.metadata.llmAccepted && !target.metadata.rejectReason) {
          target.metadata.rejectReason = 'llm-no-valid-suggestion';
          pushWarningCode(target.metadata, 'llm-no-valid-suggestion');
          if (applyLowScoreFallback(target, target.metadata.rejectReason)) {
            llmFallbackStepNumbers.push(target.step.step);
          }
        }
      }

      console.log('[AIR] [RESOLVER] LLM fallback completed', {
        attemptedSteps: llmAttemptedStepNumbers.length,
        acceptedSteps: llmAcceptedStepNumbers.length,
        deterministicFallbackSteps: llmFallbackStepNumbers.length,
        retriesByStep: Object.fromEntries(llmRetryCounts),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error('[AIR] [RESOLVER] LLM fallback failed', { error: reason });
      for (const target of llmTargets) {
        target.metadata.rejectReason = reason;
        pushWarningCode(target.metadata, 'llm-error');
        if (applyLowScoreFallback(target, reason)) {
          llmFallbackStepNumbers.push(target.step.step);
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

