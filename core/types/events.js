"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIREventSchema = exports.SpaRouteChangeEventSchema = exports.CustomMenuSelectEventSchema = exports.CustomControlOpenEventSchema = exports.CustomSelectEventSchema = exports.HoverEventSchema = exports.NetworkEventSchema = exports.CustomEventSchema = exports.OutcomeEventSchema = exports.ScrollEventSchema = exports.SubmitEventSchema = exports.InputEventSchema = exports.ClickEventSchema = exports.NestedContextSchema = exports.PageSnapshotSchema = exports.CompositeAnchorSchema = exports.CompositeAnchorKindSchema = exports.ViewportSchema = exports.EventTypeSchema = exports.SelectorResolutionSchema = void 0;
const zod_1 = require("zod");
const fingerprint_1 = require("./fingerprint");
const context_driver_1 = require("./context-driver");
exports.SelectorResolutionSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal("air:selector-resolution:v1"),
    status: zod_1.z.enum(["resolved", "unresolved"]),
    selected: zod_1.z.object({
        selector: zod_1.z.string(),
        engine: zod_1.z.enum(["css", "xpath"]),
        family: zod_1.z.string().optional(),
        source: zod_1.z.enum(["shadow-preference", "legacy-primary"]),
        proposalSource: zod_1.z.string().nullable().optional(),
        matchCount: zod_1.z.number().nullable().optional(),
        visibleMatchCount: zod_1.z.number().nullable().optional(),
        replaySafe: zod_1.z.boolean(),
        confidence: zod_1.z.enum(["high", "medium", "low"]).optional(),
        warningCodes: zod_1.z.array(zod_1.z.string()).optional(),
        proofSource: zod_1.z.string().nullable().optional(),
        selectedReason: zod_1.z.string().optional(),
    }).optional(),
    blockedReason: zod_1.z.string().nullable().optional()
});
/** Primary event categories */
exports.EventTypeSchema = zod_1.z.enum([
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
/** Browser viewport dimensions */
exports.ViewportSchema = zod_1.z.object({
    width: zod_1.z.number(),
    height: zod_1.z.number(),
});
exports.CompositeAnchorKindSchema = zod_1.z.enum([
    'form_cluster',
    'container_controls',
    'table_row',
    'dialog_actions',
    'menu_group',
]);
exports.CompositeAnchorSchema = zod_1.z.object({
    kind: exports.CompositeAnchorKindSchema,
    scopeTag: zod_1.z.string().nullable().optional(),
    scopeRole: zod_1.z.string().nullable().optional(),
    scopeId: zod_1.z.string().nullable().optional(),
    scopeName: zod_1.z.string().nullable().optional(),
    scopeLabel: zod_1.z.string().nullable().optional(),
    tokens: zod_1.z.array(zod_1.z.string()),
    descriptor: zod_1.z.string(),
    confidence: zod_1.z.number(),
}).passthrough();
/** DOM Snapshot Data */
exports.PageSnapshotSchema = zod_1.z.object({
    html: zod_1.z.string(),
    anchors: zod_1.z.array(zod_1.z.string()).optional(),
    compositeAnchors: zod_1.z.array(exports.CompositeAnchorSchema).optional(),
    controlSignature: zod_1.z.string().nullable().optional(),
    isStable: zod_1.z.boolean().optional(),
    viewport: exports.ViewportSchema.optional(),
    url: zod_1.z.string().optional(),
    normalizedUrl: zod_1.z.string().optional(),
    timestamp: zod_1.z.number().optional(),
    metrics: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
}).passthrough();
exports.NestedContextSchema = zod_1.z.object({
    isShadowDom: zod_1.z.boolean().optional(),
    shadowHostTag: zod_1.z.string().nullable().optional(),
    isIframe: zod_1.z.boolean().optional(),
    iframeSrc: zod_1.z.string().nullable().optional(),
    iframeName: zod_1.z.string().nullable().optional(),
    iframeSameOrigin: zod_1.z.boolean().nullable().optional(),
    degraded: zod_1.z.boolean().optional(),
    degradedReason: zod_1.z.string().nullable().optional(),
}).passthrough();
/** Base fields shared by all events */
const BaseEventSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    timestamp: zod_1.z.number(),
    traceId: zod_1.z.string().optional(),
    sessionId: zod_1.z.string()
        .min(1, 'Session ID required')
        .regex(/^session-[a-f0-9-]+$/, 'Invalid session ID format'),
    tabId: zod_1.z.string().nullable().optional(),
    pageUrl: zod_1.z.string().optional(), // Strictly optional to fix the Zod missing url error
    normalizedUrl: zod_1.z.string().optional(),
    nestedContext: exports.NestedContextSchema.optional(),
    schemaVersion: zod_1.z.string().optional(),
    selectorResolution: exports.SelectorResolutionSchema.optional(),
});
/** Action Event: Click */
exports.ClickEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('click'),
    pageTitle: zod_1.z.string().optional(),
    viewport: exports.ViewportSchema.optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    seek: context_driver_1.SeekStrategySchema.optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    meta: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
