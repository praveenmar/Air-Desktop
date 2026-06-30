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

export function buildSelectorDecision({
  primarySelector,
  selectorCandidates = [],
  currentSummary = [],
  shadowSummary = [],
  selectorPreferenceShadow = {},
  boundedFieldSelectorProposals = [],
  tableRowSelectorProposals = [],
  optionPanelSelectorProposals = [],
  genericContainerProposals = []
}) {
  const bestSelector = selectorPreferenceShadow?.bestSelector;
  
  const allLegacyAndShadow = [...(Array.isArray(currentSummary) ? currentSummary : []), ...(Array.isArray(shadowSummary) ? shadowSummary : [])];
  const primaryCandidate = primarySelector ? allLegacyAndShadow.find(c => c.selector === primarySelector) : null;

  let selected = null;
  let status = "unresolved";
  let blockedReason = "no-replay-safe-selector";
  let selectedFrom = "none";
  let selectedReason = "";

  // Rule 1: Prefer shadow best selector
  if (isReplaySafeSelector(bestSelector)) {
    selected = normalizeSelectorCandidate(bestSelector, "shadow-preference", {
      confidence: "high", // Or derive from tier if available
      proofSource: selectorPreferenceShadow?.bestProof?.path || "direct",
      selectedReason: "Shadow best selector is unique and visible."
    });
    status = "resolved";
    blockedReason = null;
    selectedFrom = "shadow-preference";
  } 
  // Rule 2: Fallback to legacy primary selector
  else if (primaryCandidate && isReplaySafeSelector(primaryCandidate)) {
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
      selectedFrom,
      alternativesCount: alternatives.length,
      genericContainerAlternativeCount: alternatives.filter(a => a.source === "generic-container-proposal").length
    }
  };
}
