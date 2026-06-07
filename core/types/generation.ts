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

// ─────────────────────────────────────────────────────────────────────────────
// IGNORED STEPS — recorded events not recommended for replay by default
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reason codes for why a recorded step was moved to ignoredSteps.
 * These are machine-readable and stable across versions.
 *
 * Only `broad_no_change_container_click` is active in GC-1A.
 * Additional codes are reserved for GC-2 onwards.
 */
export const IgnoredStepReasonSchemaV1 = z.enum([
  /** Click on a broad/layout container with no_change outcome and no assertions. */
  "broad_no_change_container_click",
  /** Lower-quality duplicate of a nearby resolved action with the same intent. */
  "duplicate_lower_quality_action",
  /** Background or focus click with no replay value. */
  "non_replay_background_click",
  /** Low-value step that does not fit a more specific category. */
  "unknown_low_value_step",
]);

export type IgnoredStepReasonV1 = z.infer<typeof IgnoredStepReasonSchemaV1>;

/**
 * IgnoredGenerationStepV1 is a GenerationStepV1 extended with an ignore reason.
 * It is kept in ignoredSteps for LLM context and diagnostics but must NOT be
 * replayed by default.
 *
 * Extends GenerationStepSchemaV1 — no field duplication.
 */
export const IgnoredGenerationStepSchemaV1 = GenerationStepSchemaV1.extend({
  ignoredReason: IgnoredStepReasonSchemaV1,
  ignoredExplanation: z.string().optional(),
});

export type IgnoredGenerationStepV1 = z.infer<typeof IgnoredGenerationStepSchemaV1>;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION GUIDANCE — typed rules for the IDE LLM code generator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GenerationGuidanceV1 carries explicit, typed rules for the IDE LLM so users
 * do not need to write a perfect prompt every time.
 *
 * replaySource: always "steps" — the LLM generates from steps, not ignoredSteps.
 * ignoredStepsPolicy: always "context_only" — ignoredSteps is diagnostic only.
 * rules: ordered list of generation directives for the LLM.
 */
export const GenerationGuidanceSchemaV1 = z.object({
  replaySource: z.literal("steps"),
  ignoredStepsPolicy: z.literal("context_only"),
  rules: z.array(z.string()),
});

export type GenerationGuidanceV1 = z.infer<typeof GenerationGuidanceSchemaV1>;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION CONTEXT — the full public machine-generation contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GenerationContextV1 is the pristine public generation contract for AIR.
 *
 * It is intended for current deterministic codegen and future MCP/LLM consumers.
 * It explicitly excludes massive snapshots and heavy resolver metadata.
 *
 * Shape:
 *   steps              = replay-recommended actions (generate from these)
 *   ignoredSteps       = recorded but not recommended for replay (context/diagnostics only)
 *   generationGuidance = typed rules for the IDE LLM
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

  /**
   * Recorded steps that are not recommended for replay by default.
   * The IDE LLM must NOT generate code from these unless explicitly requested.
   * Use for diagnostics, context, and fallback explanation only.
   */
  ignoredSteps: z.array(IgnoredGenerationStepSchemaV1).default([]),

  /**
   * Typed generation rules for IDE LLMs.
   * When present, the LLM should follow these rules instead of relying solely
   * on user prompts.
   */
  generationGuidance: GenerationGuidanceSchemaV1.optional(),

  metadata: z.object({
    generatedAt: z.number().optional(),
    source: z.literal("air-db").optional()
  }).optional()
});

export type GenerationContextV1 = z.infer<typeof GenerationContextSchemaV1>;
