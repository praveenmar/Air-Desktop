function uniqueVisibleCandidate(candidate) {
  return candidate?.matchCount === 1 && candidate?.visibleMatchCount === 1;
}

function uniqueMatchCandidate(candidate) {
  return candidate?.matchCount === 1;
}

function hasWarning(candidate, warningCode) {
  return Array.isArray(candidate?.warningCodes) && candidate.warningCodes.includes(warningCode);
}

function pushReason(reasons, condition, code) {
  if (condition) reasons.push(code);
}

function summarizeCandidate(candidate, tier, score, reasons) {
  return {
    selector: candidate?.selector || null,
    family: candidate?.family || 'unknown',
    engine: candidate?.engine || 'css',
    proposalSource: candidate?.proposalSource || null,
    proposalTierHint: candidate?.proposalTierHint || null,
    tier,
    score,
    reasons,
    strength: candidate?.strength || null,
    matchCount: candidate?.matchCount ?? null,
    visibleMatchCount: candidate?.visibleMatchCount ?? null,
    requiresTriggerActivation: candidate?.requiresTriggerActivation === true,
    replayPrerequisite: candidate?.replayPrerequisite || null,
    activationSelector: candidate?.activationSelector || null,
    postActivationSelector: candidate?.postActivationSelector || null,
    warningCodes: Array.isArray(candidate?.warningCodes) ? candidate.warningCodes.slice() : [],
  };
}

function baseCandidateScore(candidate) {
  switch (candidate?.family) {
    case 'test-id':
      return 95;
    case 'id':
      return 90;
    case 'name':
      return 86;
    case 'aria-label':
      return 84;
    case 'placeholder':
      return 82;
    case 'href':
      return 80;
    case 'tight-container-css':
      return 74;
    case 'parent-scoped-text-css':
      return 72;
    case 'parent-scoped-css':
      return 68;
    case 'class':
      return 55;
    case 'text':
      return 52;
    case 'role-attr':
      return 48;
    case 'xpath':
      return 30;
    default:
      return 45;
  }
}

export function classifySelectorCandidatePreference(candidate) {
  const reasons = [];
  let score = baseCandidateScore(candidate);

  pushReason(reasons, uniqueMatchCandidate(candidate), 'unique-match');
  pushReason(reasons, uniqueVisibleCandidate(candidate), 'unique-visible-match');
  if (uniqueMatchCandidate(candidate)) score += 8;
  if (uniqueVisibleCandidate(candidate)) score += 6;

  if (candidate?.family === 'test-id' || candidate?.family === 'id' || candidate?.family === 'name'
    || candidate?.family === 'aria-label' || candidate?.family === 'placeholder' || candidate?.family === 'href') {
    reasons.push('direct-attribute-family');
  }
  if (candidate?.family === 'tight-container-css' || candidate?.family === 'parent-scoped-css') {
    reasons.push('structural-scoping-family');
  }
  if (candidate?.family === 'text' || candidate?.family === 'parent-scoped-text-css') {
    reasons.push('text-scoping-family');
  }
  if (candidate?.family === 'class') reasons.push('class-family');
  if (candidate?.family === 'role-attr') reasons.push('role-only-family');
  if (candidate?.family === 'xpath') reasons.push('xpath-family');
  if (candidate?.proposalSource === 'bounded-field') {
    score += 12;
    reasons.push('proof-derived-bounded-field');
  }
  const isTriggerBoundDetached =
    candidate?.proposalSource === 'option-panel' &&
    candidate?.requiresTriggerActivation === true &&
    candidate?.replayPrerequisite === 'open-trigger';

  if (candidate?.proposalSource === 'option-panel') {
    score += 16;
    reasons.push('proof-derived-option-panel');
    if (isTriggerBoundDetached) {
      reasons.push('trigger-linked', 'requires-open-panel');
      if (candidate.visibleMatchCount === 0) {
        reasons.push('closed-panel-at-evaluation');
      }
    }
  }
  if (candidate?.proposalSource === 'table-row') {
    score += 32;
    reasons.push('proof-derived-table-row');
  }
  if (candidate?.proposalTierHint === 'preferred') {
    score += 10;
    reasons.push('proposal-tier-hint:preferred');
  } else if (candidate?.proposalTierHint === 'fallback') {
    score += 2;
    reasons.push('proposal-tier-hint:fallback');
  } else if (candidate?.proposalTierHint === 'last-resort') {
    score -= 18;
    reasons.push('proposal-tier-hint:last-resort');
  }

  if (candidate?.usesDynamicClass) {
    score -= 8;
    reasons.push('dynamic-class-risk');
  }
  if (candidate?.usesIndex) {
    score -= 20;
    reasons.push('indexed-selector');
  }
  if (hasWarning(candidate, 'framework-class')) {
    score -= 4;
    reasons.push('framework-class-risk');
  }
  if (hasWarning(candidate, 'multiple-matches')) {
    score -= 10;
    reasons.push('multiple-matches');
  }
  if (hasWarning(candidate, 'multiple-visible-matches')) {
    score -= 10;
    reasons.push('multiple-visible-matches');
  }
  if (hasWarning(candidate, 'target-not-in-matches')) {
    if (!isTriggerBoundDetached) {
      score -= 50;
    }
    reasons.push('target-not-in-matches');
  }
  if (hasWarning(candidate, 'blocked-text-evaluation')) {
    score -= 25;
    reasons.push('blocked-text-evaluation');
  }
  if (hasWarning(candidate, 'too-many-matches-for-visible-index')) {
    score -= 12;
    reasons.push('too-many-matches-for-visible-index');
  }

  if (hasWarning(candidate, 'incomplete-trigger-binding')) {
    score -= 20;
    reasons.push('incomplete-trigger-binding');
  }

  let tier = 'fallback';
  if (
    candidate?.usesIndex === true
    || candidate?.requiresPositionalDisambiguation === true
    || hasWarning(candidate, 'positional-fallback-only')
  ) tier = 'last-resort';
  else if (score >= 80) tier = 'preferred';
  else if (score < 50) tier = 'last-resort';

  return summarizeCandidate(candidate, tier, score, reasons);
}

