// Purpose: Stub interfaces for Phase 5 (Test Code Generation & Healing).
// Prototype Origin: types.js (ReplayAction, HealingScore)
// Changes: Converted to TypeScript shapes, implementation deferred.

import { z } from 'zod';

/** Replay action with confidence scoring (Phase 5 Stub) */
export const ReplayActionSchema = z.object({
  actionId: z.string().uuid(),
  targetNodeId: z.string(),
  elementSelector: z.string(),
  actionType: z.string(),
  value: z.string(),
  confidence: z.number(), // 0.0 - 1.0
  alternatives: z.array(z.string()),
  decisionPath: z.array(z.string()),
});
export type ReplayAction = z.infer<typeof ReplayActionSchema>;

/** Self-healing scoring result (Phase 5 Stub) */
export const HealingScoreSchema = z.object({
  jaccardAttributes: z.number(),
  levenshteinText: z.number(),
  parentMatch: z.number(),
  totalScore: z.number(),
  threshold: z.number().default(0.85),
  status: z.enum(['pending', 'auto-fix', 'needs-review', 'failed']),
});
export type HealingScore = z.infer<typeof HealingScoreSchema>;