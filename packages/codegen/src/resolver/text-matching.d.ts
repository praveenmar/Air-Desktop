import type { CodegenStep } from '../types';
import type { StepSignalAttributes } from './types';
export interface SemanticTextSignal {
    value: string;
    source: string;
}
export declare function cssEscape(value: string): string;
export declare function isLikelyCssSelector(selector: string): boolean;
export declare function isTextSelector(selector: string): boolean;
export declare function extractAttributeValue(selector: string, attribute: string): string | null;
export declare function extractId(selector: string): string | null;
export declare function extractClass(selector: string): string | null;
export declare function extractTextExcerpt(step: CodegenStep): string | null;
export declare function inferStepSignalAttributes(step: CodegenStep): StepSignalAttributes;
export declare function normalizeStaticText(value: string): string;
export declare function getElementTextSignals(element: Element): string[];
export declare function getElementSemanticTextSignals(element: Element, snapshot?: Document): SemanticTextSignal[];
export declare function getElementContextHints(element: Element): {
    parentTag?: string;
    nearestContainerTag?: string;
};
export declare function textFromElement(element: Element): string | null;
export declare function findStableClassFromAttributes(classAttr?: string): string | null;
export declare function isDynamicText(text: string, options?: {
    allowNumericText?: boolean;
}): boolean;
export declare function normalizeTextForMatch(text: string): string;
export declare function unquoteTextLiteral(value: string): string;
export declare function escapeTextSelectorValue(value: string): string;
export declare function extractStableParentSelector(step: CodegenStep, attrs?: StepSignalAttributes): string | null;
