export declare function normalizeStructuredSelectorText(value: string | null | undefined): string;
export declare function getVisibleInputLikeControls(root: ParentNode): Element[];
export declare function getVisibleTriggerLikeControls(root: ParentNode): Element[];
export declare function findExactVisibleLabelLikeDescendants(root: Element, labelText: string): Element[];
export declare function findTightFieldContainer(label: Element, target: Element): {
    container: Element | null;
    blockedReason?: string;
};
export declare function findTightTriggerContainer(target: Element, labelText: string): {
    container: Element | null;
    labelElement?: Element | null;
    blockedReason?: string;
};
export declare function isGenericContainerSelector(selector: string | null | undefined): boolean;
