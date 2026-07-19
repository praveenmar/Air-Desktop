const { z } = require('zod');

const RealizationStepSchema = z.object({
  kind: z.enum(["css", "xpath"]),
  value: z.string()
});

const SelectorResolutionSchema = z.object({
  schemaVersion: z.literal("air:selector-resolution:v1"),
  status: z.enum(["resolved", "unresolved"]),
  selected: z.object({
    selector: z.string(),
    engine: z.enum(["css", "xpath", "playwright-aria", "playwright-native"]),
    family: z.string().optional(),
    source: z.enum(["shadow-preference", "legacy-primary"]),
    proposalSource: z.string().nullable().optional(),
    matchCount: z.number().nullable().optional(),
    visibleMatchCount: z.number().nullable().optional(),
    replaySafe: z.boolean(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    warningCodes: z.array(z.string()).optional(),
    proofSource: z.string().nullable().optional(),
    selectedReason: z.string().optional(),
    realizationSteps: z.array(RealizationStepSchema).optional(),
  }).optional(),
  blockedReason: z.string().nullable().optional()
});

const resolution = {
  schemaVersion: "air:selector-resolution:v1",
  status: "resolved",
  selected: {
    selector: "locator('ul[role=\"menu\"]').locator('li', { hasText: 'Logout' })",
    engine: "playwright-aria",
    source: "shadow-preference",
    proposalSource: null,
    matchCount: undefined,
    visibleMatchCount: undefined,
    replaySafe: true,
    confidence: "medium",
    warningCodes: [],
    proofSource: "hierarchical-navigation",
    selectedReason: "Proof-backed safe selector..."
  }
};

const result = SelectorResolutionSchema.safeParse(JSON.parse(JSON.stringify(resolution)));
console.log(JSON.stringify(result, null, 2));
