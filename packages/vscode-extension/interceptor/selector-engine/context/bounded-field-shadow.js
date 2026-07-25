import { compareBoundedFieldContextEvidence } from './bounded-field-parity.js';

const SELECTOR_FORMAT_FIELDS = new Set([
  'boundedContainerSelectorCandidates',
  'cleanParentSelector',
  'containerSelector',
]);

const LEGACY_CONTAINER_METADATA_FIELDS = new Set([
  'visibleControlCountInContainer',
  'containerSelector',
  'competingControlCount',
]);

function stripSimpleTagPrefix(selector) {
  if (typeof selector !== 'string') return selector ?? null;
  return selector.replace(/^[a-z][a-z0-9-]*/i, '');
}

function areSelectorCandidatesFormatEquivalent(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((candidate, index) => {
    const other = right[index];
    if (!candidate || !other) return false;
    return (
      stripSimpleTagPrefix(candidate.selector) === stripSimpleTagPrefix(other.selector)
      && (candidate.kind || null) === (other.kind || null)
      && candidate.isClean === other.isClean
    );
  });
}

function isSelectorFormatDrift(field, legacyValue, modularValue) {
  if (!SELECTOR_FORMAT_FIELDS.has(field)) return false;
  if (field === 'boundedContainerSelectorCandidates') {
    return areSelectorCandidatesFormatEquivalent(legacyValue, modularValue);
  }
  return stripSimpleTagPrefix(legacyValue) === stripSimpleTagPrefix(modularValue);
}

function pruneEmptyValues(summary) {
  const compact = {};
  for (const [key, value] of Object.entries(summary || {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    compact[key] = value;
  }
  return compact;
}

function deriveMismatchReason(entry) {
  const { field, status, legacyValue, modularValue } = entry || {};

  if (status === 'match') return 'match';
  if (isSelectorFormatDrift(field, legacyValue, modularValue)) return 'selector-format-drift';
  if (field === 'cleanChildSelector' && status === 'mismatch') return 'canonical-child-binding';
  if (status === 'legacy-only' && LEGACY_CONTAINER_METADATA_FIELDS.has(field)) {
    return 'legacy-container-metadata-missing';
  }
  if (status === 'modular-only') return 'modular-enrichment';
  if (status === 'legacy-only') return 'legacy-only-proof';
  return 'value-mismatch';
}

function summarizeMismatch(entry) {
  return {
    field: entry.field,
    status: entry.status,
    reason: deriveMismatchReason(entry),
    legacyValue: entry.legacyValue,
    modularValue: entry.modularValue,
  };
}

function buildMismatchReasonCounts(mismatchReasons) {
  return mismatchReasons.reduce((counts, entry) => {
    const key = entry.reason || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function buildBoundedFieldShadowExposure({
  legacyContext,
  modularContext,
  parityResult,
} = {}) {
  const parity = parityResult || compareBoundedFieldContextEvidence({
    legacyContext,
    modularContext,
  });

  const mismatchReasons = parity.mismatches.map(summarizeMismatch);
  const matchedFields = Array.isArray(parity.matchedFields) ? parity.matchedFields.slice() : [];
  const mismatchedFields = mismatchReasons.map((entry) => entry.field);

  return {
    parityStatus: parity.parityStatus,
    isExactMatch: parity.isExactMatch,
    matchCount: parity.matchCount,
    mismatchCount: parity.mismatchCount,
    matchedFields,
    mismatchedFields,
    mismatchReasons,
    mismatchReasonCounts: buildMismatchReasonCounts(mismatchReasons),
    legacySummary: pruneEmptyValues(parity.legacy),
    modularSummary: pruneEmptyValues(parity.modular),
  };
}

