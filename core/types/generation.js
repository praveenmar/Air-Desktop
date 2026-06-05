"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerationContextSchemaV1 = exports.GenerationStepSchemaV1 = exports.FallbackHintsSchema = exports.GenerationAssertionSchema = exports.ResolvedTargetSchema = void 0;
const zod_1 = require("zod");
const events_1 = require("./events");
/**
 * ResolvedTarget is the framework-neutral representation of a locatable element.
 * It deliberately avoids Playwright-specific naming (like "locator" or "playwright")
 * because AIR GenerationContext must remain framework-neutral to support future
 * MCP/LLM adapters for Cypress, Selenium, etc.
 */
exports.ResolvedTargetSchema = zod_1.z.object({
    kind: zod_1.z.enum([
        "css",
        "xpath",
        "role",
        "text",
        "label",
        "placeholder",
        "testid"
    ]),
    value: zod_1.z.string(),
    options: zod_1.z.object({
        name: zod_1.z.string().optional(),
        exact: zod_1.z.boolean().optional()
    }).optional(),
    source: zod_1.z.enum([
        "selectorResolution",
        "legacy_fallback"
    ]),
    replaySafe: zod_1.z.boolean()
});
/**
 * GenerationAssertion represents a suggested verification derived from the recorded flow outcome,
 * page transition, destination anchors, or future user-defined assertion capture.
 * It is NOT necessarily an explicitly recorded user assertion.
 * It excludes raw DOM, snapshot traces, and heavy proof reports to keep the context lean.
 */
exports.GenerationAssertionSchema = zod_1.z.object({
    type: zod_1.z.enum([
        "url",
        "element_visible",
        "element_text",
        "title",
        "custom"
    ]),
    value: zod_1.z.string().optional(),
    selector: zod_1.z.string().optional(),
    source: zod_1.z.enum([
        "outcome",
        "anchor",
        "user_defined"
    ]).optional(),
    confidence: zod_1.z.number().optional()
});
/**
 * FallbackHints provide lightweight facts for the LLM or baseline codegen when
 * AIR does not have a safe resolved target.
 * It intentionally omits raw DOM, full fingerprints, and large candidate arrays.
 */
exports.FallbackHintsSchema = zod_1.z.object({
    legacySelector: zod_1.z.string().optional(),
    elementText: zod_1.z.string().optional(),
    tagName: zod_1.z.string().optional(),
    attributes: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).optional()
});
/**
 * GenerationStepV1 represents a single interaction or event in the recorded flow.
 *
 * locatorStatus semantics:
 * - "resolved": resolvedTarget is present and safe.
 * - "unresolved": target action needs a locator, but AIR does not have a safe resolved target.
 * - "not_applicable": step does not need a locator (e.g., navigation-only).
 */
exports.GenerationStepSchemaV1 = zod_1.z.object({
    stepIndex: zod_1.z.number(),
    eventId: zod_1.z.string().optional(),
    traceId: zod_1.z.string().optional(),
    action: zod_1.z.string(),
    intent: zod_1.z.string(),
    value: zod_1.z.string().optional(),
    locatorStatus: zod_1.z.enum([
        "resolved",
        "unresolved",
        "not_applicable"
    ]),
    resolvedTarget: exports.ResolvedTargetSchema.optional(),
    fallbackHints: exports.FallbackHintsSchema.optional(),
    selectorResolution: events_1.SelectorResolutionSchema.optional(),
    assertions: zod_1.z.array(exports.GenerationAssertionSchema).default([]),
    pageUrl: zod_1.z.string().optional(),
    normalizedUrl: zod_1.z.string().optional(),
    outcomeType: zod_1.z.string().optional(),
    confidence: zod_1.z.number().optional()
});
/**
 * GenerationContextV1 is the pristine public generation contract for AIR.
 *
 * It is intended for current deterministic codegen and future MCP/LLM consumers.
 * It explicitly excludes massive snapshots and heavy resolver metadata.
 *
 * Future MCP Pagination Design Note:
 * MCP tools exposing this context must be pagination-aware.
 * Expected future tools:
 *   get_flow_steps({ sessionId, offset: 0, limit: 25, mode: "summary" })
 * returning { totalSteps, offset, limit, hasMore, steps }.
 * Massive snapshots must never be included by default; a separate
 * `get_step_snapshot_context(eventId)` tool should handle those if needed.
 */
exports.GenerationContextSchemaV1 = zod_1.z.object({
    schemaVersion: zod_1.z.literal("air:generation-context:v1"),
    sessionId: zod_1.z.string(),
    url: zod_1.z.string(),
    recordedAt: zod_1.z.number(),
    steps: zod_1.z.array(exports.GenerationStepSchemaV1),
    metadata: zod_1.z.object({
        generatedAt: zod_1.z.number().optional(),
        source: zod_1.z.literal("air-db").optional()
    }).optional()
});
