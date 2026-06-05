import { z } from 'zod';
/**
 * ResolvedTarget is the framework-neutral representation of a locatable element.
 * It deliberately avoids Playwright-specific naming (like "locator" or "playwright")
 * because AIR GenerationContext must remain framework-neutral to support future
 * MCP/LLM adapters for Cypress, Selenium, etc.
 */
export declare const ResolvedTargetSchema: z.ZodObject<{
    kind: z.ZodEnum<["css", "xpath", "role", "text", "label", "placeholder", "testid"]>;
    value: z.ZodString;
    options: z.ZodOptional<z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        exact: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        exact?: boolean | undefined;
        name?: string | undefined;
    }, {
        exact?: boolean | undefined;
        name?: string | undefined;
    }>>;
    source: z.ZodEnum<["selectorResolution", "legacy_fallback"]>;
    replaySafe: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    value: string;
    source: "selectorResolution" | "legacy_fallback";
    kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
    replaySafe: boolean;
    options?: {
        exact?: boolean | undefined;
        name?: string | undefined;
    } | undefined;
}, {
    value: string;
    source: "selectorResolution" | "legacy_fallback";
    kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
    replaySafe: boolean;
    options?: {
        exact?: boolean | undefined;
        name?: string | undefined;
    } | undefined;
}>;
export type ResolvedTarget = z.infer<typeof ResolvedTargetSchema>;
/**
 * GenerationAssertion represents a suggested verification derived from the recorded flow outcome,
 * page transition, destination anchors, or future user-defined assertion capture.
 * It is NOT necessarily an explicitly recorded user assertion.
 * It excludes raw DOM, snapshot traces, and heavy proof reports to keep the context lean.
 */
export declare const GenerationAssertionSchema: z.ZodObject<{
    type: z.ZodEnum<["url", "element_visible", "element_text", "title", "custom"]>;
    value: z.ZodOptional<z.ZodString>;
    selector: z.ZodOptional<z.ZodString>;
    source: z.ZodOptional<z.ZodEnum<["outcome", "anchor", "user_defined"]>>;
    confidence: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    type: "custom" | "title" | "url" | "element_visible" | "element_text";
    value?: string | undefined;
    selector?: string | undefined;
    source?: "outcome" | "anchor" | "user_defined" | undefined;
    confidence?: number | undefined;
}, {
    type: "custom" | "title" | "url" | "element_visible" | "element_text";
    value?: string | undefined;
    selector?: string | undefined;
    source?: "outcome" | "anchor" | "user_defined" | undefined;
    confidence?: number | undefined;
}>;
export type GenerationAssertion = z.infer<typeof GenerationAssertionSchema>;
/**
 * FallbackHints provide lightweight facts for the LLM or baseline codegen when
 * AIR does not have a safe resolved target.
 * It intentionally omits raw DOM, full fingerprints, and large candidate arrays.
 */
export declare const FallbackHintsSchema: z.ZodObject<{
    legacySelector: z.ZodOptional<z.ZodString>;
    elementText: z.ZodOptional<z.ZodString>;
    tagName: z.ZodOptional<z.ZodString>;
    attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    tagName?: string | undefined;
    attributes?: Record<string, string> | undefined;
    legacySelector?: string | undefined;
    elementText?: string | undefined;
}, {
    tagName?: string | undefined;
    attributes?: Record<string, string> | undefined;
    legacySelector?: string | undefined;
    elementText?: string | undefined;
}>;
export type FallbackHints = z.infer<typeof FallbackHintsSchema>;
/**
 * GenerationStepV1 represents a single interaction or event in the recorded flow.
 *
 * locatorStatus semantics:
 * - "resolved": resolvedTarget is present and safe.
 * - "unresolved": target action needs a locator, but AIR does not have a safe resolved target.
 * - "not_applicable": step does not need a locator (e.g., navigation-only).
 */
