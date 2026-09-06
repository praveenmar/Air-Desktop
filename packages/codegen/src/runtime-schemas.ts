import { z } from 'zod';

export const RealizationStepSchema = z.object({
  action: z.enum(['click', 'scroll', 'hover', 'fill']),
  kind: z.string(),
  value: z.string()
});

export type RealizationStep = z.infer<typeof RealizationStepSchema>;

export const SelectorResolutionSchema = z.object({
  schemaVersion: z.literal('air:selector-resolution:v1'),
  status: z.enum(['resolved', 'unresolved']),
  selected: z.object({
    selector: z.string(),
    engine: z.enum(['css', 'xpath', 'playwright-aria', 'playwright-native']),
    family: z.string().optional(),
    source: z.enum(['shadow-preference', 'legacy-primary']),
    proposalSource: z.string().nullable().optional(),
    matchCount: z.number().nullable().optional(),
    visibleMatchCount: z.number().nullable().optional(),
    replaySafe: z.boolean(),
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    warningCodes: z.array(z.string()).optional(),
    proofSource: z.string().nullable().optional(),
    selectedReason: z.string().optional(),
    realizationSteps: z.array(RealizationStepSchema).optional(),
  }).optional(),
  blockedReason: z.string().nullable().optional(),
});

export type SelectorResolutionV1 = z.infer<typeof SelectorResolutionSchema>;

export const ResolvedTargetSchema = z.object({
  kind: z.enum(['css', 'xpath', 'role', 'text', 'label', 'placeholder', 'testid', 'frame', 'native']),
  value: z.string(),
  realizationSteps: z.array(RealizationStepSchema).optional(),
  classId: z.string().optional(),
  options: z.object({
    name: z.string().optional(),
    exact: z.boolean().optional(),
  }).optional(),
  source: z.enum(['selectorResolution', 'legacy_fallback']),
  replaySafe: z.boolean(),
});

export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;

export const GenerationAssertionSchema = z.object({
  type: z.enum(['url', 'element_visible', 'element_text', 'title', 'custom']),
  value: z.string().optional(),
  selector: z.string().optional(),
  source: z.enum(['outcome', 'anchor', 'user_defined']).optional(),
  confidence: z.number().optional(),
});

export type GenerationAssertion = z.infer<typeof GenerationAssertionSchema>;

export const FallbackHintsSchema = z.object({
  legacySelector: z.string().optional(),
  elementText: z.string().optional(),
  tagName: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional(),
});

export type FallbackHints = z.infer<typeof FallbackHintsSchema>;

/**
 * Runtime mirror of core/types/events.ts UnresolvedInteractionSchema.
 * Must stay in sync with that schema. Present when the interceptor detected
 * an autocomplete option click but could not resolve a stable locator.
 */
export const UnresolvedInteractionV1Schema = z.object({
  classTokens: z.array(z.string()).optional(),
  textContent: z.string().optional(),
  role: z.string().optional(),
  tagName: z.string().optional(),
  siblings: z.array(z.object({
    tagName: z.string(),
    textContent: z.string(),
  })).optional(),
  ancestors: z.array(z.object({
    tagName: z.string(),
    classTokens: z.array(z.string()).optional(),
    role: z.string().optional(),
  })).optional(),
  detectionFailureReason: z.enum([
    'no_aria_role',
    'no_class_match',
    'container_not_found',
    'no_input_context',
  ]).optional(),
}).strip();

export type UnresolvedInteractionV1 = z.infer<typeof UnresolvedInteractionV1Schema>;

export const GenerationStepSchemaV1 = z.object({
  stepIndex: z.number(),
  eventId: z.string().optional(),
  traceId: z.string().optional(),
  action: z.string(),
  intent: z.string(),
  value: z.string().optional(),
  locatorStatus: z.enum(['resolved', 'unresolved', 'not_applicable']),
  resolvedTarget: ResolvedTargetSchema.optional(),
  fallbackHints: FallbackHintsSchema.optional(),
  selectorResolution: SelectorResolutionSchema.optional(),
  assertions: z.array(GenerationAssertionSchema).default([]),
  pageUrl: z.string().optional(),
  normalizedUrl: z.string().optional(),
  outcomeType: z.string().optional(),
  confidence: z.number().optional(),
  /** Present when option detection failed with active input session. Capped at 2 KB by emitter. */
  unresolvedInteraction: UnresolvedInteractionV1Schema.optional(),
});

export type GenerationStepV1 = z.infer<typeof GenerationStepSchemaV1>;

// ─────────────────────────────────────────────────────────────────────────────
// IGNORED STEPS — mirror of core/types/generation.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reason codes for why a recorded step was moved to ignoredSteps.
 * Must stay in sync with core/types/generation.ts IgnoredStepReasonSchemaV1.
 */
export const IgnoredStepReasonSchemaV1 = z.enum([
  'broad_no_change_container_click',
  'duplicate_lower_quality_action',
  'non_replay_background_click',
  'unknown_low_value_step',
]);

export type IgnoredStepReasonV1 = z.infer<typeof IgnoredStepReasonSchemaV1>;

/**
 * IgnoredGenerationStepV1 — extends GenerationStepSchemaV1 with an ignore reason.
 * Must stay in sync with core/types/generation.ts IgnoredGenerationStepSchemaV1.
 */
export const IgnoredGenerationStepSchemaV1 = GenerationStepSchemaV1.extend({
  ignoredReason: IgnoredStepReasonSchemaV1,
  ignoredExplanation: z.string().optional(),
});

export type IgnoredGenerationStepV1 = z.infer<typeof IgnoredGenerationStepSchemaV1>;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION GUIDANCE — mirror of core/types/generation.ts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GenerationGuidanceV1 — typed rules for the IDE LLM code generator.
 * Must stay in sync with core/types/generation.ts GenerationGuidanceSchemaV1.
 */
export const GenerationGuidanceSchemaV1 = z.object({
  replaySource: z.literal('steps'),
  ignoredStepsPolicy: z.literal('context_only'),
  rules: z.array(z.string()),
});

export type GenerationGuidanceV1 = z.infer<typeof GenerationGuidanceSchemaV1>;

// ─────────────────────────────────────────────────────────────────────────────
// GENERATION CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export const GenerationContextSchemaV1 = z.object({
  schemaVersion: z.literal('air:generation-context:v1'),
  sessionId: z.string(),
  url: z.string(),
  recordedAt: z.number(),
  steps: z.array(GenerationStepSchemaV1),
  ignoredSteps: z.array(IgnoredGenerationStepSchemaV1).default([]),
  generationGuidance: GenerationGuidanceSchemaV1.optional(),
  metadata: z.object({
    generatedAt: z.number().optional(),
    source: z.literal('air-db').optional(),
  }).optional(),
});

export type GenerationContextV1 = z.infer<typeof GenerationContextSchemaV1>;
