import {
  buildAttributeSelector,
  getSafeClassTokens,
  isLikelyDynamicId,
  normalizeText,
  safeCssEscape,
} from '../utils.js';

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

function collectClassCandidate(element) {
  const tokens = getSafeClassTokens(element);
  if (tokens.length !== 1) return [];
  return [{
    selector: `${element.tagName.toLowerCase()}.${safeCssEscape(tokens[0])}`,
    engine: 'css',
    family: 'class',
    usesDynamicClass: /(?:active|selected|focus|hover|css-|sc-|chakra|Mui)/.test(tokens[0]),
  }];
}

function collectTextCandidate(element) {
  const text = normalizeText(element.innerText || element.textContent || '');
  if (!text || text.length > 80) return [];
  return [{
    selector: `${element.tagName.toLowerCase()}:has-text("${text.replace(/"/g, '\\"')}")`,
    engine: 'css',
    family: 'text',
  }];
}

function collectRoleCandidate(element) {
  const role = element.getAttribute('role');
  if (!role) return [];
  return [{
    selector: `[role="${role}"]`,
    engine: 'css',
    family: 'role-attr',
  }];
}

export function collectDirectCandidates(element) {
  if (!element) return [];
  return [
    ...collectTestIdCandidates(element),
    ...collectIdCandidate(element),
    ...collectNameCandidate(element),
    ...collectHrefCandidate(element),
    ...collectAriaLabelCandidate(element),
    ...collectPlaceholderCandidate(element),
    ...collectClassCandidate(element),
    ...collectTextCandidate(element),
    ...collectRoleCandidate(element),
  ];
}

