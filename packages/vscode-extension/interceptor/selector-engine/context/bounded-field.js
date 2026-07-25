import { resolveAccessibilityEvidence } from '../accessibility/role-name.js';
import { resolveLabelContextEvidence } from './labels.js';

const ACCESSIBILITY_LABEL_SOURCES = new Set([
  'label-for',
  'wrapped-label',
  'aria-labelledby',
]);

function normalizeFieldRelation(relation, accessibilitySource) {
  switch (relation) {
    case 'label-for':
    case 'wrapped-label':
    case 'aria-labelledby':
    case 'sibling-label':
    case 'bounded-container':
      return relation;
    default:
      if (ACCESSIBILITY_LABEL_SOURCES.has(accessibilitySource)) {
        return accessibilitySource;
      }
      return null;
  }
}

function inferControlKindFromRole(role) {
  switch (role) {
    case 'combobox':
      return 'combobox';
    case 'searchbox':
      return 'searchbox';
    case 'textbox':
      return 'input';
    default:
      return null;
  }
}

function normalizeBlockedReason({
  blockedReason,
  fieldLabelText,
  targetControlKind,
}) {
  if (blockedReason === 'bounded-field-duplicate-label') return blockedReason;
  if (blockedReason === 'bounded-field-multiple-targets') return blockedReason;
  if (blockedReason === 'bounded-field-broad-container') return blockedReason;
  if (blockedReason === 'bounded-field-no-renderable-scope') return blockedReason;
  if (blockedReason === 'bounded-field-target-binding-failed') return blockedReason;
  if (blockedReason === 'detached-target') return blockedReason;

  if (!targetControlKind) return 'bounded-field-target-binding-failed';
  if (!fieldLabelText) return 'bounded-field-no-label';
  return 'bounded-field-target-binding-failed';
}

function normalizeContainerCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
  const normalized = candidates
    .filter((candidate) => candidate && typeof candidate.selector === 'string')
    .map((candidate) => ({
      selector: candidate.selector,
      kind: typeof candidate.kind === 'string' && candidate.kind.trim()
        ? candidate.kind.trim()
        : 'unknown',
      isClean: candidate.isClean === true,
    }));
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveBoundedFieldContextEvidence({
  element,
  selectorResult,
  eventContext,
  labelContextEvidence,
  accessibilityEvidence,
} = {}) {
  const labelProof = labelContextEvidence || resolveLabelContextEvidence({
    element,
    selectorResult,
    eventContext,
  });
  const accessibilityProof = accessibilityEvidence || resolveAccessibilityEvidence({
    element,
    eventContext,
  });

  const targetControlKind =
    labelProof?.targetControlKind
    || inferControlKindFromRole(accessibilityProof?.role)
    || null;
  const fieldLabelText = labelProof?.fieldLabelText
    || (ACCESSIBILITY_LABEL_SOURCES.has(accessibilityProof?.accessibleNameSource)
      ? accessibilityProof?.accessibleName
      : null)
    || null;
  const fieldRelation = normalizeFieldRelation(
    labelProof?.fieldRelation,
    accessibilityProof?.accessibleNameSource,
  );
  const isValid = labelProof?.isValid === true && !!fieldLabelText && !!targetControlKind;
  const blockedReason = isValid
    ? null
    : normalizeBlockedReason({
      blockedReason: labelProof?.blockedReason || null,
      fieldLabelText,
      targetControlKind,
    });

  return {
    rawTargetSummary: labelProof?.rawTargetSummary || accessibilityProof?.rawTargetSummary || null,
    effectiveTargetSummary: labelProof?.effectiveTargetSummary || accessibilityProof?.effectiveTargetSummary || null,
    proofTargetSummary: accessibilityProof?.proofTargetSummary || labelProof?.effectiveTargetSummary || null,
    usedCanonicalTarget:
      labelProof?.usedCanonicalTarget === true || accessibilityProof?.usedCanonicalTarget === true,
    fieldLabelText,
    fieldRelation,
    targetControlKind,
    visibleControlCountInContainer: labelProof?.visibleControlCountInContainer ?? null,
    targetIndexWithinContainer: labelProof?.targetIndexWithinContainer ?? null,
    boundedContainerSummary: labelProof?.boundedContainerSummary || null,
    boundedContainerSelectorCandidates: normalizeContainerCandidates(labelProof?.boundedContainerSelectorCandidates),
    cleanParentSelector: labelProof?.cleanParentSelector || null,
    cleanChildSelector: labelProof?.cleanChildSelector || null,
    containerSelector: labelProof?.containerSelector || null,
    competingControlCount: labelProof?.competingControlCount ?? null,
    duplicateLabelCount: labelProof?.duplicateLabelCount ?? null,
    isValid,
    blockedReason,
    accessibilityRole: accessibilityProof?.role || null,
    accessibilityName: accessibilityProof?.accessibleName || null,
    accessibilityNameSource: accessibilityProof?.accessibleNameSource || 'none',
  };
}
