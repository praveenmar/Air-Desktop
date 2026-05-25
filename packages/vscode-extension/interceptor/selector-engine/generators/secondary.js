import {
  getSafeClassTokens,
  normalizeText,
  safeCssEscape,
} from '../utils.js';

function isStateClassToken(token) {
  const normalized = String(token || '').toLowerCase();
  if (!normalized) return false;
  if (/^(?:is|has)-[a-z0-9:_-]+$/i.test(normalized)) return true;
  if (/--(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)$/i.test(normalized)) {
    return true;
  }
  return /(?:^|[-_])(?:focus|focused|active|selected|open|disabled|hover|loading|expanded|collapsed|current|checked|invalid|valid|dirty|touched|visited|state)(?:$|[-_])/i.test(normalized);
}

function isFrameworkClassToken(token) {
  return /^(?:oxd-|mui|ant-|chakra-|radix-|headlessui-)/i.test(String(token || ''));
}

function isDynamicClassToken(token) {
  return isStateClassToken(token) || /^(?:css-|sc-)/i.test(String(token || ''));
}

function collectClassCandidate(element) {
  const tokens = getSafeClassTokens(element);
  if (tokens.length === 0) return [];

  let selectedToken = null;
  if (tokens.length === 1) {
    selectedToken = tokens[0];
  } else {
    const stableTokens = tokens.filter((token) => !isDynamicClassToken(token));
    if (stableTokens.length === 1) {
      selectedToken = stableTokens[0];
    }
  }

  if (!selectedToken) return [];

  const warningCodes = [];
  if (isFrameworkClassToken(selectedToken)) {
    warningCodes.push('framework-class');
  }

  return [{
    selector: `${element.tagName.toLowerCase()}.${safeCssEscape(selectedToken)}`,
    engine: 'css',
    family: 'class',
    usesDynamicClass: isDynamicClassToken(selectedToken),
    warningCodes,
  }];
}

function collectTextCandidate(element) {
  const text = normalizeText(element.innerText || element.textContent || '');
  if (!text || text.length > 80) return [];
  const scopeSelector = element.tagName.toLowerCase();
  return [{
    selector: `${scopeSelector}:has-text("${text.replace(/"/g, '\\"')}")`,
    engine: 'css',
    family: 'text',
    textQuery: {
      scopeSelector,
      text,
      matchMode: 'contains',
    },
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

export function collectSecondaryCandidates(element) {
  if (!element) return [];
  return [
    ...collectClassCandidate(element),
    ...collectTextCandidate(element),
    ...collectRoleCandidate(element),
  ];
}
