import { DEFAULT_MAX_CANDIDATES, SELECTOR_ENGINE_VERSION } from './types.js';
import { resolveCanonicalCustomControlTarget } from './canonical-target.js';
import { resolveAccessibilityEvidence } from './accessibility/role-name.js';
import { resolveLabelContextEvidence } from './context/labels.js';
import { debugLog, debugLogOnce } from './debug.js';
import { finalizeCandidates } from './evaluation.js';
import { collectStructuralCandidates } from './generators/structural.js';
import { collectDirectCandidates, collectDirectFamilyCandidates } from './generators/direct.js';
import { collectSecondaryCandidates } from './generators/secondary.js';
import { dedupeCandidates } from './utils.js';

export { resolveCanonicalCustomControlTarget };
export { resolveAccessibilityEvidence };
export { resolveLabelContextEvidence };

function isStructuralFamily(candidate) {
  return candidate?.family === 'tight-container-css' || candidate?.family === 'parent-scoped-css';
}

function logStructuralCandidateResults(candidates, eventContext) {
  candidates
    .filter(isStructuralFamily)
    .forEach((candidate) => {
      debugLog('Generated structural candidate', {
        eventType: typeof eventContext?.eventType === 'string' ? eventContext.eventType : null,
        trigger: typeof eventContext?.trigger === 'string' ? eventContext.trigger : null,
        selector: candidate.selector,
        family: candidate.family,
        matchCount: candidate.matchCount,
        visibleMatchCount: candidate.visibleMatchCount,
        warningCodes: candidate.warningCodes || [],
      });
    });
}

function collectCanonicalTargetCandidates(canonicalTargetInfo) {
  const canonicalTarget = canonicalTargetInfo?.canonicalTarget;
  if (!canonicalTargetInfo?.canonicalDiffers || !canonicalTarget) return [];

  const canonicalCandidates = [
    ...collectDirectCandidates(canonicalTarget),
    ...collectSecondaryCandidates(canonicalTarget),
  ];

  return canonicalCandidates.map((candidate) => ({
    ...candidate,
    queryTarget: canonicalTarget,
  }));
}

export function collectShadowSelectorCandidates({
  element,
  selectorResult,
  eventContext,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
  enableStructuralParity = false,
  canonicalTargetInfo = undefined,
}) {
  if (!element) return [];
  const resolvedCanonicalTargetInfo = canonicalTargetInfo || resolveCanonicalCustomControlTarget(element, eventContext);
  const baseCandidateInputs = [
    ...collectDirectCandidates(element),
    ...collectSecondaryCandidates(element),
    ...collectCanonicalTargetCandidates(resolvedCanonicalTargetInfo),
  ];

  let candidateInputs = baseCandidateInputs;
  if (enableStructuralParity) {
    const reservedBaseCandidates = dedupeCandidates(baseCandidateInputs, maxCandidates);
    if (reservedBaseCandidates.length >= maxCandidates) {
      debugLogOnce('structural-budget-exceeded', 'Skipped structural candidate generation', {
        eventType: typeof eventContext?.eventType === 'string' ? eventContext.eventType : null,
        trigger: typeof eventContext?.trigger === 'string' ? eventContext.trigger : null,
        targetTag: element?.tagName?.toLowerCase?.() || null,
        reason: 'budget-exceeded',
        maxCandidates,
      });
    } else {
      candidateInputs = [
        ...baseCandidateInputs,
        ...collectStructuralCandidates({
          element,
          selectorResult,
          eventContext,
        }),
      ];
    }
  }

  const finalizedCandidates = finalizeCandidates(element, candidateInputs, maxCandidates);
  if (enableStructuralParity) {
    logStructuralCandidateResults(finalizedCandidates, eventContext);
  }
  return finalizedCandidates;
}

export function collectDirectFamilySelectorCandidates({
  element,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
}) {
  if (!element) return [];
  return finalizeCandidates(element, collectDirectFamilyCandidates(element), maxCandidates);
}

const api = {
  version: SELECTOR_ENGINE_VERSION,
  collectShadowSelectorCandidates,
  collectDirectFamilySelectorCandidates,
  resolveCanonicalCustomControlTarget,
  resolveAccessibilityEvidence,
  resolveLabelContextEvidence,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__AIR_SELECTOR_ENGINE__ = api;
}

export default api;
