import { z } from 'zod';
import { ElementFingerprintSchema } from './fingerprint';
import { SeekStrategySchema } from './context-driver';

/** Primary event categories */
export const EventTypeSchema = z.enum([
  'click', 
  'input', 
  'outcome', 
  'scroll', 
  'submit',
  'custom',
  'network', 
  'hover', 
  'custom-select', 
  'spa-route-change'
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Browser viewport dimensions */
export const ViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/** DOM Snapshot Data */
export const PageSnapshotSchema = z.object({
  html: z.string(),
  anchors: z.array(z.string()).optional(),
  controlSignature: z.string().nullable().optional(),
  isStable: z.boolean().optional(),
  viewport: ViewportSchema.optional(),
  url: z.string().optional(),
  normalizedUrl: z.string().optional(),
  timestamp: z.number().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** Base fields shared by all events */
const BaseEventSchema = z.object({
  id: z.string().uuid().optional().catch(() => crypto.randomUUID()), // Safe fallback if ID is stripped
  timestamp: z.number(),
  traceId: z.string().optional(),
  sessionId: z.string()
    .min(1, 'Session ID required')
    .regex(/^session-[a-f0-9-]+$/, 'Invalid session ID format'),
  pageUrl: z.string().optional(), // Strictly optional to fix the Zod missing url error
  normalizedUrl: z.string().optional(),
  schemaVersion: z.string().optional(),
});

/** Action Event: Click */
export const ClickEventSchema = BaseEventSchema.extend({
  type: z.literal('click'),
  pageTitle: z.string().optional(),
  viewport: ViewportSchema.optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  seek: SeekStrategySchema.optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Action Event: Input */
export const InputEventSchema = BaseEventSchema.extend({
  type: z.literal('input'),
  pageTitle: z.string().optional(),
  viewport: ViewportSchema.optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  inputValueMasked: z.string().optional(),
  // Fix (Bug #3): these three fields were sent by the interceptor but stripped by Zod.
  // trigger distinguishes a committed value (blur/change) from a mid-typing heartbeat
  // (input:progress). graph-builder uses it to gate Branch A. Optional so events
  // sent before this fix (no trigger field) still parse — treated as committed.
  trigger: z.enum(['blur', 'change', 'input:progress']).optional(),
  inputLength: z.number().optional(),       // length of typed value — safe analytics signal
  selectedLabel: z.string().optional(),     // chosen <option> text for native <select>
});

/** Action Event: Submit */
export const SubmitEventSchema = BaseEventSchema.extend({
  type: z.literal('submit'),
  pageTitle: z.string().optional(),
  viewport: ViewportSchema.optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  meta: z.object({
    eventType: z.string(),
    formId: z.string().optional(),
  }).catchall(z.unknown()).optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
});

/** Action Event: Scroll */
export const ScrollEventSchema = BaseEventSchema.extend({
  type: z.literal('scroll'),
  viewport: ViewportSchema.optional(),
  scroll: z.object({
    x: z.number(),
    y: z.number(),
    deltaY: z.number()
  }).catchall(z.unknown()).optional(),
  seek: SeekStrategySchema.optional(),
});

/** Result Event: Outcome */
export const OutcomeEventSchema = BaseEventSchema.extend({
  type: z.literal('outcome'),
  pageState: PageSnapshotSchema.nullable().optional(),
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
  // D3.5: full-page context used for selector uniqueness / stability validation.
  interactionContext: PageSnapshotSchema.nullable().optional(),
  meta: z.object({
    // Strictly accept either a string ("navigation") OR the Quiescence Engine's object
    settleType: z.union([
      z.string(),
      z.object({
        stable: z.boolean(),
        reason: z.string(),
        waitedMs: z.number().optional()
      })
    ]),
    waitedMs: z.number().optional(),
    urlAfter: z.string().optional(),
    titleAfter: z.string().optional(),
  }).catchall(z.unknown()).optional(),
});

/** Fallback Event: Custom */
export const CustomEventSchema = BaseEventSchema.extend({
  type: z.literal('custom'),
  payload: z.record(z.string(), z.unknown()).optional(),
});

/** Advanced Event: Network */
export const NetworkEventSchema = BaseEventSchema.extend({
  type: z.literal('network'),
  network: z.object({
    transport: z.string(),
    method: z.string(),
    url: z.string(),
    status: z.number(),
    ok: z.boolean(),
    durationMs: z.number(),
    contentType: z.string().nullable().optional()
  }).optional()
});

/** Advanced Event: Hover */
export const HoverEventSchema = BaseEventSchema.extend({
  type: z.literal('hover'),
  pageTitle: z.string().optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  meta: z.object({
    domChanged: z.boolean(),
    nodesAdded: z.number(),
    nodesRemoved: z.number()
  }).optional()
});

/** Advanced Event: Custom Select (Div-based dropdowns) */
export const CustomSelectEventSchema = BaseEventSchema.extend({
  type: z.literal('custom-select'),
  trigger: z.string().optional(),
  viewport: ViewportSchema.optional(),
  selection: z.object({
    label: z.string(),
    value: z.string(),
    index: z.number()
  }).optional(),
  triggerFingerprint: ElementFingerprintSchema.nullable().optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Advanced Event: SPA Route Change */
export const SpaRouteChangeEventSchema = BaseEventSchema.extend({
  type: z.literal('spa-route-change'),
  changeType: z.string().optional(),
  pageTitle: z.string().optional(),
  navigation: z.object({
    from: z.string(),
    to: z.string(),
    domDiff: z.any().optional()
  }).optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
});

/** Complete Discriminated Union for AIR Events */
export const AIREventSchema = z.discriminatedUnion('type', [
  ClickEventSchema,
  InputEventSchema,
  SubmitEventSchema,
  ScrollEventSchema,
  OutcomeEventSchema,
  CustomEventSchema,
  NetworkEventSchema,
  HoverEventSchema,
  CustomSelectEventSchema,
  SpaRouteChangeEventSchema
]);

export type AIREvent = z.infer<typeof AIREventSchema>;
