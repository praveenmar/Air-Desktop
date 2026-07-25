import { safeTrim } from '../utils.js';

const PARITY_FIELDS = [
  'fieldLabelText',
  'fieldRelation',
  'targetControlKind',
  'visibleControlCountInContainer',
  'targetIndexWithinContainer',
  'boundedContainerSummary',
  'boundedContainerSelectorCandidates',
  'cleanParentSelector',
  'cleanChildSelector',
  'containerSelector',
  'competingControlCount',
  'duplicateLabelCount',
  'isValid',
  'blockedReason',
];

function normalizeSelectorCandidate(candidate) {
  if (!candidate || typeof candidate.selector !== 'string') return null;
  const selector = safeTrim(candidate.selector);
  if (!selector) return null;
  return {
    selector,
    kind: safeTrim(candidate.kind || '') || null,
    isClean: candidate.isClean === true,
  };
}

function normalizeSelectorCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const normalized = candidates
    .map(normalizeSelectorCandidate)
    .filter(Boolean)
    .sort((left, right) => {
      const leftKey = `${left.selector}::${left.kind || ''}::${left.isClean ? '1' : '0'}`;
      const rightKey = `${right.selector}::${right.kind || ''}::${right.isClean ? '1' : '0'}`;
      return leftKey.localeCompare(rightKey);
    });
  return normalized.length > 0 ? normalized : null;
}

function normalizeScalar(value) {
  if (typeof value === 'string') {
    const trimmed = safeTrim(value);
    return trimmed || null;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return value ?? null;
}

function isAbsent(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return safeTrim(value) === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function areEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function normalizeBoundedFieldContextForComparison(context) {
  const source = context && typeof context === 'object' ? context : {};
  return {
    fieldLabelText: normalizeScalar(source.fieldLabelText),
    fieldRelation: normalizeScalar(source.fieldRelation),
    targetControlKind: normalizeScalar(source.targetControlKind),
    visibleControlCountInContainer: normalizeScalar(source.visibleControlCountInContainer),
    targetIndexWithinContainer: normalizeScalar(source.targetIndexWithinContainer),
    boundedContainerSummary: normalizeScalar(source.boundedContainerSummary),
    boundedContainerSelectorCandidates: normalizeSelectorCandidates(source.boundedContainerSelectorCandidates),
    cleanParentSelector: normalizeScalar(source.cleanParentSelector),
    cleanChildSelector: normalizeScalar(source.cleanChildSelector),
    containerSelector: normalizeScalar(source.containerSelector),
    competingControlCount: normalizeScalar(source.competingControlCount),
    duplicateLabelCount: normalizeScalar(source.duplicateLabelCount),
    isValid: typeof source.isValid === 'boolean' ? source.isValid : null,
    blockedReason: normalizeScalar(source.blockedReason),
  };
}

function compareField(field, legacyValue, modularValue) {
  if (areEqual(legacyValue, modularValue)) {
    return {
      field,
      status: 'match',
      legacyValue,
      modularValue,
    };
  }

  if (isAbsent(legacyValue) && !isAbsent(modularValue)) {
    return {
      field,
      status: 'modular-only',
      legacyValue,
      modularValue,
    };
  }

  if (!isAbsent(legacyValue) && isAbsent(modularValue)) {
    return {
      field,
      status: 'legacy-only',
      legacyValue,
      modularValue,
    };
  }

  return {
    field,
    status: 'mismatch',
    legacyValue,
    modularValue,
  };
}

export function compareBoundedFieldContextEvidence({
  legacyContext,
  modularContext,
} = {}) {
  const legacy = normalizeBoundedFieldContextForComparison(legacyContext);
  const modular = normalizeBoundedFieldContextForComparison(modularContext);
  const comparisons = PARITY_FIELDS.map((field) => compareField(field, legacy[field], modular[field]));
  const matchedFields = comparisons
    .filter((entry) => entry.status === 'match')
    .map((entry) => entry.field);
  const mismatches = comparisons.filter((entry) => entry.status !== 'match');

  let parityStatus = 'exact-match';
  if (mismatches.length > 0 && matchedFields.length === 0) {
    parityStatus = 'no-match';
  } else if (mismatches.length > 0) {
    parityStatus = 'partial-match';
  }

  return {
    legacy,
    modular,
    comparisons,
    matchedFields,
    mismatches,
    matchCount: matchedFields.length,
    mismatchCount: mismatches.length,
    parityStatus,
    isExactMatch: mismatches.length === 0,
  };
}

