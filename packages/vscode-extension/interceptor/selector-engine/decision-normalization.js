const SCHEMA_VERSION = "air:selector-decision:v1";

const DANGEROUS_WARNINGS = new Set([
  "target-not-in-matches",
  "blocked-text-evaluation",
  "multiple-matches",
  "multiple-visible-matches",
  "detached-target",
  "inside-shadow-dom",
  "generic-container-proposal-not-unique",
  "generic-container-proposal-not-visible",
  "generic-container-proposal-no-match"
]);

function hasDangerousWarnings(candidate) {
  if (!candidate || !Array.isArray(candidate.warningCodes)) return false;
  return candidate.warningCodes.some(warning => DANGEROUS_WARNINGS.has(warning));
}

function isReplaySafeSelector(candidate) {
  if (!candidate) return false;
  if (candidate.matchCount !== 1) return false;
  if (candidate.visibleMatchCount !== 1) return false;
  if (candidate.diagnosticOnly) return false;
  if (hasDangerousWarnings(candidate)) return false;
  return true;
}

function normalizeSelectorCandidate(candidate, sourceOverride = null, extraProps = {}) {
  if (!candidate || typeof candidate.selector !== 'string') return null;
  return {
    selector: candidate.selector,
    engine: candidate.engine || "css",
    family: candidate.family || "unknown",
    source: sourceOverride || candidate.source || "unknown",
    proposalSource: candidate.proposalSource || null,
    diagnosticOnly: candidate.diagnosticOnly || false,
    replaySafe: extraProps.replaySafe !== undefined ? extraProps.replaySafe : isReplaySafeSelector(candidate),
    suppressedBy: candidate.suppressedBy || null,
    matchCount: typeof candidate.matchCount === 'number' ? candidate.matchCount : null,
    visibleMatchCount: typeof candidate.visibleMatchCount === 'number' ? candidate.visibleMatchCount : null,
    warningCodes: Array.isArray(candidate.warningCodes) ? candidate.warningCodes : [],
    ...(candidate.realizationSteps ? { realizationSteps: candidate.realizationSteps } : {}),
    ...extraProps
  };
}

function buildAlternativesLadder({
  selected,
  primaryCandidate,
  proofProposals,
  genericContainerProposals
}) {
  const alternatives = [];
  const seenSelectors = new Set();
  
  if (selected) {
    seenSelectors.add(selected.selector);
  }

  function addAlternative(candidate, overrides = {}) {
    if (!candidate || !candidate.selector) return;
    if (seenSelectors.has(candidate.selector)) return;
    if (alternatives.length >= 3) return; // Max length: 3
    
    alternatives.push(normalizeSelectorCandidate(candidate, overrides.source, overrides));
    seenSelectors.add(candidate.selector);
  }

  // 1. Safe proof-derived alternatives
  proofProposals.forEach(proposal => {
    if (isReplaySafeSelector(proposal)) {
      addAlternative(proposal, { source: "proof-proposal" });
    }
  });

  // 2. Legacy primary selector (if different and replay-safe)
  if (primaryCandidate && isReplaySafeSelector(primaryCandidate)) {
    addAlternative(primaryCandidate, { source: "legacy-primary" });
  }

  // 3. Generic Container Proposals (diagnostic only)
  if (Array.isArray(genericContainerProposals)) {
    genericContainerProposals.forEach(proposal => {
      addAlternative(proposal, {
        source: "generic-container-proposal",
        diagnosticOnly: true,
        replaySafe: isReplaySafeSelector(proposal),
        suppressedBy: proposal.suppressedBy || "guardrail-m1-diagnostic-only"
      });
    });
  }

  return alternatives;
}

