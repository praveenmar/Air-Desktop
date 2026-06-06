import { z } from 'zod';

export const SelectorResolutionSchema = z.object({
  schemaVersion: z.literal('air:selector-resolution:v1'),
  status: z.enum(['resolved', 'unresolved']),
  selected: z.object({
    selector: z.string(),
    engine: z.enum(['css', 'xpath']),
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
  }).optional(),
  blockedReason: z.string().nullable().optional(),
});

export type SelectorResolutionV1 = z.infer<typeof SelectorResolutionSchema>;

export const ResolvedTargetSchema = z.object({
  kind: z.enum(['css', 'xpath', 'role', 'text', 'label', 'placeholder', 'testid']),
  value: z.string(),
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
});

export type GenerationStepV1 = z.infer<typeof GenerationStepSchemaV1>;

export const GenerationContextSchemaV1 = z.object({
  schemaVersion: z.literal('air:generation-context:v1'),
  sessionId: z.string(),
  url: z.string(),
  recordedAt: z.number(),
  steps: z.array(GenerationStepSchemaV1),
  metadata: z.object({
    generatedAt: z.number().optional(),
    source: z.literal('air-db').optional(),
  }).optional(),
});

export type GenerationContextV1 = z.infer<typeof GenerationContextSchemaV1>;