function summarizeBoundedFieldProof(proof) {
  if (!proof) return null;
  return {
    fieldLabelText: proof.fieldLabelText || null,
    fieldRelation: proof.fieldRelation || null,
    targetControlKind: proof.targetControlKind || null,
    cleanParentSelector: proof.cleanParentSelector || null,
    cleanChildSelector: proof.cleanChildSelector || null,
    isValid: proof.isValid === true,
    blockedReason: proof.blockedReason || null,
  };
}

function summarizeLabelProof(proof) {
  if (!proof) return null;
  return {
    fieldLabelText: proof.fieldLabelText || null,
    fieldRelation: proof.fieldRelation || null,
    targetControlKind: proof.targetControlKind || null,
    usedCanonicalTarget: proof.usedCanonicalTarget === true,
    isValid: proof.isValid === true,
    blockedReason: proof.blockedReason || null,
  };
}

function summarizeAccessibilityProof(proof) {
  if (!proof) return null;
  return {
    role: proof.role || null,
    accessibleName: proof.accessibleName || null,
    accessibleNameSource: proof.accessibleNameSource || 'none',
    usedCanonicalTarget: proof.usedCanonicalTarget === true,
    blockedReason: proof.blockedReason || null,
  };
}

function summarizeOptionPanelProof(proof) {
  if (!proof) return null;
  return {
    itemRole: proof.itemRole || null,
    itemName: proof.itemName || null,
    containerRole: proof.containerRole || null,
    containerLabelText: proof.containerLabelText || null,
    containerSelector: proof.containerSelector || null,
    itemSelector: proof.itemSelector || null,
    scopedItemSelector: proof.scopedItemSelector || null,
    triggerSelector: proof.triggerSelector || null,
    uniquePanelBinding: proof.uniquePanelBinding === true,
    uniqueTargetBinding: proof.uniqueTargetBinding === true,
    requiresPositionalDisambiguation: proof.requiresPositionalDisambiguation === true,
    isValid: proof.isValid === true,
    blockedReason: proof.blockedReason || null,
  };
}

function summarizeTableRowProof(proof) {
  if (!proof) return null;
  return {
    actionRole: proof.actionRole || null,
    actionName: proof.actionName || null,
    tableRole: proof.tableRole || null,
    tableLabelText: proof.tableLabelText || null,
    tableSelector: proof.tableSelector || null,
    actionSelector: proof.actionSelector || null,
    rowIdentityTexts: Array.isArray(proof.rowIdentityTexts) ? proof.rowIdentityTexts.slice() : [],
    rowIdentityMode: proof.rowIdentityMode || 'none',
    rowScopedActionSelector: proof.rowScopedActionSelector || null,
    uniqueTableBinding: proof.uniqueTableBinding === true,
    uniqueRowBinding: proof.uniqueRowBinding === true,
    uniqueActionBinding: proof.uniqueActionBinding === true,
    requiresPositionalDisambiguation: proof.requiresPositionalDisambiguation === true,
    isValid: proof.isValid === true,
    blockedReason: proof.blockedReason || null,
  };
}

