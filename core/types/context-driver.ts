// Purpose: Types for user intent and context tracking.
// Prototype Origin: types.js (SeekMethod, SeekMetadata, ContextDriver)
// Changes: Converted to Zod schemas and strict types.

import { z } from 'zod';

/** Seek methods - how the user located the element */
export const SeekMethodSchema = z.enum([
  'scroll',
  'search',
  'filter',
  'history',
  'direct'
]);
export type SeekMethod = z.infer<typeof SeekMethodSchema>;

/** Metadata describing the seek action (e.g., scroll distance, search term) */
export const SeekStrategySchema = z.object({
  method: SeekMethodSchema.default('direct'),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type SeekStrategy = z.infer<typeof SeekStrategySchema>;

/** PRD's Context Driver for state differentiation */
export const ContextDriverSchema = z.object({
  text: z.string().default(''),
  score: z.number().default(0),
  position: z.string().default('body'),
  semanticWeight: z.number().default(0),
  historyWeight: z.number().default(0),
  positionWeight: z.number().default(0),
});
export type ContextDriver = z.infer<typeof ContextDriverSchema>;