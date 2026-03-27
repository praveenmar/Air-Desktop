/**
 * packages/codegen/src/index.ts
 * Public API of the @air/codegen package.
 */

// ── Core pipeline ────────────────────────────────────────────────────────────
export { CodegenService } from './codegen.service';

// ── FlowReview layer ─────────────────────────────────────────────────────────
export { FlowReviewService }   from './flow-review.service';
export { FlowReviewFormatter } from './flow-review.formatter';

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