import { DEFAULT_MAX_CANDIDATES, SELECTOR_ENGINE_VERSION } from './types.js';
import { finalizeCandidates } from './evaluation.js';
import { collectDirectCandidates } from './generators/direct.js';
import { collectSecondaryCandidates } from './generators/secondary.js';

export function collectShadowSelectorCandidates({
  element,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
}) {
  if (!element) return [];
  const candidateInputs = [
    ...collectDirectCandidates(element),
    ...collectSecondaryCandidates(element),
  ];
  return finalizeCandidates(element, candidateInputs, maxCandidates);
}

const api = {
  version: SELECTOR_ENGINE_VERSION,
  collectShadowSelectorCandidates,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__AIR_SELECTOR_ENGINE__ = api;
}

export default api;
