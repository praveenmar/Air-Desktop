import type { CodegenStep } from '../types';
import type {
  CandidateScore,
  RankedElementScore,
  ResolvedResolverConfig,
  StepSignalAttributes,
} from './types';
import { BROAD_SELECTOR_MATCH_LIMIT, BROAD_SELECTOR_SCORE_LIMIT } from './types';
import {
  cssEscape,
  extractStableParentSelector,
  extractTextExcerpt,
  findStableClassFromAttributes,
  getElementTextSignals,
  inferStepSignalAttributes,
  isLikelyCssSelector,
  normalizeTextForMatch,
  textFromElement,
} from './text-matching';

export function getElementDepth(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current?.parentElement) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

export function getDescendantCount(element: Element): number {
  try {
    return element.querySelectorAll('*').length;
  } catch {
    const children = (element as HTMLElement & { children?: { length?: number } }).children;
    return typeof children?.length === 'number' ? children.length : 0;
  }
}

export function buildScopeElements(snapshot: Document, selector?: string | null): Set<Element> {
  const elements = new Set<Element>();
  if (!selector || !isLikelyCssSelector(selector)) {
    return elements;
  }
  try {
    for (const element of Array.from(snapshot.querySelectorAll(selector)).slice(0, 25)) {
      elements.add(element);
    }
  } catch {
    return elements;
  }
  return elements;
}

export function isDescendantOfAnyScope(element: Element, scopes: Set<Element>): boolean {
  if (scopes.size === 0) return false;
  let current: Element | null = element;
  while (current) {
    if (scopes.has(current)) return true;
    current = current.parentElement;
  }
  return false;
}

export function textMatchStrength(element: Element, step: CodegenStep): number {
  const needles = [
    step.fingerprint?.textExcerpt,
    extractTextExcerpt(step),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (needles.length === 0) return 0;

  const haystacks = getElementTextSignals(element).map(normalizeTextForMatch).filter(Boolean);
  if (haystacks.length === 0) return 0;

  let best = 0;
  for (const rawNeedle of needles) {
    const needle = normalizeTextForMatch(rawNeedle);
    if (!needle) continue;
    const needleTokens = needle.split(/\s+/).filter(Boolean);
    for (const haystack of haystacks) {
      if (haystack === needle) {
        best = Math.max(best, 1);
        continue;
      }
      const haystackTokens = new Set(haystack.split(/\s+/).filter(Boolean));
      if (needleTokens.length > 0 && needleTokens.every(token => haystackTokens.has(token))) {
        best = Math.max(best, 0.75);
        continue;
      }
      if (haystack.includes(needle)) {
        best = Math.max(best, 0.5);
      }
    }
  }
  return best;
}

export function attributeMatchStrength(element: Element, step: CodegenStep): number {
  const attrs = inferStepSignalAttributes(step);
  const checks: Array<[string | undefined, string | null, number]> = [
    [attrs.dataTestId, element.getAttribute('data-testid'), 0.35],
    [attrs.id, element.getAttribute('id') || (element as HTMLElement).id || null, 0.25],
    [attrs.name, element.getAttribute('name'), 0.2],
    [attrs.ariaLabel, element.getAttribute('aria-label'), 0.1],
    [attrs.placeholder, element.getAttribute('placeholder'), 0.1],
  ];

  let totalWeight = 0;
  let matchedWeight = 0;
  for (const [expected, actual, weight] of checks) {
    if (!expected) continue;
    totalWeight += weight;
    if (actual && normalizeTextForMatch(actual) === normalizeTextForMatch(expected)) {
      matchedWeight += weight;
    }
  }

  if (totalWeight === 0) return 0;
  return Math.min(1, matchedWeight / totalWeight);
}

export function localityStrength(element: Element): number {
  const interactiveBonus = elementLooksInteractive(element) ? 0.45 : 0.15;
  const descendants = getDescendantCount(element);
  const sizeScore = Math.max(0, 1 - (descendants / 25));
  const depthScore = Math.min(getElementDepth(element) / 8, 1);
  return Math.min(1, (interactiveBonus * 0.5) + (sizeScore * 0.35) + (depthScore * 0.15));
}

export function parentProximityStrength(element: Element, snapshot: Document, step: CodegenStep): number {
  const parentSelector = step.fingerprint?.parentSelector;
  if (!parentSelector) return 0;
  const scopes = buildScopeElements(snapshot, parentSelector);
  return isDescendantOfAnyScope(element, scopes) ? 1 : 0;
}

export function fastPruneMatchedElements(matches: Element[], snapshot: Document, step?: CodegenStep): Element[] {
  if (matches.length <= BROAD_SELECTOR_MATCH_LIMIT) {
    return matches;
  }

  const ranked = matches.map((element, index) => {
    let score = 0;
    if (elementLooksInteractive(element)) score += 0.4;
    if (step) {
      score += textMatchStrength(element, step) * 0.3;
      score += attributeMatchStrength(element, step) * 0.2;
      score += parentProximityStrength(element, snapshot, step) * 0.1;
    }
    return { element, index, score };
  });

  return ranked
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, BROAD_SELECTOR_SCORE_LIMIT)
    .map(item => item.element);
}

