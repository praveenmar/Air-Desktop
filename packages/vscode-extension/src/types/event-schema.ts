import { z } from 'zod';

export const SelectorResolutionSchema = z.object({
  schemaVersion: z.literal("air:selector-resolution:v1"),
  status: z.enum(["resolved", "unresolved"]),
  selected: z.object({
    selector: z.string(),
    engine: z.enum(["css", "xpath"]),
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
  }).optional(),
  blockedReason: z.string().nullable().optional()
});

export const IncomingEventSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.number(),
  traceId: z.string().optional(),
  pageId: z.string().optional(),
  frameId: z.string().optional(),
  sequence: z.number().int().optional(),
  pageUrl: z.string().optional(),
  payload: z.unknown().optional(),
  selectorResolution: SelectorResolutionSchema.optional(),
}).passthrough();

export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