function classifyBoundedFieldProof(proof, shadowExposure) {
  const reasons = [];
  let score = 20;

  if (proof?.isValid === true && proof?.fieldLabelText && proof?.cleanChildSelector) {
    score = 92;
    reasons.push('valid-bounded-field-proof');
  } else if (proof?.fieldLabelText) {
    score = 62;
    reasons.push('partial-bounded-field-proof');
  } else {
    reasons.push('missing-bounded-field-proof');
  }

  if (shadowExposure?.parityStatus === 'exact-match') {
    score += 4;
    reasons.push('legacy-parity-exact');
  } else if (shadowExposure?.parityStatus === 'partial-match') {
    reasons.push('legacy-parity-partial');
  }

  if (proof?.blockedReason) {
    score -= 18;
    reasons.push(`blocked:${proof.blockedReason}`);
  }

  let tier = 'fallback';
  if (score >= 80) tier = 'preferred';
  else if (score < 50) tier = 'last-resort';

  return {
    path: 'bounded-field',
    tier,
    score,
    reasons,
    summary: summarizeBoundedFieldProof(proof),
  };
}

function classifyLabelProof(proof) {
  const reasons = [];
  let score = 18;
  const relation = proof?.fieldRelation || null;

  if (proof?.fieldLabelText && ['label-for', 'wrapped-label', 'aria-labelledby'].includes(relation)) {
    score = 82;
    reasons.push('explicit-label-association');
  } else if (proof?.fieldLabelText && ['sibling-label', 'bounded-container'].includes(relation)) {
    score = 70;
    reasons.push('container-label-association');
  } else {
    reasons.push('missing-label-context');
  }

  if (proof?.usedCanonicalTarget === true) {
    reasons.push('canonical-target-used');
  }
  if (proof?.blockedReason) {
    score -= 14;
    reasons.push(`blocked:${proof.blockedReason}`);
  }

  let tier = 'fallback';
  if (score >= 80) tier = 'preferred';
  else if (score < 50) tier = 'last-resort';

  return {
    path: 'label-context',
    tier,
    score,
    reasons,
    summary: summarizeLabelProof(proof),
  };
}

function classifyAccessibilityProof(proof) {
  const reasons = [];
  let score = 20;

  if (proof?.role && proof?.accessibleName) {
    score = 84;
    reasons.push('role-name-proof');
  } else if (proof?.role || proof?.accessibleName) {
    score = 60;
    reasons.push('partial-accessibility-proof');
  } else {
    reasons.push('missing-accessibility-proof');
  }

  if (proof?.usedCanonicalTarget === true) {
    reasons.push('canonical-target-used');
  }
  if (proof?.blockedReason) {
    score -= 14;
    reasons.push(`blocked:${proof.blockedReason}`);
  }

  let tier = 'fallback';
  if (score >= 80) tier = 'preferred';
  else if (score < 50) tier = 'last-resort';

  return {
    path: 'accessibility-role-name',
    tier,
    score,
    reasons,
    summary: summarizeAccessibilityProof(proof),
  };
}

