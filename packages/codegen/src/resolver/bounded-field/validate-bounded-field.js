"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateBoundedFieldSelectorSpec = validateBoundedFieldSelectorSpec;
exports.toCandidateValidation = toCandidateValidation;
const find_bounded_field_1 = require("./find-bounded-field");
function rejectResult(reason) {
    return {
        totalMatchCount: 0,
        visibleMatchCount: 0,
        effectiveMatchCount: 0,
        reason: 'no-visible-match',
        confidenceScore: 0,
        rejectReason: reason ?? null,
    };
}
function validateBoundedFieldSelectorSpec(spec, snapshot, _context = {}) {
    const recordedBoundedField = spec.boundedField.source === 'recorded-bounded-field'
        ? spec.boundedField
        : null;
    const proof = (0, find_bounded_field_1.findBoundedFieldProof)(snapshot, {
        labelText: spec.boundedField.labelText,
        target: spec.boundedField.target,
        controlKind: spec.boundedField.controlKind,
        relation: spec.boundedField.relation,
        originalSelector: spec.boundedField.originalSelector,
        snapshotSource: spec.boundedField.snapshotSource,
    });
    if (!proof.match) {
        if (recordedBoundedField &&
            recordedBoundedField.recordedValidity &&
            recordedBoundedField.cleanChildSelector &&
            (recordedBoundedField.cleanParentSelector || recordedBoundedField.containerSelector)) {
            return {
                totalMatchCount: 1,
                visibleMatchCount: 1,
                effectiveMatchCount: 1,
                reason: 'unique-visible',
                matchCount: 1,
                confidenceScore: 0.82,
                resolvedElement: null,
                proofSummary: `recorded:${recordedBoundedField.relation}:${recordedBoundedField.renderReason || 'recorded_bounded_field'}`,
                matchedContainerSummary: recordedBoundedField.boundedContainerSummary ?? null,
                warningCodes: Array.from(new Set([
                    ...(recordedBoundedField.warningCodes ?? []),
                    'recorded-bounded-field-proof',
                ])),
                rejectReason: null,
            };
        }
        return rejectResult(proof.rejectReason);
    }
    return {
        totalMatchCount: 1,
        visibleMatchCount: 1,
        effectiveMatchCount: 1,
        reason: 'unique-visible',
        matchCount: 1,
        confidenceScore: 1,
        resolvedElement: proof.match.targetElement,
        proofSummary: `${proof.match.relation}:${proof.match.renderReason}`,
        matchedContainerSummary: proof.match.boundedContainerSummary ?? null,
        warningCodes: proof.match.warningCodes ?? [],
        rejectReason: null,
    };
}
function toCandidateValidation(validation) {
    return {
        totalMatchCount: validation.totalMatchCount,
        visibleMatchCount: validation.visibleMatchCount,
        effectiveMatchCount: validation.effectiveMatchCount,
        reason: validation.reason,
        matchCount: validation.matchCount,
        confidenceScore: validation.confidenceScore,
        ambiguityReason: validation.ambiguityReason,
        resolvedElement: validation.resolvedElement,
    };
}
