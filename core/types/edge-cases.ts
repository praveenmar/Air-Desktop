// Purpose: Enumerations and models for specific handling of web edge cases.
// Prototype Origin: types.js (EdgeCaseType, EdgeCaseDetection), graph-builder.js (OutcomeType)
// Changes: Converted to TypeScript types with Zod schemas.

import { z } from 'zod';

/** PRD's Edge Case Rules (EC1-EC14) */
export const EdgeCaseTypeSchema = z.enum([
  'EC1', 'EC2', 'EC3', 'EC4', 'EC5', 'EC6', 'EC7', 
  'EC8', 'EC9', 'EC10', 'EC11', 'EC12', 'EC13', 'EC14'
]);
export type EdgeCaseType = z.infer<typeof EdgeCaseTypeSchema>;

/** Categorization of how an edge transitions between nodes */
export const OutcomeTypeSchema = z.enum([
  'state_refresh', 
  'navigation', 
  'no_change', 
  'immediate_action'
]);
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>;

/** Edge case detection metadata */
export const EdgeCaseDetectionSchema = z.object({
  type: EdgeCaseTypeSchema,
  detected: z.boolean().default(false),
  confidence: z.number().default(0),
  handlingStrategy: z.string().default(''),
  applied: z.boolean().default(false),
});
export type EdgeCaseDetection = z.infer<typeof EdgeCaseDetectionSchema>;