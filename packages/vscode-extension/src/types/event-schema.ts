import { z } from 'zod';

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
}).passthrough();

export type IncomingEvent = z.infer<typeof IncomingEventSchema>;

