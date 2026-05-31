import {
  buildAttributeSelector,
  isLikelyDynamicId,
  safeCssEscape,
} from '../utils.js';
import { debugLog } from '../debug.js';

function collectTestIdCandidates(element) {
  const candidates = [];
  for (const attributeName of ['data-testid', 'data-cy', 'data-qa']) {
    const value = element.getAttribute(attributeName);
    const selector = buildAttributeSelector(null, attributeName, value, { tagScoped: false });
    if (selector) {
      candidates.push({
        selector,
        engine: 'css',
        family: 'test-id',
      });
    }
  }
  return candidates;
}

function collectIdCandidate(element) {
  const id = element.id;
  if (!id || isLikelyDynamicId(id)) return [];
  return [{
    selector: `#${safeCssEscape(id)}`,
    engine: 'css',
    family: 'id',
  }];
}

function collectNameCandidate(element) {
  const selector = buildAttributeSelector(element.tagName, 'name', element.getAttribute('name'));
  return selector ? [{
    selector,
    engine: 'css',
    family: 'name',
  }] : [];
}

function collectHrefCandidate(element) {
  const href = element.getAttribute('href');
  if (!href || href.startsWith('#')) return [];
  const selector = buildAttributeSelector('a', 'href', href);
  return selector ? [{
    selector,
    engine: 'css',
    family: 'href',
  }] : [];
}

function collectAriaLabelCandidate(element) {
  const selector = buildAttributeSelector(element.tagName, 'aria-label', element.getAttribute('aria-label'));
  return selector ? [{
    selector,
    engine: 'css',
    family: 'aria-label',
  }] : [];
}

function collectPlaceholderCandidate(element) {
  const selector = buildAttributeSelector(element.tagName, 'placeholder', element.getAttribute('placeholder'));
  return selector ? [{
    selector,
    engine: 'css',
    family: 'placeholder',
  }] : [];
}

export function collectDirectFamilyCandidates(element) {
  if (!element) return [];
  
  const candidates = [
    ...collectTestIdCandidates(element),
    ...collectIdCandidate(element),
    ...collectNameCandidate(element),
    ...collectHrefCandidate(element),
    ...collectAriaLabelCandidate(element),
    ...collectPlaceholderCandidate(element),
  ];

  debugLog('Direct candidate generation', {
    tagName: element.tagName?.toLowerCase?.(),
    name: element.getAttribute?.('name') || null,
    placeholder: element.getAttribute?.('placeholder') || null,
    generatedFamilies: candidates.map(c => c.family),
    generatedSelectors: candidates.map(c => c.selector),
  });

  return candidates;
}

export function collectDirectCandidates(element) {
  return collectDirectFamilyCandidates(element);
}
