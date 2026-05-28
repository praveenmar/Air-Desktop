import { DEFAULT_MAX_CANDIDATES } from '../types.js';
import { finalizeCandidates } from '../evaluation.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import {
  buildProposalCandidateInput,
  buildScopedSelector,
  buildScopedTextSelector,
} from '../proposal-contract.js';
import {
  buildAttributeSelector,
  getSafeClassTokens,
  isLikelyDynamicId,
  normalizeText,
  safeCssEscape,
  safeTrim,
} from '../utils.js';
import { resolveOptionPanelContextEvidence } from './option-panel.js';

const ACTIONABLE_DESCENDANT_SELECTOR = [
  'a[href]',
  'button',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="link"]',
  '[role="button"]',
].join(', ');

function resolveProposalTarget(element, eventContext, optionPanelContextEvidence, canonicalTargetInfo) {
  if (optionPanelContextEvidence?.usedCanonicalTarget !== true) return element || null;
  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(element, eventContext);
  return resolvedCanonicalTargetInfo?.canonicalTarget || element || null;
}

function isFastVisible(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  if (element.isConnected === false) return false;
  if (element.hidden) return false;
  if (element.getAttribute?.('aria-hidden') === 'true') return false;
  const inlineStyle = element.style || null;
  if (inlineStyle && (inlineStyle.display === 'none' || inlineStyle.visibility === 'hidden')) {
    return false;
  }
  return true;
}

function normalizeLabelText(value) {
  const normalized = normalizeText(value)
    .replace(/[:*]\s*$/, '')
    .trim();
  return normalized || null;
}

function getBestStableClassToken(element) {
  const tokens = getSafeClassTokens(element)
    .filter((token) => !/^(?:is|has)-/i.test(token))
    .filter((token) => !/^(?:css-|sc-)/i.test(token))
    .filter((token) => token.length >= 4)
    .sort((left, right) => left.length - right.length);
  return tokens[0] || null;
}

