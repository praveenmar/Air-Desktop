// Purpose: Core types and schemas for DOM element identification (Fingerprints).
// Prototype Origin: types.js (SelectorPriority, ElementFingerprint)
// Changes: Converted to strict TypeScript with Zod validation.

import { z } from 'zod';

/** Selector priority (used by Interceptor when choosing selector) */
export const SelectorPrioritySchema = z.enum([
  'data-testid',
  'id',
  'class',
  'attribute',
  'path',
  'other',
  'text',     // Added based on event logs
  'xpath',    // Added based on event logs
  'chained'   // Added based on interceptor.js capabilities
]);
export type SelectorPriority = z.infer<typeof SelectorPrioritySchema>;

/** Contextual tags surrounding the element */
export const FingerprintContextSchema = z.object({
  parentTag: z.string().nullable(),
  nearestContainerTag: z.string().nullable(),
});
export type FingerprintContext = z.infer<typeof FingerprintContextSchema>;

/** Compact fingerprint for an element (4-layer identification) */
export const ElementFingerprintSchema = z.object({
  selector: z.string(),
  selectorPriority: SelectorPrioritySchema,
  selectorRank: z.number().int().min(1).max(10).optional(),
  tagName: z.string().optional(),
  parentSelector: z.string().nullable().optional(),
  textExcerpt: z.string().nullable(),
  context: FingerprintContextSchema,
  attributes: z.record(z.string(), z.string().optional()),
  attributesHash: z.string(),
});
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;
