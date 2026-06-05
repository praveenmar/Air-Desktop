"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWeakBoundedFieldInputCandidate = isWeakBoundedFieldInputCandidate;
exports.buildBoundedFieldCandidates = buildBoundedFieldCandidates;
exports.diagnoseBoundedFieldInputCandidate = diagnoseBoundedFieldInputCandidate;
exports.buildBoundedFieldTriggerCandidates = buildBoundedFieldTriggerCandidates;
const selector_spec_1 = require("../../selector-spec");
const text_matching_1 = require("../text-matching");
const visibility_1 = require("../visibility");
const find_bounded_field_1 = require("./find-bounded-field");
const structured_selector_utils_1 = require("../structured-selector-utils");
function getCapturedBoundedFieldContext(step, useTrigger = false) {
    const fingerprint = useTrigger
        ? (step.triggerFingerprint ?? step.fingerprint)
        : step.fingerprint;
    const context = fingerprint?.boundedFieldContext;
    return context && typeof context === 'object' ? context : null;
}
function getFieldLabelText(step) {
    const captured = getCapturedBoundedFieldContext(step);
    const capturedLabel = captured?.fieldLabelText;
    if (typeof capturedLabel === 'string' && capturedLabel.trim().length > 0) {
        return capturedLabel.trim();
    }
    const attrs = (0, text_matching_1.inferStepSignalAttributes)(step);
    const value = attrs.fieldLabelText
        || attrs.associatedLabelText
        || attrs.wrappedLabelText
        || attrs.labelledByText;
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}
function getCapturedControlKind(step, useTrigger = false) {
    const captured = getCapturedBoundedFieldContext(step, useTrigger);
    const kind = captured?.targetControlKind;
    return typeof kind === 'string' ? kind : null;
}
function hasStrongDirectSelectorEvidence(step) {
    const priority = step.selectorPriority;
    if (priority === 'data-testid' ||
        priority === 'id' ||
        priority === 'attribute' ||
        priority === 'text') {
        return true;
    }
    const attrs = (0, text_matching_1.inferStepSignalAttributes)(step);
    return !!(attrs.dataTestId ||
        attrs.dataCy ||
        attrs.dataQa ||
        attrs.id ||
        attrs.name ||
        attrs.placeholder ||
        attrs.ariaLabel ||
        attrs.href);
}
function isWeakPriority(priority) {
    return priority === 'class' || priority === 'path' || priority === 'unknown' || priority === 'other';
}
function inferInputControlKind(step) {
    const capturedKind = getCapturedControlKind(step);
    if (capturedKind)
        return capturedKind;
    const attrs = (0, text_matching_1.inferStepSignalAttributes)(step);
    const tagName = attrs.tagName || step.fingerprint?.tagName?.toLowerCase() || 'input';
    const role = (attrs.role || '').toLowerCase();
    if (tagName === 'textarea')
        return 'textarea';
    if (tagName === 'select')
        return 'select';
    if (role === 'combobox')
        return 'combobox';
    if (role === 'searchbox')
        return 'searchbox';
    if ((step.fingerprint?.attributes?.contenteditable || '').toLowerCase() === 'true')
        return 'contenteditable';
    return 'input';
}
function normalizeCapturedRelation(relation) {
    switch (relation) {
        case 'label-for':
        case 'wrapped-label':
        case 'aria-labelledby':
        case 'sibling-label':
        case 'bounded-container':
            return relation;
        default:
            return 'bounded-container';
    }
}
function buildInputTargetSelector(step, controlKind) {
    switch (controlKind) {
        case 'textarea':
            return 'textarea';
        case 'select':
            return 'select';
        case 'combobox':
            return '[role="combobox"]';
        case 'searchbox':
            return '[role="searchbox"],input[type="search"]';
        case 'contenteditable':
            return '[contenteditable="true"]';
        case 'input':
        case 'unknown':
        default:
            return 'input';
    }
}
function inferTriggerLabelText(step) {
    const triggerFingerprintAttrs = step.triggerFingerprint?.attributes;
    const capturedLabel = step.triggerFingerprint?.boundedFieldContext?.fieldLabelText;
    const candidates = [
        capturedLabel,
        triggerFingerprintAttrs?.fieldLabelText,
        triggerFingerprintAttrs?.associatedLabelText,
        triggerFingerprintAttrs?.wrappedLabelText,
        triggerFingerprintAttrs?.labelledByText,
        step.fingerprint?.attributes?.fieldLabelText,
    ];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string')
            continue;
        const trimmed = candidate.trim();
        if (!trimmed || trimmed === 'Select' || trimmed === '-- Select --')
            continue;
        return trimmed;
    }
    return null;
}
function isSelectLikeTriggerStep(step) {
    const family = (step.controlFamily || '').toLowerCase();
    return (step.action === 'custom-control-open' ||
        (step.action === 'custom-select' && ['combobox', 'listbox', 'select', 'dropdown'].includes(family)));
}
function buildBoundedFieldSyntheticSelector(spec) {
    const containerHint = spec.containerSelector || spec.boundedContainerSummary;
    const targetHint = spec.cleanChildSelector || spec.target.selector;
    if (containerHint) {
        return `bounded-field("${spec.labelText}" within ${containerHint} -> ${targetHint})`;
    }
    return `bounded-field("${spec.labelText}" -> ${targetHint})`;
}
function buildBoundedFieldCandidateFromProof(step, labelText, controlKind, targetSelector, snapshot, snapshotSource) {
    const targetSpec = (0, selector_spec_1.buildSelectorSpec)({
        selector: targetSelector,
        source: 'resolver',
        proofLevel: 'snapshot_validated',
    });
    const proof = (0, find_bounded_field_1.findBoundedFieldProof)(snapshot, {
        labelText,
        target: targetSpec,
        controlKind,
        originalSelector: step.selector,
        snapshotSource: snapshotSource?.source ?? 'unavailable',
    });
    if (!proof.match)
        return [];
    const boundedField = {
        source: 'snapshot-bounded-field',
        labelText,
        target: targetSpec,
        controlKind,
        relation: proof.match.relation,
        originalSelector: step.selector,
        containerSelector: proof.match.containerSelector,
        labelElementTag: proof.match.labelElement.tagName?.toLowerCase() || 'label',
        boundedContainerSummary: proof.match.boundedContainerSummary,
        snapshotSource: snapshotSource?.source ?? 'unavailable',
        renderStatus: proof.match.renderStatus,
        renderReason: proof.match.renderReason,
        cleanParentSelector: proof.match.cleanParentSelector,
        cleanChildSelector: proof.match.cleanChildSelector,
        warningCodes: proof.match.warningCodes,
    };
    return [{
            selector: buildBoundedFieldSyntheticSelector(boundedField),
            source: 'bounded-field',
            engine: 'bounded-field',
            categoryOverride: 'bounded-field',
            boundedField,
            rank: 8,
        }];
}
function buildRecordedBoundedFieldCandidate(step, labelText, controlKind, targetSelector, snapshotSource, capturedContext, originalSelector) {
    // 1. Hard Blocks (Required behavior: only emit when capture proof is locally valid)
    if (capturedContext.isValid !== true)
        return [];
    if (!labelText || labelText.trim() === '')
        return [];
    if (!controlKind)
        return [];
    if (capturedContext.visibleControlCountInContainer !== 1)
        return [];
    if (capturedContext.targetIndexWithinContainer === null || capturedContext.targetIndexWithinContainer === undefined)
        return [];
    if (!capturedContext.cleanChildSelector)
        return [];
    // 2. Identify Parent/Container
    const selectorCandidates = capturedContext.boundedContainerSelectorCandidates ?? [];
    const rawParentSelector = capturedContext.cleanParentSelector ??
        selectorCandidates.find(candidate => candidate.isClean)?.selector ?? null;
    const rawContainerSelector = capturedContext.containerSelector ??
        rawParentSelector ??
        selectorCandidates[0]?.selector ?? null;
    // 3. Safety/Genericness Filtering
    const isParentSafe = rawParentSelector && !(0, structured_selector_utils_1.isGenericContainerSelector)(rawParentSelector);
    const isContainerSafe = rawContainerSelector && !(0, structured_selector_utils_1.isGenericContainerSelector)(rawContainerSelector);
    const warningCodes = new Set();
    if ((capturedContext.duplicateLabelCount ?? 0) > 1) {
        warningCodes.add('bounded-field-global-duplicate-label');
    }
    let renderStatus = 'clean-scoped-locator';
    let renderReason = 'recorded_clean_parent_unique_visible';
    let recordedValidity = true;
    let recordedBlockedReason = null;
    let proofLevel = 'recorded';
    if (capturedContext.recordedBlockedReason) {
        recordedValidity = false;
        recordedBlockedReason = capturedContext.recordedBlockedReason;
        renderStatus = 'blocked-unsafe-render';
        renderReason = `captured_blocked_reason: ${capturedContext.recordedBlockedReason}`;
        proofLevel = 'blocked';
    }
    else if (!isParentSafe && isContainerSafe) {
        renderStatus = 'proven-structural-fallback';
        renderReason = 'recorded_bounded_field_structural_fallback';
        warningCodes.add('bounded-field-structural-fallback');
    }
    else if (!isParentSafe && !isContainerSafe) {
        recordedValidity = false;
        recordedBlockedReason = 'generic_container_only';
        renderStatus = 'proof-only-no-clean-render';
        renderReason = 'no_safe_parent_or_container_selector';
        proofLevel = 'blocked';
    }
    warningCodes.add('recorded-bounded-field-proof');
    const targetSpec = (0, selector_spec_1.buildSelectorSpec)({
        selector: targetSelector,
        source: 'resolver',
        proofLevel,
    });
    const boundedField = {
        source: 'recorded-bounded-field',
        labelText,
        target: targetSpec,
        controlKind,
        relation: normalizeCapturedRelation(capturedContext.fieldRelation),
        originalSelector,
        containerSelector: rawContainerSelector ?? undefined,
        boundedContainerSummary: capturedContext.boundedContainerSummary ?? undefined,
        snapshotSource: snapshotSource?.source ?? 'unavailable',
        renderStatus,
        renderReason,
        cleanParentSelector: isParentSafe ? rawParentSelector : undefined,
        cleanChildSelector: capturedContext.cleanChildSelector,
        warningCodes: Array.from(warningCodes),
        visibleControlCountInContainer: capturedContext.visibleControlCountInContainer ?? null,
        targetIndexWithinContainer: capturedContext.targetIndexWithinContainer ?? null,
        competingControlCount: capturedContext.competingControlCount ?? null,
        duplicateLabelCount: capturedContext.duplicateLabelCount ?? null,
        recordedValidity,
        recordedBlockedReason,
    };
    return [{
            selector: buildBoundedFieldSyntheticSelector(boundedField),
            source: 'bounded-field',
            engine: 'bounded-field',
            categoryOverride: 'bounded-field',
            boundedField,
            rank: 8,
        }];
}
function diagnoseBoundedFieldInputProof(step, snapshot, snapshotSelection) {
    const captured = getCapturedBoundedFieldContext(step);
    if (captured?.isValid === false && typeof captured.blockedReason === 'string') {
        return captured.blockedReason;
    }
    const labelText = getFieldLabelText(step);
    if (!labelText)
        return 'bounded-field-no-label';
    const controlKind = inferInputControlKind(step);
    const targetSelector = buildInputTargetSelector(step, controlKind);
    const targetSpec = (0, selector_spec_1.buildSelectorSpec)({
        selector: targetSelector,
        source: 'resolver',
        proofLevel: 'snapshot_validated',
    });
    const proof = (0, find_bounded_field_1.findBoundedFieldProof)(snapshot, {
        labelText,
        target: targetSpec,
        controlKind,
        originalSelector: step.selector,
        snapshotSource: snapshotSelection?.source ?? 'unavailable',
    });
    return proof.rejectReason;
}
function isWeakBoundedFieldInputCandidate(step) {
    return step.action === 'input' && !hasStrongDirectSelectorEvidence(step) && !!getFieldLabelText(step) && isWeakPriority(step.selectorPriority);
}
function buildBoundedFieldCandidates(params) {
    const { step, snapshot, snapshotSelection } = params;
    if (!isWeakBoundedFieldInputCandidate(step))
        return [];
    const labelText = getFieldLabelText(step);
    if (!labelText)
        return [];
    const controlKind = inferInputControlKind(step);
    const targetSelector = buildInputTargetSelector(step, controlKind);
    const capturedContext = getCapturedBoundedFieldContext(step);
    const recordedCandidates = capturedContext
        ? buildRecordedBoundedFieldCandidate(step, labelText, controlKind, targetSelector, snapshotSelection, capturedContext, step.selector)
        : [];
    if (recordedCandidates.length > 0) {
        return recordedCandidates;
    }
    return buildBoundedFieldCandidateFromProof(step, labelText, controlKind, targetSelector, snapshot, snapshotSelection);
}
function diagnoseBoundedFieldInputCandidate(params) {
    if (!isWeakBoundedFieldInputCandidate(params.step))
        return null;
    return diagnoseBoundedFieldInputProof(params.step, params.snapshot, params.snapshotSelection);
}
function buildBoundedFieldTriggerCandidates(params) {
    const { step, snapshot, snapshotSelection } = params;
    if (!isSelectLikeTriggerStep(step))
        return [];
    const triggerSelector = (step.triggerSelector || '').trim();
    if (!triggerSelector || !(0, text_matching_1.isLikelyCssSelector)(triggerSelector))
        return [];
    if (hasStrongDirectSelectorEvidence({
        ...step,
        selector: triggerSelector,
        selectorPriority: step.triggerSelectorPriority ?? step.selectorPriority,
        fingerprint: step.triggerFingerprint ?? step.fingerprint,
    })) {
        return [];
    }
    let visibleMatches = [];
    try {
        visibleMatches = Array.from(snapshot.querySelectorAll(triggerSelector)).filter(visibility_1.isVisibleElement);
    }
    catch {
        return [];
    }
    const capturedContext = getCapturedBoundedFieldContext(step, true);
    const recordedTriggerAmbiguity = step.triggerFingerprint?.selectorAmbiguity?.isAmbiguous === true;
    if (visibleMatches.length <= 1 && !recordedTriggerAmbiguity && !capturedContext?.fieldLabelText)
        return [];
    const labelText = inferTriggerLabelText(step);
    if (!labelText)
        return [];
    if (capturedContext?.isValid || capturedContext?.fieldLabelText) {
        return buildRecordedBoundedFieldCandidate(step, labelText, getCapturedControlKind(step, true) ?? 'custom-trigger', triggerSelector, snapshotSelection, capturedContext, triggerSelector);
    }
    const targetSpec = (0, selector_spec_1.buildSelectorSpec)({
        selector: triggerSelector,
        source: 'resolver',
        proofLevel: 'snapshot_validated',
    });
    const proof = (0, find_bounded_field_1.findBoundedFieldProof)(snapshot, {
        labelText,
        target: targetSpec,
        controlKind: 'custom-trigger',
        originalSelector: triggerSelector,
        snapshotSource: snapshotSelection?.source ?? 'unavailable',
    });
    if (!proof.match)
        return [];
    const boundedField = {
        source: 'snapshot-bounded-field',
        labelText,
        target: targetSpec,
        controlKind: 'custom-trigger',
        relation: proof.match.relation,
        originalSelector: triggerSelector,
        containerSelector: proof.match.containerSelector,
        labelElementTag: proof.match.labelElement.tagName?.toLowerCase() || 'label',
        boundedContainerSummary: proof.match.boundedContainerSummary,
        snapshotSource: snapshotSelection?.source ?? 'unavailable',
        renderStatus: proof.match.renderStatus,
        renderReason: proof.match.renderReason,
        cleanParentSelector: proof.match.cleanParentSelector,
        cleanChildSelector: proof.match.cleanChildSelector,
        warningCodes: proof.match.warningCodes,
    };
    return [{
            selector: buildBoundedFieldSyntheticSelector(boundedField),
            source: 'bounded-field',
            engine: 'bounded-field',
            categoryOverride: 'bounded-field',
            boundedField,
            rank: 5,
        }];
}
