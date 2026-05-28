import { getSafeClassTokens, safeTrim } from '../utils.js';

export function getRole(element) {
  return safeTrim(element?.getAttribute?.('role') || '').toLowerCase() || null;
}

export function getBestStableClassToken(element) {
  const tokens = getSafeClassTokens(element)
    .filter((token) => !/^(?:is|has)-/i.test(token))
    .filter((token) => !/^(?:css-|sc-)/i.test(token))
    .filter((token) => token.length >= 4)
    .sort((left, right) => left.length - right.length);
  return tokens[0] || null;
}
