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

export function getQueryRoot(element) {
  if (!element) return null;
  const root = typeof element.getRootNode === 'function' ? element.getRootNode() : null;
  if (root && typeof root.querySelectorAll === 'function') {
    return root;
  }
  return element.ownerDocument || document;
}

export function queryAll(root, selector) {
  const normalizedSelector = safeTrim(selector);
  if (!root || !normalizedSelector) return [];
  try {
    return Array.from(root.querySelectorAll(normalizedSelector));
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

export function buildAttributeSelector(tagName, attributeName, attributeValue, options = {}) {
  const value = safeTrim(attributeValue);
  if (!value) return null;
  const escapedValue = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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

