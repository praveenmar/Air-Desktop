import type { BoundedFieldSelectorSpec, LabelContextRenderStatus } from '../../types';
export declare function classifyBoundedFieldRenderStatus(boundedField?: BoundedFieldSelectorSpec | null): LabelContextRenderStatus | undefined;
export declare function renderBoundedFieldLocator(boundedField?: BoundedFieldSelectorSpec | null): string | null;
export declare function getBoundedFieldRenderingWarnings(boundedField?: BoundedFieldSelectorSpec | null): string[];
export declare function buildBoundedFieldWarningComments(boundedField?: BoundedFieldSelectorSpec | null): string[];