function classifyOptionPanelProof(proof) {
  const reasons = [];
  let score = 16;

  const hasStrongScopedBinding = !!proof?.containerSelector && !!(proof?.scopedTextSelector || proof?.scopedItemSelector);
  const hasCompleteTriggerBinding = !!proof?.triggerSelector && !proof?.triggerBlockedReason;
  const hasUniquePanelBinding = proof?.uniquePanelBinding === true;
  const hasUniqueTargetBinding = proof?.uniqueTargetBinding === true;
  const requiresPositionalDisambiguation = proof?.requiresPositionalDisambiguation === true;

  if (
    proof?.isValid === true
    && hasStrongScopedBinding
    && hasUniquePanelBinding
    && hasUniqueTargetBinding
    && hasCompleteTriggerBinding
    && !requiresPositionalDisambiguation
    && !proof?.blockedReason
  ) {
    score = 88;
    reasons.push('valid-option-panel-proof');
    reasons.push('unique-panel-binding');
    reasons.push('unambiguous-item-binding');
  } else if (proof?.blockedReason) {
    score = 24;
    reasons.push('blocked-option-panel-proof');
  } else if (proof?.containerSelector && (proof?.itemName || proof?.itemRole)) {
    score = 74;
    reasons.push('partial-option-panel-proof');
    if (!hasUniquePanelBinding || !hasCompleteTriggerBinding) reasons.push('incomplete-panel-trigger-binding');
    if (!hasUniqueTargetBinding) reasons.push('ambiguous-item-binding');
    if (requiresPositionalDisambiguation) reasons.push('positional-disambiguation-required');
  } else {
    reasons.push('missing-option-panel-proof');
  }

  if (hasCompleteTriggerBinding) {
    score += 2;
    reasons.push('trigger-linked');
  }
  if (proof?.triggerBlockedReason) {
    score -= 8;
    reasons.push(`trigger-blocked:${proof.triggerBlockedReason}`);
  }
  if (proof?.usedCanonicalTarget === true) {
    reasons.push('canonical-target-used');
  }
  if (proof?.blockedReason) {
    score -= 16;
    reasons.push(`blocked:${proof.blockedReason}`);
  }
  if (requiresPositionalDisambiguation) {
    score -= 18;
  }

  let tier = 'fallback';
  if (requiresPositionalDisambiguation) tier = 'last-resort';
  else if (score >= 80) tier = 'preferred';
  else if (score < 50) tier = 'last-resort';

  return {
    path: 'option-panel-context',
    tier,
    score,
    reasons,
    summary: summarizeOptionPanelProof(proof),
  };
}

function classifyTableRowProof(proof) {
  const reasons = [];
  let score = 16;

  const hasScopedRowAction = !!proof?.rowScopedActionSelector;
  const hasUniqueTableBinding = proof?.uniqueTableBinding === true;
  const hasUniqueRowBinding = proof?.uniqueRowBinding === true;
  const hasUniqueActionBinding = proof?.uniqueActionBinding === true;
  const requiresPositionalDisambiguation = proof?.requiresPositionalDisambiguation === true;

  if (
    proof?.isValid === true
    && hasScopedRowAction
    && hasUniqueTableBinding
    && hasUniqueRowBinding
    && hasUniqueActionBinding
    && !requiresPositionalDisambiguation
    && !proof?.blockedReason
  ) {
    score = 90;
    reasons.push('valid-table-row-proof');
    reasons.push('unique-table-binding');
    reasons.push('unique-row-binding');
    reasons.push('unique-action-binding');
  } else if (proof?.blockedReason) {
    score = 24;
    reasons.push('blocked-table-row-proof');
  } else if (proof?.tableSelector && (proof?.actionSelector || proof?.actionName)) {
    score = 72;
    reasons.push('partial-table-row-proof');
    if (!hasUniqueTableBinding) reasons.push('incomplete-table-binding');
    if (!hasUniqueRowBinding) reasons.push('ambiguous-row-binding');
    if (!hasUniqueActionBinding) reasons.push('ambiguous-action-binding');
    if (requiresPositionalDisambiguation) reasons.push('positional-disambiguation-required');
  } else {
    reasons.push('missing-table-row-proof');
  }

  if (proof?.usedCanonicalTarget === true) {
    reasons.push('canonical-target-used');
  }
  if (proof?.blockedReason) {
    score -= 16;
    reasons.push(`blocked:${proof.blockedReason}`);
  }
  if (requiresPositionalDisambiguation) {
    score -= 18;
  }

  let tier = 'fallback';
  if (requiresPositionalDisambiguation) tier = 'last-resort';
  else if (score >= 80) tier = 'preferred';
  else if (score < 50) tier = 'last-resort';

  return {
    path: 'table-row-context',
    tier,
    score,
    reasons,
    summary: summarizeTableRowProof(proof),
  };
}

function buildTierCounts(entries) {
  return entries.reduce((counts, entry) => {
    const tier = entry?.tier || 'fallback';
    counts[tier] = (counts[tier] || 0) + 1;
    return counts;
  }, {
    preferred: 0,
    fallback: 0,
    'last-resort': 0,
  });
}

function sortByScoreDescending(left, right) {
  if ((right?.score || 0) !== (left?.score || 0)) return (right?.score || 0) - (left?.score || 0);
  return String(left?.selector || left?.path || '').localeCompare(String(right?.selector || right?.path || ''));
}

const TEXT_ONLY_SELECTOR_FAMILIES = new Set([
  'text',
  'parent-scoped-text-css',
  'xpath-text',
]);

