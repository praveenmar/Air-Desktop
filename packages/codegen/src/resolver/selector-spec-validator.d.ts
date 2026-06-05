import type { BoundedFieldStructuredSelectorSpec, CodegenStep, ScopedSelectorSpec, SelectorSpec } from '../types';
import type { CandidateValidation, RawCandidate } from './types';
export interface SelectorSpecValidationContext {
    step?: CodegenStep;
    root?: ParentNode;
}
export declare function validateScopedSelectorSpec(spec: ScopedSelectorSpec, snapshot: Document, context?: SelectorSpecValidationContext): CandidateValidation;
export declare function validateBoundedFieldStructuredSelectorSpec(spec: BoundedFieldStructuredSelectorSpec, snapshot: Document, context?: SelectorSpecValidationContext): CandidateValidation;
export declare function validateSelectorSpec(spec: SelectorSpec, snapshot: Document, context?: SelectorSpecValidationContext): CandidateValidation;
export declare function validateRawCandidate(candidate: RawCandidate, snapshot: Document, step?: CodegenStep): CandidateValidation;
