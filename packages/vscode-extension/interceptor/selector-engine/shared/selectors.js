import { buildAttributeSelector, safeCssEscape, isLikelyDynamicId } from '../utils.js';
import { getRole, getBestStableClassToken } from './dom-attributes.js';
import { escapeTextLiteral } from './text.js';

export function buildScopedSelector(parentSelector, childSelector) {
  const parent = typeof parentSelector === 'string' ? parentSelector.trim() : '';
  const child = typeof childSelector === 'string' ? childSelector.trim() : '';
  if (!parent || !child) return null;
  return `${parent} ${child}`;
}

export function buildSelectorForElement(element, options = {}) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = element.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  for (const attrName of options.preferredAttributes || ['data-testid', 'data-cy', 'data-qa']) {
    const selector = buildAttributeSelector(
      options.tagScoped === false ? null : tagName,
      attrName,
      element.getAttribute(attrName),
      { tagScoped: options.tagScoped !== false },
    );
    if (selector) return selector;
  }

  if (element.id && !isLikelyDynamicId(element.id)) {
    return `#${safeCssEscape(element.id)}`;
  }

  if (options.allowHref && tagName === 'a') {
    const hrefSelector = buildAttributeSelector(tagName, 'href', element.getAttribute('href'));
    if (hrefSelector) return hrefSelector;
  }

  if (options.allowType && tagName === 'input') {
    const typeSelector = buildAttributeSelector(tagName, 'type', element.getAttribute('type'));
    if (typeSelector) return typeSelector;
  }

  if (options.allowValue && tagName === 'option') {
    const valueSelector = buildAttributeSelector(tagName, 'value', element.getAttribute('value'));
    if (valueSelector) return valueSelector;
  }

  if (options.allowRole !== false) {
    const role = getRole(element);
    if (role) return `${tagName}[role="${escapeTextLiteral(role)}"]`;
  }

  const classToken = getBestStableClassToken(element);
  if (classToken) return `${tagName}.${safeCssEscape(classToken)}`;

  return tagName;
}
