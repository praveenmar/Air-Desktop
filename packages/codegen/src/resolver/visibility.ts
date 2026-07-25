import type { CodegenStep } from '../types';
import type { CandidateValidation } from './types';
import {
  BROAD_SELECTOR_MATCH_LIMIT,
  DOM_ORDER_TIEBREAKER_REASON,
  NON_RENDERED_TAGS,
} from './types';
import {
  getElementTextSignals,
  isLikelyCssSelector,
  normalizeTextForMatch,
  unquoteTextLiteral,
} from './text-matching';
import {
  elementLooksInputLike,
  elementLooksInteractive,
  hasFieldIntent,
  scoreMatchedElements,
} from './element-ranking';

export function isVisibleElement(el: Element): boolean {
  let current: Element | null = el;
  while (current) {
    const htmlEl = current as HTMLElement;
    const tagName = (htmlEl.tagName || '').toLowerCase();

    if (NON_RENDERED_TAGS.has(tagName)) return false;
    if (htmlEl.hasAttribute('hidden')) return false;
    if ((htmlEl.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return false;
    if (
      tagName === 'input' &&
      (htmlEl.getAttribute('type') || '').toLowerCase() === 'hidden'
    ) {
      return false;
    }

    const style = (htmlEl.getAttribute('style') || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (style.includes('display:none')) return false;
    if (style.includes('visibility:hidden')) return false;

    current = htmlEl.parentElement;
  }
  return true;
}

export function validateCSSCandidate(
  selector: string,
  snapshot: Document,
  step?: CodegenStep,
  root: ParentNode = snapshot,
): CandidateValidation {
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
    matches = root.querySelectorAll(selector);
  } catch {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
    };
  }

  const visibleMatches = Array.from(matches).filter(isVisibleElement);
  if (visibleMatches.length === 0) {
    return {
      totalMatchCount: matches.length,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'no-visible-match',
      matchCount: 0,
      confidenceScore: 0,
      resolvedElement: null,
    };
  }

  if (visibleMatches.length === 1) {
    return {
      totalMatchCount: matches.length,
      visibleMatchCount: 1,
      effectiveMatchCount: 1,
      reason: 'unique-visible',
      matchCount: 1,
      confidenceScore: 1,
      resolvedElement: visibleMatches[0] ?? null,
    };
  }

  const rankedMatches = scoreMatchedElements(visibleMatches, snapshot, step);
  const winner = rankedMatches[0];
  const runnerUp = rankedMatches[1];
  const ambiguityReason =
    winner && runnerUp && Math.abs(winner.score - runnerUp.score) < 0.05
      ? DOM_ORDER_TIEBREAKER_REASON
      : undefined;
  return {
    totalMatchCount: matches.length,
    visibleMatchCount: visibleMatches.length,
    effectiveMatchCount: 1,
    reason: matches.length > BROAD_SELECTOR_MATCH_LIMIT ? 'too-broad' : 'resolved-multi-match',
    matchCount: visibleMatches.length,
    confidenceScore: ambiguityReason ? Math.min(winner?.score ?? 0, 0.7) : (winner?.score ?? 0),
    ambiguityReason,
    resolvedElement: winner?.element ?? null,
  };
}

export function validateTextCandidate(
  selector: string,
  snapshot: Document,
  step?: CodegenStep,
  root: ParentNode = snapshot,
): CandidateValidation {
  const rawSelector = selector.trim();
  let scopeSelector: string | null = null;
  let textNeedle = '';

  if (rawSelector.startsWith('text=')) {
    textNeedle = unquoteTextLiteral(rawSelector.slice(5).trim());
  } else {
    const hasTextMatch = rawSelector.match(/^(.*):has-text\((.*)\)$/);
    if (!hasTextMatch) {
      return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'invalid-selector',
      };
    }
    scopeSelector = hasTextMatch[1]?.trim() || null;
    textNeedle = unquoteTextLiteral(hasTextMatch[2]?.trim() || '');
  }

  const normalizedNeedle = normalizeTextForMatch(textNeedle);
  if (!normalizedNeedle) {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
    };
  }

  let scopeMatches: Element[];
  try {
    scopeMatches = scopeSelector
      ? Array.from(root.querySelectorAll(scopeSelector))
      : Array.from(root.querySelectorAll('*'));
  } catch {
    return {
      totalMatchCount: 0,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'invalid-selector',
    };
  }

  const wasTooBroad = scopeMatches.length > BROAD_SELECTOR_MATCH_LIMIT;
  if (wasTooBroad) {
    const filtered = scopeMatches.filter(element => {
      const signals = getElementTextSignals(element).map(normalizeTextForMatch).filter(Boolean);
      if (signals.some(signal => signal.includes(normalizedNeedle))) {
        return true;
      }
      return elementLooksInteractive(element) || elementLooksInputLike(element);
    });
    scopeMatches = filtered.slice(0, BROAD_SELECTOR_MATCH_LIMIT);
  }

  let matchedElements = scopeMatches.filter(element => {
    const signals = getElementTextSignals(element).map(normalizeTextForMatch).filter(Boolean);
    return signals.some(signal => signal.includes(normalizedNeedle));
  });

  if (step && hasFieldIntent(step)) {
    matchedElements = matchedElements.filter(element =>
      elementLooksInputLike(element) || elementLooksInteractive(element)
    );
  }

  const visibleMatches = matchedElements.filter(isVisibleElement);
  if (visibleMatches.length === 0) {
    return {
      totalMatchCount: matchedElements.length,
      visibleMatchCount: 0,
      effectiveMatchCount: 0,
      reason: 'no-visible-match',
      matchCount: 0,
      confidenceScore: 0,
      resolvedElement: null,
    };
  }

  if (visibleMatches.length === 1) {
    return {
      totalMatchCount: matchedElements.length,
      visibleMatchCount: 1,
      effectiveMatchCount: 1,
      reason: 'unique-visible',
      matchCount: 1,
      confidenceScore: 1,
      resolvedElement: visibleMatches[0] ?? null,
    };
  }

  const rankedMatches = scoreMatchedElements(visibleMatches, snapshot, step);
  const winner = rankedMatches[0];
  const runnerUp = rankedMatches[1];
  const ambiguityReason =
    winner && runnerUp && Math.abs(winner.score - runnerUp.score) < 0.05
      ? DOM_ORDER_TIEBREAKER_REASON
      : undefined;

  return {
    totalMatchCount: matchedElements.length,
    visibleMatchCount: visibleMatches.length,
    effectiveMatchCount: 1,
    reason: wasTooBroad ? 'too-broad' : 'resolved-multi-match',
    matchCount: visibleMatches.length,
    confidenceScore: ambiguityReason ? Math.min(winner?.score ?? 0, 0.7) : (winner?.score ?? 0),
    ambiguityReason,
    resolvedElement: winner?.element ?? null,
  };
}

export {
  elementLooksInputLike,
  elementLooksInteractive,
  hasFieldIntent,
};