function buildDescendantSelector(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = element.tagName?.toLowerCase?.() || '';
  if (!tagName) return null;

  for (const attrName of ['data-testid', 'data-cy', 'data-qa']) {
    const selector = buildAttributeSelector(tagName, attrName, element.getAttribute(attrName));
    if (selector) return selector;
  }

  if (element.id && !isLikelyDynamicId(element.id)) {
    return `#${safeCssEscape(element.id)}`;
  }

  if (tagName === 'a') {
    const hrefSelector = buildAttributeSelector(tagName, 'href', element.getAttribute('href'));
    if (hrefSelector) return hrefSelector;
  }

  const role = safeTrim(element.getAttribute?.('role') || '');
  if (role) return `${tagName}[role="${role.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;

  const classToken = getBestStableClassToken(element);
  if (classToken) return `${tagName}.${safeCssEscape(classToken)}`;

  return tagName;
}

function isMenuLikeProof(proof) {
  return proof?.containerRole === 'menu'
    || proof?.itemRole === 'menuitem'
    || proof?.itemRole === 'menuitemradio'
    || proof?.itemRole === 'menuitemcheckbox';
}

function findUniqueActionableDescendant(rawElement, proof) {
  if (!rawElement || rawElement.nodeType !== Node.ELEMENT_NODE) return null;
  if (isMenuLikeProof(proof) !== true) return null;
  if (typeof rawElement.matches === 'function' && rawElement.matches(ACTIONABLE_DESCENDANT_SELECTOR)) {
    return null;
  }

  let descendants = [];
  try {
    descendants = Array.from(rawElement.querySelectorAll(ACTIONABLE_DESCENDANT_SELECTOR)).filter(isFastVisible);
  } catch {
    return null;
  }

  if (descendants.length === 0) return null;

  const targetText = normalizeLabelText(proof?.itemName || '');
  if (targetText) {
    const textMatched = descendants.filter((candidate) => normalizeLabelText(candidate.textContent || '') === targetText);
    if (textMatched.length === 1) return textMatched[0];
    if (textMatched.length > 1) return null;
  }

  return descendants.length === 1 ? descendants[0] : null;
}

function hasCompleteTriggerBinding(proof) {
  return !!proof?.triggerSelector && !proof?.triggerBlockedReason;
}

function hasKnownTargetIndex(proof) {
  return Number.isInteger(proof?.targetIndexWithinContainer) && proof.targetIndexWithinContainer >= 0;
}

function canEmitStructuralProposal(proof) {
  return !!proof?.scopedItemSelector && proof?.itemSelectorMatchCountInContainer === 1;
}

function canEmitScopedTextProposal(proof) {
  return !!proof?.itemName && !!(proof?.scopedTextSelector || proof?.scopedItemSelector);
}

function canEmitPositionalProposal(proof) {
  return proof?.requiresPositionalDisambiguation === true
    && proof?.uniquePanelBinding === true
    && hasKnownTargetIndex(proof)
    && !!proof?.containerSelector
    && !!proof?.itemSelector;
}

function buildPositionalItemSelector(proof) {
  if (!canEmitPositionalProposal(proof)) return null;
  const positionalChildSelector = `${proof.itemSelector}:nth-of-type(${proof.targetIndexWithinContainer + 1})`;
  return buildScopedSelector(proof.containerSelector, positionalChildSelector);
}

function resolveProposalMode(proof) {
  if (!proof?.isValid) return { blockedReason: proof?.blockedReason || 'option-panel-invalid-proof' };
  if (!proof?.containerSelector) return { blockedReason: 'option-panel-no-container-selector' };
  if (!proof?.itemSelector && !proof?.scopedTextSelector) {
    return { blockedReason: 'option-panel-no-item-selector' };
  }

  const completeTriggerBinding = hasCompleteTriggerBinding(proof);
  const uniquePanelBinding = proof?.uniquePanelBinding === true;
  const uniqueTargetBinding = proof?.uniqueTargetBinding === true;
  const positionalOnly = proof?.requiresPositionalDisambiguation === true;

  if (proof?.blockedReason === 'option-panel-multiple-panels') {
    return { blockedReason: 'option-panel-multiple-panels' };
  }
  if (proof?.blockedReason && proof.blockedReason !== 'option-panel-duplicate-option-text') {
    return { blockedReason: proof.blockedReason };
  }
  if (positionalOnly) {
    if (canEmitPositionalProposal(proof)) {
      return {
        mode: 'last-resort',
        completeTriggerBinding,
        uniquePanelBinding,
        uniqueTargetBinding,
      };
    }
    return { blockedReason: 'option-panel-duplicate-option-text' };
  }
  if (!uniquePanelBinding) {
    return { blockedReason: 'option-panel-incomplete-panel-binding' };
  }

  return {
    mode: completeTriggerBinding && uniqueTargetBinding ? 'preferred' : 'fallback',
    completeTriggerBinding,
    uniquePanelBinding,
    uniqueTargetBinding,
  };
}

function buildProposalInputs(proof, queryTarget, proposalMode) {
  const candidates = [];
  const completeTriggerBinding = proposalMode?.completeTriggerBinding === true;
  const tierHint = proposalMode?.mode === 'preferred'
    ? 'preferred'
    : (proposalMode?.mode === 'last-resort' ? 'last-resort' : 'fallback');
  const baseWarningCodes = [];

  if (!completeTriggerBinding) {
    baseWarningCodes.push('incomplete-trigger-binding');
  }
  if (proof?.uniqueTargetBinding !== true) {
    baseWarningCodes.push('ambiguous-item-binding');
  }
  if (proof?.uniquePanelBinding !== true) {
    baseWarningCodes.push('incomplete-panel-binding');
  }

  const actionableDescendant = findUniqueActionableDescendant(queryTarget, proof);
  const actionableDescendantSelector = actionableDescendant
    ? buildScopedSelector(proof?.containerSelector, buildDescendantSelector(actionableDescendant))
    : null;
  if (
    actionableDescendant
    && actionableDescendantSelector
    && proposalMode?.mode !== 'last-resort'
  ) {
    const descendantCandidate = buildProposalCandidateInput({
      selector: actionableDescendantSelector,
      family: 'parent-scoped-css',
      proposalSource: 'option-panel',
      queryTarget: actionableDescendant,
      proposalTierHint: tierHint,
      warningCodes: [...baseWarningCodes, 'actionable-descendant-bridge'],
    });
    if (descendantCandidate) candidates.push(descendantCandidate);
  }

  if (canEmitStructuralProposal(proof) && proposalMode?.mode !== 'last-resort') {
    const scopedStructuralCandidate = buildProposalCandidateInput({
      selector: proof.scopedItemSelector,
      family: 'parent-scoped-css',
      proposalSource: 'option-panel',
      queryTarget,
      proposalTierHint: tierHint,
      warningCodes: baseWarningCodes,
    });
    if (scopedStructuralCandidate) candidates.push(scopedStructuralCandidate);
  }

  const scopedTextSelector = proof?.scopedTextSelector
    || buildScopedTextSelector(proof?.scopedItemSelector || '', proof?.itemName || '');
  if (scopedTextSelector && canEmitScopedTextProposal(proof) && proof?.uniqueTargetBinding === true) {
    const scopedTextCandidate = buildProposalCandidateInput({
      selector: scopedTextSelector,
      family: 'text',
      proposalSource: 'option-panel',
      queryTarget,
      proposalTierHint: tierHint,
      warningCodes: baseWarningCodes,
      textQuery: {
        scopeSelector: proof.scopedItemSelector || proof.itemSelector || '',
        text: proof.itemName,
        matchMode: 'contains',
      },
    });
    if (scopedTextCandidate) candidates.push(scopedTextCandidate);
  }

  const positionalSelector = buildPositionalItemSelector(proof);
  if (positionalSelector && proposalMode?.mode === 'last-resort') {
    const positionalCandidate = buildProposalCandidateInput({
      selector: positionalSelector,
      family: 'parent-scoped-css',
      proposalSource: 'option-panel',
      queryTarget,
      proposalTierHint: 'last-resort',
      warningCodes: baseWarningCodes,
      usesIndex: true,
      requiresPositionalDisambiguation: true,
    });
    if (positionalCandidate) candidates.push(positionalCandidate);
  }

  return candidates;
}

export function collectOptionPanelSelectorProposals({
  element,
  eventContext,
  optionPanelContextEvidence,
  canonicalTargetInfo,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
} = {}) {
  const proof = optionPanelContextEvidence || resolveOptionPanelContextEvidence({
    element,
    eventContext,
    canonicalTargetInfo,
  });
  const proposalMode = resolveProposalMode(proof);
  const blockedReason = proposalMode?.blockedReason || null;
  const queryTarget = resolveProposalTarget(
    element,
    eventContext,
    proof,
    canonicalTargetInfo,
  );

  if (blockedReason) {
    return {
      itemRole: proof?.itemRole || null,
      itemName: proof?.itemName || null,
      containerRole: proof?.containerRole || null,
      containerSelector: proof?.containerSelector || null,
      itemSelector: proof?.itemSelector || null,
      scopedItemSelector: proof?.scopedItemSelector || null,
      scopedTextSelector: proof?.scopedTextSelector || null,
      usedCanonicalTarget: proof?.usedCanonicalTarget === true,
      blockedReason,
      proposals: [],
    };
  }

  const proposals = finalizeCandidates(
    element,
    buildProposalInputs(proof, queryTarget, proposalMode),
    maxCandidates,
  );

  return {
    itemRole: proof?.itemRole || null,
    itemName: proof?.itemName || null,
    containerRole: proof?.containerRole || null,
    containerSelector: proof?.containerSelector || null,
    itemSelector: proof?.itemSelector || null,
    scopedItemSelector: proof?.scopedItemSelector || null,
    scopedTextSelector: proof?.scopedTextSelector || null,
    usedCanonicalTarget: proof?.usedCanonicalTarget === true,
    blockedReason: proposals.length > 0 ? null : 'option-panel-no-renderable-scope',
    proposals,
  };
}
