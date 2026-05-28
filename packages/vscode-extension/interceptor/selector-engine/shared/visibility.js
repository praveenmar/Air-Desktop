export function isFastVisible(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.isConnected === false) return false;
  if (element.hidden) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;
  const inlineStyle = element.style || null;
  if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) {
    return false;
  }
  return true;
}

export function isFastVisibleForCandidateDiscovery(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.isConnected === false) return false;
  if (element.hidden) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;

  const tagName = element.tagName?.toLowerCase?.() || '';
  const inputType = (element.getAttribute?.('type') || '').toLowerCase();
  if (tagName === 'input' && inputType === 'hidden') return false;

  const inlineStyle = element.style || null;
  if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) {
    return false;
  }

  return true;
}

export function queryVisibleElements(root, selector) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isFastVisible);
  } catch {
    return [];
  }
}

export function countVisibleMatches(root, selector) {
  if (!root || typeof root.querySelectorAll !== 'function' || !selector) return 0;
  try {
    return Array.from(root.querySelectorAll(selector)).filter(isFastVisible).length;
  } catch {
    return 0;
  }
}
