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
import { collectGenericContainerProposals } from './context/generic-container-bridging.js';
import { debugLog, debugLogOnce } from './debug.js';
import { finalizeCandidates } from './evaluation.js';
import { collectStructuralCandidates } from './generators/structural.js';
import { collectDirectCandidates, collectDirectFamilyCandidates } from './generators/direct.js';
import { collectSecondaryCandidates } from './generators/secondary.js';
import { buildSelectorPreferenceShadow, classifySelectorCandidatePreference } from './preference-tiers.js';
import { dedupeCandidates } from './utils.js';
import { collectWeakAppShadowCoverage } from './weak-app-shadow.js';
import { chooseSemanticRowIdentity } from './context/semantic-row-anchor.js';
import { buildSelectorDecision } from './decision-normalization.js';
import { generateDirectIdentityShadow } from './generators/shadow-identity.js';
import { applyNativeDomNormalization } from './generators/native-dom-normalization.js';
import { generateSemanticIdentityShadow } from './generators/semantic-identity.js';
import { generateLabelBoundIdentityShadow } from './generators/label-bound-identity.js';
import { trackSelectorPacket } from './telemetry.js';
import { generateSemanticContextShadow } from './generators/semantic-context-filtering.js';
import { generateStructuralDisambiguationShadow } from './generators/structural-disambiguation.js';
import { generateStatefulLifecycleShadow } from './generators/stateful-lifecycle.js';
import { generateCollectionMembershipShadow } from './generators/collection-membership.js';
import { generateHierarchicalNavigationShadow } from './generators/hierarchical-navigation.js';
import { resolveTreeNodeContextEvidence } from './context/tree-node.js';

export const ENABLE_SHADOW_PROOF_PIPELINE = true;

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
export { collectGenericContainerProposals };
export { classifySelectorCandidatePreference };
export { buildSelectorPreferenceShadow };
export { collectWeakAppShadowCoverage };
export { buildSelectorDecision };

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

/**
 * @param {CandidateProof[]} proofs
 * @returns {SelectorProofPacketV0|undefined}
 */
export function assembleSelectorProofPacketV0(proofs = []) {
  if (!ENABLE_SHADOW_PROOF_PIPELINE) return undefined;

  try {
    const shadowCandidates = [];
    
    // --- Route Proofs to Pure Generators ---
    if (Array.isArray(proofs)) {
      for (const rawProof of proofs) {
        if (!rawProof) continue;

        // Class 11 - Native DOM Normalization:
        // Normalize invisible/variant Unicode in human-readable text fields before
        // any generator runs. Identity attribute fields (id, data-testid, name, href)
        // are intentionally NOT normalized - they are developer-set values, not
        // rendered text. All generator classes receive the normalized proof.
        const proof = applyNativeDomNormalization(rawProof);
        
        const identityCandidate = generateDirectIdentityShadow(proof);
        if (identityCandidate) shadowCandidates.push(identityCandidate);

        const semanticCandidate = generateSemanticIdentityShadow(proof);
        if (semanticCandidate) shadowCandidates.push(semanticCandidate);

        const labelCandidate = generateLabelBoundIdentityShadow(proof);
        if (labelCandidate) shadowCandidates.push(labelCandidate);

        const class7Result = generateStatefulLifecycleShadow(proof);
        if (Array.isArray(class7Result)) {
          if (class7Result.length) shadowCandidates.push(...class7Result);
        } else if (class7Result) {
          shadowCandidates.push(class7Result); // legacy fallback
        }

        const disambiguationCandidate = generateStructuralDisambiguationShadow(proof);
        if (disambiguationCandidate) shadowCandidates.push(disambiguationCandidate);

        const class8Result = generateCollectionMembershipShadow(proof);
        if (Array.isArray(class8Result)) {
          if (class8Result.length) shadowCandidates.push(...class8Result);
        } else if (class8Result) {
          shadowCandidates.push(class8Result); // legacy fallback
        }

        const class9Result = generateHierarchicalNavigationShadow(proof);
        if (Array.isArray(class9Result)) {
          if (class9Result.length) shadowCandidates.push(...class9Result);
        } else if (class9Result) {
          shadowCandidates.push(class9Result); // legacy fallback
        }
      }
    }
    
    // Process Class 4 Semantic Context candidates in bulk
    const class4Candidates = generateSemanticContextShadow(proofs);
    shadowCandidates.push(...class4Candidates);
  

    // --- Assemble Packet with Versioning ---
    const packet = {
      version: 0,
      candidates: shadowCandidates
    };

    // User requested console print that doesn't hide nested objects
    globalThis.__SHADOW_PACKET__ = packet;
    console.error('[[[SHADOW_PACKET_DUMP]]]\n' + JSON.stringify(packet, null, 2));

    trackSelectorPacket(packet);

    return packet;
  } catch (err) {
    // Error Boundary: Swallow all shadow errors to protect production interception
    console.warn("[AIR Shadow Pipeline] Failed to assemble packet", err);
    return undefined;
  }
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
  resolveTreeNodeContextEvidence,
  resolveGenericContainerProof,
  collectGenericContainerProposals,
  classifySelectorCandidatePreference,
  buildSelectorPreferenceShadow,
  collectWeakAppShadowCoverage,
  buildSelectorDecision,
  assembleSelectorProofPacketV0,
  ENABLE_SHADOW_PROOF_PIPELINE
};

if (typeof globalThis !== 'undefined') {
  globalThis.__AIR_SELECTOR_ENGINE__ = api;
}

export default api;
