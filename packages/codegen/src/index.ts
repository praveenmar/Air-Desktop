/**
 * packages/codegen/src/index.ts
 * Public API of the @air/codegen package.
 */

// ── Core pipeline ────────────────────────────────────────────────────────────
export { CodegenService } from './codegen.service';
export { resolveSelectorsForSession } from './selector-resolver';
export {
  selectSnapshotForAction,
  selectSnapshotForOutcome,
  selectSnapshotForStep,
} from './snapshot-selector';
export type {
  ResolverConfig,
  SnapshotCache,
  SelectorResolution,
  SelectorResolverResult,
} from './selector-resolver';

// ── FlowReview layer ─────────────────────────────────────────────────────────
export { FlowReviewService }   from './flow-review.service';
export { FlowReviewFormatter, FlowReviewMarkdownFormatter } from './flow-review.formatter';

// ── Types ────────────────────────────────────────────────────────────────────
export type {
  // Codegen types
  CodegenSession,
  CodegenStep,
  CodegenAssertion,
  CodegenServiceOptions,
  UserDefinedAssertion,
  ActionType,
  AssertionType,
  AssertionSource,
  OutcomeType,
  SelectorPriority,
  FingerprintData,
  NestedContextData,
  ResolverMetadata,
  ResolverResolvedBy,
  ResolverSnapshotSource,
  TemporalClass,
  SnapshotSelectionProvenance,
  SnapshotCandidateTraceEntry,
  SelectorEngine,
  SelectorCategory,
  SelectorEvaluation,
  SelectorSource,
  SelectorProofSource,
  SelectorProofLevel,
  SelectorSpec,
} from './types';

export type {
  // FlowReview types
  FlowReview,
  FlowReviewPage,
  FlowReviewStep,
  FlowReviewWarning,
  FlowReviewStats,
  SelectorQuality,
  WarningSeverity,
  WarningType,
} from './flow-review.types';

// ── Stubs ────────────────────────────────────────────────────────────────────
export {
  getUserDefinedAssertions,
  hasUserAssertionSupport,
} from './assertion.stub';
