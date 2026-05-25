import { collectMatchMetadata } from './evaluation.js';
import { classifySelectorCandidatePreference } from './preference-tiers.js';
import {
  buildAttributeSelector,
  getSafeClassTokens,
  normalizeText,
  safeCssEscape,
  safeTrim,
} from './utils.js';

function escapeTextLiteral(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function hasPreferredSelector(candidates) {
  return Array.isArray(candidates) && candidates.some((candidate) => (
    classifySelectorCandidatePreference(candidate).tier === 'preferred'
  ));
}

function buildTargetSummary(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  return {
    tagName: element.tagName?.toLowerCase?.() || null,
    textExcerpt: normalizeText(element.innerText || element.textContent || '').slice(0, 80) || null,
    classList: getSafeClassTokens(element).slice(0, 3),
  };
}

function deriveParentScopeSelector(parent) {
  if (!parent || parent.nodeType !== Node.ELEMENT_NODE) return null;

  for (const attrName of ['data-testid', 'data-cy', 'data-qa']) {
    const selector = buildAttributeSelector(parent.tagName, attrName, parent.getAttribute(attrName));
    if (selector) return selector;
  }

  if (parent.id) {
    return `#${safeCssEscape(parent.id)}`;
  }

  const stableToken = getSafeClassTokens(parent)
    .filter((token) => !/^(?:is|has)-/i.test(token))
    .find((token) => token.length >= 4);
  if (stableToken) {
    return `${parent.tagName.toLowerCase()}.${safeCssEscape(stableToken)}`;
  }

  return parent.tagName?.toLowerCase?.() || null;
}

function buildTagWithBestClass(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = element.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;
  const token = getSafeClassTokens(element)
    .filter((classToken) => classToken.length >= 4)
    .find((classToken) => !/^(?:is|has)-/i.test(classToken));
  return token ? `${tagName}.${safeCssEscape(token)}` : tagName;
}

function findSameTagSiblingIndex(element) {
  const parent = element?.parentElement || null;
  if (!parent) return null;
  const tagName = element.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  const sameTagSiblings = Array.from(parent.children).filter((child) => (
    child.tagName?.toLowerCase?.() === tagName
  ));
  if (sameTagSiblings.length <= 1) return null;

  const index = sameTagSiblings.indexOf(element);
  if (index < 0) return null;

  return {
    parent,
    index,
    count: sameTagSiblings.length,
    tagName,
  };
}

function findAncestorIndexedPath(element) {
  const parent = element?.parentElement || null;
  const grandParent = parent?.parentElement || null;
  if (!parent || !grandParent) return null;

  const parentTagName = parent.tagName?.toLowerCase?.() || '';
  if (!parentTagName) return null;

  const sameTagParents = Array.from(grandParent.children).filter((child) => (
    child.tagName?.toLowerCase?.() === parentTagName
  ));
  if (sameTagParents.length <= 1) return null;

  const parentIndex = sameTagParents.indexOf(parent);
  if (parentIndex < 0) return null;

  return {
    parent,
    grandParent,
    parentTagName,
    parentIndex,
    childSelector: buildTagWithBestClass(element),
  };
}

function buildIndexedDomXPath(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE || element.isConnected === false) return null;
  const segments = [];
  let current = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName?.toLowerCase?.();
    if (!tagName) return null;

    if (current.id) {
      segments.unshift(`*[@id="${String(current.id).replace(/"/g, '\\"')}"]`);
      return `//*[@id="${String(current.id).replace(/"/g, '\\"')}"]${segments.length > 1 ? `/${segments.slice(1).join('/')}` : ''}`;
    }

    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
      : [current];
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${tagName}[${index}]`);

    current = current.parentElement;
    if (!current) break;
  }

  return `/${segments.join('/')}`;
}

function buildScopedTextCandidate(element, boundedFieldContextEvidence) {
  const scopeSelector = safeTrim(
    boundedFieldContextEvidence?.cleanParentSelector
    || boundedFieldContextEvidence?.containerSelector
    || deriveParentScopeSelector(element?.parentElement || null)
    || '',
  );
  const childSelector = safeTrim(
    boundedFieldContextEvidence?.cleanChildSelector
    || buildTagWithBestClass(element)
    || '',
  );
  const text = normalizeText(element?.innerText || element?.textContent || '');

  if (!scopeSelector || !childSelector || !text || text.length > 80) return null;

  return {
    selector: `${scopeSelector} ${childSelector}:has-text("${escapeTextLiteral(text)}")`,
    engine: 'css',
    family: 'text',
    strategy: 'container-scoped-text',
    textQuery: {
      scopeSelector: `${scopeSelector} ${childSelector}`,
      text,
      matchMode: 'contains',
    },
  };
}

function buildNthOfTypeCandidate(element, boundedFieldContextEvidence) {
  const siblingInfo = findSameTagSiblingIndex(element);
  if (siblingInfo) {
    const scopeSelector = safeTrim(
      boundedFieldContextEvidence?.cleanParentSelector
      || boundedFieldContextEvidence?.containerSelector
      || deriveParentScopeSelector(siblingInfo.parent)
      || '',
    );
    if (!scopeSelector) return null;

    return {
      selector: `${scopeSelector} > ${siblingInfo.tagName}:nth-of-type(${siblingInfo.index + 1})`,
      engine: 'css',
      family: 'parent-scoped-css',
      strategy: 'nth-of-type-child',
      usesIndex: true,
    };
  }

  const ancestorInfo = findAncestorIndexedPath(element);
  if (!ancestorInfo?.childSelector) return null;

  const ancestorScopeSelector = safeTrim(
    deriveParentScopeSelector(ancestorInfo.grandParent)
    || ancestorInfo.grandParent.tagName?.toLowerCase?.()
    || '',
  );
  if (!ancestorScopeSelector) return null;

  return {
    selector: `${ancestorScopeSelector} > ${ancestorInfo.parentTagName}:nth-of-type(${ancestorInfo.parentIndex + 1}) > ${ancestorInfo.childSelector}`,
    engine: 'css',
    family: 'parent-scoped-css',
    strategy: 'nth-of-type-child',
    usesIndex: true,
  };
}

function buildIndexedXPathCandidate(element) {
  const selector = buildIndexedDomXPath(element);
  if (!selector) return null;

  return {
    selector,
    engine: 'xpath',
    family: 'xpath',
    strategy: 'indexed-dom-xpath',
    usesIndex: true,
  };
}

function dedupeGeneratedCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate || typeof candidate.selector !== 'string') return false;
    const key = `${candidate.engine || 'css'}::${candidate.family || 'unknown'}::${candidate.selector}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function forceWeakCoverageTier(classified) {
  if (!classified) return classified;
  const strategy = classified.strategy || '';
  if (strategy === 'nth-of-type-child' || strategy === 'indexed-dom-xpath') {
    return {
      ...classified,
      tier: 'last-resort',
    };
  }
  return classified;
}

export function collectWeakAppShadowCoverage({
  element,
  currentCandidates = [],
  boundedFieldContextEvidence,
} = {}) {
  const targetSummary = buildTargetSummary(element);
  if (!element || element.nodeType !== Node.ELEMENT_NODE || element.isConnected === false) {
    return {
      targetSummary,
      needsWeakCoverage: false,
      blockedReason: 'detached-target',
      fallbacks: [],
    };
  }

  if (hasPreferredSelector(currentCandidates)) {
    return {
      targetSummary,
      needsWeakCoverage: false,
      blockedReason: 'strong-selector-already-available',
      fallbacks: [],
    };
  }

  const generatedCandidates = dedupeGeneratedCandidates([
    buildScopedTextCandidate(element, boundedFieldContextEvidence),
    buildNthOfTypeCandidate(element, boundedFieldContextEvidence),
    buildIndexedXPathCandidate(element),
  ]);

  const fallbacks = generatedCandidates.map((candidateInput) => {
    const metadata = collectMatchMetadata(element, candidateInput);
    const candidate = {
      selector: candidateInput.selector,
      engine: candidateInput.engine || 'css',
      family: candidateInput.family || 'unknown',
      strength: candidateInput.family === 'xpath' ? 'weak' : 'medium',
      usesDynamicClass: candidateInput.usesDynamicClass === true,
      usesIndex: candidateInput.usesIndex === true,
      matchCount: metadata.matchCount,
      visibleMatchCount: metadata.visibleMatchCount,
      positionInAllMatches: metadata.positionInAllMatches,
      positionInVisibleMatches: metadata.positionInVisibleMatches,
      warningCodes: metadata.warningCodes,
    };
    const classified = classifySelectorCandidatePreference(candidate);
    return forceWeakCoverageTier({
      ...classified,
      strategy: candidateInput.strategy,
      positionInAllMatches: candidate.positionInAllMatches,
      positionInVisibleMatches: candidate.positionInVisibleMatches,
      targetSummary,
    });
  });

  return {
    targetSummary,
    needsWeakCoverage: fallbacks.length > 0,
    blockedReason: fallbacks.length > 0 ? null : 'no-weak-coverage-generated',
    fallbacks,
  };
}
