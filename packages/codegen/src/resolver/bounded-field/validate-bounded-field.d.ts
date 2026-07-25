import type { BoundedFieldStructuredSelectorSpec } from '../../types';
import type { CandidateValidation } from '../types';
import type { BoundedFieldValidationContext, BoundedFieldValidationResult } from './types';
export declare function validateBoundedFieldSelectorSpec(spec: BoundedFieldStructuredSelectorSpec, snapshot: Document, _context?: BoundedFieldValidationContext): BoundedFieldValidationResult;
export declare function toCandidateValidation(validation: BoundedFieldValidationResult): CandidateValidation;