// ---------------------------------------------------------
// PROOF-PACKET SCORING (Rule 0)
// ---------------------------------------------------------
function isChainSelector(selector) {
  if (typeof selector !== 'string') return false;
  return /\.(getByRole|getByLabel|getByText|getByPlaceholder|getByTestId|locator|filter|nth|frameLocator)\(/.test(selector);
}

function countChainLinks(selector) {
  if (typeof selector !== 'string') return 1;
  const matches = selector.match(/\.(getByRole|getByLabel|getByText|getByPlaceholder|getByTestId|locator|filter|nth|frameLocator)\(/g);
  return matches ? matches.length + 1 : 1;
}

function baseProofPacketScore(classId, proof, metadata) {
  switch (classId) {
    case 'direct-identity': {
      if (proof.isGloballyUnique === false) return 40; // Ambiguous ID fallback
      const identityType = proof?.identityType || '';
      if (identityType === 'data-testid') return 97;
      if (identityType === 'id')          return 92;
      return 88; // name, href, alt, title, value
    }
    case 'semantic-identity':           return 89;
    case 'label-bound-identity':        return 87;
    case 'semantic-context-filtering':  return 83;
    case 'structural-disambiguation':   return 79;
    case 'stateful-lifecycle-linkage': {
      const shape = metadata?.shape;
      if (shape === 'P') return 30;
      if (shape === 'C') return 82;
      if (shape === 'B') return 78;
      if (shape === 'D') return 74;
      return 74;
    }
    case 'collection-membership': {
      if (metadata?.shape === 'B') return 30;
      return 83;
    }
    case 'hierarchical-navigation': {
      const shape = metadata?.shape;
      if (shape === 'P-chain') return 65;
      return 82; // Shape N and P-aria
    }
    case 'boundary-traversal': return 80;
    case 'pragmatic-css-fallback': return 65;
    default:                   return 45;
  }
}

function scoreProofPacketCandidate(candidate) {
  if (!candidate || !candidate.classId) return null;

  const proof    = candidate.proof    || {};
  const metadata = candidate.metadata || {};
  const reasons  = [];

  let score = baseProofPacketScore(candidate.classId, proof, metadata);
  reasons.push(`class:${candidate.classId}`);
  if (metadata.shape) reasons.push(`shape:${metadata.shape}`);

  // Dynamic candidates leave the race - scored 0, tier advisory
  if (proof.isLikelyDynamic === true || proof.accessibleNameIsDynamic === true) {
    return { score: 0, tier: 'advisory', reasons: [...reasons, 'dynamic-element'], isDynamic: true };
  }

  // Uniqueness bonuses - proof-certified at record time
  if (proof.uniqueByAriaName === true)    { score += 6; reasons.push('unique-by-aria-name'); }
  if (proof.uniquePanelBinding === true)  { score += 4; reasons.push('unique-panel-binding'); }
  if (proof.uniqueTargetBinding === true) { score += 4; reasons.push('unique-target-binding'); }
  if (proof.uniqueRowBinding === true)    { score += 4; reasons.push('unique-row-binding'); }
  if (proof.uniqueActionBinding === true) { score += 4; reasons.push('unique-action-binding'); }

  // Chain scoring - weakest-link model
  if (isChainSelector(candidate.selector)) {
    const linkCount = countChainLinks(candidate.selector);
    const depthBonus = Math.min((linkCount - 1) * 3, 10); // max +10
    const breakRisk = Math.min((linkCount - 1) * 2, 8);   // max -8
    score = score + depthBonus - breakRisk;
    reasons.push(`chain-depth:${linkCount}`);
  }

  // Positional hard-cap - Shape P / Shape B / nth are never Rule 0 winners
  const isPositional = 
    metadata.shape === 'P' ||
    metadata.shape === 'B' ||
    metadata.reason === 'positional-fallback' ||
    /\.nth\(\d+\)/.test(candidate.selector || '');

  if (isPositional) {
    score = Math.min(score, 35);
    reasons.push('positional-fallback');
  }

  let tier;
  if (isPositional)      tier = 'last-resort';
  else if (score >= 80)  tier = 'preferred';
  else if (score >= 50)  tier = 'fallback';
  else                   tier = 'last-resort';

  return { score, tier, reasons, isDynamic: false };
}

function isProofBackedReplaySafe(candidate) {
  if (!candidate || typeof candidate.selector !== 'string') return false;
  if (!candidate.classId) return false;

  const proof = candidate.proof || {};

  // Dynamic values are never safe to replay
  if (proof.isLikelyDynamic === true || proof.accessibleNameIsDynamic === true) return false;

  switch (candidate.classId) {
    case 'direct-identity':
      if (proof.isGloballyUnique === false) return false;
      return proof.isLikelyDynamic !== true && !!proof.identityType;

    case 'semantic-identity':
      return !!proof.accessibleName && proof.accessibleNameIsDynamic !== true;

    case 'label-bound-identity':
      return !!proof.fieldLabelText &&
        ['label-for', 'wrapped-label', 'aria-labelledby'].includes(proof.fieldRelation);

    case 'semantic-context-filtering':
      if (proof.proofType === 'bounded-field')
        return !!proof.fieldLabelText && (proof.duplicateLabelCount == null || proof.duplicateLabelCount <= 1);
      if (proof.proofType === 'table-row')
        return proof.uniqueRowBinding === true && proof.uniqueActionBinding === true;
      if (proof.proofType === 'generic-container')
        return !!proof.containerAnchorText && !!proof.actionName;
      return false;

    case 'structural-disambiguation':
      return !!proof.fieldLabelText && typeof proof.targetIndexWithinAmbiguity === 'number';

    case 'stateful-lifecycle-linkage':
      if (candidate.metadata?.shape === 'P') return false;
      return proof.uniquePanelBinding === true && proof.uniqueTargetBinding === true;

    case 'collection-membership':
      if (candidate.metadata?.shape === 'B') return false;
      return proof.uniqueRowBinding === true && proof.uniqueActionBinding === true;

    case 'hierarchical-navigation':
      if (candidate.metadata?.shape === 'P-chain') return false;
      return !!proof.nodeName;

    case 'boundary-traversal':
      return proof.isSameOrigin === true && !!proof.frameSelector;

    default:
      return false;
  }
}

export function buildSelectorDecision({
  primarySelector,
  selectorCandidates = [],
  currentSummary = [],
  shadowSummary = [],
  selectorPreferenceShadow = {},
  boundedFieldSelectorProposals = [],
  tableRowSelectorProposals = [],
  optionPanelSelectorProposals = [],
  genericContainerProposals = [],
  proofPacketCandidates = []          // <- NEW
}) {
  const bestSelector = selectorPreferenceShadow?.bestSelector;

  const allLegacyAndShadow = [
    ...(Array.isArray(currentSummary) ? currentSummary : []),
    ...(Array.isArray(shadowSummary)  ? shadowSummary  : []),
  ];
  const primaryCandidate = primarySelector
    ? allLegacyAndShadow.find(c => c.selector === primarySelector)
    : null;

  let selected       = null;
  let status         = "unresolved";
  let blockedReason  = "no-replay-safe-selector";
  let selectedFrom   = "none";
  let selectedReason = "";

  // ---------------------------------------------------------
  // Rule 0: Proof-packet winner (Classes 1-10)
  // ---------------------------------------------------------
  if (Array.isArray(proofPacketCandidates) && proofPacketCandidates.length > 0) {
    const scoredPacketCandidates = proofPacketCandidates
      .filter(c => c && !c.proof?.isLikelyDynamic && !c.proof?.accessibleNameIsDynamic)
      .map(c => {
        const scored = scoreProofPacketCandidate(c);
        return scored ? { ...c, _scored: scored } : null;
      })
      .filter(Boolean)
      .filter(c => c._scored.tier !== 'last-resort' && c._scored.tier !== 'advisory')
      .filter(c => isProofBackedReplaySafe(c))
      .sort((a, b) => (b._scored.score || 0) - (a._scored.score || 0));

    const rule0Winner = scoredPacketCandidates[0] || null;

    if (rule0Winner) {
      selected = normalizeSelectorCandidate(rule0Winner, "shadow-preference", {
        confidence: rule0Winner._scored.tier === 'preferred' ? 'high' : 'medium',
        proofSource: rule0Winner.classId,
        selectedReason: `Proof-packet winner. Class: ${rule0Winner.classId}. Score: ${rule0Winner._scored.score}. Reasons: ${(rule0Winner._scored.reasons || []).join(', ')}.`,
        replaySafe: true,
      });
      status         = "resolved";
      blockedReason  = null;
      selectedFrom   = "shadow-preference";
    }
  }

  // ---------------------------------------------------------
  // Rule 1: Shadow best selector (Population A + proposal candidates)
  // ---------------------------------------------------------
  if (!selected && isReplaySafeSelector(bestSelector)) {
    selected = normalizeSelectorCandidate(bestSelector, "shadow-preference", {
      confidence: "high",
      proofSource: selectorPreferenceShadow?.bestProof?.path || "direct",
      selectedReason: "Shadow best selector is unique and visible."
    });
    status = "resolved";
    blockedReason = null;
    selectedFrom = "shadow-preference";
  } 
  
  // ---------------------------------------------------------
  // Rule 2: Fallback to legacy primary selector
  // ---------------------------------------------------------
  if (!selected && primaryCandidate && isReplaySafeSelector(primaryCandidate)) {
    selected = normalizeSelectorCandidate(primaryCandidate, "legacy-primary", {
      confidence: "low",
      proofSource: null,
      selectedReason: "Shadow selector unsafe/missing. Legacy selector verified unique and visible."
    });
    status = "resolved";
    blockedReason = null;
    selectedFrom = "legacy-primary";
  }

  // Build alternatives ladder
  const proofProposals = [
    ...(Array.isArray(boundedFieldSelectorProposals) ? boundedFieldSelectorProposals : []),
    ...(Array.isArray(tableRowSelectorProposals) ? tableRowSelectorProposals : []),
    ...(Array.isArray(optionPanelSelectorProposals) ? optionPanelSelectorProposals : [])
  ];

  const alternatives = buildAlternativesLadder({
    selected,
    primaryCandidate,
    proofProposals,
    genericContainerProposals
  });

  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    selected,
    alternatives,
    blockedReason,
    diagnosticsSummary: {
      legacyPrimaryPresent: !!primarySelector,
      shadowBestPresent: !!bestSelector,
      proofPacketCandidateCount: Array.isArray(proofPacketCandidates) ? proofPacketCandidates.length : 0,
      selectedFrom,
      alternativesCount: alternatives.length,
      genericContainerAlternativeCount: alternatives.filter(a => a.source === "generic-container-proposal").length
    }
  };
}
