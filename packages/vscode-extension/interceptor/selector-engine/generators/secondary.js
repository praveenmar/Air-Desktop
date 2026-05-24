import {
  getSafeClassTokens,
  normalizeText,
  safeCssEscape,
} from '../utils.js';

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

export function collectSecondaryCandidates(element) {
  if (!element) return [];
  return [
    ...collectClassCandidate(element),
    ...collectTextCandidate(element),
    ...collectRoleCandidate(element),
  ];
}
