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

  return {
    matches,
    warningCodes: [],
  };
}

function collectMatches(root, candidateInput) {
  if (candidateInput?.family === 'text') {
    return queryTextMatches(root, candidateInput);
  }

  return {
    matches: queryAll(root, candidateInput?.selector),
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
    const visibleMatches = matches.filter((candidate) => isVisible(candidate));
    visibleMatchCount = visibleMatches.length;
    positionInVisibleMatches = visibleMatches.indexOf(targetElement);
    if (visibleMatchCount > 1) warningCodes.push('multiple-visible-matches');
  } else {
    warningCodes.push('too-many-matches-for-visible-index');
  }

  return {
    matchCount,
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
      strength: resolveStrength(candidateInput, metadata),
      usesDynamicClass: candidateInput.usesDynamicClass === true,
      usesIndex: candidateInput.usesIndex === true,
      matchCount: metadata.matchCount,
      visibleMatchCount: metadata.visibleMatchCount,
      positionInAllMatches: metadata.positionInAllMatches,
      positionInVisibleMatches: metadata.positionInVisibleMatches,
      warningCodes,
    };
  });
}
