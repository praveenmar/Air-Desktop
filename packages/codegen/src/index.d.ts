/**
 * packages/codegen/src/index.ts
 * Public API of the @air/codegen package.
 */
export { CodegenService } from './codegen.service';
export { resolveSelectorsForSession } from './selector-resolver';
export { selectSnapshotForAction, selectSnapshotForOutcome, selectSnapshotForStep, } from './snapshot-selector';
export type { ResolverConfig, SnapshotCache, SelectorResolution, SelectorResolverResult, } from './selector-resolver';
export { FlowReviewService } from './flow-review.service';
export { FlowReviewFormatter } from './flow-review.formatter';
export type { CodegenSession, CodegenStep, CodegenAssertion, CodegenServiceOptions, UserDefinedAssertion, ActionType, AssertionType, AssertionSource, OutcomeType, SelectorPriority, FingerprintData, NestedContextData, ResolverMetadata, ResolverResolvedBy, ResolverSnapshotSource, TemporalClass, SnapshotSelectionProvenance, SnapshotCandidateTraceEntry, SelectorEngine, SelectorCategory, SelectorEvaluation, SelectorSource, SelectorProofSource, SelectorProofLevel, SelectorSpec, } from './types';
export type { FlowReview, FlowReviewPage, FlowReviewStep, FlowReviewWarning, FlowReviewStats, SelectorQuality, WarningSeverity, WarningType, } from './flow-review.types';
export { getUserDefinedAssertions, hasUserAssertionSupport, } from './assertion.stub';
