import { DEFAULT_MAX_CANDIDATES } from '../types.js';
import { finalizeCandidates } from '../evaluation.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import { resolveBoundedFieldContextEvidence } from './bounded-field.js';

function buildScopedSelector(parentSelector, childSelector) {
  const parent = typeof parentSelector === 'string' ? parentSelector.trim() : '';
  const child = typeof childSelector === 'string' ? childSelector.trim() : '';
  if (!parent || !child) return null;
  return `${parent} ${child}`;
}

function resolveProposalTarget(element, eventContext, boundedFieldContextEvidence, canonicalTargetInfo) {
  if (boundedFieldContextEvidence?.usedCanonicalTarget !== true) return element || null;
  const resolvedCanonicalTargetInfo = canonicalTargetInfo?.canonicalTarget
    ? canonicalTargetInfo
    : resolveCanonicalCustomControlTargetInternal(element, eventContext);
  return resolvedCanonicalTargetInfo?.canonicalTarget || element || null;
}

function normalizeBlockedReason(proof, scopeSelector, childSelector) {
  if (proof?.blockedReason) return proof.blockedReason;
  if (!childSelector) return 'bounded-field-target-binding-failed';
  if (!scopeSelector) return 'bounded-field-no-renderable-scope';
  return null;
}

function buildProposalInputs(scopeSelector, childSelector, queryTarget) {
  const scopedSelector = buildScopedSelector(scopeSelector, childSelector);
  if (!scopedSelector) return [];

  return [{
    selector: scopedSelector,
    family: 'parent-scoped-css',
    engine: 'css',
    proposalSource: 'bounded-field',
    queryTarget,
    warningCodes: [],
  }];
}

export function collectBoundedFieldSelectorProposals({
  element,
  selectorResult,
  eventContext,
  boundedFieldContextEvidence,
  canonicalTargetInfo,
  maxCandidates = DEFAULT_MAX_CANDIDATES,
} = {}) {
  const proof = boundedFieldContextEvidence || resolveBoundedFieldContextEvidence({
    element,
    selectorResult,
    eventContext,
  });
  const scopeSelector = proof?.cleanParentSelector || null;
  const childSelector = proof?.cleanChildSelector || null;
  const blockedReason = normalizeBlockedReason(proof, scopeSelector, childSelector);
  const queryTarget = resolveProposalTarget(
    element,
    eventContext,
    proof,
    canonicalTargetInfo,
  );

  if (!proof?.isValid || blockedReason) {
    return {
      fieldLabelText: proof?.fieldLabelText || null,
      fieldRelation: proof?.fieldRelation || null,
      targetControlKind: proof?.targetControlKind || null,
      usedCanonicalTarget: proof?.usedCanonicalTarget === true,
      scopeSelector,
      childSelector,
      blockedReason,
      proposals: [],
    };
  }

  const proposals = finalizeCandidates(
    element,
    buildProposalInputs(scopeSelector, childSelector, queryTarget),
    maxCandidates,
  );

  return {
    fieldLabelText: proof?.fieldLabelText || null,
    fieldRelation: proof?.fieldRelation || null,
    targetControlKind: proof?.targetControlKind || null,
    usedCanonicalTarget: proof?.usedCanonicalTarget === true,
    scopeSelector,
    childSelector,
    blockedReason: proposals.length > 0 ? null : 'bounded-field-no-renderable-scope',
    proposals,
  };
}
