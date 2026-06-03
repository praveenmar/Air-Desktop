import { z } from 'zod';
import { SelectorResolutionSchema } from './events';

/**
 * ResolvedTarget is the framework-neutral representation of a locatable element.
 * It deliberately avoids Playwright-specific naming (like "locator" or "playwright")
 * because AIR GenerationContext must remain framework-neutral to support future
 * MCP/LLM adapters for Cypress, Selenium, etc.
 */
export const ResolvedTargetSchema = z.object({
  kind: z.enum([
    "css",
    "xpath",
    "role",
    "text",
    "label",
    "placeholder",
    "testid"
  ]),
  value: z.string(),
  options: z.object({
    name: z.string().optional(),
    exact: z.boolean().optional()
  }).optional(),
  source: z.enum([
    "selectorResolution",
    "legacy_fallback"
  ]),
  replaySafe: z.boolean()
});

export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;

/**
 * GenerationAssertion represents a suggested verification derived from the recorded flow outcome,
 * page transition, destination anchors, or future user-defined assertion capture.
 * It is NOT necessarily an explicitly recorded user assertion.
 * It excludes raw DOM, snapshot traces, and heavy proof reports to keep the context lean.
 */
export const GenerationAssertionSchema = z.object({
  type: z.enum([
    "url",
    "element_visible",
    "element_text",
    "title",
    "custom"
  ]),
  value: z.string().optional(),
  selector: z.string().optional(),
  source: z.enum([
    "outcome",
    "anchor",
    "user_defined"
  ]).optional(),
  confidence: z.number().optional()
});

export type GenerationAssertion = z.infer<typeof GenerationAssertionSchema>;

/**
 * FallbackHints provide lightweight facts for the LLM or baseline codegen when
 * AIR does not have a safe resolved target.
 * It intentionally omits raw DOM, full fingerprints, and large candidate arrays.
 */
export const FallbackHintsSchema = z.object({
  legacySelector: z.string().optional(),
  elementText: z.string().optional(),
  tagName: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional()
});

export type FallbackHints = z.infer<typeof FallbackHintsSchema>;

/**
 * GenerationStepV1 represents a single interaction or event in the recorded flow.
 * 
 * locatorStatus semantics:
 * - "resolved": resolvedTarget is present and safe.
 * - "unresolved": target action needs a locator, but AIR does not have a safe resolved target.
 * - "not_applicable": step does not need a locator (e.g., navigation-only).
 */
export const GenerationStepSchemaV1 = z.object({
  stepIndex: z.number(),

  eventId: z.string().optional(),
  traceId: z.string().optional(),

  action: z.string(),
  intent: z.string(),
  value: z.string().optional(),

  locatorStatus: z.enum([
    "resolved",
    "unresolved",
    "not_applicable"
  ]),

  resolvedTarget: ResolvedTargetSchema.optional(),
  fallbackHints: FallbackHintsSchema.optional(),

  selectorResolution: SelectorResolutionSchema.optional(),

  assertions: z.array(GenerationAssertionSchema).default([]),

  pageUrl: z.string().optional(),
  normalizedUrl: z.string().optional(),
  outcomeType: z.string().optional(),
  confidence: z.number().optional()
});

export type GenerationStepV1 = z.infer<typeof GenerationStepSchemaV1>;

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
export const GenerationContextSchemaV1 = z.object({
  schemaVersion: z.literal("air:generation-context:v1"),

  sessionId: z.string(),
  url: z.string(),
  recordedAt: z.number(),

  steps: z.array(GenerationStepSchemaV1),

  metadata: z.object({
    generatedAt: z.number().optional(),
    source: z.literal("air-db").optional()
  }).optional()
});

export type GenerationContextV1 = z.infer<typeof GenerationContextSchemaV1>;
