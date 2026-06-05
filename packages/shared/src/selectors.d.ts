export type SelectorResult = {
    selector: string;
    priority: string;
    rank: number;
};
type SelectorOptions = {
    maxTextLength?: number;
};
export declare const SELECTOR_RANK_MAP: Record<string, number>;
export declare function escapeCssString(value: unknown): string;
export declare function rankForPriority(priority: string): number;
export declare function extractText(element: Element, maxTextLength?: number): string | null;
export declare function findStableClass(element: Element): string | null;
export declare function generateXPath(element: Element): string;
export declare function generateOptimalSelector(rawElement: Element, options?: SelectorOptions): SelectorResult;
export {};
