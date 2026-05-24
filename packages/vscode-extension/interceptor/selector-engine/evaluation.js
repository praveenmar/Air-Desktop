import {
  DEFAULT_MAX_CANDIDATES,
  MAX_VISIBLE_MATCHES_FOR_INDEX,
} from './types.js';
import {
  dedupeCandidates,
  getQueryRoot,
  isVisible,
  queryAll,
} from './utils.js';

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

export function collectMatchMetadata(element, candidateInput) {
  const root = getQueryRoot(candidateInput.queryTarget || element);
  const matches = queryAll(root, candidateInput.selector);
  const matchCount = matches.length;
  const positionInAllMatches = matches.indexOf(element);
  const warningCodes = [];

  if (matchCount > 1) warningCodes.push('multiple-matches');
  if (positionInAllMatches < 0) warningCodes.push('target-not-in-matches');

  let visibleMatchCount = null;
  let positionInVisibleMatches = null;

  if (matchCount <= MAX_VISIBLE_MATCHES_FOR_INDEX) {
    const visibleMatches = matches.filter((candidate) => isVisible(candidate));
    visibleMatchCount = visibleMatches.length;
    positionInVisibleMatches = visibleMatches.indexOf(element);
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

