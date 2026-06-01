import { DEFAULT_MAX_CANDIDATES, SELECTOR_ENGINE_VERSION } from './types.js';
import {
  resolveCanonicalCustomControlTarget,
  resolveCanonicalTargetInternal,
} from './canonical-target.js';
import { resolveAccessibilityEvidence } from './accessibility/role-name.js';
import { resolveBoundedFieldContextEvidence } from './context/bounded-field.js';
import { collectBoundedFieldSelectorProposals } from './context/bounded-field-bridging.js';
import { compareBoundedFieldContextEvidence } from './context/bounded-field-parity.js';
import { buildBoundedFieldShadowExposure } from './context/bounded-field-shadow.js';
import { resolveLabelContextEvidence } from './context/labels.js';
import { resolveOptionPanelContextEvidence } from './context/option-panel.js';
import { collectOptionPanelSelectorProposals } from './context/option-panel-bridging.js';
import { resolveTableRowContextEvidence } from './context/table-row.js';
import { collectTableRowSelectorProposals } from './context/table-row-bridging.js';
import { resolveGenericContainerProof } from './context/generic-container.js';
import { debugLog, debugLogOnce } from './debug.js';
import { finalizeCandidates } from './evaluation.js';
import { collectStructuralCandidates } from './generators/structural.js';
import { collectDirectCandidates, collectDirectFamilyCandidates } from './generators/direct.js';
import { collectSecondaryCandidates } from './generators/secondary.js';
import { buildSelectorPreferenceShadow, classifySelectorCandidatePreference } from './preference-tiers.js';
import { dedupeCandidates } from './utils.js';
import { collectWeakAppShadowCoverage } from './weak-app-shadow.js';

export { resolveCanonicalCustomControlTarget };
export { resolveAccessibilityEvidence };
export { resolveBoundedFieldContextEvidence };
export { collectBoundedFieldSelectorProposals };
export { compareBoundedFieldContextEvidence };
export { buildBoundedFieldShadowExposure };
export { resolveLabelContextEvidence };
export { resolveOptionPanelContextEvidence };
export { collectOptionPanelSelectorProposals };
export { resolveTableRowContextEvidence };
export { collectTableRowSelectorProposals };
export { classifySelectorCandidatePreference };
export { buildSelectorPreferenceShadow };
export { collectWeakAppShadowCoverage };

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
  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalTargetInternal(element, eventContext);
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
  resolveBoundedFieldContextEvidence,
  collectBoundedFieldSelectorProposals,
  compareBoundedFieldContextEvidence,
  buildBoundedFieldShadowExposure,
  resolveLabelContextEvidence,
  resolveOptionPanelContextEvidence,
  collectOptionPanelSelectorProposals,
  resolveTableRowContextEvidence,
  collectTableRowSelectorProposals,
  resolveGenericContainerProof,
  classifySelectorCandidatePreference,
  buildSelectorPreferenceShadow,
  collectWeakAppShadowCoverage,
};

if (typeof globalThis !== 'undefined') {
  globalThis.__AIR_SELECTOR_ENGINE__ = api;
}

export default api;
