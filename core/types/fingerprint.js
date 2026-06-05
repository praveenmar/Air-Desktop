"use strict";
// Purpose: Core types and schemas for DOM element identification (Fingerprints).
// Prototype Origin: types.js (SelectorPriority, ElementFingerprint)
// Changes: Converted to strict TypeScript with Zod validation.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ElementFingerprintSchema = exports.TargetIdentityStatusSchema = exports.TargetIdentitySourceSchema = exports.AccessibilityEvidenceSchema = exports.BoundedFieldContextSchema = exports.BoundedContainerSelectorCandidateSchema = exports.CapturedSelectorCandidateArraySchema = exports.CapturedSelectorCandidateSchema = exports.CapturedSelectorCandidateStrengthSchema = exports.CapturedSelectorCandidateFamilySchema = exports.CapturedSelectorCandidateEngineSchema = exports.SelectorAmbiguityMetadataSchema = exports.FingerprintContextSchema = exports.SelectorPrioritySchema = void 0;
const zod_1 = require("zod");
/** Selector priority (used by Interceptor when choosing selector) */
exports.SelectorPrioritySchema = zod_1.z.enum([
    'data-testid',
    'id',
    'class',
    'attribute',
    'path',
    'other',
    'text', // Added based on event logs
    'xpath', // Added based on event logs
    'chained' // Added based on interceptor.js capabilities
]);
/** Contextual tags surrounding the element */
exports.FingerprintContextSchema = zod_1.z.object({
    parentTag: zod_1.z.string().nullable(),
    nearestContainerTag: zod_1.z.string().nullable(),
}).passthrough();
exports.SelectorAmbiguityMetadataSchema = zod_1.z.object({
    originalSelector: zod_1.z.string(),
    originalPriority: exports.SelectorPrioritySchema.optional(),
    matchCount: zod_1.z.number().int().min(0),
    visibleMatchCount: zod_1.z.number().int().min(0),
    positionInMatches: zod_1.z.number().int().min(0).nullable().optional(),
    isUnique: zod_1.z.boolean(),
    isAmbiguous: zod_1.z.boolean(),
}).passthrough();
exports.CapturedSelectorCandidateEngineSchema = zod_1.z.enum([
    'css',
    'text',
    'xpath',
]);
exports.CapturedSelectorCandidateFamilySchema = zod_1.z.enum([
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
exports.CapturedSelectorCandidateStrengthSchema = zod_1.z.enum([
    'strong',
    'medium',
    'weak',
]);
function normalizeWarningCodes(codes) {
    const unique = Array.from(new Set(codes.map(code => code.trim()).filter(Boolean)));
    return unique.length > 0 ? unique : undefined;
}
exports.CapturedSelectorCandidateSchema = zod_1.z.object({
    selector: zod_1.z.string().trim().min(1),
    engine: exports.CapturedSelectorCandidateEngineSchema,
    family: exports.CapturedSelectorCandidateFamilySchema,
    strength: exports.CapturedSelectorCandidateStrengthSchema,
    source: zod_1.z.literal('capture'),
    isPrimary: zod_1.z.boolean().optional(),
    matchCount: zod_1.z.number().int().min(0).nullable().optional(),
    visibleMatchCount: zod_1.z.number().int().min(0).nullable().optional(),
    positionInAllMatches: zod_1.z.number().int().min(0).nullable().optional(),
    positionInVisibleMatches: zod_1.z.number().int().min(0).nullable().optional(),
    usesDynamicClass: zod_1.z.boolean().optional(),
    usesIndex: zod_1.z.boolean().optional(),
    warningCodes: zod_1.z.array(zod_1.z.string().trim().min(1)).optional().transform(codes => {
        if (!codes)
            return undefined;
        return normalizeWarningCodes(codes);
    }),
});
exports.CapturedSelectorCandidateArraySchema = zod_1.z.array(zod_1.z.unknown()).transform((entries) => {
    const valid = [];
    for (const entry of entries) {
        const parsed = exports.CapturedSelectorCandidateSchema.safeParse(entry);
        if (!parsed.success)
            continue;
        valid.push(parsed.data);
    }
    return valid.length > 0 ? valid : undefined;
});
exports.BoundedContainerSelectorCandidateSchema = zod_1.z.object({
    selector: zod_1.z.string(),
    kind: zod_1.z.string(),
    isClean: zod_1.z.boolean().optional(),
}).passthrough();
exports.BoundedFieldContextSchema = zod_1.z.object({
    fieldLabelText: zod_1.z.string().nullable().optional(),
    fieldRelation: zod_1.z.enum([
        'label-for',
        'wrapped-label',
        'aria-labelledby',
        'sibling-label',
        'bounded-container',
    ]).nullable().optional(),
    targetControlKind: zod_1.z.enum([
        'input',
        'textarea',
        'select',
        'custom-trigger',
        'combobox',
        'searchbox',
        'contenteditable',
        'unknown',
    ]).nullable().optional(),
    visibleControlCountInContainer: zod_1.z.number().int().min(0).nullable().optional(),
    targetIndexWithinContainer: zod_1.z.number().int().min(0).nullable().optional(),
    boundedContainerSummary: zod_1.z.string().nullable().optional(),
    boundedContainerSelectorCandidates: zod_1.z.array(exports.BoundedContainerSelectorCandidateSchema).optional(),
    cleanParentSelector: zod_1.z.string().nullable().optional(),
    cleanChildSelector: zod_1.z.string().nullable().optional(),
    containerSelector: zod_1.z.string().nullable().optional(),
    competingControlCount: zod_1.z.number().int().min(0).nullable().optional(),
    duplicateLabelCount: zod_1.z.number().int().min(0).nullable().optional(),
    isValid: zod_1.z.boolean().optional(),
    blockedReason: zod_1.z.string().nullable().optional(),
}).passthrough();
exports.AccessibilityEvidenceSchema = zod_1.z.object({
    role: zod_1.z.string().nullable().optional(),
    accessibleName: zod_1.z.string().nullable().optional(),
    accessibleNameSource: zod_1.z.enum([
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
    ]).optional(),
    labelText: zod_1.z.string().nullable().optional(),
    labelledByIds: zod_1.z.array(zod_1.z.string()).optional(),
    isNativeLabelAssociation: zod_1.z.boolean().optional(),
}).passthrough();
exports.TargetIdentitySourceSchema = zod_1.z.enum([
    'pageState',
    'pageSnapshot',
    'interactionContext',
]);
exports.TargetIdentityStatusSchema = zod_1.z.enum([
    'emitted',
    'target-not-element',
    'target-detached',
    'target-not-in-snapshot',
    'shadow-not-serialized',
    'cross-origin-frame',
    'unsupported',
]);
/** Compact fingerprint for an element (4-layer identification) */
exports.ElementFingerprintSchema = zod_1.z.object({
    selector: zod_1.z.string(),
    selectorPriority: exports.SelectorPrioritySchema,
    selectorRank: zod_1.z.number().int().min(1).max(10).optional(),
    tagName: zod_1.z.string().optional(),
    parentSelector: zod_1.z.string().nullable().optional(),
    textExcerpt: zod_1.z.string().nullable(),
    context: exports.FingerprintContextSchema,
    attributes: zod_1.z.record(zod_1.z.string(), zod_1.z.string().optional()),
    selectorCandidates: exports.CapturedSelectorCandidateArraySchema.optional(),
    selectorAmbiguity: exports.SelectorAmbiguityMetadataSchema.optional(),
    boundedFieldContext: exports.BoundedFieldContextSchema.optional(),
    accessibilityEvidence: exports.AccessibilityEvidenceSchema.optional(),
    attributesHash: zod_1.z.string(),
    targetNodeId: zod_1.z.string().trim().min(1).optional(),
    targetIdentitySource: exports.TargetIdentitySourceSchema.optional(),
    targetIdentityStatus: exports.TargetIdentityStatusSchema.optional(),
}).passthrough();
