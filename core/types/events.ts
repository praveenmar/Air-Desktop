import { z } from 'zod';
import { ElementFingerprintSchema } from './fingerprint';
import { SeekStrategySchema } from './context-driver';

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
  'custom-control-open',
  'custom-select', 
  'custom-menu-select',
  'spa-route-change'
]);
export type EventType = z.infer<typeof EventTypeSchema>;

/** Browser viewport dimensions */
export const ViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

export const CompositeAnchorKindSchema = z.enum([
  'form_cluster',
  'container_controls',
  'table_row',
  'dialog_actions',
  'menu_group',
]);
export type CompositeAnchorKind = z.infer<typeof CompositeAnchorKindSchema>;

export const CompositeAnchorSchema = z.object({
  kind: CompositeAnchorKindSchema,
  scopeTag: z.string().nullable().optional(),
  scopeRole: z.string().nullable().optional(),
  scopeId: z.string().nullable().optional(),
  scopeName: z.string().nullable().optional(),
  scopeLabel: z.string().nullable().optional(),
  tokens: z.array(z.string()),
  descriptor: z.string(),
  confidence: z.number(),
}).passthrough();
export type CompositeAnchor = z.infer<typeof CompositeAnchorSchema>;

/** DOM Snapshot Data */
export const PageSnapshotSchema = z.object({
  html: z.string(),
  anchors: z.array(z.string()).optional(),
  compositeAnchors: z.array(CompositeAnchorSchema).optional(),
  controlSignature: z.string().nullable().optional(),
  isStable: z.boolean().optional(),
  viewport: ViewportSchema.optional(),
  url: z.string().optional(),
  normalizedUrl: z.string().optional(),
  timestamp: z.number().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

export const NestedContextSchema = z.object({
  isShadowDom: z.boolean().optional(),
  shadowHostTag: z.string().nullable().optional(),
  isIframe: z.boolean().optional(),
  iframeSrc: z.string().nullable().optional(),
  iframeName: z.string().nullable().optional(),
  iframeSameOrigin: z.boolean().nullable().optional(),
  degraded: z.boolean().optional(),
  degradedReason: z.string().nullable().optional(),
}).passthrough();
export type NestedContext = z.infer<typeof NestedContextSchema>;

export const FrameContextSchema = z.object({
  frameSelector: z.string(),
  frameId: z.string().nullable().optional(),
  frameName: z.string().nullable().optional(),
  frameSrc: z.string().nullable().optional(),
  isSameOrigin: z.literal(true),
});
export type FrameContext = z.infer<typeof FrameContextSchema>;

/**
 * Diagnostic payload attached to events where dropdown option detection failed
 * and the interceptor could not resolve a stable locator for the clicked element.
 * Provides the raw DOM evidence the LLM needs to generate a best-effort locator
 * without inventing selectors it cannot verify.
 *
 * Design constraints:
 *   - Optional on all event types via BaseEventSchema to minimise schema churn.
 *   - Capped at 2 KB per record (enforced at emit time in interceptor.js).
 *   - At most 25 records per session (enforced via _unresolvedInteractionCount).
 *   - Never emitted when detection succeeds (i.e. custom-select with selection field set).
 */
export const UnresolvedInteractionSchema = z.object({
  /** Tailwind / utility class tokens on the clicked element, opaque hashes stripped. */
  classTokens: z.array(z.string()).optional(),
  /** Trimmed text content of the clicked element (max 120 chars). */
  textContent: z.string().optional(),
  /** Role of the clicked element if present. */
  role: z.string().optional(),
  /** Tag name of the clicked element (lowercase). */
  tagName: z.string().optional(),
  /**
   * Shape-similar siblings: each entry is { tagName, textContent } for up to 5
   * direct siblings sharing the same tagName, giving the LLM population context.
   */
  siblings: z.array(z.object({
    tagName: z.string(),
    textContent: z.string(),
  })).optional(),
  /**
   * Ancestor chain: up to 3 levels, each { tagName, classTokens, role }. Provides
   * containment context for selector construction (e.g. parent div with a semantic class).
   */
  ancestors: z.array(z.object({
    tagName: z.string(),
    classTokens: z.array(z.string()).optional(),
    role: z.string().optional(),
  })).optional(),
  /** Indicates why the normal detection path failed. Observable, not diagnostic-only. */
  detectionFailureReason: z.enum([
    'no_aria_role',          // element had no ARIA role matching known patterns
    'no_class_match',       // element class tokens matched no known library pattern
    'container_not_found',  // no dropdown container was found walking up 8 levels
    'no_input_context',     // detection fired outside any active input session
  ]).optional(),
});

export type UnresolvedInteraction = z.infer<typeof UnresolvedInteractionSchema>;

/** Base fields shared by all events */
const BaseEventSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.number(),
  traceId: z.string().optional(),
  sessionId: z.string()
    .min(1, 'Session ID required')
    .regex(/^session-[a-f0-9-]+$/, 'Invalid session ID format'),
  tabId: z.string().nullable().optional(),
  pageUrl: z.string().optional(), // Strictly optional to fix the Zod missing url error
  normalizedUrl: z.string().optional(),
  nestedContext: NestedContextSchema.optional(),
  frameContext: FrameContextSchema.optional(),
  schemaVersion: z.string().optional(),
  selectorResolution: SelectorResolutionSchema.optional(),
  /** Present when the interceptor detected an autocomplete option click but could not resolve a stable locator. */
  unresolvedInteraction: UnresolvedInteractionSchema.optional(),
});

