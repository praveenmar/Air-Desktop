"use strict";
/**
 * packages/codegen/src/codegen.service.ts
 *
 * The AIR Code Generation Service â€” "The Compressor".
 *
 * Reads raw recording data from SQLite and produces a compressed,
 * intent-driven CodegenSession (the Semantic Timeline) that can be
 * fed directly to an AI without blowing up the context window.
 *
 * What gets stripped:
 *   - Raw HTML snapshots (can be 100KB-500KB each)
 *   - Network events (not actionable in tests)
 *   - Scroll events (excluded by default â€” noise for most tests)
 *   - Hover events (excluded by default)
 *   - Input heartbeats (trigger=input:progress â€” already filtered at DB level)
 *   - Duplicate edges (deduped by fingerprint hash)
 *   - Pre-navigation UI setup clicks (hamburger expands, container taps)   â† Fix B
 *   - Assertions shared across 2+ destination pages (layout chrome)        â† Fix C
 *
 * What gets preserved:
 *   - Selectors + selector priority (how to find the element)
 *   - Intents (why the user interacted â€” drives self-healing)
 *   - Outcome types (navigation/no_change â€” drives waitForURL/assertions)
 *   - Confidence + sample size (reliability signal for the AI)
 *   - Anchor fingerprints from destination nodes (drives assertions)
 *   - Page URLs (drives page.goto() when needed)
 *
 * Output size target: < 8KB per session for a typical 10-step flow.
 * This fits comfortably in any AI context window alongside the prompt.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodegenService = exports.SELECTOR_RANK_MAP = void 0;
exports.rankFromPriority = rankFromPriority;
exports.getSourceNodeId = getSourceNodeId;
exports.normalizeSelectorPriority = normalizeSelectorPriority;
exports.suppressPreNavSetupClicks = suppressPreNavSetupClicks;
exports.collapseRedundantClickBeforeInput = collapseRedundantClickBeforeInput;
exports.compressDuplicateSubmitAfterClick = compressDuplicateSubmitAfterClick;
exports.compressCustomControlOpenSelectPairs = compressCustomControlOpenSelectPairs;
exports.deduplicateSharedAssertions = deduplicateSharedAssertions;
const crypto = __importStar(require("crypto"));
const snapshot_selector_1 = require("./snapshot-selector");
const flow_review_service_1 = require("./flow-review.service");
const flow_review_formatter_1 = require("./flow-review.formatter");
const assertion_stub_1 = require("./assertion.stub");
const selector_spec_1 = require("./selector-spec");
const shared_1 = require("@air/shared");
const sqlite_client_1 = require("./sqlite-client");
const runtime_schemas_1 = require("./runtime-schemas");
const generation_builder_1 = require("./generation-builder");
exports.SELECTOR_RANK_MAP = {
    'data-testid': 1,
    id: 2,
    attribute: 3,
    class: 7,
    text: 8,
    path: 10,
    xpath: 10,
    other: 10,
    chained: 10,
    unknown: 10,
};
const MAX_RECORDED_SELECTOR_CANDIDATES = 8;
const VALID_CAPTURED_SELECTOR_CANDIDATE_ENGINES = new Set([
    'css',
    'text',
    'xpath',
]);
const VALID_CAPTURED_SELECTOR_CANDIDATE_FAMILIES = new Set([
    'primary',
    'test-id',
    'id',
    'name',
    'placeholder',
    'aria-label',
    'href',
    'role-attr',
    'text',
    'class',
    'parent-scoped-css',
    'tight-container-css',
]);
const VALID_CAPTURED_SELECTOR_CANDIDATE_STRENGTHS = new Set([
    'strong',
    'medium',
    'weak',
]);
function escapeCssString(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\A ')
        .replace(/\r/g, '\\D ')
        .replace(/\t/g, '\\9 ');
}
function rankFromPriority(priority) {
    return exports.SELECTOR_RANK_MAP[priority] ?? 10;
}
function getStepNormalizedUrl(step) {
    return step.normalizedUrl ?? (0, shared_1.normalizeUrl)(step.pageUrl);
}
function getSourceNodeId(event, edge) {
    return event?.nodeId ?? edge?.fromNodeId ?? edge?.toNodeId ?? null;
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ACTION TYPES THAT PRODUCE MEANINGFUL TEST STEPS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const ACTIONABLE_TYPES = new Set(['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select']);
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIX B â€” FRAGILE SELECTOR PRIORITIES
// Steps with these priorities AND immediate_action outcome are candidates for
// pre-navigation setup suppression (hamburger expands, container taps, etc.)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FRAGILE_PRIORITIES = new Set(['class', 'path', 'xpath']);
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ANCHOR PARSING
// Anchors are stored as JSON arrays of strings like:
//   ["URL:/dashboard", "BUTTON:text=Log out", "H1:text=Congratulations"]
// We parse these into CodegenAssertions.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseAnchorsToAssertions(anchorsJson, pageUrl, confidence) {
    const assertions = [];
    // Always assert the URL when we have one
    if (pageUrl) {
        assertions.push({
            type: 'url',
            value: pageUrl,
            source: 'url_change',
            confidence,
        });
    }
    if (!anchorsJson)
        return assertions;
    let anchors;
    try {
        anchors = JSON.parse(anchorsJson);
    }
    catch {
        return assertions;
    }
    for (const anchor of anchors) {
        // Skip URL anchors â€” already handled above
        if (anchor.startsWith('URL:'))
            continue;
        // Parse format: "TAG:attr=value" e.g. "BUTTON:text=Log out"
        const colonIdx = anchor.indexOf(':');
        if (colonIdx === -1)
            continue;
        const tag = anchor.slice(0, colonIdx).toLowerCase();
        const rest = anchor.slice(colonIdx + 1);
        const eqIdx = rest.indexOf('=');
        if (eqIdx === -1)
            continue;
        const attrType = rest.slice(0, eqIdx);
        const attrVal = rest.slice(eqIdx + 1);
        if (!attrVal || attrVal.length < 2)
            continue;
        let assertionType = 'element_visible';
        let selector = '';
        const safeVal = escapeCssString(attrVal);
        switch (attrType) {
            case 'text':
                selector = `${tag}:has-text("${safeVal}")`;
                break;
            case 'testid':
                selector = `[data-testid="${safeVal}"]`;
                break;
            case 'id': {
                const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                    ? CSS.escape(attrVal)
                    : escapeCssString(attrVal);
                selector = `#${safeId}`;
                break;
            }
            case 'name':
                selector = `[name="${safeVal}"]`;
                break;
            case 'role':
                selector = `[role="${safeVal}"]`;
                break;
            default:
                selector = `${tag}[${attrType}="${safeVal}"]`;
        }
        assertions.push({
            type: assertionType,
            value: attrVal,
            selector,
            source: 'anchor',
            confidence: confidence * 0.9,
        });
    }
    return assertions;
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SELECTOR EXTRACTION
// Fingerprint is stored as JSON in event payload.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function logFingerprintWarning(code, details) {
    console.warn(code, details);
}
function normalizeFingerprintAttributes(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const source = raw;
    const normalized = {};
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === 'string' && value.length > 0) {
            normalized[key] = value;
        }
    }
    const aliasPairs = [
        ['ariaLabel', 'aria-label'],
        ['dataTestId', 'data-testid'],
        ['dataCy', 'data-cy'],
        ['dataQa', 'data-qa'],
    ];
    for (const [camelKey, kebabKey] of aliasPairs) {
        const camelValue = normalized[camelKey];
        const kebabValue = normalized[kebabKey];
        if (camelValue && !kebabValue)
            normalized[kebabKey] = camelValue;
        if (kebabValue && !camelValue)
            normalized[camelKey] = kebabValue;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
}
function normalizeNonNegativeInteger(raw) {
    if (raw === null)
        return null;
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0)
        return undefined;
    return raw;
}
function normalizeTargetIdentitySource(raw) {
    return raw === 'pageState' || raw === 'pageSnapshot' || raw === 'interactionContext'
        ? raw
        : undefined;
}
function normalizeTargetIdentityStatus(raw) {
    return (raw === 'emitted' ||
        raw === 'target-not-element' ||
        raw === 'target-detached' ||
        raw === 'target-not-in-snapshot' ||
        raw === 'shadow-not-serialized' ||
        raw === 'cross-origin-frame' ||
        raw === 'unsupported')
        ? raw
        : undefined;
}
function normalizeCapturedSelectorCandidate(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const source = raw;
    const selector = typeof source.selector === 'string' ? source.selector.trim() : '';
    const engine = typeof source.engine === 'string' ? source.engine : undefined;
    const family = typeof source.family === 'string' ? source.family : undefined;
    const strength = typeof source.strength === 'string' ? source.strength : undefined;
    const captureSource = typeof source.source === 'string' ? source.source : undefined;
    if (!selector)
        return null;
    if (!engine || !VALID_CAPTURED_SELECTOR_CANDIDATE_ENGINES.has(engine)) {
        return null;
    }
    if (!family || !VALID_CAPTURED_SELECTOR_CANDIDATE_FAMILIES.has(family)) {
        return null;
    }
    if (!strength || !VALID_CAPTURED_SELECTOR_CANDIDATE_STRENGTHS.has(strength)) {
        return null;
    }
    if (captureSource !== 'capture')
        return null;
    const warningCodes = Array.isArray(source.warningCodes)
        ? Array.from(new Set(source.warningCodes
            .filter((code) => typeof code === 'string')
            .map(code => code.trim())
            .filter(Boolean)))
        : undefined;
    const candidate = {
        selector,
        engine: engine,
        family: family,
        strength: strength,
        source: 'capture',
    };
    if (typeof source.isPrimary === 'boolean')
        candidate.isPrimary = source.isPrimary;
    if (typeof source.usesDynamicClass === 'boolean')
        candidate.usesDynamicClass = source.usesDynamicClass;
    if (typeof source.usesIndex === 'boolean')
        candidate.usesIndex = source.usesIndex;
    const matchCount = normalizeNonNegativeInteger(source.matchCount);
    if (matchCount !== undefined)
        candidate.matchCount = matchCount;
    const visibleMatchCount = normalizeNonNegativeInteger(source.visibleMatchCount);
    if (visibleMatchCount !== undefined)
        candidate.visibleMatchCount = visibleMatchCount;
    const positionInAllMatches = normalizeNonNegativeInteger(source.positionInAllMatches);
    if (positionInAllMatches !== undefined)
        candidate.positionInAllMatches = positionInAllMatches;
    const positionInVisibleMatches = normalizeNonNegativeInteger(source.positionInVisibleMatches);
    if (positionInVisibleMatches !== undefined)
        candidate.positionInVisibleMatches = positionInVisibleMatches;
    if (warningCodes && warningCodes.length > 0) {
        candidate.warningCodes = warningCodes;
    }
    return candidate;
}
function normalizeSelectorCandidates(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const normalized = [];
    const seen = new Set();
    for (const entry of raw) {
        const candidate = normalizeCapturedSelectorCandidate(entry);
        if (!candidate)
            continue;
        const dedupeKey = `${candidate.engine}::${candidate.family}::${candidate.selector}`;
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        normalized.push(candidate);
        if (normalized.length >= MAX_RECORDED_SELECTOR_CANDIDATES)
            break;
    }
    return normalized.length > 0 ? normalized : undefined;
}
function normalizeSelectorAmbiguity(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const source = raw;
    const matchCount = typeof source.matchCount === 'number' ? source.matchCount : undefined;
    const visibleMatchCount = typeof source.visibleMatchCount === 'number' ? source.visibleMatchCount : undefined;
    const isUnique = typeof source.isUnique === 'boolean' ? source.isUnique : undefined;
    const isAmbiguous = typeof source.isAmbiguous === 'boolean' ? source.isAmbiguous : undefined;
    if (typeof source.originalSelector !== 'string' ||
        matchCount == null ||
        visibleMatchCount == null ||
        isUnique == null ||
        isAmbiguous == null) {
        return undefined;
    }
    return {
        originalSelector: source.originalSelector,
        originalPriority: typeof source.originalPriority === 'string' ? source.originalPriority : undefined,
        matchCount,
        visibleMatchCount,
        positionInMatches: source.positionInMatches === null
            ? null
            : (typeof source.positionInMatches === 'number' ? source.positionInMatches : undefined),
        isUnique,
        isAmbiguous,
    };
}
function normalizeBoundedFieldContext(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const source = raw;
    const rawCandidates = Array.isArray(source.boundedContainerSelectorCandidates)
        ? source.boundedContainerSelectorCandidates
        : [];
    const boundedContainerSelectorCandidates = rawCandidates
        .map(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            return null;
        const record = candidate;
        if (typeof record.selector !== 'string' || typeof record.kind !== 'string')
            return null;
        return {
            selector: record.selector,
            kind: record.kind,
            isClean: typeof record.isClean === 'boolean' ? record.isClean : undefined,
        };
    })
        .filter((candidate) => candidate !== null);
    const fieldRelation = source.fieldRelation === null
        ? null
        : (source.fieldRelation === 'label-for' ||
            source.fieldRelation === 'wrapped-label' ||
            source.fieldRelation === 'aria-labelledby' ||
            source.fieldRelation === 'sibling-label' ||
            source.fieldRelation === 'bounded-container'
            ? source.fieldRelation
            : undefined);
    const targetControlKind = source.targetControlKind === null
        ? null
        : (source.targetControlKind === 'input' ||
            source.targetControlKind === 'textarea' ||
            source.targetControlKind === 'select' ||
            source.targetControlKind === 'custom-trigger' ||
            source.targetControlKind === 'combobox' ||
            source.targetControlKind === 'searchbox' ||
            source.targetControlKind === 'contenteditable' ||
            source.targetControlKind === 'unknown'
            ? source.targetControlKind
            : undefined);
    return {
        fieldLabelText: source.fieldLabelText === null
            ? null
            : (typeof source.fieldLabelText === 'string' ? source.fieldLabelText : undefined),
        fieldRelation,
        targetControlKind,
        visibleControlCountInContainer: source.visibleControlCountInContainer === null
            ? null
            : (typeof source.visibleControlCountInContainer === 'number' ? source.visibleControlCountInContainer : undefined),
        targetIndexWithinContainer: source.targetIndexWithinContainer === null
            ? null
            : (typeof source.targetIndexWithinContainer === 'number' ? source.targetIndexWithinContainer : undefined),
        boundedContainerSummary: source.boundedContainerSummary === null
            ? null
            : (typeof source.boundedContainerSummary === 'string' ? source.boundedContainerSummary : undefined),
        boundedContainerSelectorCandidates: boundedContainerSelectorCandidates.length > 0 ? boundedContainerSelectorCandidates : undefined,
        cleanParentSelector: source.cleanParentSelector === null
            ? null
            : (typeof source.cleanParentSelector === 'string' ? source.cleanParentSelector : undefined),
        cleanChildSelector: source.cleanChildSelector === null
            ? null
            : (typeof source.cleanChildSelector === 'string' ? source.cleanChildSelector : undefined),
        containerSelector: source.containerSelector === null
            ? null
            : (typeof source.containerSelector === 'string' ? source.containerSelector : undefined),
        competingControlCount: source.competingControlCount === null
            ? null
            : (typeof source.competingControlCount === 'number' ? source.competingControlCount : undefined),
        duplicateLabelCount: source.duplicateLabelCount === null
            ? null
            : (typeof source.duplicateLabelCount === 'number' ? source.duplicateLabelCount : undefined),
        isValid: typeof source.isValid === 'boolean' ? source.isValid : undefined,
        blockedReason: source.blockedReason === null
            ? null
            : (typeof source.blockedReason === 'string' ? source.blockedReason : undefined),
    };
}
function normalizeAccessibilityEvidence(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return undefined;
    const source = raw;
    const validSources = [
        'aria-label',
        'aria-labelledby',
        'label-for',
        'wrapped-label',
        'button-text',
        'link-text',
        'placeholder',
        'title',
        'role-text',
        'none',
    ];
    return {
        role: typeof source.role === 'string' ? source.role : (source.role === null ? null : undefined),
        accessibleName: typeof source.accessibleName === 'string' ? source.accessibleName : (source.accessibleName === null ? null : undefined),
        accessibleNameSource: (validSources.includes(source.accessibleNameSource)
            ? source.accessibleNameSource
            : 'none'),
        labelText: typeof source.labelText === 'string' ? source.labelText : (source.labelText === null ? null : undefined),
        labelledByIds: Array.isArray(source.labelledByIds)
            ? source.labelledByIds.filter((id) => typeof id === 'string')
            : undefined,
        isNativeLabelAssociation: typeof source.isNativeLabelAssociation === 'boolean' ? source.isNativeLabelAssociation : undefined,
    };
}
function normalizeFingerprint(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const fingerprint = raw;
    const attributes = normalizeFingerprintAttributes(fingerprint.attributes);
    const contextRaw = fingerprint.context && typeof fingerprint.context === 'object' && !Array.isArray(fingerprint.context)
        ? fingerprint.context
        : undefined;
    const normalized = {
        selector: typeof fingerprint.selector === 'string' ? fingerprint.selector : undefined,
        selectorPriority: typeof fingerprint.selectorPriority === 'string' ? fingerprint.selectorPriority : undefined,
        selectorRank: typeof fingerprint.selectorRank === 'number' ? fingerprint.selectorRank : undefined,
        tagName: typeof fingerprint.tagName === 'string' ? fingerprint.tagName : undefined,
        parentSelector: fingerprint.parentSelector === null
            ? null
            : (typeof fingerprint.parentSelector === 'string' ? fingerprint.parentSelector : undefined),
        textExcerpt: fingerprint.textExcerpt === null
            ? null
            : (typeof fingerprint.textExcerpt === 'string' ? fingerprint.textExcerpt : undefined),
        context: contextRaw
            ? {
                parentTag: contextRaw.parentTag === null
                    ? null
                    : (typeof contextRaw.parentTag === 'string' ? contextRaw.parentTag : undefined),
                nearestContainerTag: contextRaw.nearestContainerTag === null
                    ? null
                    : (typeof contextRaw.nearestContainerTag === 'string' ? contextRaw.nearestContainerTag : undefined),
            }
            : undefined,
        attributes,
        selectorCandidates: normalizeSelectorCandidates(fingerprint.selectorCandidates),
        selectorAmbiguity: normalizeSelectorAmbiguity(fingerprint.selectorAmbiguity),
        boundedFieldContext: normalizeBoundedFieldContext(fingerprint.boundedFieldContext),
        accessibilityEvidence: normalizeAccessibilityEvidence(fingerprint.accessibilityEvidence),
        attributesHash: typeof fingerprint.attributesHash === 'string' ? fingerprint.attributesHash : undefined,
        targetNodeId: typeof fingerprint.targetNodeId === 'string' && fingerprint.targetNodeId.trim().length > 0
            ? fingerprint.targetNodeId.trim()
            : undefined,
        targetIdentitySource: normalizeTargetIdentitySource(fingerprint.targetIdentitySource),
        targetIdentityStatus: normalizeTargetIdentityStatus(fingerprint.targetIdentityStatus),
    };
    if (fingerprint.attributes != null &&
        (typeof fingerprint.attributes !== 'object' || Array.isArray(fingerprint.attributes))) {
        logFingerprintWarning('FINGERPRINT_ATTRIBUTE_DROPPED_DOWNSTREAM', {
            reason: 'attributes-unparseable',
            rawType: typeof fingerprint.attributes,
        });
    }
    const expectedAliases = [
        ['ariaLabel', 'aria-label'],
        ['dataTestId', 'data-testid'],
        ['dataCy', 'data-cy'],
        ['dataQa', 'data-qa'],
    ];
    for (const [camelKey, kebabKey] of expectedAliases) {
        const source = fingerprint.attributes;
        const sourceHasValue = typeof source?.[camelKey] === 'string' || typeof source?.[kebabKey] === 'string';
        const normalizedHasValue = typeof attributes?.[camelKey] === 'string' || typeof attributes?.[kebabKey] === 'string';
        if (sourceHasValue && !normalizedHasValue) {
            logFingerprintWarning('FINGERPRINT_ATTRIBUTE_DROPPED_DOWNSTREAM', {
                attribute: camelKey,
                alias: kebabKey,
            });
        }
    }
    return normalized;
}
function extractFingerprint(payloadJson) {
    if (!payloadJson)
        return null;
    try {
        const payload = JSON.parse(payloadJson);
        if (payload.fingerprint && typeof payload.fingerprint === 'object' && !Array.isArray(payload.fingerprint)) {
            const rawFingerprint = payload.fingerprint;
            for (const field of ['selector', 'selectorPriority', 'attributes']) {
                if (rawFingerprint[field] == null) {
                    logFingerprintWarning('FINGERPRINT_ATTRIBUTE_MISSING_AT_CAPTURE', {
                        field,
                    });
                }
            }
        }
        const fingerprint = normalizeFingerprint(payload.fingerprint);
        if (payload.fingerprint && !fingerprint) {
            logFingerprintWarning('FINGERPRINT_ATTRIBUTE_DROPPED_DOWNSTREAM', {
                reason: 'fingerprint-unparseable',
            });
        }
        return fingerprint;
    }
    catch {
        return null;
    }
}
function normalizeSelectorPriority(raw) {
    const valid = [
        'data-testid', 'id', 'attribute', 'class', 'path', 'text', 'xpath', 'chained', 'other',
    ];
    return (valid.includes(raw) ? raw : 'unknown');
}
function extractValue(payloadJson, eventType) {
    if (!payloadJson)
        return undefined;
    try {
        const payload = JSON.parse(payloadJson);
        if ((eventType === 'custom-select' || eventType === 'custom-menu-select') && payload.selection?.label) {
            return payload.selection.label;
        }
        if (eventType === 'input') {
            if (payload.inputValueMasked) {
                if (payload.inputValueMasked === '[REDACTED]') {
                    return '<LLM_GENERATE_MOCK_DATA>';
                }
                return payload.inputValueMasked;
            }
            if (payload.inputLength)
                return '*'.repeat(Math.min(payload.inputLength, 20));
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function extractControlSignature(payloadJson) {
    if (!payloadJson)
        return undefined;
    try {
        const payload = JSON.parse(payloadJson);
        const candidates = [
            payload?.interactionContext?.controlSignature,
            payload?.pageSnapshot?.controlSignature,
            payload?.pageState?.controlSignature,
            payload?.controlSignature,
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.length > 0) {
                return candidate;
            }
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function extractNestedContext(payloadJson) {
    if (!payloadJson)
        return undefined;
    try {
        const payload = JSON.parse(payloadJson);
        const nestedContext = payload?.nestedContext;
        if (!nestedContext || typeof nestedContext !== 'object')
            return undefined;
        return nestedContext;
    }
    catch {
        return undefined;
    }
}
function extractCustomControlFamily(payloadJson) {
    if (!payloadJson)
        return undefined;
    try {
        const payload = JSON.parse(payloadJson);
        const familyCandidates = [
            payload?.controlFamily,
            payload?.meta?.containerRole,
        ];
        for (const candidate of familyCandidates) {
            if (typeof candidate === 'string' && candidate.length > 0) {
                return candidate;
            }
        }
        return undefined;
    }
    catch {
        return undefined;
    }
}
function buildRecordedSelectorSpecFromFingerprint(selector, selectorPriority, selectorRank) {
    const normalizedSelector = (selector || '').trim();
    if (!normalizedSelector)
        return undefined;
    const normalizedPriority = normalizeSelectorPriority(selectorPriority);
    const rank = selectorRank ?? rankFromPriority(normalizedPriority);
    return (0, selector_spec_1.buildSelectorSpec)({
        selector: normalizedSelector,
        selectorPriority: normalizedPriority,
        source: 'interceptor',
        proofLevel: 'recorded',
        rank,
    });
}
function extractCustomControlEvidence(payloadJson, eventType) {
    if (!payloadJson)
        return {};
    try {
        const payload = JSON.parse(payloadJson);
        const fingerprint = normalizeFingerprint(payload?.fingerprint);
        const triggerFingerprint = normalizeFingerprint(payload?.triggerFingerprint);
        const triggerSelector = triggerFingerprint?.selector ??
            (typeof payload?.meta?.triggerSelector === 'string' && payload.meta.triggerSelector.length > 0
                ? payload.meta.triggerSelector
                : undefined);
        const triggerSelectorPriority = normalizeSelectorPriority(triggerFingerprint?.selectorPriority) ??
            (triggerSelector ? 'unknown' : undefined);
        const optionText = payload?.selection?.label ??
            payload?.selection?.value ??
            fingerprint?.textExcerpt ??
            undefined;
        const optionValue = payload?.selection?.value ??
            payload?.selection?.label ??
            fingerprint?.textExcerpt ??
            undefined;
        if (eventType === 'custom-control-open') {
            return {
                controlFamily: extractCustomControlFamily(payloadJson),
                triggerFingerprint: fingerprint ?? undefined,
                triggerSelector: fingerprint?.selector,
                triggerSelectorPriority: normalizeSelectorPriority(fingerprint?.selectorPriority),
                triggerSelectorSpec: buildRecordedSelectorSpecFromFingerprint(fingerprint?.selector, fingerprint?.selectorPriority, fingerprint?.selectorRank),
            };
        }
        if (eventType === 'custom-select' || eventType === 'custom-menu-select') {
            return {
                controlFamily: extractCustomControlFamily(payloadJson),
                triggerFingerprint: triggerFingerprint ?? undefined,
                triggerSelector,
                triggerSelectorPriority: triggerSelector
                    ? normalizeSelectorPriority(triggerFingerprint?.selectorPriority)
                    : undefined,
                triggerSelectorSpec: buildRecordedSelectorSpecFromFingerprint(triggerFingerprint?.selector ?? triggerSelector, triggerFingerprint?.selectorPriority, triggerFingerprint?.selectorRank),
                optionSelector: fingerprint?.selector,
                optionText,
                optionValue,
                optionSelectorSpec: buildRecordedSelectorSpecFromFingerprint(fingerprint?.selector, fingerprint?.selectorPriority, fingerprint?.selectorRank),
            };
        }
        return {};
    }
    catch {
        return {};
    }
}
function extractTabId(payloadJson) {
    if (!payloadJson)
        return undefined;
    try {
        const payload = JSON.parse(payloadJson);
        return typeof payload?.tabId === 'string' && payload.tabId.length > 0
            ? payload.tabId
            : undefined;
    }
    catch {
        return undefined;
    }
}
function extractNormalizedUrl(payloadJson, fallbackPageUrl) {
    if (payloadJson) {
        try {
            const payload = JSON.parse(payloadJson);
            if (typeof payload?.normalizedUrl === 'string' && payload.normalizedUrl.length > 0) {
                return payload.normalizedUrl;
            }
        }
        catch {
            // Fall through to pageUrl fallback
        }
    }
    if (fallbackPageUrl) {
        return (0, shared_1.normalizeUrl)(fallbackPageUrl);
    }
    return undefined;
}
function computeFpHash(fp, eventType) {
    const raw = [
        fp?.selector || '',
        fp?.textExcerpt || '',
        fp?.attributesHash || '',
        eventType,
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIX A â€” INTENT FROM textExcerpt
//
// Previously intent was synthesised entirely from the selector string:
//   click_.oxd_main_menu_item  (same for Admin, PIM and Leave links)
//
// The textExcerpt in the fingerprint holds the visible label the user clicked
// ("Admin", "PIM", "Leave"). Using it makes intents unique and human-readable,
// which also produces better selector guidance for the AI code generator.
//
// Priority order:
//   1. textExcerpt (visible label â€” most meaningful)
//   2. aria-label attribute (accessibility label)
//   3. title/alt attribute (icon and tooltip labels)
//   4. name attribute (form field names)
//   5. selector string (last resort)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function buildIntent(eventType, fp) {
    const candidates = [
        fp.textExcerpt,
        fp.attributes?.['ariaLabel'],
        fp.attributes?.['aria-label'],
        fp.attributes?.['fieldLabelText'],
        fp.attributes?.['associatedLabelText'],
        fp.attributes?.['wrappedLabelText'],
        fp.attributes?.['labelledByText'],
        fp.attributes?.['placeholder'],
        fp.attributes?.['title'],
        fp.attributes?.['alt'],
        fp.attributes?.['name'],
    ];
    const label = candidates.find(c => typeof c === 'string' && c.trim().length > 1);
    const source = label ?? fp.selector ?? '';
    const safeName = source
        .trim()
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .substring(0, 30);
    return safeName ? `${eventType}_${safeName}` : eventType;
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIX B â€” PRE-NAVIGATION SETUP CLICK SUPPRESSION
//
// SPA sidebar navigation produces noise clicks before the real nav trigger:
//   8.  click .oxd-icon            (immediate_action, fragile class selector)
//   9.  click div > div:nth-of-type  (immediate_action, fragile path selector)
//   10. click .oxd-main-menu-item   (navigation)  â† the only step that matters
//
// A step is suppressed when ALL three conditions hold:
//   1. outcomeType is 'immediate_action' (explicitly did not change page state)
//   2. selectorPriority is fragile (class / path / xpath)
//   3. Within the next LOOKAHEAD_WINDOW steps on the same page URL, there is a
//      navigation step â€” OR there are no further steps on this page at all
//      (trailing setup clicks with no completion are equally useless).
//
// Steps that do NOT meet all three conditions are always kept, so legitimate
// class-selector clicks that actually change state (e.g. toggling a tab that
// stays on the same page with state_refresh outcome) are never suppressed.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const LOOKAHEAD_WINDOW = 4; // scan up to 4 steps ahead for a navigation trigger
function suppressPreNavSetupClicks(steps) {
    const suppress = new Set(); // indices to remove
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        // Condition 1: must be immediate_action
        if (step.outcomeType !== 'immediate_action')
            continue;
        // Condition 2: must have a fragile selector
        if (!FRAGILE_PRIORITIES.has(step.selectorPriority))
            continue;
        // Condition 3a: look ahead within the window on the same page
        let foundNavAhead = false;
        let foundAnyStepOnSamePage = false;
        const stepUrl = getStepNormalizedUrl(step);
        for (let j = i + 1; j < steps.length && j <= i + LOOKAHEAD_WINDOW; j++) {
            const nextUrl = getStepNormalizedUrl(steps[j]);
            if (nextUrl !== stepUrl)
                break; // left the page
            foundAnyStepOnSamePage = true;
            if (steps[j].outcomeType === 'navigation') {
                foundNavAhead = true;
                break;
            }
        }
        // Condition 3b: also suppress if this is the last meaningful step on the
        // page (no further steps exist on this URL â€” trailing noise).
        const isTrailing = !foundAnyStepOnSamePage ||
            steps.slice(i + 1).every(s => getStepNormalizedUrl(s) !== stepUrl);
        if (foundNavAhead || isTrailing) {
            suppress.add(i);
        }
    }
    return steps.filter((_, i) => !suppress.has(i));
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// FIX C â€” SHARED ASSERTION DEDUPLICATION
//
// scanPageAnchors() captures global nav/sidebar elements (Add, Reset, Search,
// Upgrade, checkbox, text input) that appear identically on every page of the
// app. These produce the same assertion set on every navigation step, making
// them useless as page-specific checks.
//
// Strategy: count how many distinct destination pages each anchor assertion
// selector appears on. Any selector present on 2+ destination pages is layout
// chrome â€” strip it. URL assertions are always unique so they are never
// touched. The result: each nav step keeps only the assertions that are
// genuinely specific to its destination page.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function isLikelyTextEntryStep(step) {
    if (step.action !== 'input')
        return false;
    const selector = (step.selector || '').toLowerCase();
    const tagName = (step.fingerprint?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tagName))
        return true;
    if (selector.startsWith('input') || selector.startsWith('textarea') || selector.startsWith('select')) {
        return true;
    }
    if (/\[(?:name|placeholder|type)=/i.test(selector))
        return true;
    return false;
}
/**
 * Collapses redundant focus-click steps when the next step is an input on the
 * same element in the same page context.
 */
