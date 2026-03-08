// Purpose: Types corresponding directly to the SQLite Database models and internal graph representations.
// Prototype Origin: types.js (UIStateNode, GraphEdge, TransitionOutcome), db.js tables.
// Changes: Reconciled JS prototype classes with the actual SQLite columns.

import { z } from 'zod';
import { SeekStrategySchema, ContextDriverSchema } from './context-driver';
import { OutcomeTypeSchema } from './edge-cases';

/** UI State Node (Represents a unique page state) */
export const GraphNodeSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().default('default'),
  canonicalHash: z.string(),
  pageUrl: z.string().nullable(),
  pageTitle: z.string().nullable(),
  snapshotHtml: z.string().nullable(),
  contextTokens: z.string().nullable(), // JSON string array
  anchors: z.string().nullable(),       // JSON string array
  stateSource: z.string().nullable(),
  viewportWidth: z.number().nullable(),
  viewportHeight: z.number().nullable(),
  createdAt: z.number(),
  lastObservedAt: z.number().nullable(),
  observationCount: z.number().default(1),
  metadata: z.string().nullable(),      // JSON string
});
export type GraphNode = z.infer<typeof GraphNodeSchema>;

/** Transition Outcome with Laplace Smoothing */
export const OutcomeSchema = z.object({
  id: z.string().uuid(),
  edgeId: z.string(),
  targetNodeId: z.string(),
  probability: z.number().default(1.0),
  decayedCount: z.number().default(1.0),
  lastObserved: z.number(),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

/** Directed Edge linking two Nodes via an Action */
export const GraphEdgeSchema = z.object({
  id: z.string().uuid(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  triggerEventId: z.string(),
  fingerprintHash: z.string().nullable(),
  seekStrategy: z.string().nullable(), // JSON string mapped from SeekStrategy
  sampleSize: z.number().default(1),
  lastUpdated: z.number(),
  outcomeType: OutcomeTypeSchema.nullable(),
});
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/** Active User Session */
export const SessionSchema = z.object({
  id: z.string(),
  projectId: z.string().default('default'),
  startedAt: z.number(),
  lastEventAt: z.number().nullable(),
  lastNodeId: z.string().nullable(),
  eventCount: z.number().default(0),
  status: z.string().default('active'),
  metadata: z.string().nullable(),
});
export type Session = z.infer<typeof SessionSchema>;

/** Pending Action waiting for an Outcome resolution */
export const PendingActionSchema = z.object({
  traceId: z.string(),
  sessionId: z.string(),
  fromNodeId: z.string(),
  triggerEventId: z.string(),
  actionType: z.string(),
  fingerprintHash: z.string().nullable(),
  createdAt: z.number(),
  resolvedAt: z.number().nullable(),
  status: z.string().default('pending'),
});
export type PendingAction = z.infer<typeof PendingActionSchema>;
export interface GraphStats {
  nodes: number;
  edges: number;
  events: number;
  outcomes: number;
  sessions: number;
  pendingActions: number;
  timestamp?: number;
  error?: string;
}