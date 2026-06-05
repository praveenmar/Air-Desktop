import { z } from 'zod';
/** Selector priority (used by Interceptor when choosing selector) */
export declare const SelectorPrioritySchema: z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>;
export type SelectorPriority = z.infer<typeof SelectorPrioritySchema>;
/** Contextual tags surrounding the element */
export declare const FingerprintContextSchema: z.ZodObject<{
    parentTag: z.ZodNullable<z.ZodString>;
    nearestContainerTag: z.ZodNullable<z.ZodString>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    parentTag: z.ZodNullable<z.ZodString>;
    nearestContainerTag: z.ZodNullable<z.ZodString>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    parentTag: z.ZodNullable<z.ZodString>;
    nearestContainerTag: z.ZodNullable<z.ZodString>;
}, z.ZodTypeAny, "passthrough">>;
export type FingerprintContext = z.infer<typeof FingerprintContextSchema>;
export declare const SelectorAmbiguityMetadataSchema: z.ZodObject<{
    originalSelector: z.ZodString;
    originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
    matchCount: z.ZodNumber;
    visibleMatchCount: z.ZodNumber;
    positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isUnique: z.ZodBoolean;
    isAmbiguous: z.ZodBoolean;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    originalSelector: z.ZodString;
    originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
    matchCount: z.ZodNumber;
    visibleMatchCount: z.ZodNumber;
    positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isUnique: z.ZodBoolean;
    isAmbiguous: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    originalSelector: z.ZodString;
    originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
    matchCount: z.ZodNumber;
    visibleMatchCount: z.ZodNumber;
    positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isUnique: z.ZodBoolean;
    isAmbiguous: z.ZodBoolean;
}, z.ZodTypeAny, "passthrough">>;
export type SelectorAmbiguityMetadata = z.infer<typeof SelectorAmbiguityMetadataSchema>;
export declare const CapturedSelectorCandidateEngineSchema: z.ZodEnum<["css", "text", "xpath"]>;
export type CapturedSelectorCandidateEngine = z.infer<typeof CapturedSelectorCandidateEngineSchema>;
export declare const CapturedSelectorCandidateFamilySchema: z.ZodEnum<["primary", "test-id", "id", "name", "placeholder", "aria-label", "href", "role-attr", "text", "class", "parent-scoped-css", "tight-container-css"]>;
export type CapturedSelectorCandidateFamily = z.infer<typeof CapturedSelectorCandidateFamilySchema>;
export declare const CapturedSelectorCandidateStrengthSchema: z.ZodEnum<["strong", "medium", "weak"]>;
export type CapturedSelectorCandidateStrength = z.infer<typeof CapturedSelectorCandidateStrengthSchema>;
export declare const CapturedSelectorCandidateSchema: z.ZodObject<{
    selector: z.ZodString;
    engine: z.ZodEnum<["css", "text", "xpath"]>;
    family: z.ZodEnum<["primary", "test-id", "id", "name", "placeholder", "aria-label", "href", "role-attr", "text", "class", "parent-scoped-css", "tight-container-css"]>;
    strength: z.ZodEnum<["strong", "medium", "weak"]>;
    source: z.ZodLiteral<"capture">;
    isPrimary: z.ZodOptional<z.ZodBoolean>;
    matchCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    visibleMatchCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    positionInAllMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    positionInVisibleMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    usesDynamicClass: z.ZodOptional<z.ZodBoolean>;
    usesIndex: z.ZodOptional<z.ZodBoolean>;
    warningCodes: z.ZodEffects<z.ZodOptional<z.ZodArray<z.ZodString, "many">>, string[] | undefined, string[] | undefined>;
}, "strip", z.ZodTypeAny, {
    selector: string;
    engine: "text" | "xpath" | "css";
    family: "id" | "class" | "text" | "primary" | "test-id" | "name" | "placeholder" | "aria-label" | "href" | "role-attr" | "parent-scoped-css" | "tight-container-css";
    strength: "strong" | "medium" | "weak";
    source: "capture";
    matchCount?: number | null | undefined;
    visibleMatchCount?: number | null | undefined;
    isPrimary?: boolean | undefined;
    positionInAllMatches?: number | null | undefined;
    positionInVisibleMatches?: number | null | undefined;
    usesDynamicClass?: boolean | undefined;
    usesIndex?: boolean | undefined;
    warningCodes?: string[] | undefined;
}, {
    selector: string;
    engine: "text" | "xpath" | "css";
    family: "id" | "class" | "text" | "primary" | "test-id" | "name" | "placeholder" | "aria-label" | "href" | "role-attr" | "parent-scoped-css" | "tight-container-css";
    strength: "strong" | "medium" | "weak";
    source: "capture";
    matchCount?: number | null | undefined;
    visibleMatchCount?: number | null | undefined;
    isPrimary?: boolean | undefined;
    positionInAllMatches?: number | null | undefined;
    positionInVisibleMatches?: number | null | undefined;
    usesDynamicClass?: boolean | undefined;
    usesIndex?: boolean | undefined;
    warningCodes?: string[] | undefined;
}>;
export type CapturedSelectorCandidate = z.infer<typeof CapturedSelectorCandidateSchema>;
export declare const CapturedSelectorCandidateArraySchema: z.ZodEffects<z.ZodArray<z.ZodUnknown, "many">, {
    selector: string;
    engine: "text" | "xpath" | "css";
    family: "id" | "class" | "text" | "primary" | "test-id" | "name" | "placeholder" | "aria-label" | "href" | "role-attr" | "parent-scoped-css" | "tight-container-css";
    strength: "strong" | "medium" | "weak";
    source: "capture";
    matchCount?: number | null | undefined;
    visibleMatchCount?: number | null | undefined;
    isPrimary?: boolean | undefined;
    positionInAllMatches?: number | null | undefined;
    positionInVisibleMatches?: number | null | undefined;
    usesDynamicClass?: boolean | undefined;
    usesIndex?: boolean | undefined;
    warningCodes?: string[] | undefined;
}[] | undefined, unknown[]>;
export declare const BoundedContainerSelectorCandidateSchema: z.ZodObject<{
    selector: z.ZodString;
    kind: z.ZodString;
    isClean: z.ZodOptional<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    selector: z.ZodString;
    kind: z.ZodString;
    isClean: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    selector: z.ZodString;
    kind: z.ZodString;
    isClean: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type BoundedContainerSelectorCandidate = z.infer<typeof BoundedContainerSelectorCandidateSchema>;
export declare const BoundedFieldContextSchema: z.ZodObject<{
    fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
    targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
    visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isValid: z.ZodOptional<z.ZodBoolean>;
    blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
    targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
    visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isValid: z.ZodOptional<z.ZodBoolean>;
    blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
    targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
    visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        selector: z.ZodString;
        kind: z.ZodString;
        isClean: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>, "many">>;
    cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    isValid: z.ZodOptional<z.ZodBoolean>;
    blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.ZodTypeAny, "passthrough">>;
export type BoundedFieldContext = z.infer<typeof BoundedFieldContextSchema>;
export declare const AccessibilityEvidenceSchema: z.ZodObject<{
    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
    labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
    labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
    labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
}, z.ZodTypeAny, "passthrough">>;
export type AccessibilityEvidence = z.infer<typeof AccessibilityEvidenceSchema>;
export declare const TargetIdentitySourceSchema: z.ZodEnum<["pageState", "pageSnapshot", "interactionContext"]>;
export type TargetIdentitySource = z.infer<typeof TargetIdentitySourceSchema>;
export declare const TargetIdentityStatusSchema: z.ZodEnum<["emitted", "target-not-element", "target-detached", "target-not-in-snapshot", "shadow-not-serialized", "cross-origin-frame", "unsupported"]>;
export type TargetIdentityStatus = z.infer<typeof TargetIdentityStatusSchema>;
/** Compact fingerprint for an element (4-layer identification) */
export declare const ElementFingerprintSchema: z.ZodObject<{
    selector: z.ZodString;
    selectorPriority: z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>;
    selectorRank: z.ZodOptional<z.ZodNumber>;
    tagName: z.ZodOptional<z.ZodString>;
    parentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    textExcerpt: z.ZodNullable<z.ZodString>;
    context: z.ZodObject<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    attributes: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
    selectorCandidates: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodUnknown, "many">, {
        selector: string;
        engine: "text" | "xpath" | "css";
        family: "id" | "class" | "text" | "primary" | "test-id" | "name" | "placeholder" | "aria-label" | "href" | "role-attr" | "parent-scoped-css" | "tight-container-css";
        strength: "strong" | "medium" | "weak";
        source: "capture";
        matchCount?: number | null | undefined;
        visibleMatchCount?: number | null | undefined;
        isPrimary?: boolean | undefined;
        positionInAllMatches?: number | null | undefined;
        positionInVisibleMatches?: number | null | undefined;
        usesDynamicClass?: boolean | undefined;
        usesIndex?: boolean | undefined;
        warningCodes?: string[] | undefined;
    }[] | undefined, unknown[]>>;
    selectorAmbiguity: z.ZodOptional<z.ZodObject<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">>>;
    boundedFieldContext: z.ZodOptional<z.ZodObject<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>;
    accessibilityEvidence: z.ZodOptional<z.ZodObject<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
    attributesHash: z.ZodString;
    targetNodeId: z.ZodOptional<z.ZodString>;
    targetIdentitySource: z.ZodOptional<z.ZodEnum<["pageState", "pageSnapshot", "interactionContext"]>>;
    targetIdentityStatus: z.ZodOptional<z.ZodEnum<["emitted", "target-not-element", "target-detached", "target-not-in-snapshot", "shadow-not-serialized", "cross-origin-frame", "unsupported"]>>;
}, "passthrough", z.ZodTypeAny, z.objectOutputType<{
    selector: z.ZodString;
    selectorPriority: z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>;
    selectorRank: z.ZodOptional<z.ZodNumber>;
    tagName: z.ZodOptional<z.ZodString>;
    parentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    textExcerpt: z.ZodNullable<z.ZodString>;
    context: z.ZodObject<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    attributes: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
    selectorCandidates: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodUnknown, "many">, {
        selector: string;
        engine: "text" | "xpath" | "css";
        family: "id" | "class" | "text" | "primary" | "test-id" | "name" | "placeholder" | "aria-label" | "href" | "role-attr" | "parent-scoped-css" | "tight-container-css";
        strength: "strong" | "medium" | "weak";
        source: "capture";
        matchCount?: number | null | undefined;
        visibleMatchCount?: number | null | undefined;
        isPrimary?: boolean | undefined;
        positionInAllMatches?: number | null | undefined;
        positionInVisibleMatches?: number | null | undefined;
        usesDynamicClass?: boolean | undefined;
        usesIndex?: boolean | undefined;
        warningCodes?: string[] | undefined;
    }[] | undefined, unknown[]>>;
    selectorAmbiguity: z.ZodOptional<z.ZodObject<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">>>;
    boundedFieldContext: z.ZodOptional<z.ZodObject<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>;
    accessibilityEvidence: z.ZodOptional<z.ZodObject<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
    attributesHash: z.ZodString;
    targetNodeId: z.ZodOptional<z.ZodString>;
    targetIdentitySource: z.ZodOptional<z.ZodEnum<["pageState", "pageSnapshot", "interactionContext"]>>;
    targetIdentityStatus: z.ZodOptional<z.ZodEnum<["emitted", "target-not-element", "target-detached", "target-not-in-snapshot", "shadow-not-serialized", "cross-origin-frame", "unsupported"]>>;
}, z.ZodTypeAny, "passthrough">, z.objectInputType<{
    selector: z.ZodString;
    selectorPriority: z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>;
    selectorRank: z.ZodOptional<z.ZodNumber>;
    tagName: z.ZodOptional<z.ZodString>;
    parentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    textExcerpt: z.ZodNullable<z.ZodString>;
    context: z.ZodObject<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        parentTag: z.ZodNullable<z.ZodString>;
        nearestContainerTag: z.ZodNullable<z.ZodString>;
    }, z.ZodTypeAny, "passthrough">>;
    attributes: z.ZodRecord<z.ZodString, z.ZodOptional<z.ZodString>>;
    selectorCandidates: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodUnknown, "many">, {
        selector: string;
        engine: "text" | "xpath" | "css";
        family: "id" | "class" | "text" | "primary" | "test-id" | "name" | "placeholder" | "aria-label" | "href" | "role-attr" | "parent-scoped-css" | "tight-container-css";
        strength: "strong" | "medium" | "weak";
        source: "capture";
        matchCount?: number | null | undefined;
        visibleMatchCount?: number | null | undefined;
        isPrimary?: boolean | undefined;
        positionInAllMatches?: number | null | undefined;
        positionInVisibleMatches?: number | null | undefined;
        usesDynamicClass?: boolean | undefined;
        usesIndex?: boolean | undefined;
        warningCodes?: string[] | undefined;
    }[] | undefined, unknown[]>>;
    selectorAmbiguity: z.ZodOptional<z.ZodObject<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        originalSelector: z.ZodString;
        originalPriority: z.ZodOptional<z.ZodEnum<["data-testid", "id", "class", "attribute", "path", "other", "text", "xpath", "chained"]>>;
        matchCount: z.ZodNumber;
        visibleMatchCount: z.ZodNumber;
        positionInMatches: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isUnique: z.ZodBoolean;
        isAmbiguous: z.ZodBoolean;
    }, z.ZodTypeAny, "passthrough">>>;
    boundedFieldContext: z.ZodOptional<z.ZodObject<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        fieldLabelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        fieldRelation: z.ZodOptional<z.ZodNullable<z.ZodEnum<["label-for", "wrapped-label", "aria-labelledby", "sibling-label", "bounded-container"]>>>;
        targetControlKind: z.ZodOptional<z.ZodNullable<z.ZodEnum<["input", "textarea", "select", "custom-trigger", "combobox", "searchbox", "contenteditable", "unknown"]>>>;
        visibleControlCountInContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        targetIndexWithinContainer: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        boundedContainerSummary: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        boundedContainerSelectorCandidates: z.ZodOptional<z.ZodArray<z.ZodObject<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
            selector: z.ZodString;
            kind: z.ZodString;
            isClean: z.ZodOptional<z.ZodBoolean>;
        }, z.ZodTypeAny, "passthrough">>, "many">>;
        cleanParentSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        cleanChildSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        containerSelector: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        competingControlCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        duplicateLabelCount: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        isValid: z.ZodOptional<z.ZodBoolean>;
        blockedReason: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.ZodTypeAny, "passthrough">>>;
    accessibilityEvidence: z.ZodOptional<z.ZodObject<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, "passthrough", z.ZodTypeAny, z.objectOutputType<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">, z.objectInputType<{
        role: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        accessibleNameSource: z.ZodOptional<z.ZodEnum<["aria-label", "aria-labelledby", "label-for", "wrapped-label", "button-text", "link-text", "placeholder", "title", "role-text", "none"]>>;
        labelText: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        labelledByIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        isNativeLabelAssociation: z.ZodOptional<z.ZodBoolean>;
    }, z.ZodTypeAny, "passthrough">>>;
    attributesHash: z.ZodString;
    targetNodeId: z.ZodOptional<z.ZodString>;
    targetIdentitySource: z.ZodOptional<z.ZodEnum<["pageState", "pageSnapshot", "interactionContext"]>>;
    targetIdentityStatus: z.ZodOptional<z.ZodEnum<["emitted", "target-not-element", "target-detached", "target-not-in-snapshot", "shadow-not-serialized", "cross-origin-frame", "unsupported"]>>;
}, z.ZodTypeAny, "passthrough">>;
export type ElementFingerprint = z.infer<typeof ElementFingerprintSchema>;
