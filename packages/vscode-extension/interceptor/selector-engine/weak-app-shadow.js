import { collectMatchMetadata } from './evaluation.js';
import { classifySelectorCandidatePreference } from './preference-tiers.js';
import {
  buildAttributeSelector,
  getSafeClassTokens,
  normalizeText,
  safeCssEscape,
  safeTrim,
} from './utils.js';
import { escapeTextLiteral } from './shared/text.js';



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

    // F-S3: SVG elements live in the SVG XML namespace. Raw tagName steps like
    // '//path' or '//circle' fail in namespace-aware XPath contexts. Use
    // local-name() to build namespace-agnostic steps for any SVG interior element.
    const isSvgElement = current.namespaceURI === 'http://www.w3.org/2000/svg' && tagName !== 'svg';
    const xpathTagExpr = isSvgElement ? `*[local-name()='${tagName}']` : tagName;

    if (current.id) {
      segments.unshift(`*[@id="${String(current.id).replace(/"/g, '\\"')}"]`);
      return `//*[@id="${String(current.id).replace(/"/g, '\\"')}"]${segments.length > 1 ? `/${segments.slice(1).join('/')}` : ''}`;
    }

    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
      : [current];
    const index = siblings.indexOf(current) + 1;
    segments.unshift(`${xpathTagExpr}[${index}]`);

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

  // F-G5: Detect closed shadow DOM before generating any fallbacks.
  // Elements inside a closed shadow root are inaccessible to standard DOM queries.
  // We can still attempt structural fallbacks but consumers must be warned.
  let closedShadowWarning = null;
  try {
    const rootNode = typeof element.getRootNode === 'function' ? element.getRootNode() : null;
    const ShadowRootCtor = typeof ShadowRoot !== 'undefined' ? ShadowRoot : null;
    if (ShadowRootCtor && rootNode instanceof ShadowRootCtor && rootNode.mode === 'closed') {
      closedShadowWarning = 'closed-shadow-root';
    }
  } catch {
    // Ignore SecurityError — treat as non-closed.
  }

  if (hasPreferredSelector(currentCandidates)) {
    return {
      targetSummary,
      needsWeakCoverage: false,
      blockedReason: 'strong-selector-already-available',
      fallbacks: [],
    };
  }

  // F-G4: Track whether a text-based candidate was generated.
  // buildScopedTextCandidate returns null when the element has no inner text
  // (icon-only buttons, SVG-only elements, etc.). When it returns null AND all
  // surviving fallbacks are positional, we tag the fallbacks with 'no-semantic-anchor'.
  const textCandidate = buildScopedTextCandidate(element, boundedFieldContextEvidence);
  const nthOfTypeCandidate = buildNthOfTypeCandidate(element, boundedFieldContextEvidence);
  const indexedXPathCandidate = buildIndexedXPathCandidate(element);

  const generatedCandidates = dedupeGeneratedCandidates([
    textCandidate,
    nthOfTypeCandidate,
    indexedXPathCandidate,
  ]);

  const fallbacks = generatedCandidates.map((candidateInput) => {
    const metadata = collectMatchMetadata(element, candidateInput);

    // Merge generator-level warning codes with evaluation-time warning codes.
    const baseWarningCodes = [...(metadata.warningCodes || [])];
    if (closedShadowWarning && !baseWarningCodes.includes(closedShadowWarning)) {
      baseWarningCodes.push(closedShadowWarning);
    }

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
      warningCodes: baseWarningCodes,
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

  // F-G4: If no text candidate was generated and every fallback is positional/indexed,
  // tag all fallbacks with 'no-semantic-anchor' so consumers can warn the user that
  // the engine could not find any stable semantic anchor for this element.
  const hasOnlyPositionalFallbacks =
    !textCandidate &&
    fallbacks.length > 0 &&
    fallbacks.every((f) => f.usesIndex === true);

  const finalFallbacks = hasOnlyPositionalFallbacks
    ? fallbacks.map((f) => ({
        ...f,
        warningCodes: [...(f.warningCodes || []), 'no-semantic-anchor'],
      }))
    : fallbacks;

  return {
    targetSummary,
    needsWeakCoverage: finalFallbacks.length > 0,
    noSemanticAnchor: hasOnlyPositionalFallbacks,
    blockedReason: finalFallbacks.length > 0 ? null : 'no-weak-coverage-generated',
    fallbacks: finalFallbacks,
  };
}
