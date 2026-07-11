import {
  DEFAULT_MAX_CANDIDATES,
  MAX_VISIBLE_MATCHES_FOR_INDEX,
} from './types.js';
import {
  dedupeCandidates,
  getNormalizedElementText,
  getQueryRoot,
  isVisible,
  parseHasTextSelector,
  queryAll,
  queryXPathAll,
} from './utils.js';

const MAX_TEXT_QUERY_SCOPE = 500;

function resolveStrength(candidateInput, metadata) {
  const isUnique = metadata.matchCount === 1 && metadata.visibleMatchCount === 1;
  switch (candidateInput.family) {
    case 'test-id':
    case 'id':
    case 'name':
    case 'href':
    case 'aria-label':
    case 'placeholder':
      return isUnique ? 'strong' : 'medium';
    case 'class':
      return candidateInput.usesDynamicClass ? 'weak' : (isUnique ? 'medium' : 'weak');
    default:
      return isUnique ? 'medium' : 'weak';
  }
}

function resolveTextQuery(candidateInput) {
  const textQuery = candidateInput?.textQuery;
  if (textQuery && typeof textQuery === 'object') {
    const scopeSelector = typeof textQuery.scopeSelector === 'string'
      ? textQuery.scopeSelector.trim()
      : '';
    const text = typeof textQuery.text === 'string'
      ? textQuery.text.trim()
      : '';
    const matchMode = typeof textQuery.matchMode === 'string'
      ? textQuery.matchMode.trim()
      : 'contains';

    if (scopeSelector && text && matchMode === 'contains') {
      return {
        scopeSelector,
        text,
        childSelector: typeof textQuery.childSelector === 'string' ? textQuery.childSelector.trim() : '',
        matchMode,
      };
    }
  }

  return parseHasTextSelector(candidateInput?.selector);
}

function queryTextMatches(root, candidateInput) {
  const textQuery = resolveTextQuery(candidateInput);
  if (!root || !textQuery || textQuery.matchMode !== 'contains') {
    return {
      matches: [],
      warningCodes: ['blocked-text-evaluation'],
    };
  }

  const scopeMatches = queryAll(root, textQuery.scopeSelector);
  if (scopeMatches.length > MAX_TEXT_QUERY_SCOPE) {
    return {
      matches: [],
      warningCodes: ['blocked-text-evaluation'],
    };
  }

  const matches = scopeMatches.filter((candidate) => {
    const normalizedText = getNormalizedElementText(candidate);
    return normalizedText.includes(textQuery.text);
  });

  if (!textQuery.childSelector) {
    return {
      matches,
      warningCodes: [],
    };
  }

  const finalMatches = [];
  for (const parent of matches) {
    finalMatches.push(...queryAll(parent, textQuery.childSelector));
  }

  return {
    matches: finalMatches.filter((match, index, list) => list.indexOf(match) === index),
    warningCodes: [],
  };
}

function collectMatches(root, candidateInput) {
  if (candidateInput?.family === 'text' || candidateInput?.family === 'parent-scoped-text-css') {
    return queryTextMatches(root, candidateInput);
  }

  if (candidateInput?.engine === 'xpath' || candidateInput?.family === 'xpath') {
    return {
      matches: queryXPathAll(root, candidateInput?.selector, candidateInput?.queryTarget || null),
      warningCodes: [],
    };
  }

  let selector = candidateInput?.selector;
  const requiresPlaywrightEngine = candidateInput?.requiresPlaywrightEngine || candidateInput?.metadata?.requiresPlaywrightEngine;
  if (requiresPlaywrightEngine) {
    selector = selector.replace(/:visible$/, '');
  }

  return {
    matches: queryAll(root, selector),
    warningCodes: [],
  };
}

export function collectMatchMetadata(element, candidateInput) {
  const targetElement = candidateInput.queryTarget || element;
  const root = getQueryRoot(targetElement);
  const queryResult = collectMatches(root, candidateInput);
  const matches = queryResult.matches;
  const matchCount = matches.length;
  const positionInAllMatches = matches.indexOf(targetElement);
  const warningCodes = [...queryResult.warningCodes];

  if (matchCount > 1) warningCodes.push('multiple-matches');
  if (positionInAllMatches < 0) warningCodes.push('target-not-in-matches');

  let visibleMatchCount = null;
  let positionInVisibleMatches = null;

  if (matchCount <= MAX_VISIBLE_MATCHES_FOR_INDEX) {
    // F-S4: Filter aria-hidden elements from visibleMatchCount.
    // Playwright's getByRole() implicitly skips aria-hidden="true" elements.
    // Raw CSS locators do not — so a selector that appears to match 2 elements
    // may only match 1 *accessible* element. By filtering here, we correctly
    // classify such selectors as unique for accessible-name-based locators.
    // NOTE: matchCount is intentionally left unfiltered — it reflects raw DOM
    // reality, which is needed to accurately flag CSS strict-mode collisions.
    const visibleMatches = matches.filter(
      (candidate) => isVisible(candidate) && candidate.getAttribute('aria-hidden') !== 'true'
    );
    visibleMatchCount = visibleMatches.length;
    positionInVisibleMatches = visibleMatches.indexOf(targetElement);
    if (visibleMatchCount > 1) warningCodes.push('multiple-visible-matches');
  } else {
    warningCodes.push('too-many-matches-for-visible-index');
  }

  let effectiveMatchCount = matchCount;
  const requiresPlaywrightEngine = candidateInput?.requiresPlaywrightEngine || candidateInput?.metadata?.requiresPlaywrightEngine;
  if (requiresPlaywrightEngine && visibleMatchCount === 1) {
    effectiveMatchCount = 1;
    const warnIdx = warningCodes.indexOf('multiple-matches');
    if (warnIdx > -1) warningCodes.splice(warnIdx, 1);
  }

  return {
    matchCount: effectiveMatchCount,
    visibleMatchCount,
    positionInAllMatches: positionInAllMatches >= 0 ? positionInAllMatches : null,
    positionInVisibleMatches: positionInVisibleMatches >= 0 ? positionInVisibleMatches : null,
    warningCodes,
  };
}

export function finalizeCandidates(element, candidates, maxCandidates = DEFAULT_MAX_CANDIDATES) {
  return dedupeCandidates(candidates, maxCandidates).map((candidateInput) => {
    const metadata = collectMatchMetadata(element, candidateInput);
    const warningCodes = Array.from(new Set([
      ...(candidateInput.warningCodes || []),
      ...metadata.warningCodes,
    ]));

    return {
      selector: candidateInput.selector,
      engine: candidateInput.engine || 'css',
      family: candidateInput.family,
      source: 'shadow',
      proposalSource: candidateInput.proposalSource || null,
      proposalTierHint: candidateInput.proposalTierHint || null,
      strength: resolveStrength(candidateInput, metadata),
      usesDynamicClass: candidateInput.usesDynamicClass === true,
      usesIndex: candidateInput.usesIndex === true,
      requiresPositionalDisambiguation: candidateInput.requiresPositionalDisambiguation === true,
      matchCount: metadata.matchCount,
      visibleMatchCount: metadata.visibleMatchCount,
      positionInAllMatches: metadata.positionInAllMatches,
      positionInVisibleMatches: metadata.positionInVisibleMatches,
      warningCodes,
    };
  });
}
