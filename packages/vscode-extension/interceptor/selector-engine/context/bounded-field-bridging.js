import { DEFAULT_MAX_CANDIDATES } from '../types.js';
import { finalizeCandidates } from '../evaluation.js';
import { resolveCanonicalCustomControlTargetInternal } from '../canonical-target.js';
import { buildProposalCandidateInput } from '../proposal-contract.js';
import {
  getSafeClassTokens,
  isLikelyDynamicId,
  safeTrim,
} from '../utils.js';
import { getBestStableClassToken } from '../shared/dom-attributes.js';
import { buildScopedSelector } from '../shared/selectors.js';
import { resolveBoundedFieldContextEvidence } from './bounded-field.js';

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

function escapeXPathLiteral(value) {
  const normalized = safeTrim(value);
  if (!normalized.includes('"')) return `"${normalized}"`;
  if (!normalized.includes('\'')) return `'${normalized}'`;
  const parts = normalized.split('"');
  const tokens = [];
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]) tokens.push(`"${parts[index]}"`);
    if (index < parts.length - 1) tokens.push('\'"\'');
  }
  return `concat(${tokens.join(', ')})`;
}

function buildClassPredicate(classToken) {
  const normalized = safeTrim(classToken);
  if (!normalized) return null;
  const tokenWithPadding = ` ${normalized} `
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
  return `contains(concat(" ", normalize-space(@class), " "), "${tokenWithPadding}")`;
}



function buildElementXPath(element, { allowDescendant = false } = {}) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
  const tagName = element.tagName?.toLowerCase?.() || '*';
  const predicates = [];

  for (const attrName of ['data-testid', 'data-cy', 'data-qa']) {
    const attrValue = safeTrim(element.getAttribute?.(attrName) || '');
    if (attrValue) {
      predicates.push(`@${attrName}=${escapeXPathLiteral(attrValue)}`);
      break;
    }
  }

  if (predicates.length === 0 && element.id && !isLikelyDynamicId(element.id)) {
    predicates.push(`@id=${escapeXPathLiteral(element.id)}`);
  }

  const role = safeTrim(element.getAttribute?.('role') || '');
  if (role) predicates.push(`@role=${escapeXPathLiteral(role)}`);

  const href = safeTrim(element.getAttribute?.('href') || '');
  if (href && tagName === 'a') predicates.push(`@href=${escapeXPathLiteral(href)}`);

  const type = safeTrim(element.getAttribute?.('type') || '');
  if (type && tagName === 'input') predicates.push(`@type=${escapeXPathLiteral(type)}`);

  const ariaHasPopup = safeTrim(element.getAttribute?.('aria-haspopup') || '');
  if (ariaHasPopup) predicates.push(`@aria-haspopup=${escapeXPathLiteral(ariaHasPopup)}`);

  if (predicates.length === 0) {
    const classToken = getBestStableClassToken(element);
    if (classToken) predicates.push(buildClassPredicate(classToken));
  }

  const axis = '//';
  if (predicates.length === 0) return `${axis}${tagName}`;
  return `${axis}${tagName}[${predicates.join(' and ')}]`;
}

function buildLabelAnchoredCustomTriggerXPath(proof, queryTarget) {
  const labelText = safeTrim(proof?.fieldLabelText || '');
  const scopeSelector = safeTrim(proof?.cleanParentSelector || proof?.containerSelector || '');
  if (!labelText || proof?.targetControlKind !== 'custom-trigger' || !scopeSelector || !queryTarget?.closest) {
    return null;
  }

  let containerElement = null;
  try {
    containerElement = queryTarget.closest(scopeSelector);
  } catch {
    containerElement = null;
  }
  if (!containerElement) return null;

  const containerXPath = buildElementXPath(containerElement);
  const targetXPath = buildElementXPath(queryTarget, { allowDescendant: true });
  if (!containerXPath || !targetXPath) return null;

  const labelPredicate = `.//*[normalize-space(.)=${escapeXPathLiteral(labelText)}]`;
  return `${containerXPath}[${labelPredicate}]${targetXPath}`;
}

function buildProposalInputs(proof, scopeSelector, childSelector, queryTarget) {
  const scopedSelector = buildScopedSelector(scopeSelector, childSelector);
  const candidates = [];

  if (scopedSelector) {
    const scopedCandidate = buildProposalCandidateInput({
      selector: scopedSelector,
      family: 'parent-scoped-css',
      proposalSource: 'bounded-field',
      queryTarget,
      proposalTierHint: proof?.targetControlKind === 'custom-trigger' ? 'fallback' : null,
      warningCodes: [],
    });
    if (scopedCandidate) candidates.push(scopedCandidate);
  }

  const labelAnchoredXPath = buildLabelAnchoredCustomTriggerXPath(proof, queryTarget);
  if (labelAnchoredXPath) {
    const xpathCandidate = buildProposalCandidateInput({
      selector: labelAnchoredXPath,
      family: 'xpath',
      engine: 'xpath',
      proposalSource: 'bounded-field',
      queryTarget,
      proposalTierHint: 'fallback',
      warningCodes: ['label-anchored-trigger-scope'],
    });
    if (xpathCandidate) candidates.push(xpathCandidate);
  }

  return candidates;
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
  const queryTarget = resolveProposalTarget(
    element,
    eventContext,
    proof,
    canonicalTargetInfo,
  );
  const proposalInputs = buildProposalInputs(proof, scopeSelector, childSelector, queryTarget);
  const blockedReason = normalizeBlockedReason(proof, scopeSelector, childSelector);

  if (!proof?.isValid || (blockedReason && proposalInputs.length === 0)) {
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
    proposalInputs,
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
