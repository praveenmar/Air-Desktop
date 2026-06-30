import { z } from 'zod';

export const RealizationStepSchema = z.object({
  action: z.enum(['click', 'scroll', 'hover', 'fill']),
  kind: z.string(),
  value: z.string()
});

export type RealizationStep = z.infer<typeof RealizationStepSchema>;

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
    realizationSteps: z.array(RealizationStepSchema).optional(),
  }).optional(),
  blockedReason: z.string().nullable().optional()
});

export const FrameContextSchema = z.object({
  frameSelector: z.string(),
  frameId: z.string().nullable().optional(),
  frameName: z.string().nullable().optional(),
  frameSrc: z.string().nullable().optional(),
  isSameOrigin: z.literal(true),
});
export type FrameContext = z.infer<typeof FrameContextSchema>;

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
  frameContext: FrameContextSchema.optional(),
  selectorResolution: SelectorResolutionSchema.optional(),
}).passthrough();

export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