export function scoreMatchedElements(
  matches: Element[],
  snapshot: Document,
  step?: CodegenStep,
): RankedElementScore[] {
  const candidates = fastPruneMatchedElements(matches, snapshot, step);

  return candidates.map((element, index) => {
    const intent = step ? evaluateIntentMatch(element, step) : null;
    const tagRole = intent ? ((intent.roleScore + intent.tagScore) / 2) : (elementLooksInteractive(element) ? 0.6 : 0.2);
    const score = step
      ? (
        (intent?.score ?? 0) * 0.30 +
        textMatchStrength(element, step) * 0.20 +
        attributeMatchStrength(element, step) * 0.20 +
        tagRole * 0.15 +
        localityStrength(element) * 0.10 +
        parentProximityStrength(element, snapshot, step) * 0.05
      )
      : (localityStrength(element) * 0.7) + (elementLooksInteractive(element) ? 0.3 : 0);

    return {
      element,
      index,
      score: Math.max(0, Math.min(1, score)),
    };
  }).sort((a, b) => (b.score - a.score) || (a.index - b.index));
}

export function enrichSignalAttributesFromElement(attrs: StepSignalAttributes, element: Element): void {
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
  if (!attrs.ariaLabelledBy) {
    const ariaLabelledBy = htmlElement.getAttribute('aria-labelledby');
    if (ariaLabelledBy) attrs.ariaLabelledBy = ariaLabelledBy;
  }
  if (!attrs.placeholder) {
    const placeholder = htmlElement.getAttribute('placeholder');
    if (placeholder) attrs.placeholder = placeholder;
  }
  if (!attrs.autocomplete) {
    const autocomplete = htmlElement.getAttribute('autocomplete');
    if (autocomplete) attrs.autocomplete = autocomplete;
  }
  if (!attrs.role) {
    const role = htmlElement.getAttribute('role');
    if (role) attrs.role = role;
  }
  if (!attrs.title) {
    const title = htmlElement.getAttribute('title');
    if (title) attrs.title = title;
  }
  if (!attrs.class && htmlElement.className) {
    attrs.class = htmlElement.className;
  }
}

export function findSeedElements(step: CodegenStep, snapshot: Document): Element[] {
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
    const selectBonus = (step.action === 'custom-select' || step.action === 'custom-menu-select')
      && elementLooksInteractive(element) ? 0.15 : 0;
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

export function isOverlyBroadSeedElement(element: Element): boolean {
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

export function containsCalendarHint(value?: string | null): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return CALENDAR_SELECTOR_HINTS.some(hint => normalized.includes(hint));
}

function isNumericIntentToken(token: string): boolean {
  return /^\d{1,4}$/.test(token);
}

export function tokenizeIntentText(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => token.length >= 2);
}

export function intentTokensForStep(step: CodegenStep): string[] {
  return tokenizeIntentText(step.intent || '');
}

export function hasCalendarIntent(step: CodegenStep): boolean {
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

export function isCalendarContext(step: CodegenStep, snapshot: Document, attrs: StepSignalAttributes, seedElements: Element[]): boolean {
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

export function getCalendarScopeSelectors(step: CodegenStep, attrs: StepSignalAttributes): string[] {
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

export function extractCalendarTextTarget(step: CodegenStep, textExcerpt?: string | null): string | null {
  const raw = textExcerpt?.trim() || '';
  if (raw) return raw;
  const numericToken = intentTokensForStep(step).find(isNumericIntentToken);
  return numericToken ?? null;
}

export function looksDateValue(value?: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  return /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(trimmed);
}

export type IntentActionHint =
  | 'click'
  | 'input'
  | 'submit'
  | 'custom-control-open'
  | 'custom-select'
  | 'custom-menu-select'
  | 'hover'
  | 'scroll'
  | 'navigate'
  | 'unknown';

export interface IntentScore {
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

function inferActionHint(step: CodegenStep, tokens: string[]): IntentActionHint {
  if (step.action) return step.action;
  if (tokens.includes('custom') && tokens.includes('control') && tokens.includes('open')) return 'custom-control-open';
  if (tokens.includes('custom') && tokens.includes('menu') && tokens.includes('select')) return 'custom-menu-select';
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
    case 'custom-control-open':
      return new Set(['button', 'a', 'label', 'input', 'summary', 'div']);
    case 'custom-select':
    case 'custom-menu-select':
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
  const text = getElementTextSignals(el).join(' ');
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

  if (actionHint === 'custom-control-open') {
    if (['button', 'combobox'].includes(roleLower)) return 1;
    if (['button', 'input', 'a', 'div'].includes(tagLower)) return 0.9;
    return 0.3;
  }

  if (actionHint === 'custom-select' || actionHint === 'custom-menu-select') {
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

export function evaluateIntentMatch(el: Element, step: CodegenStep): IntentScore {
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

export function selectorLooksInputLike(selector: string): boolean {
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

export function selectorLooksInteractive(selector: string): boolean {
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

export function elementLooksInputLike(el: Element | null): boolean {
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

export function elementLooksInteractive(el: Element | null): boolean {
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

export function hasFieldIntent(step: CodegenStep): boolean {
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

export function getCandidateElement(snapshot: Document, selector: string): Element | null {
  try {
    return snapshot.querySelector(selector);
  } catch {
    return null;
  }
}

export function isLowScoreFallbackCandidateSafe(
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

  if (step.action === 'custom-control-open') {
    return interactive && intentScore >= config.intentMinScore;
  }

  if (step.action === 'custom-select' || step.action === 'custom-menu-select') {
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

export function matchesIntent(
  el: Element,
  intent: string | CodegenStep,
  defaultIntentMinScore: number,
): boolean {
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
  return evaluateIntentMatch(el, step).score >= defaultIntentMinScore;
}