function collapseRedundantClickBeforeInput(steps) {
    const out = [];
    for (let i = 0; i < steps.length; i++) {
        const current = steps[i];
        const next = steps[i + 1];
        const shouldCollapse = current?.action === 'click' &&
            next?.action === 'input' &&
            current.selector === next.selector &&
            getStepNormalizedUrl(current) === getStepNormalizedUrl(next) &&
            (current.sourceNodeId ?? null) === (next.sourceNodeId ?? null) &&
            !current.navigatesTo &&
            (current.assertions?.length ?? 0) === 0 &&
            current.outcomeType !== 'navigation' &&
            isLikelyTextEntryStep(next);
        if (shouldCollapse) {
            continue;
        }
        out.push(current);
    }
    return out;
}
const DUPLICATE_SUBMIT_AFTER_CLICK_MAX_MS = 1000;
const CUSTOM_CONTROL_OPEN_SELECT_MAX_MS = 1500;
function assertionKey(assertion) {
    return JSON.stringify({
        type: assertion.type,
        value: assertion.value,
        selector: assertion.selector ?? null,
        source: assertion.source,
        confidence: assertion.confidence,
    });
}
function userAssertionKey(assertion) {
    return JSON.stringify({
        assertionIntent: assertion.assertionIntent,
        selector: assertion.selector,
        expectedValue: assertion.expectedValue ?? null,
        checkType: assertion.checkType,
    });
}
function mergeAssertions(primary, absorbed) {
    const merged = [];
    const seen = new Set();
    for (const assertion of [...primary, ...absorbed]) {
        const key = assertionKey(assertion);
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(assertion);
    }
    return merged;
}
function mergeUserAssertions(primary, absorbed) {
    const merged = [];
    const seen = new Set();
    for (const assertion of [...primary, ...absorbed]) {
        const key = userAssertionKey(assertion);
        if (seen.has(key))
            continue;
        seen.add(key);
        merged.push(assertion);
    }
    return merged;
}
function containsSubmitLikeText(value) {
    if (!value)
        return false;
    return /\b(submit|search|save|login|log\s*in|sign\s*in|register|create\s+account|continue|next|apply|send|confirm)\b/i
        .test(value);
}
function isMeaningfulSubmitControl(step) {
    if (step.action !== 'click')
        return false;
    const selector = (step.selector ?? '').toLowerCase();
    const tagName = (step.fingerprint?.tagName ?? '').toLowerCase();
    const role = (step.fingerprint?.attributes?.role ?? '').toLowerCase();
    const type = (step.fingerprint?.attributes?.type ?? '').toLowerCase();
    if (/^(button|input)\[type=["']?submit["']?\]/i.test(selector))
        return true;
    if ((tagName === 'button' || tagName === 'input') && type === 'submit')
        return true;
    const labelCandidates = [
        step.fingerprint?.textExcerpt ?? undefined,
        step.fingerprint?.attributes?.value,
        step.fingerprint?.attributes?.title,
        step.fingerprint?.attributes?.ariaLabel,
        step.fingerprint?.attributes?.['aria-label'],
        step.intent.replace(/^click_/, '').replace(/_/g, ' '),
    ];
    const isButtonLike = tagName === 'button' ||
        tagName === 'input' ||
        role === 'button' ||
        selector.startsWith('button') ||
        selector.startsWith('input');
    return isButtonLike && labelCandidates.some(candidate => containsSubmitLikeText(candidate));
}
function isLikelyFormShellSubmit(step) {
    if (step.action !== 'submit')
        return false;
    const selector = (step.selector ?? '').toLowerCase();
    const tagName = (step.fingerprint?.tagName ?? '').toLowerCase();
    const role = (step.fingerprint?.attributes?.role ?? '').toLowerCase();
    const nearestContainerTag = (step.fingerprint?.context?.nearestContainerTag ?? '').toLowerCase();
    const parentTag = (step.fingerprint?.context?.parentTag ?? '').toLowerCase();
    if (tagName === 'form' || role === 'form')
        return true;
    if (selector === 'form' || selector.startsWith('form[') || selector.startsWith('form.'))
        return true;
    const formContext = nearestContainerTag === 'form' ||
        parentTag === 'form' ||
        selector.includes('form');
    return formContext && FRAGILE_PRIORITIES.has(step.selectorPriority);
}
function canAbsorbSubmitOutcome(clickStep, submitStep) {
    if (clickStep.action !== 'click' || submitStep.action !== 'submit')
        return false;
    if (clickStep.traceId == null || submitStep.traceId == null || clickStep.traceId !== submitStep.traceId)
        return false;
    const clickTab = clickStep.tabId ?? null;
    const submitTab = submitStep.tabId ?? null;
    if (clickTab !== submitTab)
        return false;
    if (getStepNormalizedUrl(clickStep) !== getStepNormalizedUrl(submitStep))
        return false;
    if (typeof clickStep.timestamp === 'number' && typeof submitStep.timestamp === 'number') {
        const deltaMs = submitStep.timestamp - clickStep.timestamp;
        if (deltaMs < 0 || deltaMs > DUPLICATE_SUBMIT_AFTER_CLICK_MAX_MS)
            return false;
    }
    else {
        return false;
    }
    if (!isMeaningfulSubmitControl(clickStep))
        return false;
    if (!isLikelyFormShellSubmit(submitStep))
        return false;
    return true;
}
function mergeSubmitIntoClick(clickStep, submitStep) {
    return {
        ...clickStep,
        outcomeType: submitStep.outcomeType ?? clickStep.outcomeType,
        navigatesTo: submitStep.navigatesTo ?? clickStep.navigatesTo,
        destinationNodeId: submitStep.destinationNodeId ?? clickStep.destinationNodeId,
        assertions: mergeAssertions(clickStep.assertions, submitStep.assertions),
        userAssertions: mergeUserAssertions(clickStep.userAssertions, submitStep.userAssertions),
        confidence: Math.max(clickStep.confidence, submitStep.confidence),
        sampleSize: Math.max(clickStep.sampleSize, submitStep.sampleSize),
    };
}
function compressDuplicateSubmitAfterClick(steps) {
    const out = [];
    for (let i = 0; i < steps.length; i++) {
        const current = steps[i];
        const next = steps[i + 1];
        if (current && next && canAbsorbSubmitOutcome(current, next)) {
            out.push(mergeSubmitIntoClick(current, next));
            i++;
            continue;
        }
        out.push(current);
    }
    return out;
}
function isSelectLikeControlFamily(family) {
    const normalized = (family || '').toLowerCase();
    return ['combobox', 'listbox', 'select', 'dropdown'].includes(normalized);
}
function canCompressOpenSelectPair(openStep, selectStep) {
    if (openStep.action !== 'custom-control-open' || selectStep.action !== 'custom-select')
        return false;
    if (openStep.traceId == null || selectStep.traceId == null || openStep.traceId !== selectStep.traceId)
        return false;
    const openTab = openStep.tabId ?? null;
    const selectTab = selectStep.tabId ?? null;
    if (openTab !== selectTab)
        return false;
    if (getStepNormalizedUrl(openStep) !== getStepNormalizedUrl(selectStep))
        return false;
    if (typeof openStep.timestamp !== 'number' || typeof selectStep.timestamp !== 'number')
        return false;
    const deltaMs = selectStep.timestamp - openStep.timestamp;
    if (deltaMs < 0 || deltaMs > CUSTOM_CONTROL_OPEN_SELECT_MAX_MS)
        return false;
    if (!isSelectLikeControlFamily(openStep.controlFamily ?? selectStep.controlFamily))
        return false;
    if ((openStep.controlFamily ?? '').toLowerCase() === 'autocomplete')
        return false;
    if ((selectStep.controlFamily ?? '').toLowerCase() === 'autocomplete')
        return false;
    const triggerSelector = selectStep.triggerSelector ?? openStep.triggerSelector ?? openStep.selector;
    const optionSelector = selectStep.optionSelector ?? selectStep.selector;
    const optionText = selectStep.optionText ?? selectStep.value ?? selectStep.fingerprint?.textExcerpt ?? undefined;
    if (!triggerSelector || triggerSelector.trim().length === 0)
        return false;
    if ((!optionSelector || optionSelector.trim().length === 0) && (!optionText || optionText.trim().length === 0)) {
        return false;
    }
    return true;
}
function compressOpenSelectPair(openStep, selectStep) {
    const compressedEventIds = [openStep.eventId, selectStep.eventId].filter((value) => typeof value === 'string' && value.length > 0);
    return {
        ...selectStep,
        controlFamily: selectStep.controlFamily ?? openStep.controlFamily,
        triggerSelector: selectStep.triggerSelector ?? openStep.triggerSelector ?? openStep.selector,
        triggerSelectorPriority: selectStep.triggerSelectorPriority ??
            openStep.triggerSelectorPriority ??
            openStep.selectorPriority,
        triggerFingerprint: selectStep.triggerFingerprint ??
            openStep.triggerFingerprint ??
            openStep.fingerprint,
        triggerSelectorSpec: selectStep.triggerSelectorSpec ??
            openStep.triggerSelectorSpec ??
            openStep.selectorSpec,
        triggerResolvedSelector: selectStep.triggerResolvedSelector ??
            openStep.triggerResolvedSelector,
        optionSelector: selectStep.optionSelector ?? selectStep.selector,
        optionText: selectStep.optionText ??
            selectStep.value ??
            selectStep.fingerprint?.textExcerpt ??
            undefined,
        optionValue: selectStep.optionValue ??
            selectStep.value ??
            selectStep.optionText ??
            selectStep.fingerprint?.textExcerpt ??
            undefined,
        optionSelectorSpec: selectStep.optionSelectorSpec ??
            selectStep.selectorSpec,
        optionResolvedSelector: selectStep.optionResolvedSelector,
        absorbedOpenEventId: openStep.eventId,
        absorbedOpenTraceId: openStep.traceId,
        compressedFromEvents: compressedEventIds,
    };
}
function compressCustomControlOpenSelectPairs(steps) {
    const out = [];
    for (let i = 0; i < steps.length; i++) {
        const current = steps[i];
        const next = steps[i + 1];
        if (current && next && canCompressOpenSelectPair(current, next)) {
            out.push(compressOpenSelectPair(current, next));
            i++;
            continue;
        }
        out.push(current);
    }
    return out;
}
function deduplicateSharedAssertions(steps) {
    // Count how many NAV steps each anchor selector appears in
    const selectorPageCount = new Map();
    for (const step of steps) {
        if (step.outcomeType !== 'navigation')
            continue;
        // Use a Set so one step with the same selector twice doesn't double-count
        const seen = new Set();
        for (const assertion of step.assertions) {
            if (assertion.source !== 'anchor')
                continue;
            if (!assertion.selector)
                continue;
            if (!seen.has(assertion.selector)) {
                seen.add(assertion.selector);
                selectorPageCount.set(assertion.selector, (selectorPageCount.get(assertion.selector) ?? 0) + 1);
            }
        }
    }
    // Strip selectors that appear on more than one destination page
    return steps.map(step => ({
        ...step,
        assertions: step.assertions.filter(assertion => {
            if (assertion.source !== 'anchor')
                return true; // always keep URL assertions
            if (!assertion.selector)
                return true;
            return (selectorPageCount.get(assertion.selector) ?? 0) < 2;
        }),
    }));
}
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN SERVICE
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class CodegenService {
    options;
    db;
    constructor(options) {
        this.options = options;
        this.db = (0, sqlite_client_1.openSqliteReadonlyDatabase)(options.dbPath);
    }
    /**
     * Lists all sessions available for code generation, newest first.
     */
    listSessions() {
        const rows = this.db.prepare(`
      SELECT
        s.id          AS sessionId,
        s.started_at  AS startedAt,
        s.event_count AS eventCount,
        (
          SELECT e2.page_url FROM events e2
          WHERE e2.session_id = s.id AND e2.page_url IS NOT NULL
          ORDER BY e2.timestamp ASC
          LIMIT 1
        ) AS url
      FROM sessions s
      ORDER BY s.started_at DESC
    `).all();
        return rows.map(r => ({
            sessionId: r.sessionId,
            url: r.url || 'unknown',
            startedAt: new Date(r.startedAt).toISOString(),
            eventCount: r.eventCount || 0,
        }));
    }
    /**
     * Builds the full Semantic Timeline for a session.
     * This is what gets fed to the AI â€” no raw HTML, no snapshots.
     */
    buildSession(sessionId) {
        // â”€â”€ 1. Load session metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const session = this.db.prepare(`
      SELECT id, started_at, last_event_at, metadata
      FROM sessions
      WHERE id = ?
    `).get(sessionId);
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        // â”€â”€ 2. Load ordered events for this session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const includeTypes = ['click', 'input', 'submit', 'custom-control-open', 'custom-select', 'custom-menu-select'];
        if (this.options.includeScrollSteps)
            includeTypes.push('scroll');
        if (this.options.includeHoverSteps)
            includeTypes.push('hover');
        const placeholders = includeTypes.map(() => '?').join(', ');
        const events = this.db.prepare(`
      SELECT
        e.id          AS eventId,
        e.type        AS eventType,
        e.timestamp,
        e.page_url    AS pageUrl,
        e.trace_id    AS traceId,
        e.node_id     AS nodeId,
        e.payload
      FROM events e
      WHERE e.session_id = ?
        AND e.type IN (${placeholders})
      ORDER BY e.timestamp ASC
    `).all(sessionId, ...includeTypes);
        // â”€â”€ 3. Load edges keyed by fingerprint_hash â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // CRITICAL: We join via fingerprint_hash not trigger_event_id.
        // When the same action is recorded multiple times, OutcomeHandler calls
        // resolveOutcome() on the EXISTING edge (first session created it).
        // That edge's trigger_event_id points to a DIFFERENT session's event,
        // making it invisible if we filter by current session's event IDs.
        const sessionFpHashes = new Set();
        const sessionEventIds = new Set();
        for (const ev of events) {
            if (ev.eventId)
                sessionEventIds.add(ev.eventId);
            const fp = extractFingerprint(ev.payload);
            sessionFpHashes.add(computeFpHash(fp, ev.eventType));
        }
        const fpHashList = Array.from(sessionFpHashes);
        const eventIdList = Array.from(sessionEventIds);
        const allEdgeRows = [];
        if (fpHashList.length > 0) {
            const fpPlaceholders = fpHashList.map(() => '?').join(', ');
            const byFp = this.db.prepare(`
        SELECT
          ed.fingerprint_hash AS fingerprintHash,
          ed.id               AS edgeId,
          ed.trigger_event_id AS triggerEventId,
          ed.from_node_id     AS fromNodeId,
          ed.to_node_id       AS toNodeId,
          ed.outcome_type     AS outcomeType,
          ed.sample_size      AS sampleSize,
          o.probability
        FROM edges ed
        LEFT JOIN outcomes o ON o.edge_id = ed.id
        WHERE ed.fingerprint_hash IN (${fpPlaceholders})
      `).all(...fpHashList);
            allEdgeRows.push(...byFp);
        }
        if (eventIdList.length > 0) {
            const evPlaceholders = eventIdList.map(() => '?').join(', ');
            const byEvent = this.db.prepare(`
        SELECT
          ed.fingerprint_hash AS fingerprintHash,
          ed.id               AS edgeId,
          ed.trigger_event_id AS triggerEventId,
          ed.from_node_id     AS fromNodeId,
          ed.to_node_id       AS toNodeId,
          ed.outcome_type     AS outcomeType,
          ed.sample_size      AS sampleSize,
          o.probability
        FROM edges ed
        LEFT JOIN outcomes o ON o.edge_id = ed.id
        WHERE ed.trigger_event_id IN (${evPlaceholders})
      `).all(...eventIdList);
            allEdgeRows.push(...byEvent);
        }
        // Deduplicate edges â€” keep highest-confidence outcome per fingerprint
        const edgeByEventId = new Map();
        const edgeByFingerprint = new Map();
        const outcomeTypePriority = {
            navigation: 3, state_refresh: 2, no_change: 1, immediate_action: 0,
        };
        for (const edge of allEdgeRows) {
            const newPriority = outcomeTypePriority[edge.outcomeType] ?? -1;
            if (edge.triggerEventId) {
                const existing = edgeByEventId.get(edge.triggerEventId);
                if (!existing || newPriority > (outcomeTypePriority[existing.outcomeType] ?? -1)) {
                    edgeByEventId.set(edge.triggerEventId, edge);
                }
            }
            if (edge.fingerprintHash) {
                const existing = edgeByFingerprint.get(edge.fingerprintHash);
                if (!existing || newPriority > (outcomeTypePriority[existing.outcomeType] ?? -1)) {
                    edgeByFingerprint.set(edge.fingerprintHash, edge);
                }
            }
        }
        const edgeRows = Array.from(edgeByFingerprint.values());
        // â”€â”€ 4. Load destination nodes for navigation edges â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const navEdges = edgeRows.filter(e => e.outcomeType === 'navigation');
        const toNodeIds = Array.from(new Set(navEdges.map(e => e.toNodeId).filter(Boolean)));
        const nodeMap = new Map();
        if (toNodeIds.length > 0) {
            const nodePlaceholders = toNodeIds.map(() => '?').join(', ');
            const nodes = this.db.prepare(`
        SELECT id, page_url, page_title, anchors
        FROM nodes
        WHERE id IN (${nodePlaceholders})
      `).all(...toNodeIds);
            for (const node of nodes)
                nodeMap.set(node.id, node);
        }
        // Source-node fallback for control signature when payload lacks it.
        // This is additive and preserves current behavior when payload already carries signature.
        const nodeControlSignatureStmt = this.db.prepare(`
      SELECT control_signature AS controlSignature
      FROM nodes
      WHERE id = ?
      LIMIT 1
    `);
        const controlSignatureByNodeId = new Map();
        const getNodeControlSignature = (nodeId) => {
            if (!nodeId)
                return undefined;
            if (controlSignatureByNodeId.has(nodeId)) {
                return controlSignatureByNodeId.get(nodeId);
            }
            const row = nodeControlSignatureStmt.get(nodeId);
            const resolved = typeof row?.controlSignature === 'string' && row.controlSignature.length > 0
                ? row.controlSignature
                : undefined;
            controlSignatureByNodeId.set(nodeId, resolved);
            return resolved;
        };
        // â”€â”€ 5. Build raw steps â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const rawSteps = [];
        let stepNum = 0;
        const minConfidence = this.options.minConfidence ?? 0.0;
        let lastResolvedSourceNodeId;
        for (const ev of events) {
            if (!ACTIONABLE_TYPES.has(ev.eventType))
                continue;
            const fingerprint = extractFingerprint(ev.payload);
            if (!fingerprint?.selector)
                continue;
            const recomputedHash = computeFpHash(fingerprint, ev.eventType);
            const edge = edgeByEventId.get(ev.eventId) || edgeByFingerprint.get(recomputedHash);
            const confidence = edge?.probability ?? 1.0;
            if (confidence < minConfidence)
                continue;
            stepNum++;
            // FIX A: intent now prefers textExcerpt over the raw selector string.
            // "click_Admin", "click_PIM", "click_Leave" instead of
            // "click__oxd_main_menu_item" for all three navigation steps.
            const intent = buildIntent(ev.eventType, fingerprint);
            const selectorPriority = normalizeSelectorPriority(fingerprint.selectorPriority);
            const selectorRank = fingerprint.selectorRank ?? rankFromPriority(selectorPriority);
            const directSourceNodeId = getSourceNodeId(ev, edge) ?? undefined;
            // Submit events can arrive without node linkage from the event payload/edge.
            // Keep graph truth untouched, but anchor generation to the latest known node
            // so resolver can still fetch a meaningful snapshot.
            const sourceNodeId = directSourceNodeId ?? (ev.eventType === 'submit'
                ? lastResolvedSourceNodeId
                : undefined);
            const controlSignature = extractControlSignature(ev.payload) ??
                getNodeControlSignature(sourceNodeId);
            const step = {
                step: stepNum,
                eventId: ev.eventId ?? undefined,
                traceId: ev.traceId ?? undefined,
                timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : undefined,
                tabId: extractTabId(ev.payload) ?? null,
                intent,
                action: ev.eventType,
                selector: fingerprint.selector,
                sourceNodeId,
                selectorPriority,
                selectorRank,
                selectorSpec: (0, selector_spec_1.buildSelectorSpec)({
                    selector: fingerprint.selector,
                    selectorPriority,
                    source: 'interceptor',
                    proofLevel: 'recorded',
                    rank: selectorRank,
                }),
                fingerprint: fingerprint ?? undefined,
                targetNodeId: fingerprint?.targetNodeId ?? undefined,
                nestedContext: extractNestedContext(ev.payload),
                controlSignature,
                pageUrl: ev.pageUrl || '',
                normalizedUrl: extractNormalizedUrl(ev.payload, ev.pageUrl || ''),
                confidence,
                sampleSize: edge?.sampleSize ?? 1,
                assertions: [],
                userAssertions: [],
            };
            Object.assign(step, extractCustomControlEvidence(ev.payload, ev.eventType));
            if (sourceNodeId) {
                lastResolvedSourceNodeId = sourceNodeId;
            }
            const value = extractValue(ev.payload, ev.eventType);
            if (value)
                step.value = value;
            if (edge) {
                step.outcomeType = edge.outcomeType;
                step.destinationNodeId = edge.toNodeId ?? undefined;
                if (edge.outcomeType === 'navigation' && edge.toNodeId) {
                    const destNode = nodeMap.get(edge.toNodeId);
                    if (destNode?.page_url)
                        step.navigatesTo = destNode.page_url;
                    if (destNode) {
                        step.assertions = parseAnchorsToAssertions(destNode.anchors, destNode.page_url, edge.probability ?? 1.0);
                    }
                    step.userAssertions = (0, assertion_stub_1.hasUserAssertionSupport)(this.db)
                        ? (0, assertion_stub_1.getUserDefinedAssertions)(sessionId, this.db)
                        : [];
                }
            }
            console.log('CODEGEN_STEP_MAPPED', {
                sessionId,
                step: step.step,
                eventId: ev.eventId ?? null,
                traceId: ev.traceId ?? null,
                sourceNodeId: step.sourceNodeId ?? null,
                selector: step.selector,
                resolvedSelector: step.resolvedSelector ?? null,
            });
            // Consecutive duplicate filter â€” keep last (carries final committed value)
            const prev = rawSteps[rawSteps.length - 1];
            if (prev && prev.selector === step.selector && prev.action === step.action) {
                step.step = prev.step;
                rawSteps[rawSteps.length - 1] = step;
                stepNum--;
            }
            else {
                rawSteps.push(step);
            }
        }
        // â”€â”€ 6. FIX B: suppress pre-navigation setup clicks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        // Removes hamburger-expand and container-tap noise clicks that precede
        // every SPA sidebar navigation (e.g. .oxd-icon and div > div:nth-of-type).
        const afterClickInputCollapse = collapseRedundantClickBeforeInput(rawSteps);
        const afterSubmitCompression = compressDuplicateSubmitAfterClick(afterClickInputCollapse);
        const afterCustomControlCompression = compressCustomControlOpenSelectPairs(afterSubmitCompression);
        const afterSetupFilter = suppressPreNavSetupClicks(afterCustomControlCompression);
        // â”€â”€ 7. FIX C: strip assertions shared across multiple destination pages â”€â”€
        // Removes global layout elements (Add, Reset, Search buttons) that appear
        // identically in the anchor set of every page, leaving only page-specific
        // assertions. URL assertions are never stripped.
        const finalSteps = deduplicateSharedAssertions(afterSetupFilter);
        // Re-number steps sequentially after filtering
        finalSteps.forEach((s, i) => { s.step = i + 1; });
        // â”€â”€ 8. Flow confidence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const navProbabilities = edgeRows
            .filter(e => e.outcomeType === 'navigation' && e.probability != null)
            .map(e => e.probability);
        const flowConfidence = navProbabilities.length > 0
            ? navProbabilities.reduce((sum, p) => sum + p, 0) / navProbabilities.length
            : 1.0;
        // â”€â”€ 9. Starting URL and title â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const firstEvent = events[0];
        const startUrl = firstEvent?.pageUrl || 'unknown';
        const startTitle = (() => {
            try {
                const payload = JSON.parse(firstEvent?.payload || '{}');
                return payload.pageTitle || '';
            }
            catch {
                return '';
            }
        })();
        // â”€â”€ 10. Unique node count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const visitedNodes = new Set();
        for (const ev of events) {
            if (ev.nodeId)
                visitedNodes.add(ev.nodeId);
        }
        return {
            sessionId,
            url: startUrl,
            title: startTitle,
            recordedAt: new Date(session.started_at).toISOString(),
            stepCount: finalSteps.length,
            steps: finalSteps,
            flowConfidence,
            nodeCount: visitedNodes.size,
        };
    }
    close() {
        this.db.close();
    }
    async loadSnapshots(session, options = {}) {
        try {
            const sourceNodeIds = Array.from(new Set(session.steps
                .map(step => step.sourceNodeId)
                .filter((nodeId) => typeof nodeId === 'string' && nodeId.length > 0)));
            const destinationNodeIds = Array.from(new Set(session.steps
                .map(step => step.destinationNodeId)
                .filter((nodeId) => typeof nodeId === 'string' && nodeId.length > 0)));
            const normalizedUrls = Array.from(new Set(session.steps
                .map(step => step.normalizedUrl || (0, shared_1.normalizeUrl)(step.pageUrl))
                .filter((url) => typeof url === 'string' && url.length > 0)));
            const eventIds = Array.from(new Set(session.steps
                .map(step => step.eventId)
                .filter((eventId) => typeof eventId === 'string' && eventId.length > 0)));
            const traceIds = Array.from(new Set(session.steps
                .map(step => step.traceId)
                .filter((traceId) => typeof traceId === 'string' && traceId.length > 0)));
            const maxBytes = options.maxSnapshotBytesForValidation ?? 2_000_000;
            let jsdomCtor = null;
            let linkedomParse = null;
            const dynamicImport = new Function('specifier', 'return import(specifier);');
            try {
                const jsdomModule = await dynamicImport('jsdom');
                if (typeof jsdomModule.JSDOM === 'function') {
                    jsdomCtor = jsdomModule.JSDOM;
                }
            }
            catch {
                // Try linkedom below.
            }
            if (!jsdomCtor) {
                try {
                    const linkedom = await dynamicImport('linkedom');
                    if (typeof linkedom.parseHTML === 'function') {
                        linkedomParse = linkedom.parseHTML;
                    }
                }
                catch {
                    // Snapshot engine remains unavailable.
                }
            }
            const snapshotEngineAvailable = !!(jsdomCtor || linkedomParse);
            console.log('[DEBUG] loadSnapshots: jsdomCtor=', !!jsdomCtor, 'linkedomParse=', !!linkedomParse);
            const emptyInventory = {
                snapshotEngineAvailable,
                hardBoundaries: [],
                icBoundaryToleranceMs: 75,
                eventLocalByEventId: new Map(),
                interactionContextExactStable: new Map(),
                interactionContextExactAny: new Map(),
                interactionContextStableByUrl: new Map(),
                interactionContextAnyByUrl: new Map(),
                outcomeEventByTraceId: new Map(),
                sourceNodeById: new Map(),
                destinationNodeById: new Map(),
                urlEventFallbackByNormalizedUrl: new Map(),
            };
            if (!snapshotEngineAvailable) {
                console.warn('[AIR] Failed to load jsdom or linkedom. Snapshot validation disabled.');
                console.warn('[AIR] Snapshot engine unavailable — resolver running in degraded mode');
                return {
                    snapshotEngineAvailable,
                    get(_nodeId, _normalizedUrl, _controlSignature) {
                        return null;
                    },
                    getSource(_nodeId, _normalizedUrl, _controlSignature) {
                        return 'unavailable';
                    },
                    selectForStep(step, mode = 'action') {
                        return (0, snapshot_selector_1.selectSnapshotForStep)(step, emptyInventory, mode);
                    },
                };
            }
            const parseHtmlToDocument = (html, debugLabel) => {
                if (!html)
                    return null;
                if (Buffer.byteLength(html, 'utf8') > maxBytes)
                    return null;
                try {
                    if (jsdomCtor) {
                        const dom = new jsdomCtor(html);
                        return dom.window.document;
                    }
                    if (linkedomParse) {
                        const parsed = linkedomParse(html);
                        return parsed.window.document;
                    }
                    return null;
                }
                catch (err) {
                    console.error('[DEBUG] loadSnapshots: parsing error for', debugLabel, err);
                    return null;
                }
            };
            const buildIcKey = (normalizedUrl, controlSignature) => `${normalizedUrl}|${controlSignature ?? ''}`;
            const payloadRowCache = new Map();
            const documentCache = new Map();
            const getEventRowStmt = this.db.prepare(`
        SELECT
          id AS eventId,
          type AS eventType,
          trace_id AS traceId,
          timestamp,
          page_url AS pageUrl,
          payload
        FROM events
        WHERE id = ?
        LIMIT 1
      `);
            const getNodeSnapshotStmt = this.db.prepare(`
        SELECT snapshot_html AS snapshotHtml
        FROM nodes
        WHERE id = ?
        LIMIT 1
      `);
            const getInteractionContextSnapshotStmt = this.db.prepare(`
        SELECT snapshot_html AS snapshotHtml
        FROM interaction_contexts
        WHERE session_id = ? AND normalized_url = ? AND control_signature = ?
        LIMIT 1
      `);
            const loadEventRow = (eventId) => {
                if (payloadRowCache.has(eventId)) {
                    return payloadRowCache.get(eventId) ?? null;
                }
                const row = getEventRowStmt.get(eventId);
                const resolved = row ?? null;
                payloadRowCache.set(eventId, resolved);
                return resolved;
            };
            const parsePayload = (eventId) => {
                const row = loadEventRow(eventId);
                if (!row?.payload)
                    return null;
                try {
                    return JSON.parse(row.payload);
                }
                catch {
                    return null;
                }
            };
            const parsePayloadJson = (payloadJson) => {
                if (!payloadJson)
                    return null;
                try {
                    return JSON.parse(payloadJson);
                }
                catch {
                    return null;
                }
            };
            const sessionTimelineRows = this.db.prepare(`
        SELECT
          id AS eventId,
          type AS eventType,
          trace_id AS traceId,
          timestamp,
          page_url AS pageUrl,
          payload
        FROM events
        WHERE session_id = ?
        ORDER BY timestamp ASC
      `).all(session.sessionId);
            const icTabEvidence = new Map();
            const hardBoundaries = [];
            const previousByTab = new Map();
            let previousTimelineEvent = null;
            for (const row of sessionTimelineRows) {
                const payload = parsePayloadJson(row.payload);
                const tabId = extractTabId(row.payload) ?? null;
                const normalizedUrl = extractNormalizedUrl(row.payload, row.pageUrl);
                const controlSignature = typeof payload?.interactionContext?.controlSignature === 'string'
                    ? payload.interactionContext.controlSignature
                    : (payload?.interactionContext?.controlSignature === null
                        ? ''
                        : undefined);
                if (tabId && normalizedUrl !== undefined && controlSignature !== undefined) {
                    const icKey = buildIcKey(normalizedUrl, controlSignature);
                    const knownTabs = icTabEvidence.get(icKey) ?? new Set();
                    knownTabs.add(tabId);
                    icTabEvidence.set(icKey, knownTabs);
                }
                if (previousTimelineEvent?.tabId &&
                    tabId &&
                    previousTimelineEvent.tabId !== tabId) {
                    hardBoundaries.push({
                        timestamp: row.timestamp,
                        kind: previousTimelineEvent.traceId &&
                            row.traceId &&
                            previousTimelineEvent.traceId === row.traceId
                            ? 'cross_tab_handoff'
                            : 'tab_change',
                        eventId: row.eventId,
                        traceId: row.traceId,
                        fromTabId: previousTimelineEvent.tabId,
                        toTabId: tabId,
                        tabId,
                    });
                }
                if (row.eventType === 'spa-route-change') {
                    hardBoundaries.push({
                        timestamp: row.timestamp,
                        kind: 'spa_route_change',
                        eventId: row.eventId,
                        traceId: row.traceId,
                        tabId,
                        toNormalizedUrl: normalizedUrl ?? null,
                    });
                }
                if (tabId) {
                    const previousForTab = previousByTab.get(tabId);
                    if (previousForTab?.normalizedUrl &&
                        normalizedUrl &&
                        previousForTab.normalizedUrl !== normalizedUrl) {
                        hardBoundaries.push({
                            timestamp: row.timestamp,
                            kind: row.eventType === 'outcome' ? 'navigation' : 'url_change',
                            eventId: row.eventId,
                            traceId: row.traceId,
                            tabId,
                            fromNormalizedUrl: previousForTab.normalizedUrl,
                            toNormalizedUrl: normalizedUrl,
                        });
                    }
                    previousByTab.set(tabId, { normalizedUrl });
                }
                previousTimelineEvent = {
                    tabId,
                    traceId: row.traceId,
                };
            }
            const loadDocumentCached = (cacheKey, factory) => {
                if (documentCache.has(cacheKey)) {
                    return documentCache.get(cacheKey) ?? null;
                }
                const doc = factory();
                documentCache.set(cacheKey, doc);
                return doc;
            };
            const loadEventSnapshotField = (eventId, fieldName, sourceLabel) => {
                return loadDocumentCached(`event:${eventId}:${fieldName}`, () => {
                    const payload = parsePayload(eventId);
                    const html = payload?.[fieldName]?.html;
                    if (typeof html !== 'string' || html.length === 0)
                        return null;
                    return parseHtmlToDocument(html, `${sourceLabel}:${eventId}:${fieldName}`);
                });
            };
            const loadUrlFallbackSnapshot = (eventId, normalizedUrl) => {
                return loadDocumentCached(`url-fallback:${normalizedUrl}:${eventId}`, () => {
                    const payload = parsePayload(eventId);
                    if (!payload || typeof payload !== 'object')
                        return null;
                    const candidates = [
                        payload?.pageState?.html,
                        payload?.pageSnapshot?.html,
                        payload?.interactionContext?.html,
                    ];
                    for (const candidate of candidates) {
                        if (typeof candidate === 'string' && candidate.length > 0) {
                            return parseHtmlToDocument(candidate, `url-fallback:${normalizedUrl}:${eventId}`);
                        }
                    }
                    return null;
                });
            };
            const loadNodeSnapshot = (nodeId, sourceLabel) => {
                return loadDocumentCached(`node:${sourceLabel}:${nodeId}`, () => {
                    const row = getNodeSnapshotStmt.get(nodeId);
                    const snapshotHtml = row?.snapshotHtml;
                    console.log(`[DEBUG] loadSnapshots: nodeId=${nodeId}, snapshotHtml length=${snapshotHtml ? snapshotHtml.length : 0}`);
                    if (!snapshotHtml)
                        return null;
                    return parseHtmlToDocument(snapshotHtml, `${sourceLabel}:${nodeId}`);
                });
            };
            const loadInteractionContext = (normalizedUrl, controlSignature, sourceLabel) => {
                return loadDocumentCached(`ic:${sourceLabel}:${normalizedUrl}:${controlSignature}`, () => {
                    const row = getInteractionContextSnapshotStmt.get(session.sessionId, normalizedUrl, controlSignature);
                    const snapshotHtml = row?.snapshotHtml;
                    if (!snapshotHtml)
                        return null;
                    return parseHtmlToDocument(snapshotHtml, `${sourceLabel}:${normalizedUrl}:${controlSignature}`);
                });
            };
            // Current inventory contract is intentionally HTML/provenance/control-signature centered.
            // Rich snapshot metadata such as compositeAnchors, captured metrics, and snapshotBuildId
            // is proven earlier in capture/schema tests but is not reconstructed here until a concrete
            // downstream consumer exists.
            const inventory = {
                snapshotEngineAvailable,
                hardBoundaries,
                icBoundaryToleranceMs: 75,
                eventLocalByEventId: new Map(),
                interactionContextExactStable: new Map(),
                interactionContextExactAny: new Map(),
                interactionContextStableByUrl: new Map(),
                interactionContextAnyByUrl: new Map(),
                outcomeEventByTraceId: new Map(),
                sourceNodeById: new Map(),
                destinationNodeById: new Map(),
                urlEventFallbackByNormalizedUrl: new Map(),
            };
            for (const eventId of eventIds) {
                const eventRow = loadEventRow(eventId);
                const eventNormalizedUrl = extractNormalizedUrl(eventRow?.payload ?? null, eventRow?.pageUrl ?? null);
                const eventControlSignature = extractControlSignature(eventRow?.payload ?? null);
                const eventTabId = extractTabId(eventRow?.payload ?? null) ?? null;
                inventory.eventLocalByEventId.set(eventId, {
                    pageState: {
                        source: 'event-local-pageState',
                        temporalClass: 'action_local',
                        eventId,
                        timestamp: eventRow?.timestamp,
                        tabId: eventTabId,
                        normalizedUrl: eventNormalizedUrl,
                        controlSignature: eventControlSignature,
                        load: () => loadEventSnapshotField(eventId, 'pageState', 'event-local'),
                    },
                    pageSnapshot: {
                        source: 'event-local-pageSnapshot',
                        temporalClass: 'action_local',
                        eventId,
                        timestamp: eventRow?.timestamp,
                        tabId: eventTabId,
                        normalizedUrl: eventNormalizedUrl,
                        controlSignature: eventControlSignature,
                        load: () => loadEventSnapshotField(eventId, 'pageSnapshot', 'event-local'),
                    },
                });
            }
            for (const nodeId of sourceNodeIds) {
                inventory.sourceNodeById.set(nodeId, {
                    source: 'source-node-snapshot',
                    temporalClass: 'pre_action',
                    sourceNodeId: nodeId,
                    load: () => loadNodeSnapshot(nodeId, 'source-node'),
                });
            }
            for (const nodeId of destinationNodeIds) {
                inventory.destinationNodeById.set(nodeId, {
                    source: 'destination-node-snapshot',
                    temporalClass: 'outcome_state',
                    sourceNodeId: nodeId,
                    load: () => loadNodeSnapshot(nodeId, 'destination-node'),
                });
            }
            if (normalizedUrls.length > 0) {
                const normalizedPlaceholders = normalizedUrls.map(() => '?').join(', ');
                const icRows = this.db.prepare(`
          SELECT
            normalized_url AS normalizedUrl,
            control_signature AS controlSignature,
            is_stable AS isStable,
            captured_at AS capturedAt
          FROM interaction_contexts
          WHERE session_id = ?
            AND normalized_url IN (${normalizedPlaceholders})
          ORDER BY normalized_url ASC, control_signature ASC, is_stable DESC, captured_at DESC
        `).all(session.sessionId, ...normalizedUrls);
                for (const row of icRows) {
                    if (!row.normalizedUrl)
                        continue;
                    const cacheKey = buildIcKey(row.normalizedUrl, row.controlSignature ?? '');
                    const reliableIcTabs = icTabEvidence.get(cacheKey);
                    const icTabId = reliableIcTabs && reliableIcTabs.size === 1
                        ? Array.from(reliableIcTabs)[0]
                        : null;
                    const baseHandle = {
                        source: 'interaction-context-exact',
                        temporalClass: row.isStable === 1 ? 'outcome_state' : 'post_action',
                        timestamp: row.capturedAt,
                        tabId: icTabId,
                        normalizedUrl: row.normalizedUrl,
                        controlSignature: row.controlSignature ?? '',
                        load: () => loadInteractionContext(row.normalizedUrl, row.controlSignature ?? '', row.isStable === 1 ? 'ic-exact-stable' : 'ic-exact-any'),
                    };
                    if (!inventory.interactionContextExactAny.has(cacheKey)) {
                        inventory.interactionContextExactAny.set(cacheKey, baseHandle);
                    }
                    if (row.isStable === 1) {
                        if (!inventory.interactionContextExactStable.has(cacheKey)) {
                            inventory.interactionContextExactStable.set(cacheKey, baseHandle);
                        }
                        if (!inventory.interactionContextStableByUrl.has(row.normalizedUrl)) {
                            inventory.interactionContextStableByUrl.set(row.normalizedUrl, {
                                ...baseHandle,
                                source: 'interaction-context-stable-by-url',
                                load: () => loadInteractionContext(row.normalizedUrl, row.controlSignature ?? '', 'ic-stable-by-url'),
                            });
                        }
                    }
                    if (!inventory.interactionContextAnyByUrl.has(row.normalizedUrl)) {
                        inventory.interactionContextAnyByUrl.set(row.normalizedUrl, {
                            ...baseHandle,
                            source: 'interaction-context-any-by-url',
                            load: () => loadInteractionContext(row.normalizedUrl, row.controlSignature ?? '', 'ic-any-by-url'),
                        });
                    }
                }
            }
            if (traceIds.length > 0) {
                const tracePlaceholders = traceIds.map(() => '?').join(', ');
                const outcomeRows = this.db.prepare(`
          SELECT
            id AS eventId,
            trace_id AS traceId,
            timestamp
          FROM events
          WHERE session_id = ?
            AND type = 'outcome'
            AND trace_id IN (${tracePlaceholders})
          ORDER BY trace_id ASC, timestamp DESC
        `).all(session.sessionId, ...traceIds);
                for (const row of outcomeRows) {
                    if (!row.traceId || inventory.outcomeEventByTraceId.has(row.traceId))
                        continue;
                    inventory.outcomeEventByTraceId.set(row.traceId, {
                        source: 'outcome-event-snapshot',
                        temporalClass: 'outcome_state',
                        eventId: row.eventId,
                        timestamp: row.timestamp,
                        tabId: extractTabId(loadEventRow(row.eventId)?.payload ?? null) ?? null,
                        load: () => loadEventSnapshotField(row.eventId, 'pageState', 'outcome-event')
                            || loadEventSnapshotField(row.eventId, 'pageSnapshot', 'outcome-event'),
                    });
                }
            }
            if (normalizedUrls.length > 0) {
                const normalizedUrlSet = new Set(normalizedUrls);
                const eventRows = this.db.prepare(`
          SELECT id AS eventId, timestamp, page_url AS pageUrl
          FROM events
          WHERE session_id = ?
          ORDER BY timestamp DESC
        `).all(session.sessionId);
                for (const row of eventRows) {
                    const normalizedUrl = row.pageUrl ? (0, shared_1.normalizeUrl)(row.pageUrl) : null;
                    if (!normalizedUrl || !normalizedUrlSet.has(normalizedUrl))
                        continue;
                    if (inventory.urlEventFallbackByNormalizedUrl.has(normalizedUrl))
                        continue;
                    inventory.urlEventFallbackByNormalizedUrl.set(normalizedUrl, {
                        source: 'url-event-fallback',
                        temporalClass: 'unknown',
                        eventId: row.eventId,
                        timestamp: row.timestamp,
                        load: () => loadUrlFallbackSnapshot(row.eventId, normalizedUrl),
                    });
                }
            }
            console.log('[DEBUG] loadSnapshots inventory', {
                exactEventLocal: inventory.eventLocalByEventId.size,
                sourceNodes: inventory.sourceNodeById.size,
                destinationNodes: inventory.destinationNodeById.size,
                icExactStable: inventory.interactionContextExactStable.size,
                icExactAny: inventory.interactionContextExactAny.size,
                icStableByUrl: inventory.interactionContextStableByUrl.size,
                icAnyByUrl: inventory.interactionContextAnyByUrl.size,
                outcomeEvents: inventory.outcomeEventByTraceId.size,
                urlFallback: inventory.urlEventFallbackByNormalizedUrl.size,
            });
            const legacyGet = (nodeId, normalizedUrl, controlSignature) => {
                if (normalizedUrl && controlSignature) {
                    const exactKey = buildIcKey(normalizedUrl, controlSignature);
                    const stable = inventory.interactionContextExactStable.get(exactKey)?.load();
                    if (stable)
                        return stable;
                    const any = inventory.interactionContextExactAny.get(exactKey)?.load();
                    if (any)
                        return any;
                }
                if (normalizedUrl) {
                    const stableByUrl = inventory.interactionContextStableByUrl.get(normalizedUrl)?.load();
                    if (stableByUrl)
                        return stableByUrl;
                    const anyByUrl = inventory.interactionContextAnyByUrl.get(normalizedUrl)?.load();
                    if (anyByUrl)
                        return anyByUrl;
                    const eventFallback = inventory.urlEventFallbackByNormalizedUrl.get(normalizedUrl)?.load();
                    if (eventFallback)
                        return eventFallback;
                }
                if (!nodeId)
                    return null;
                return inventory.sourceNodeById.get(nodeId)?.load() ?? inventory.destinationNodeById.get(nodeId)?.load() ?? null;
            };
            const legacyGetSource = (nodeId, normalizedUrl, controlSignature) => {
                if (normalizedUrl && controlSignature) {
                    const exactKey = buildIcKey(normalizedUrl, controlSignature);
                    if (inventory.interactionContextExactStable.get(exactKey)?.load())
                        return 'interaction-context-exact';
                    if (inventory.interactionContextExactAny.get(exactKey)?.load())
                        return 'interaction-context-exact';
                }
                if (normalizedUrl) {
                    if (inventory.interactionContextStableByUrl.get(normalizedUrl)?.load())
                        return 'interaction-context-stable-by-url';
                    if (inventory.interactionContextAnyByUrl.get(normalizedUrl)?.load())
                        return 'interaction-context-any-by-url';
                    if (inventory.urlEventFallbackByNormalizedUrl.get(normalizedUrl)?.load())
                        return 'url-event-fallback';
                }
                if (nodeId) {
                    if (inventory.sourceNodeById.get(nodeId)?.load())
                        return 'source-node-snapshot';
                    if (inventory.destinationNodeById.get(nodeId)?.load())
                        return 'destination-node-snapshot';
                }
                return 'unavailable';
            };
            return {
                snapshotEngineAvailable,
                get(nodeId, normalizedUrl, controlSignature) {
                    return legacyGet(nodeId, normalizedUrl, controlSignature);
                },
                getSource(nodeId, normalizedUrl, controlSignature) {
                    return legacyGetSource(nodeId, normalizedUrl, controlSignature);
                },
                selectForStep(step, mode = 'action') {
                    return (0, snapshot_selector_1.selectSnapshotForStep)(step, inventory, mode);
                },
            };
        }
        catch (err) {
            console.error('[AIR] loadSnapshots fatal error:', err);
            const emptyInventory = {
                snapshotEngineAvailable: false,
                hardBoundaries: [],
                icBoundaryToleranceMs: 75,
                eventLocalByEventId: new Map(),
                interactionContextExactStable: new Map(),
                interactionContextExactAny: new Map(),
                interactionContextStableByUrl: new Map(),
                interactionContextAnyByUrl: new Map(),
                outcomeEventByTraceId: new Map(),
                sourceNodeById: new Map(),
                destinationNodeById: new Map(),
                urlEventFallbackByNormalizedUrl: new Map(),
            };
            return {
                snapshotEngineAvailable: false,
                get(_nodeId, _normalizedUrl, _controlSignature) {
                    return null;
                },
                getSource(_nodeId, _normalizedUrl, _controlSignature) {
                    return 'unavailable';
                },
                selectForStep(step, mode = 'action') {
                    return (0, snapshot_selector_1.selectSnapshotForStep)(step, emptyInventory, mode);
                },
            };
        }
    }
    /**
     * PHASE 3B: Lightweight Metadata Extraction
     *
     * Fetches only the minimal metadata required to build the public GenerationContext
     * without loading the massive raw payload. Uses SQLite JSON functions to parse
     * only the specific fields needed (selectorResolution, fallback hints).
     */
    getGenerationEventMetadataByIds(eventIds) {
        const result = new Map();
        if (!eventIds || eventIds.length === 0)
            return result;
        const uniqueIds = Array.from(new Set(eventIds));
        const placeholders = uniqueIds.map(() => '?').join(',');
        const query = `
      SELECT
        id,
        json_extract(payload, '$.selectorResolution') as selectorResolution,
        json_extract(payload, '$.fingerprint.selector') as legacySelector,
        json_extract(payload, '$.fingerprint.textExcerpt') as elementText,
        json_extract(payload, '$.fingerprint.tagName') as tagName
      FROM events
      WHERE id IN (${placeholders})
    `;
        const rows = this.db.prepare(query).all(...uniqueIds);
        for (const row of rows) {
            let selectorResolution;
            try {
                if (row.selectorResolution) {
                    const parsed = JSON.parse(row.selectorResolution);
                    const validation = runtime_schemas_1.SelectorResolutionSchema.safeParse(parsed);
                    if (validation.success) {
                        selectorResolution = validation.data;
                    }
                }
            }
            catch (e) {
                // Silently ignore invalid JSON per requirements
            }
            const metadata = { id: row.id };
            if (selectorResolution) {
                metadata.selectorResolution = selectorResolution;
            }
            const fallbackHints = {};
            if (row.legacySelector)
                fallbackHints.legacySelector = row.legacySelector;
            if (row.elementText)
                fallbackHints.elementText = row.elementText;
            if (row.tagName)
                fallbackHints.tagName = row.tagName;
            if (Object.keys(fallbackHints).length > 0) {
                metadata.fallbackHints = fallbackHints;
            }
            result.set(row.id, metadata);
        }
        return result;
    }
    /**
     * PHASE 3D: Service Orchestration
     *
     * Orchestrates the building of a full session, fetching of lightweight
     * event metadata, and derivation of the pure GenerationContext.
     * This is the entrypoint for future MCP codegen workflows.
     */
    buildGenerationContext(sessionId) {
        const session = this.buildSession(sessionId);
        const eventIds = session.steps
            .map(step => step.eventId)
            .filter((id) => typeof id === 'string' && id.length > 0);
        const eventsById = this.getGenerationEventMetadataByIds(eventIds);
        return (0, generation_builder_1.deriveGenerationContext)({ session, eventsById });
    }
    /**
     * PHASE 3E: MCP read path
     *
     * Lightweight discovery of recorded sessions without building GenerationContext
     */
    listRecordedSessions(options = {}) {
        const rawLimit = options.limit ?? 10;
        const limit = Math.min(Math.max(Math.floor(rawLimit), 1), 50);
        const rawOffset = options.offset ?? 0;
        const offset = Math.max(Math.floor(rawOffset), 0);
        const recentDays = typeof options.recentDays === 'number' && Number.isFinite(options.recentDays)
            ? Math.min(Math.max(Math.floor(options.recentDays), 1), 365)
            : undefined;
        const whereClauses = [];
        const params = [];
        if (recentDays !== undefined) {
            const cutoff = Date.now() - recentDays * 86400000;
            whereClauses.push('started_at >= ?');
            params.push(cutoff);
        }
        const whereSql = whereClauses.length > 0
            ? `WHERE ${whereClauses.join(' AND ')}`
            : '';
        const query = `
      SELECT
        id as sessionId,
        started_at as recordedAt,
        last_event_at as lastEventAt,
        event_count as eventCount,
        status,
        json_extract(
          CASE
            WHEN metadata IS NOT NULL AND json_valid(metadata) THEN metadata
            ELSE '{}'
          END,
          '$.title'
        ) as title,
        json_extract(
          CASE
            WHEN metadata IS NOT NULL AND json_valid(metadata) THEN metadata
            ELSE '{}'
          END,
          '$.url'
        ) as url
      FROM sessions
      ${whereSql}
      ORDER BY started_at DESC
      LIMIT ? OFFSET ?
    `;
        const queryLimit = limit + 1;
        const rows = this.db.prepare(query).all(...params, queryLimit, offset);
        const hasMore = rows.length > limit;
        const visibleRows = rows.slice(0, limit);
        const sessions = visibleRows.map(row => ({
            sessionId: String(row.sessionId),
            recordedAt: typeof row.recordedAt === 'number' ? row.recordedAt : undefined,
            lastEventAt: typeof row.lastEventAt === 'number' ? row.lastEventAt : undefined,
            eventCount: typeof row.eventCount === 'number' ? row.eventCount : undefined,
            status: typeof row.status === 'string' ? row.status : undefined,
            title: typeof row.title === 'string' && row.title.length > 0 ? row.title : undefined,
            url: typeof row.url === 'string' && row.url.length > 0 ? row.url : undefined,
        }));
        return {
            sessions,
            limit,
            offset,
            hasMore,
        };
    }
    /**
     * PHASE 3E-C: MCP read path
     *
     * Returns a human-readable ASCII/Markdown review of a recorded session.
     * Driven by the FlowReview layer, avoiding raw DOM/snapshot data.
     */
    getFlowReviewMarkdown(sessionId) {
        const session = this.buildSession(sessionId);
        const review = flow_review_service_1.FlowReviewService.build(session);
        return flow_review_formatter_1.FlowReviewFormatter.formatForConsole(review);
    }
}
exports.CodegenService = CodegenService;
