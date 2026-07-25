export type CompositeAnchorKind = "form_cluster" | "container_controls" | "table_row" | "dialog_actions" | "menu_group";
export interface CompositeAnchor {
    kind: CompositeAnchorKind;
    scopeTag?: string | null;
    scopeRole?: string | null;
    scopeId?: string | null;
    scopeName?: string | null;
    scopeLabel?: string | null;
    tokens: string[];
    descriptor: string;
    confidence: number;
}
export interface CompositeAnchorScanResult {
    anchors: CompositeAnchor[];
    inspectedContainerCount: number;
    droppedCompositeCount: number;
    skippedCompositeReasons: string[];
    skippedCompositeCount: number;
    finalCompositeCount: number;
    formScanMs: number;
    dialogScanMs: number;
    tableScanMs: number;
    menuScanMs: number;
    containerScanMs: number;
}
/**
 * Exported normalize function (Node + test usage)
 */
export declare function normalizeAnchor(text: string | null | undefined): string;
/**
 * MUST be self-contained for page.evaluate()
 */
export declare function scanPageAnchors(root?: Document | Element, locationPath?: string): string[];
export declare function scanCompositeAnchors(root?: Document | Element, _locationPath?: string): CompositeAnchor[];
export declare function scanCompositeAnchorsDetailed(root?: Document | Element, _locationPath?: string): CompositeAnchorScanResult;