/** Action Event: Input */
exports.InputEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('input'),
    pageTitle: zod_1.z.string().optional(),
    viewport: exports.ViewportSchema.optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    inputValueMasked: zod_1.z.string().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    interactionContext: exports.PageSnapshotSchema.nullable().optional(),
    // Fix (Bug #3): these three fields were sent by the interceptor but stripped by Zod.
    // trigger distinguishes a committed value (blur/change) from a mid-typing heartbeat
    // (input:progress). graph-builder uses it to gate Branch A. Optional so events
    // sent before this fix (no trigger field) still parse — treated as committed.
    trigger: zod_1.z.enum(['blur', 'change', 'input:progress']).optional(),
    inputLength: zod_1.z.number().optional(), // length of typed value — safe analytics signal
    selectedLabel: zod_1.z.string().optional(), // chosen <option> text for native <select>
});
/** Action Event: Submit */
exports.SubmitEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('submit'),
    pageTitle: zod_1.z.string().optional(),
    viewport: exports.ViewportSchema.optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    meta: zod_1.z.object({
        eventType: zod_1.z.string(),
        formId: zod_1.z.string().optional(),
    }).catchall(zod_1.z.unknown()).optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    interactionContext: exports.PageSnapshotSchema.nullable().optional(),
});
/** Action Event: Scroll */
exports.ScrollEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('scroll'),
    viewport: exports.ViewportSchema.optional(),
    scroll: zod_1.z.object({
        x: zod_1.z.number(),
        y: zod_1.z.number(),
        deltaY: zod_1.z.number()
    }).catchall(zod_1.z.unknown()).optional(),
    seek: context_driver_1.SeekStrategySchema.optional(),
});
/** Result Event: Outcome */
exports.OutcomeEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('outcome'),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    // D3.5: full-page context used for selector uniqueness / stability validation.
    interactionContext: exports.PageSnapshotSchema.nullable().optional(),
    meta: zod_1.z.object({
        // Strictly accept either a string ("navigation") OR the Quiescence Engine's object
        settleType: zod_1.z.union([
            zod_1.z.string(),
            zod_1.z.object({
                stable: zod_1.z.boolean(),
                reason: zod_1.z.string(),
                waitedMs: zod_1.z.number().optional()
            })
        ]),
        waitedMs: zod_1.z.number().optional(),
        urlAfter: zod_1.z.string().optional(),
        titleAfter: zod_1.z.string().optional(),
    }).catchall(zod_1.z.unknown()).optional(),
});
/** Fallback Event: Custom */
exports.CustomEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('custom'),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
/** Advanced Event: Network */
exports.NetworkEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('network'),
    network: zod_1.z.object({
        transport: zod_1.z.string(),
        method: zod_1.z.string(),
        url: zod_1.z.string(),
        status: zod_1.z.number(),
        ok: zod_1.z.boolean(),
        durationMs: zod_1.z.number(),
        contentType: zod_1.z.string().nullable().optional()
    }).optional()
});
/** Advanced Event: Hover */
exports.HoverEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('hover'),
    pageTitle: zod_1.z.string().optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    meta: zod_1.z.object({
        domChanged: zod_1.z.boolean(),
        nodesAdded: zod_1.z.number(),
        nodesRemoved: zod_1.z.number()
    }).catchall(zod_1.z.unknown()).optional()
});
/** Advanced Event: Custom Select (Div-based dropdowns) */
exports.CustomSelectEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('custom-select'),
    trigger: zod_1.z.string().optional(),
    viewport: exports.ViewportSchema.optional(),
    selection: zod_1.z.object({
        label: zod_1.z.string(),
        value: zod_1.z.string(),
        index: zod_1.z.number()
    }).optional(),
    triggerFingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    interactionContext: exports.PageSnapshotSchema.nullable().optional(),
    meta: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
/** Advanced Event: Custom Control Open (semantic trigger click) */
exports.CustomControlOpenEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('custom-control-open'),
    trigger: zod_1.z.string().optional(),
    pageTitle: zod_1.z.string().optional(),
    viewport: exports.ViewportSchema.optional(),
    controlFamily: zod_1.z.string().optional(),
    triggerText: zod_1.z.string().optional(),
    triggerRole: zod_1.z.string().optional(),
    triggerFingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    interactionContext: exports.PageSnapshotSchema.nullable().optional(),
    meta: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
/** Advanced Event: Custom Menu Select (menuitem-based dropdowns) */
exports.CustomMenuSelectEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('custom-menu-select'),
    trigger: zod_1.z.string().optional(),
    pageTitle: zod_1.z.string().optional(),
    viewport: exports.ViewportSchema.optional(),
    controlFamily: zod_1.z.string().optional(),
    optionRole: zod_1.z.string().optional(),
    selection: zod_1.z.object({
        label: zod_1.z.string(),
        value: zod_1.z.string(),
        index: zod_1.z.number()
    }).optional(),
    triggerFingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    fingerprint: fingerprint_1.ElementFingerprintSchema.nullable().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    interactionContext: exports.PageSnapshotSchema.nullable().optional(),
    meta: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
/** Advanced Event: SPA Route Change */
exports.SpaRouteChangeEventSchema = BaseEventSchema.extend({
    type: zod_1.z.literal('spa-route-change'),
    changeType: zod_1.z.string().optional(),
    pageTitle: zod_1.z.string().optional(),
    navigation: zod_1.z.object({
        from: zod_1.z.string(),
        to: zod_1.z.string(),
        domDiff: zod_1.z.any().optional()
    }).optional(),
    pageState: exports.PageSnapshotSchema.nullable().optional(),
    pageSnapshot: exports.PageSnapshotSchema.nullable().optional(),
});
/** Complete Discriminated Union for AIR Events */
exports.AIREventSchema = zod_1.z.discriminatedUnion('type', [
    exports.ClickEventSchema,
    exports.InputEventSchema,
    exports.SubmitEventSchema,
    exports.ScrollEventSchema,
    exports.OutcomeEventSchema,
    exports.CustomEventSchema,
    exports.NetworkEventSchema,
    exports.HoverEventSchema,
    exports.CustomControlOpenEventSchema,
    exports.CustomSelectEventSchema,
    exports.CustomMenuSelectEventSchema,
    exports.SpaRouteChangeEventSchema
]);
