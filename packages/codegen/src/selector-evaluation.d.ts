import type { EquivalentRendering, SelectorCategory, SelectorEvaluation, SelectorProofLevel, SelectorProofSource, SelectorSource, SelectorSpec } from './types';
import type { CandidateValidation, RawCandidate } from './resolver/types';
export declare function classifySelectorCategory(selector: string, source?: RawCandidate['source'] | SelectorSource): SelectorCategory;
export declare function mapSelectorProofSource(params: {
    source: SelectorSource;
    proofLevel: SelectorProofLevel;
}): SelectorProofSource;
export declare function proofScoreForValidation(validation: CandidateValidation): number;
export declare function stabilityBaseScoreForCategory(category: SelectorCategory): number;
export declare function summarizeSelectorEvaluation(selectorSpec: SelectorSpec, params: {
    category: SelectorCategory;
    validation: SelectorEvaluation['validation'];
    proofSource: SelectorProofSource;
    snapshotTargetEvidence?: boolean;
    proofScore: number;
    stabilityScore: number;
    semanticScore: number;
    brittlenessPenalty: number;
    entropyPenalty: number;
    finalScore: number;
    reasons: string[];
    warningCodes?: string[];
    rejectReason?: string | null;
    preferredRenderings?: EquivalentRendering[];
}): SelectorEvaluation;
