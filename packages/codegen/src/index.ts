/**
 * packages/codegen/src/index.ts
 * Public API of the @air/codegen package.
 */
export { CodegenService } from './codegen.service';
export type {
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
export {
  getUserDefinedAssertions,
  hasUserAssertionSupport,
} from './assertion.stub';