const REPLAY_SAFE_TRIGGER_CONTROL_FAMILIES = new Set([
  'test-id',
  'id',
  'name',
  'aria-label',
  'placeholder',
  'href',
  'title',
  'alt',
  'value',
  'compound-attributes',
  'tight-container-css',
  'parent-scoped-css',
  'class',
]);

const PREFERENCE_DANGEROUS_WARNINGS = new Set([
  'target-not-in-matches',
  'blocked-text-evaluation',
  'multiple-matches',
  'multiple-visible-matches',
  'too-many-matches-for-visible-index',
  'incomplete-trigger-binding',
]);

function isCustomControlOpenEvent(eventContext) {
  return eventContext?.eventType === 'custom-control-open';
}

function hasPreferenceDangerousWarnings(entry) {
  return Array.isArray(entry?.warningCodes)
    && entry.warningCodes.some((warningCode) => PREFERENCE_DANGEROUS_WARNINGS.has(warningCode));
}

function isReplaySafeTriggerControlSelector(entry) {
  return !!entry
    && REPLAY_SAFE_TRIGGER_CONTROL_FAMILIES.has(entry.family)
    && entry.matchCount === 1
    && entry.visibleMatchCount === 1
    && !hasPreferenceDangerousWarnings(entry);
}

function resolveTierForSelectorChoice(entry, score) {
  if (
    entry?.usesIndex === true
    || entry?.requiresPositionalDisambiguation === true
    || Array.isArray(entry?.warningCodes) && entry.warningCodes.includes('positional-fallback-only')
  ) {
    return 'last-resort';
  }
  if (score >= 80) return 'preferred';
  if (score < 50) return 'last-resort';
  return 'fallback';
}

function applyCustomControlOpenSelectorPolicy(selectorChoices, eventContext) {
  if (!isCustomControlOpenEvent(eventContext)) {
    return selectorChoices;
  }

  const hasReplaySafeTriggerControl = selectorChoices.some(isReplaySafeTriggerControlSelector);
  if (!hasReplaySafeTriggerControl) {
    return selectorChoices;
  }

  return selectorChoices
    .map((entry) => {
      if (!TEXT_ONLY_SELECTOR_FAMILIES.has(entry.family)) {
        return entry;
      }

      const adjustedScore = entry.score - 18;
      return {
        ...entry,
        score: adjustedScore,
        tier: resolveTierForSelectorChoice(entry, adjustedScore),
        reasons: [...(Array.isArray(entry.reasons) ? entry.reasons : []), 'demoted-display-text-for-custom-control-open'],
      };
    })
    .sort(sortByScoreDescending);
}

function mergeSelectorInputs(candidates, proposalCandidates) {
  const seen = new Set();
  const merged = [];

  for (const candidate of [...(Array.isArray(candidates) ? candidates : []), ...(Array.isArray(proposalCandidates) ? proposalCandidates : [])]) {
    if (!candidate || typeof candidate.selector !== 'string') continue;
    const selector = candidate.selector.trim();
    if (!selector) continue;
    const key = `${candidate.engine || 'css'}::${candidate.family || 'unknown'}::${selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }

  return merged;
}

export function buildSelectorPreferenceShadow({
  candidates = [],
  proposalCandidates = [],
  eventContext,
  boundedFieldContextEvidence,
  labelContextEvidence,
  accessibilityEvidence,
  boundedFieldShadowExposure,
  optionPanelContextEvidence,
  tableRowContextEvidence,
} = {}) {
  const selectorChoices = applyCustomControlOpenSelectorPolicy(mergeSelectorInputs(candidates, proposalCandidates)
    .map(classifySelectorCandidatePreference)
    .sort(sortByScoreDescending), eventContext);

  const proofChoices = [
    classifyBoundedFieldProof(boundedFieldContextEvidence, boundedFieldShadowExposure),
    classifyLabelProof(labelContextEvidence),
    classifyAccessibilityProof(accessibilityEvidence),
    classifyOptionPanelProof(optionPanelContextEvidence),
    classifyTableRowProof(tableRowContextEvidence),
  ].sort(sortByScoreDescending);

  return {
    selectorChoices,
    proofChoices,
    selectorTierCounts: buildTierCounts(selectorChoices),
    proofTierCounts: buildTierCounts(proofChoices),
    bestSelector: selectorChoices[0] || null,
    bestProof: proofChoices[0] || null,
  };
}
