import type { CodegenStep, SnapshotSelectionProvenance } from '../../types';
import type { BoundedFieldCandidate } from './types';
export declare function isWeakBoundedFieldInputCandidate(step: CodegenStep): boolean;
export declare function buildBoundedFieldCandidates(params: {
    step: CodegenStep;
    snapshot: Document;
    snapshotSelection?: SnapshotSelectionProvenance;
}): BoundedFieldCandidate[];
export declare function diagnoseBoundedFieldInputCandidate(params: {
    step: CodegenStep;
    snapshot: Document;
    snapshotSelection?: SnapshotSelectionProvenance;
}): string | null;
export declare function buildBoundedFieldTriggerCandidates(params: {
    step: CodegenStep;
    snapshot: Document;
    snapshotSelection?: SnapshotSelectionProvenance;
}): BoundedFieldCandidate[];
