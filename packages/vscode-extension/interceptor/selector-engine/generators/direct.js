import {
  buildAttributeSelector,
  escapeQuotedAttributeValue,
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
      // Synchronous DOM check to prevent poisoning the shadow packet (Rule 0)
      let isGloballyUnique = false;
      try {
        isGloballyUnique = document.querySelectorAll(selector).length === 1;
      } catch (e) {}

      candidates.push({
        selector,
        engine: 'css',
        family: 'test-id',
        isGloballyUnique
      });
    }
  }
  return candidates;
}

function collectIdCandidate(element) {
  const id = element.id;
  if (!id || isLikelyDynamicId(id)) return [];
  
  const selector = `#${safeCssEscape(id)}`;
  
  // Synchronous DOM check to prevent poisoning the shadow packet (Rule 0)
  let isGloballyUnique = false;
  try {
    isGloballyUnique = document.querySelectorAll(selector).length === 1;
  } catch (e) {
    // If querySelectorAll fails (e.g. invalid escaped ID), default to false
  }

  return [{
    selector,
    engine: 'css',
    family: 'id',
    isGloballyUnique
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

function collectTitleCandidate(element) {
  const selector = buildAttributeSelector(element.tagName, 'title', element.getAttribute('title'));
  return selector ? [{
    selector,
    engine: 'css',
    family: 'title',
  }] : [];
}

function collectAltCandidate(element) {
  const tagName = element.tagName?.toLowerCase?.();
  if (!['img', 'area', 'input'].includes(tagName)) return [];
  const selector = buildAttributeSelector(tagName, 'alt', element.getAttribute('alt'));
  return selector ? [{
    selector,
    engine: 'css',
    family: 'alt',
  }] : [];
}

function collectValueCandidate(element) {
  const tagName = element.tagName?.toLowerCase?.();
  const type = (element.getAttribute('type') || '').toLowerCase();
  
  if (tagName !== 'input' || !['submit', 'button', 'reset', 'image'].includes(type)) {
    return [];
  }
  
  const selector = buildAttributeSelector(tagName, 'value', element.getAttribute('value'));
  return selector ? [{
    selector,
    engine: 'css',
    family: 'value',
  }] : [];
}

function collectCompoundAttributeCandidate(element) {
  const tagName = element.tagName?.toLowerCase?.();
  if (!tagName) return [];
  
  const parts = [];
  
  if (element.id && !isLikelyDynamicId(element.id)) {
    parts.push(`#${safeCssEscape(element.id)}`);
  }
  
  const name = element.getAttribute('name');
  if (name) parts.push(`[name="${escapeQuotedAttributeValue(name)}"]`);
  
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) parts.push(`[placeholder="${escapeQuotedAttributeValue(placeholder)}"]`);
  
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) parts.push(`[aria-label="${escapeQuotedAttributeValue(ariaLabel)}"]`);
  
  const title = element.getAttribute('title');
  if (title) parts.push(`[title="${escapeQuotedAttributeValue(title)}"]`);
  
  const alt = element.getAttribute('alt');
  if (alt && ['img', 'area', 'input'].includes(tagName)) {
    parts.push(`[alt="${escapeQuotedAttributeValue(alt)}"]`);
  }
  
  const href = element.getAttribute('href');
  if (href && !href.startsWith('#')) {
    parts.push(`[href="${escapeQuotedAttributeValue(href)}"]`);
  }
  
  const type = (element.getAttribute('type') || '').toLowerCase();
  const value = element.getAttribute('value');
  if (value && tagName === 'input' && ['submit', 'button', 'reset', 'image'].includes(type)) {
    parts.push(`[value="${escapeQuotedAttributeValue(value)}"]`);
  }
  
  if (type && ['input', 'button'].includes(tagName)) {
    parts.push(`[type="${escapeQuotedAttributeValue(type)}"]`);
  }
  
  if (element.dataset) {
    for (const key of Object.keys(element.dataset)) {
      if (['testid', 'cy', 'qa'].includes(key)) continue;
      const attrName = `data-${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
      const val = element.getAttribute(attrName);
      if (val) {
        parts.push(`[${attrName}="${escapeQuotedAttributeValue(val)}"]`);
      }
    }
  }
  
  if (parts.length >= 2) {
    return [{
      selector: `${tagName}${parts.join('')}`,
      engine: 'css',
      family: 'compound-attributes',
    }];
  }
  
  return [];
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
    ...collectTitleCandidate(element),
    ...collectAltCandidate(element),
    ...collectValueCandidate(element),
    ...collectCompoundAttributeCandidate(element),
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
