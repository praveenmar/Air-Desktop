import type { CodegenStep } from '../types';
import type { CandidateValidation } from './types';
import { elementLooksInputLike, elementLooksInteractive, hasFieldIntent } from './element-ranking';
export declare function isVisibleElement(el: Element): boolean;
export declare function validateCSSCandidate(selector: string, snapshot: Document, step?: CodegenStep, root?: ParentNode): CandidateValidation;
export declare function validateTextCandidate(selector: string, snapshot: Document, step?: CodegenStep, root?: ParentNode): CandidateValidation;
export { elementLooksInputLike, elementLooksInteractive, hasFieldIntent, };