export declare const GenerationStepSchemaV1: z.ZodObject<{
    stepIndex: z.ZodNumber;
    eventId: z.ZodOptional<z.ZodString>;
    traceId: z.ZodOptional<z.ZodString>;
    action: z.ZodString;
    intent: z.ZodString;
    value: z.ZodOptional<z.ZodString>;
    locatorStatus: z.ZodEnum<["resolved", "unresolved", "not_applicable"]>;
    resolvedTarget: z.ZodOptional<z.ZodObject<{
        kind: z.ZodEnum<["css", "xpath", "role", "text", "label", "placeholder", "testid"]>;
        value: z.ZodString;
        options: z.ZodOptional<z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            exact: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            exact?: boolean | undefined;
            name?: string | undefined;
        }, {
            exact?: boolean | undefined;
            name?: string | undefined;
        }>>;
        source: z.ZodEnum<["selectorResolution", "legacy_fallback"]>;
        replaySafe: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        value: string;
        source: "selectorResolution" | "legacy_fallback";
        kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
        replaySafe: boolean;
        options?: {
            exact?: boolean | undefined;
            name?: string | undefined;
        } | undefined;
    }, {
        value: string;
        source: "selectorResolution" | "legacy_fallback";
        kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
        replaySafe: boolean;
        options?: {
            exact?: boolean | undefined;
            name?: string | undefined;
        } | undefined;
    }>>;
    fallbackHints: z.ZodOptional<z.ZodObject<{
        legacySelector: z.ZodOptional<z.ZodString>;
        elementText: z.ZodOptional<z.ZodString>;
        tagName: z.ZodOptional<z.ZodString>;
        attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        tagName?: string | undefined;
        attributes?: Record<string, string> | undefined;
        legacySelector?: string | undefined;
        elementText?: string | undefined;
    }, {
        tagName?: string | undefined;
        attributes?: Record<string, string> | undefined;
        legacySelector?: string | undefined;
        elementText?: string | undefined;
    }>>;
    selectorResolution: z.ZodOptional<z.ZodObject<{
        schemaVersion: z.ZodLiteral<"air:selector-resolution:v1">;
        status: z.ZodEnum<["resolved", "unresolved"]>;
        selected: z.ZodOptional<z.ZodObject<{
            selector: z.ZodString;
            engine: z.ZodEnum<["css", "xpath"]>;
            family: z.ZodOptional<z.ZodString>;
            source: z.ZodEnum<["shadow-preference", "legacy-primary"]>;
            proposalSource: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            matchCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            visibleMatchCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            replaySafe: z.ZodBoolean;
            confidence: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
            warningCodes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            proofSource: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            selectedReason: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            selector: string;
            engine: "xpath" | "css";
            source: "shadow-preference" | "legacy-primary";
            replaySafe: boolean;
            matchCount?: number | null | undefined;
            visibleMatchCount?: number | null | undefined;
            family?: string | undefined;
            warningCodes?: string[] | undefined;
            proposalSource?: string | null | undefined;
            confidence?: "medium" | "high" | "low" | undefined;
            proofSource?: string | null | undefined;
            selectedReason?: string | undefined;
        }, {
            selector: string;
            engine: "xpath" | "css";
            source: "shadow-preference" | "legacy-primary";
            replaySafe: boolean;
            matchCount?: number | null | undefined;
            visibleMatchCount?: number | null | undefined;
            family?: string | undefined;
            warningCodes?: string[] | undefined;
            proposalSource?: string | null | undefined;
            confidence?: "medium" | "high" | "low" | undefined;
            proofSource?: string | null | undefined;
            selectedReason?: string | undefined;
        }>>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        status: "resolved" | "unresolved";
        schemaVersion: "air:selector-resolution:v1";
        blockedReason?: string | null | undefined;
        selected?: {
            selector: string;
            engine: "xpath" | "css";
            source: "shadow-preference" | "legacy-primary";
            replaySafe: boolean;
            matchCount?: number | null | undefined;
            visibleMatchCount?: number | null | undefined;
            family?: string | undefined;
            warningCodes?: string[] | undefined;
            proposalSource?: string | null | undefined;
            confidence?: "medium" | "high" | "low" | undefined;
            proofSource?: string | null | undefined;
            selectedReason?: string | undefined;
        } | undefined;
    }, {
        status: "resolved" | "unresolved";
        schemaVersion: "air:selector-resolution:v1";
        blockedReason?: string | null | undefined;
        selected?: {
            selector: string;
            engine: "xpath" | "css";
            source: "shadow-preference" | "legacy-primary";
            replaySafe: boolean;
            matchCount?: number | null | undefined;
            visibleMatchCount?: number | null | undefined;
            family?: string | undefined;
            warningCodes?: string[] | undefined;
            proposalSource?: string | null | undefined;
            confidence?: "medium" | "high" | "low" | undefined;
            proofSource?: string | null | undefined;
            selectedReason?: string | undefined;
        } | undefined;
    }>>;
    assertions: z.ZodDefault<z.ZodArray<z.ZodObject<{
        type: z.ZodEnum<["url", "element_visible", "element_text", "title", "custom"]>;
        value: z.ZodOptional<z.ZodString>;
        selector: z.ZodOptional<z.ZodString>;
        source: z.ZodOptional<z.ZodEnum<["outcome", "anchor", "user_defined"]>>;
        confidence: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        type: "custom" | "title" | "url" | "element_visible" | "element_text";
        value?: string | undefined;
        selector?: string | undefined;
        source?: "outcome" | "anchor" | "user_defined" | undefined;
        confidence?: number | undefined;
    }, {
        type: "custom" | "title" | "url" | "element_visible" | "element_text";
        value?: string | undefined;
        selector?: string | undefined;
        source?: "outcome" | "anchor" | "user_defined" | undefined;
        confidence?: number | undefined;
    }>, "many">>;
    pageUrl: z.ZodOptional<z.ZodString>;
    normalizedUrl: z.ZodOptional<z.ZodString>;
    outcomeType: z.ZodOptional<z.ZodString>;
    confidence: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    action: string;
    stepIndex: number;
    intent: string;
    locatorStatus: "resolved" | "unresolved" | "not_applicable";
    assertions: {
        type: "custom" | "title" | "url" | "element_visible" | "element_text";
        value?: string | undefined;
        selector?: string | undefined;
        source?: "outcome" | "anchor" | "user_defined" | undefined;
        confidence?: number | undefined;
    }[];
    value?: string | undefined;
    confidence?: number | undefined;
    normalizedUrl?: string | undefined;
    traceId?: string | undefined;
    pageUrl?: string | undefined;
    selectorResolution?: {
        status: "resolved" | "unresolved";
        schemaVersion: "air:selector-resolution:v1";
        blockedReason?: string | null | undefined;
        selected?: {
            selector: string;
            engine: "xpath" | "css";
            source: "shadow-preference" | "legacy-primary";
            replaySafe: boolean;
            matchCount?: number | null | undefined;
            visibleMatchCount?: number | null | undefined;
            family?: string | undefined;
            warningCodes?: string[] | undefined;
            proposalSource?: string | null | undefined;
            confidence?: "medium" | "high" | "low" | undefined;
            proofSource?: string | null | undefined;
            selectedReason?: string | undefined;
        } | undefined;
    } | undefined;
    eventId?: string | undefined;
    resolvedTarget?: {
        value: string;
        source: "selectorResolution" | "legacy_fallback";
        kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
        replaySafe: boolean;
        options?: {
            exact?: boolean | undefined;
            name?: string | undefined;
        } | undefined;
    } | undefined;
    fallbackHints?: {
        tagName?: string | undefined;
        attributes?: Record<string, string> | undefined;
        legacySelector?: string | undefined;
        elementText?: string | undefined;
    } | undefined;
    outcomeType?: string | undefined;
}, {
    action: string;
    stepIndex: number;
    intent: string;
    locatorStatus: "resolved" | "unresolved" | "not_applicable";
    value?: string | undefined;
    confidence?: number | undefined;
    normalizedUrl?: string | undefined;
    traceId?: string | undefined;
    pageUrl?: string | undefined;
    selectorResolution?: {
        status: "resolved" | "unresolved";
        schemaVersion: "air:selector-resolution:v1";
        blockedReason?: string | null | undefined;
        selected?: {
            selector: string;
            engine: "xpath" | "css";
            source: "shadow-preference" | "legacy-primary";
            replaySafe: boolean;
            matchCount?: number | null | undefined;
            visibleMatchCount?: number | null | undefined;
            family?: string | undefined;
            warningCodes?: string[] | undefined;
            proposalSource?: string | null | undefined;
            confidence?: "medium" | "high" | "low" | undefined;
            proofSource?: string | null | undefined;
            selectedReason?: string | undefined;
        } | undefined;
    } | undefined;
    eventId?: string | undefined;
    resolvedTarget?: {
        value: string;
        source: "selectorResolution" | "legacy_fallback";
        kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
        replaySafe: boolean;
        options?: {
            exact?: boolean | undefined;
            name?: string | undefined;
        } | undefined;
    } | undefined;
    fallbackHints?: {
        tagName?: string | undefined;
        attributes?: Record<string, string> | undefined;
        legacySelector?: string | undefined;
        elementText?: string | undefined;
    } | undefined;
    assertions?: {
        type: "custom" | "title" | "url" | "element_visible" | "element_text";
        value?: string | undefined;
        selector?: string | undefined;
        source?: "outcome" | "anchor" | "user_defined" | undefined;
        confidence?: number | undefined;
    }[] | undefined;
    outcomeType?: string | undefined;
}>;
export type GenerationStepV1 = z.infer<typeof GenerationStepSchemaV1>;
/**
 * GenerationContextV1 is the pristine public generation contract for AIR.
 *
 * It is intended for current deterministic codegen and future MCP/LLM consumers.
 * It explicitly excludes massive snapshots and heavy resolver metadata.
 *
 * Future MCP Pagination Design Note:
 * MCP tools exposing this context must be pagination-aware.
 * Expected future tools:
 *   get_flow_steps({ sessionId, offset: 0, limit: 25, mode: "summary" })
 * returning { totalSteps, offset, limit, hasMore, steps }.
 * Massive snapshots must never be included by default; a separate
 * `get_step_snapshot_context(eventId)` tool should handle those if needed.
 */
