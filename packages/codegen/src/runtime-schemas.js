"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationContextSchemaV1 = exports.GenerationGuidanceSchemaV1 = exports.IgnoredGenerationStepSchemaV1 = exports.IgnoredStepReasonSchemaV1 = exports.GenerationStepSchemaV1 = exports.FallbackHintsSchema = exports.GenerationAssertionSchema = exports.ResolvedTargetSchema = exports.SelectorResolutionSchema = void 0;
const zod_1 = require("zod");

exports.SelectorResolutionSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal('air:selector-resolution:v1'),
    status: zod_1.z.enum(['resolved', 'unresolved']),
    selected: zod_1.z.object({
        selector: zod_1.z.string(),
        engine: zod_1.z.enum(['css', 'xpath']),
        family: zod_1.z.string().optional(),
        source: zod_1.z.enum(['shadow-preference', 'legacy-primary']),
        proposalSource: zod_1.z.string().nullable().optional(),
        matchCount: zod_1.z.number().nullable().optional(),
        visibleMatchCount: zod_1.z.number().nullable().optional(),
        replaySafe: zod_1.z.boolean(),
        confidence: zod_1.z.enum(['high', 'medium', 'low']).optional(),
        warningCodes: zod_1.z.array(zod_1.z.string()).optional(),
        proofSource: zod_1.z.string().nullable().optional(),
        selectedReason: zod_1.z.string().optional(),
    }).optional(),
    blockedReason: zod_1.z.string().nullable().optional(),
});

exports.ResolvedTargetSchema = zod_1.z.object({
    kind: zod_1.z.enum(['css', 'xpath', 'role', 'text', 'label', 'placeholder', 'testid']),
    value: zod_1.z.string(),
    options: zod_1.z.object({
        name: zod_1.z.string().optional(),
        exact: zod_1.z.boolean().optional(),
    }).optional(),
    source: zod_1.z.enum(['selectorResolution', 'legacy_fallback']),
    replaySafe: zod_1.z.boolean(),
});

exports.GenerationAssertionSchema = zod_1.z.object({
    type: zod_1.z.enum(['url', 'element_visible', 'element_text', 'title', 'custom']),
    value: zod_1.z.string().optional(),
    selector: zod_1.z.string().optional(),
    source: zod_1.z.enum(['outcome', 'anchor', 'user_defined']).optional(),
    confidence: zod_1.z.number().optional(),
});

exports.FallbackHintsSchema = zod_1.z.object({
    legacySelector: zod_1.z.string().optional(),
    elementText: zod_1.z.string().optional(),
    tagName: zod_1.z.string().optional(),
    attributes: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional(),
});

exports.GenerationStepSchemaV1 = zod_1.z.object({
    stepIndex: zod_1.z.number(),
    eventId: zod_1.z.string().optional(),
    traceId: zod_1.z.string().optional(),
    action: zod_1.z.string(),
    intent: zod_1.z.string(),
    value: zod_1.z.string().optional(),
    locatorStatus: zod_1.z.enum(['resolved', 'unresolved', 'not_applicable']),
    resolvedTarget: exports.ResolvedTargetSchema.optional(),
    fallbackHints: exports.FallbackHintsSchema.optional(),
    selectorResolution: exports.SelectorResolutionSchema.optional(),
    assertions: zod_1.z.array(exports.GenerationAssertionSchema).default([]),
    pageUrl: zod_1.z.string().optional(),
    normalizedUrl: zod_1.z.string().optional(),
    outcomeType: zod_1.z.string().optional(),
    confidence: zod_1.z.number().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// IGNORED STEPS — mirror of core/types/generation.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reason codes for why a recorded step was moved to ignoredSteps.
 * Must stay in sync with core/types/generation.ts IgnoredStepReasonSchemaV1.
 */
exports.IgnoredStepReasonSchemaV1 = zod_1.z.enum([
    'broad_no_change_container_click',
    'duplicate_lower_quality_action',
    'non_replay_background_click',
    'unknown_low_value_step',
]);

/**
 * IgnoredGenerationStepV1 — extends GenerationStepSchemaV1 with an ignore reason.
 * Must stay in sync with core/types/generation.ts IgnoredGenerationStepSchemaV1.
 */
exports.IgnoredGenerationStepSchemaV1 = exports.GenerationStepSchemaV1.extend({
    ignoredReason: exports.IgnoredStepReasonSchemaV1,
    ignoredExplanation: zod_1.z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION GUIDANCE — mirror of core/types/generation.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GenerationGuidanceV1 — typed rules for the IDE LLM code generator.
 * Must stay in sync with core/types/generation.ts GenerationGuidanceSchemaV1.
 */
exports.GenerationGuidanceSchemaV1 = zod_1.z.object({
    replaySource: zod_1.z.literal('steps'),
    ignoredStepsPolicy: zod_1.z.literal('context_only'),
    rules: zod_1.z.array(zod_1.z.string()),
});

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

exports.GenerationContextSchemaV1 = zod_1.z.object({
    schemaVersion: zod_1.z.literal('air:generation-context:v1'),
    sessionId: zod_1.z.string(),
    url: zod_1.z.string(),
    recordedAt: zod_1.z.number(),
    steps: zod_1.z.array(exports.GenerationStepSchemaV1),
    ignoredSteps: zod_1.z.array(exports.IgnoredGenerationStepSchemaV1).default([]),
    generationGuidance: exports.GenerationGuidanceSchemaV1.optional(),
    metadata: zod_1.z.object({
        generatedAt: zod_1.z.number().optional(),
        source: zod_1.z.literal('air-db').optional(),
    }).optional(),
});
