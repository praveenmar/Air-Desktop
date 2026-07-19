import { BLOCKED_ID_PATTERNS } from './types.js';

export function safeTrim(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function safeCssEscape(value) {
  const normalized = safeTrim(value);
  if (!normalized) return '';
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(normalized);
  }
  return normalized.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

export function normalizeText(value) {
  return safeTrim(String(value || '').replace(/\s+/g, ' '));
}

export function getNormalizedElementText(element) {
  if (!element) return '';
  return normalizeText(element.innerText || element.textContent || '');
}
export function unescapeTextLiteral(value) {
  return String(value || '')
    .replace(/\\\\/g, '\\')
    .replace(/\\"/g, '"');
}

export function parseHasTextSelector(selector) {
  const normalizedSelector = safeTrim(selector);
  if (!normalizedSelector) return null;

  const match = normalizedSelector.match(/^([^:]+):has-text\("((?:\\.|[^"])*)"\)(.*)$/);
  if (!match) return null;

  const scopeSelector = safeTrim(match[1] || '');
  const text = normalizeText(unescapeTextLiteral(match[2] || ''));
  const childSelector = safeTrim(match[3] || '');
  if (!scopeSelector || !text) return null;

  return {
    scopeSelector,
    text,
    childSelector,
    matchMode: 'contains',
  };
}

export function isLikelyDynamicId(id) {
  const normalized = safeTrim(id);
  if (!normalized) return true;
  return BLOCKED_ID_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isVisible(element) {
  if (!element || !element.isConnected) return false;
  if (element.hidden) return false;
  const style = window.getComputedStyle(element);
  if (!style) return false;
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return element.offsetParent !== null || style.position === 'fixed';
}

/**
 * F-S1: Cross-origin iframe SecurityError guard.
 *
 * getQueryRoot() traverses the shadow DOM boundary via getRootNode() to find the
 * closest queryable root. In standard same-origin flows this is safe. However,
 * when the engine is invoked near a cross-origin iframe boundary — or against an
 * element reference tainted by cross-origin access — getRootNode() can throw a
 * SecurityError in strict browser security contexts.
 *
 * Fix: wrap both the getRootNode() call and the ownerDocument fallback in
 * independent try/catch blocks. Absolute last-resort fallback is the global
 * `document`, always accessible in any same-origin content script.
 */
export function getQueryRoot(element) {
  if (!element) return null;
  try {
    const root = typeof element.getRootNode === 'function' ? element.getRootNode() : null;
    if (root && typeof root.querySelectorAll === 'function') {
      return root;
    }
  } catch {
    // SecurityError: cross-origin iframe boundary or detached element.
    // Fall through to ownerDocument.
  }
  try {
    return element.ownerDocument || document;
  } catch {
    // Absolute last resort — ownerDocument inaccessible (e.g. detached frame).
    return document;
  }
}

export function queryAll(root, selector) {
  const normalizedSelector = safeTrim(selector);
  if (!root || !normalizedSelector) return [];
  
  const matches = [];

  function walk(node) {
    if (!node) return;
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.matches && node.matches(normalizedSelector)) {
        matches.push(node);
      }
      if (node.shadowRoot) {
        walk(node.shadowRoot);
      }
    }
    let child = node.firstChild;
    while (child) {
      walk(child);
      child = child.nextSibling;
    }
  }

  try {
    walk(root);
  } catch {
    // Catch cross-origin iframe errors or invalid selector syntax
  }
  return matches;
}

export function queryXPathAll(root, expression, contextNode) {
  const normalizedExpression = safeTrim(expression);
  if (!normalizedExpression) return [];

  const documentRef = contextNode?.ownerDocument
    || root?.ownerDocument
    || (root?.nodeType === Node.DOCUMENT_NODE ? root : document);
  if (!documentRef || typeof documentRef.evaluate !== 'function') return [];
  const xpathResultRef = documentRef.defaultView?.XPathResult
    || (typeof XPathResult !== 'undefined' ? XPathResult : null);
  if (!xpathResultRef) return [];

  const evaluationContext = normalizedExpression.startsWith('.')
    ? (contextNode || documentRef.documentElement || documentRef)
    : documentRef;

  try {
    const result = documentRef.evaluate(
      normalizedExpression,
      evaluationContext,
      null,
      xpathResultRef.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const matches = [];
    for (let index = 0; index < result.snapshotLength; index += 1) {
      const node = result.snapshotItem(index);
      if (node && node.nodeType === Node.ELEMENT_NODE) {
        matches.push(node);
      }
    }
    return matches;
  } catch {
    return [];
  }
}

export function dedupeCandidates(candidates, maxCandidates) {
  const seen = new Set();
  const deduped = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate.selector !== 'string') continue;
    const selector = safeTrim(candidate.selector);
    if (!selector) continue;
    const key = `${candidate.engine || 'css'}::${candidate.family || 'unknown'}::${selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...candidate, selector });
    if (deduped.length >= maxCandidates) break;
  }

  return deduped;
}

export function escapeQuotedAttributeValue(value) {
  return safeTrim(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

export function buildAttributeSelector(tagName, attributeName, attributeValue, options = {}) {
  const value = safeTrim(attributeValue);
  if (!value) return null;
  const escapedValue = escapeQuotedAttributeValue(value);
  const tagPrefix = options.tagScoped === false ? '' : safeTrim(tagName || '').toLowerCase();
  return `${tagPrefix || ''}[${attributeName}="${escapedValue}"]`;
}

export function getSafeClassTokens(element) {
  if (!element || typeof element.className !== 'string') return [];
  return element.className
    .split(/\s+/)
    .map((token) => safeTrim(token))
    .filter(Boolean);
}