export declare const GenerationContextSchemaV1: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"air:generation-context:v1">;
    sessionId: z.ZodString;
    url: z.ZodString;
    recordedAt: z.ZodNumber;
    steps: z.ZodArray<z.ZodObject<{
        stepIndex: z.ZodNumber;
        eventId: z.ZodOptional<z.ZodString>;
        traceId: z.ZodOptional<z.ZodString>;
        action: z.ZodString;
        intent: z.ZodString;
        value: z.ZodOptional<z.ZodString>;
        locatorStatus: z.ZodEnum<["resolved", "unresolved", "not_applicable"]>;
        resolvedTarget: z.ZodOptional<z.ZodObject<{
            kind: z.ZodEnum<["css", "xpath", "role", "text", "label", "placeholder", "testid"]>;
            value: z.ZodString;
            options: z.ZodOptional<z.ZodObject<{
                name: z.ZodOptional<z.ZodString>;
                exact: z.ZodOptional<z.ZodBoolean>;
            }, "strip", z.ZodTypeAny, {
                exact?: boolean | undefined;
                name?: string | undefined;
            }, {
                exact?: boolean | undefined;
                name?: string | undefined;
            }>>;
            source: z.ZodEnum<["selectorResolution", "legacy_fallback"]>;
            replaySafe: z.ZodBoolean;
        }, "strip", z.ZodTypeAny, {
            value: string;
            source: "selectorResolution" | "legacy_fallback";
            kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
            replaySafe: boolean;
            options?: {
                exact?: boolean | undefined;
                name?: string | undefined;
            } | undefined;
        }, {
            value: string;
            source: "selectorResolution" | "legacy_fallback";
            kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
            replaySafe: boolean;
            options?: {
                exact?: boolean | undefined;
                name?: string | undefined;
            } | undefined;
        }>>;
        fallbackHints: z.ZodOptional<z.ZodObject<{
            legacySelector: z.ZodOptional<z.ZodString>;
            elementText: z.ZodOptional<z.ZodString>;
            tagName: z.ZodOptional<z.ZodString>;
            attributes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            tagName?: string | undefined;
            attributes?: Record<string, string> | undefined;
            legacySelector?: string | undefined;
            elementText?: string | undefined;
        }, {
            tagName?: string | undefined;
            attributes?: Record<string, string> | undefined;
            legacySelector?: string | undefined;
            elementText?: string | undefined;
        }>>;
        selectorResolution: z.ZodOptional<z.ZodObject<{
            schemaVersion: z.ZodLiteral<"air:selector-resolution:v1">;
            status: z.ZodEnum<["resolved", "unresolved"]>;
            selected: z.ZodOptional<z.ZodObject<{
                selector: z.ZodString;
                engine: z.ZodEnum<["css", "xpath"]>;
                family: z.ZodOptional<z.ZodString>;
                source: z.ZodEnum<["shadow-preference", "legacy-primary"]>;
                proposalSource: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                matchCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                visibleMatchCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
                replaySafe: z.ZodBoolean;
                confidence: z.ZodOptional<z.ZodEnum<["high", "medium", "low"]>>;
                warningCodes: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
                proofSource: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                selectedReason: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            }, {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            }>>;
            blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            status: "resolved" | "unresolved";
            schemaVersion: "air:selector-resolution:v1";
            blockedReason?: string | null | undefined;
            selected?: {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            } | undefined;
        }, {
            status: "resolved" | "unresolved";
            schemaVersion: "air:selector-resolution:v1";
            blockedReason?: string | null | undefined;
            selected?: {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            } | undefined;
        }>>;
        assertions: z.ZodDefault<z.ZodArray<z.ZodObject<{
            type: z.ZodEnum<["url", "element_visible", "element_text", "title", "custom"]>;
            value: z.ZodOptional<z.ZodString>;
            selector: z.ZodOptional<z.ZodString>;
            source: z.ZodOptional<z.ZodEnum<["outcome", "anchor", "user_defined"]>>;
            confidence: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            type: "custom" | "title" | "url" | "element_visible" | "element_text";
            value?: string | undefined;
            selector?: string | undefined;
            source?: "outcome" | "anchor" | "user_defined" | undefined;
            confidence?: number | undefined;
        }, {
            type: "custom" | "title" | "url" | "element_visible" | "element_text";
            value?: string | undefined;
            selector?: string | undefined;
            source?: "outcome" | "anchor" | "user_defined" | undefined;
            confidence?: number | undefined;
        }>, "many">>;
        pageUrl: z.ZodOptional<z.ZodString>;
        normalizedUrl: z.ZodOptional<z.ZodString>;
        outcomeType: z.ZodOptional<z.ZodString>;
        confidence: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        action: string;
        stepIndex: number;
        intent: string;
        locatorStatus: "resolved" | "unresolved" | "not_applicable";
        assertions: {
            type: "custom" | "title" | "url" | "element_visible" | "element_text";
            value?: string | undefined;
            selector?: string | undefined;
            source?: "outcome" | "anchor" | "user_defined" | undefined;
            confidence?: number | undefined;
        }[];
        value?: string | undefined;
        confidence?: number | undefined;
        normalizedUrl?: string | undefined;
        traceId?: string | undefined;
        pageUrl?: string | undefined;
        selectorResolution?: {
            status: "resolved" | "unresolved";
            schemaVersion: "air:selector-resolution:v1";
            blockedReason?: string | null | undefined;
            selected?: {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            } | undefined;
        } | undefined;
        eventId?: string | undefined;
        resolvedTarget?: {
            value: string;
            source: "selectorResolution" | "legacy_fallback";
            kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
            replaySafe: boolean;
            options?: {
                exact?: boolean | undefined;
                name?: string | undefined;
            } | undefined;
        } | undefined;
        fallbackHints?: {
            tagName?: string | undefined;
            attributes?: Record<string, string> | undefined;
            legacySelector?: string | undefined;
            elementText?: string | undefined;
        } | undefined;
        outcomeType?: string | undefined;
    }, {
        action: string;
        stepIndex: number;
        intent: string;
        locatorStatus: "resolved" | "unresolved" | "not_applicable";
        value?: string | undefined;
        confidence?: number | undefined;
        normalizedUrl?: string | undefined;
        traceId?: string | undefined;
        pageUrl?: string | undefined;
        selectorResolution?: {
            status: "resolved" | "unresolved";
            schemaVersion: "air:selector-resolution:v1";
            blockedReason?: string | null | undefined;
            selected?: {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            } | undefined;
        } | undefined;
        eventId?: string | undefined;
        resolvedTarget?: {
            value: string;
            source: "selectorResolution" | "legacy_fallback";
            kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
            replaySafe: boolean;
            options?: {
                exact?: boolean | undefined;
                name?: string | undefined;
            } | undefined;
        } | undefined;
        fallbackHints?: {
            tagName?: string | undefined;
            attributes?: Record<string, string> | undefined;
            legacySelector?: string | undefined;
            elementText?: string | undefined;
        } | undefined;
        assertions?: {
            type: "custom" | "title" | "url" | "element_visible" | "element_text";
            value?: string | undefined;
            selector?: string | undefined;
            source?: "outcome" | "anchor" | "user_defined" | undefined;
            confidence?: number | undefined;
        }[] | undefined;
        outcomeType?: string | undefined;
    }>, "many">;
    metadata: z.ZodOptional<z.ZodObject<{
        generatedAt: z.ZodOptional<z.ZodNumber>;
        source: z.ZodOptional<z.ZodLiteral<"air-db">>;
    }, "strip", z.ZodTypeAny, {
        source?: "air-db" | undefined;
        generatedAt?: number | undefined;
    }, {
        source?: "air-db" | undefined;
        generatedAt?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    schemaVersion: "air:generation-context:v1";
    url: string;
    sessionId: string;
    recordedAt: number;
    steps: {
        action: string;
        stepIndex: number;
        intent: string;
        locatorStatus: "resolved" | "unresolved" | "not_applicable";
        assertions: {
            type: "custom" | "title" | "url" | "element_visible" | "element_text";
            value?: string | undefined;
            selector?: string | undefined;
            source?: "outcome" | "anchor" | "user_defined" | undefined;
            confidence?: number | undefined;
        }[];
        value?: string | undefined;
        confidence?: number | undefined;
        normalizedUrl?: string | undefined;
        traceId?: string | undefined;
        pageUrl?: string | undefined;
        selectorResolution?: {
            status: "resolved" | "unresolved";
            schemaVersion: "air:selector-resolution:v1";
            blockedReason?: string | null | undefined;
            selected?: {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            } | undefined;
        } | undefined;
        eventId?: string | undefined;
        resolvedTarget?: {
            value: string;
            source: "selectorResolution" | "legacy_fallback";
            kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
            replaySafe: boolean;
            options?: {
                exact?: boolean | undefined;
                name?: string | undefined;
            } | undefined;
        } | undefined;
        fallbackHints?: {
            tagName?: string | undefined;
            attributes?: Record<string, string> | undefined;
            legacySelector?: string | undefined;
            elementText?: string | undefined;
        } | undefined;
        outcomeType?: string | undefined;
    }[];
    metadata?: {
        source?: "air-db" | undefined;
        generatedAt?: number | undefined;
    } | undefined;
}, {
    schemaVersion: "air:generation-context:v1";
    url: string;
    sessionId: string;
    recordedAt: number;
    steps: {
        action: string;
        stepIndex: number;
        intent: string;
        locatorStatus: "resolved" | "unresolved" | "not_applicable";
        value?: string | undefined;
        confidence?: number | undefined;
        normalizedUrl?: string | undefined;
        traceId?: string | undefined;
        pageUrl?: string | undefined;
        selectorResolution?: {
            status: "resolved" | "unresolved";
            schemaVersion: "air:selector-resolution:v1";
            blockedReason?: string | null | undefined;
            selected?: {
                selector: string;
                engine: "xpath" | "css";
                source: "shadow-preference" | "legacy-primary";
                replaySafe: boolean;
                matchCount?: number | null | undefined;
                visibleMatchCount?: number | null | undefined;
                family?: string | undefined;
                warningCodes?: string[] | undefined;
                proposalSource?: string | null | undefined;
                confidence?: "medium" | "high" | "low" | undefined;
                proofSource?: string | null | undefined;
                selectedReason?: string | undefined;
            } | undefined;
        } | undefined;
        eventId?: string | undefined;
        resolvedTarget?: {
            value: string;
            source: "selectorResolution" | "legacy_fallback";
            kind: "text" | "xpath" | "css" | "placeholder" | "role" | "label" | "testid";
            replaySafe: boolean;
            options?: {
                exact?: boolean | undefined;
                name?: string | undefined;
            } | undefined;
        } | undefined;
        fallbackHints?: {
            tagName?: string | undefined;
            attributes?: Record<string, string> | undefined;
            legacySelector?: string | undefined;
            elementText?: string | undefined;
        } | undefined;
        assertions?: {
            type: "custom" | "title" | "url" | "element_visible" | "element_text";
            value?: string | undefined;
            selector?: string | undefined;
            source?: "outcome" | "anchor" | "user_defined" | undefined;
            confidence?: number | undefined;
        }[] | undefined;
        outcomeType?: string | undefined;
    }[];
    metadata?: {
        source?: "air-db" | undefined;
        generatedAt?: number | undefined;
    } | undefined;
}>;
export type GenerationContextV1 = z.infer<typeof GenerationContextSchemaV1>;