/** Action Event: Click */
export const ClickEventSchema = BaseEventSchema.extend({
  type: z.literal('click'),
  pageTitle: z.string().optional(),
  viewport: ViewportSchema.optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  seek: SeekStrategySchema.optional(),
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
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
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  interactionContext: PageSnapshotSchema.nullable().optional(),
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
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
  meta: z.object({
    eventType: z.string(),
    formId: z.string().optional(),
  }).catchall(z.unknown()).optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  interactionContext: PageSnapshotSchema.nullable().optional(),
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
  }).catchall(z.unknown()).optional()
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
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  interactionContext: PageSnapshotSchema.nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Advanced Event: Custom Control Open (semantic trigger click) */
export const CustomControlOpenEventSchema = BaseEventSchema.extend({
  type: z.literal('custom-control-open'),
  trigger: z.string().optional(),
  pageTitle: z.string().optional(),
  viewport: ViewportSchema.optional(),
  controlFamily: z.string().optional(),
  triggerText: z.string().optional(),
  triggerRole: z.string().optional(),
  triggerFingerprint: ElementFingerprintSchema.nullable().optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  interactionContext: PageSnapshotSchema.nullable().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/** Advanced Event: Custom Menu Select (menuitem-based dropdowns) */
export const CustomMenuSelectEventSchema = BaseEventSchema.extend({
  type: z.literal('custom-menu-select'),
  trigger: z.string().optional(),
  pageTitle: z.string().optional(),
  viewport: ViewportSchema.optional(),
  controlFamily: z.string().optional(),
  optionRole: z.string().optional(),
  selection: z.object({
    label: z.string(),
    value: z.string(),
    index: z.number()
  }).optional(),
  triggerFingerprint: ElementFingerprintSchema.nullable().optional(),
  fingerprint: ElementFingerprintSchema.nullable().optional(),
  pageSnapshot: PageSnapshotSchema.nullable().optional(),
  pageState: PageSnapshotSchema.nullable().optional(),
  interactionContext: PageSnapshotSchema.nullable().optional(),
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
  CustomControlOpenEventSchema,
  CustomSelectEventSchema,
  CustomMenuSelectEventSchema,
  SpaRouteChangeEventSchema
]);

export type AIREvent = z.infer<typeof AIREventSchema>;
