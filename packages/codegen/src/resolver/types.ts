import type {
  BoundedFieldSelectorSpec,
  CodegenAssertion,
  CodegenSession,
  CodegenStep,
  FlatSelectorEngine,
  LabelContextSelectorSpec,
  TriggerContextSelectorSpec,
  LlmResponseFormat,
  ResolverMetadata,
  ResolverSnapshotSource,
  SelectorCategory,
  SelectorEngine,
  SelectorEvaluation,
  SelectorSpec,
  SelectorPriority,
} from '../types';
import type { SnapshotSelectionResult } from '../snapshot-selector';

export interface ResolverConfig {
  enableLLMFallback?: boolean;
  enableCapturedCandidateShadowEvaluation?: boolean;
  enableCapturedCandidateDirectPromotion?: boolean;
  resolverMinScore?: number;
  intentMinScore?: number;
  maxSnapshotBytesForValidation?: number;
  maxSnapshotExcerptChars?: number;
  llmTimeoutMs?: number;
  llmRetryTimeoutMs?: number;
  maxLLMFallbackPerSession?: number;
  llmMaxCandidatesPerStep?: number;
  /** @deprecated Use llmMaxCandidatesPerStep. */
  llmMaxRetriesPerStep?: number;
}

export interface ResolvedResolverConfig {
  enableLLMFallback: boolean;
  enableCapturedCandidateShadowEvaluation: boolean;
  enableCapturedCandidateDirectPromotion: boolean;
  resolverMinScore: number;
  intentMinScore: number;
  maxSnapshotBytesForValidation: number;
  maxSnapshotExcerptChars: number;
  llmTimeoutMs: number;
  llmRetryTimeoutMs: number;
  maxLLMFallbackPerSession?: number;
  llmMaxCandidatesPerStep: number;
  /** @deprecated Use llmMaxCandidatesPerStep. */
  llmMaxRetriesPerStep: number;
}

export interface SnapshotCache {
  get(nodeId: string, normalizedUrl?: string, controlSignature?: string): Document | null;
  getSource?: (
    nodeId: string,
    normalizedUrl?: string,
    controlSignature?: string
  ) => ResolverSnapshotSource;
  selectForStep?: (
    step: CodegenStep,
    mode?: 'action' | 'outcome'
  ) => SnapshotSelectionResult;
  snapshotEngineAvailable?: boolean;
}

export interface CandidateValidation {
  totalMatchCount: number;
  visibleMatchCount: number;
  effectiveMatchCount: number;
  reason: 'unique-visible' | 'resolved-multi-match' | 'no-visible-match' | 'non-unique' | 'invalid-selector' | 'too-broad';
  matchCount?: number;
  confidenceScore?: number;
  ambiguityReason?: string;
  resolvedElement?: Element | null;
  warningCodes?: string[];
}

export interface RawCandidate {
  selector: string;
  source:
    | 'original'
    | 'id'
    | 'name'
    | 'testid'
    | 'data-cy'
    | 'data-qa'
    | 'aria'
    | 'placeholder'
    | 'href'
    | 'role+name'
    | 'class'
    | 'text'
    | 'parent-scope'
    | 'other'
    | 'path'
    | 'chained'
    | 'bounded-field'
    | 'label-context'
    | 'trigger-context';
  engine?: FlatSelectorEngine | 'bounded-field';
  categoryOverride?: SelectorCategory;
  boundedField?: BoundedFieldSelectorSpec;
  labelContext?: LabelContextSelectorSpec;
  triggerContext?: TriggerContextSelectorSpec;
  rank: number;
}

export interface CandidateScore {
  candidate: RawCandidate;
  validation: CandidateValidation;
  score: number;
  selectorEvaluation?: SelectorEvaluation;
  idEntropyScore?: number;
  idPenaltyReason?: string[];
  classEntropyScore?: number;
  classPenaltyReason?: string[];
}

export interface RankedElementScore {
  element: Element;
  index: number;
  score: number;
}

export interface StepResolutionDraft {
  step: CodegenStep;
  snapshot: Document | null;
  selectorSpec?: SelectorSpec;
  resolvedSelectorSpec?: SelectorSpec;
  resolvedSelector: string;
  metadata: ResolverMetadata;
  llmEligible: boolean;
  lowScoreFallback?: CandidateScore;
}

export interface ResolveContext {
  snapshotEngineAvailable: boolean;
}

export interface LlmFallbackStep {
  stepNumber: number;
  intent: string;
  action: CodegenStep['action'];
  originalSelector: string;
  snapshotExcerpt: string;
  normalizedUrl?: string;
  snapshotSource?: ResolverSnapshotSource;
  excerptChars?: number;
  excerptMode?: 'target-selector' | 'seed-element' | 'document-fallback';
  selectorPriority?: SelectorPriority;
}

export interface LlmRetryFingerprintSummary {
  tagName?: string;
  textExcerpt?: string;
  href?: string;
  role?: string;
  ariaLabel?: string;
  name?: string;
  placeholder?: string;
  type?: string;
  dataTestId?: string;
  dataCy?: string;
  dataQa?: string;
  parentSelector?: string;
  controlFamily?: ControlFamily;
}

export interface LlmRetryFailedCandidate {
  selector: string;
  rejectReason: string;
}

export interface LlmCorrectiveRetryStep {
  stepNumber: number;
  action: CodegenStep['action'];
  intent: string;
  originalSelector: string;
  fingerprint?: LlmRetryFingerprintSummary;
  snapshotExcerpt: string;
  failedCandidates: LlmRetryFailedCandidate[];
}

export interface LlmFallbackCandidatePayload {
  selector?: string;
  reason?: string;
}

export interface LlmFallbackSuggestion {
  stepNumber: number;
  selector?: string;
  selectors?: string[];
  candidates?: Array<string | LlmFallbackCandidatePayload>;
  responseFormat?: LlmResponseFormat;
}

export interface NormalizedLlmSuggestion {
  stepNumber: number;
  candidates: string[];
  responseFormat: LlmResponseFormat;
  truncated?: boolean;
}

export interface NormalizedLlmRetrySuggestion {
  stepNumber: number;
  selector: string;
}

export interface LlmFallbackRequest {
  mode: 'initial';
  steps: LlmFallbackStep[];
  config: ResolvedResolverConfig;
}

export interface LlmCorrectiveRetryRequest {
  mode: 'retry';
  steps: LlmCorrectiveRetryStep[];
  config: ResolvedResolverConfig;
}

export type SelectorFallbackRequest = LlmFallbackRequest | LlmCorrectiveRetryRequest;

export type SelectorFallbackProvider = (
  request: SelectorFallbackRequest
) => Promise<LlmFallbackSuggestion[] | NormalizedLlmRetrySuggestion[] | unknown[]>;

export interface SelectorResolution {
  stepNumber: number;
  sourceNodeId: string | null;
  originalSelector: string;
  selectorSpec?: SelectorSpec;
  resolvedSelector: string;
  resolvedSelectorSpec?: SelectorSpec;
  resolverMetadata: ResolverMetadata;
}

export interface SelectorResolverResult {
  resolutions: SelectorResolution[];
  unresolvedStepNumbers: number[];
  llmAttemptedStepNumbers: number[];
  llmAcceptedStepNumbers: number[];
}

export type ResolverRejectReason =
  | 'href_mismatch'
  | 'control_family_mismatch'
  | 'text_mismatch'
  | 'snapshot_target_missing';

export type ControlFamily =
  | 'text-input'
  | 'password-input'
  | 'submit-button'
  | 'nav-link'
  | 'menuitem'
  | 'select-trigger'
  | 'combobox'
  | 'icon-button'
  | 'button'
  | 'generic-container';

export interface StepSignalAttributes {
  id?: string;
  name?: string;
  dataTestId?: string;
  dataCy?: string;
  dataQa?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  placeholder?: string;
  autocomplete?: string;
  role?: string;
  href?: string;
  type?: string;
  title?: string;
  alt?: string;
  value?: string;
  associatedLabelText?: string;
  wrappedLabelText?: string;
  labelledByText?: string;
  describedByText?: string;
  fieldLabelText?: string;
  class?: string;
  tagName?: string;
  parentSelector?: string | null;
}

export const BROAD_SELECTOR_MATCH_LIMIT = 50;
export const BROAD_SELECTOR_SCORE_LIMIT = 15;
export const NON_RENDERED_TAGS = new Set(['script', 'style', 'template', 'meta', 'link', 'noscript']);
export const DOM_ORDER_TIEBREAKER_REASON = 'resolved_by_dom_order_tiebreaker';

export function assertionNeedsDomContext(assertion: CodegenAssertion): boolean {
  if (assertion.selector && assertion.selector.trim().length > 0) {
    return true;
  }
  return assertion.type === 'element_visible' || assertion.type === 'element_text';
}

export function attachAssertionOutcomeSelections(
  session: CodegenSession,
  snapshotCache: SnapshotCache,
): void {
  for (const step of session.steps) {
    if (!Array.isArray(step.assertions) || step.assertions.length === 0) {
      continue;
    }

    const eligibleAssertions = step.assertions.filter(assertionNeedsDomContext);
    if (eligibleAssertions.length === 0) {
      continue;
    }

    let selection: SnapshotSelectionResult | null = null;
    try {
      if (snapshotCache.selectForStep) {
        selection = snapshotCache.selectForStep(step, 'outcome');
      }
    } catch (_err) {
      selection = null;
    }

    if (!selection) {
      const nodeId = step.destinationNodeId ?? step.sourceNodeId ?? '';
      const snapshot = snapshotCache.get(nodeId, step.normalizedUrl, step.controlSignature);
      const snapshotSource = snapshotCache.getSource
        ? snapshotCache.getSource(nodeId, step.normalizedUrl, step.controlSignature)
        : (snapshot ? 'latest' : 'unavailable');
      selection = {
        snapshot,
        provenance: {
          source: snapshotSource,
          temporalClass: 'unknown',
          reason: snapshot ? 'legacy_snapshot_cache_selection' : 'legacy_snapshot_cache_unavailable',
          eventId: step.eventId,
          sourceNodeId: step.destinationNodeId ?? step.sourceNodeId,
          confidenceScore: snapshot ? 0.5 : 0,
        },
        evaluatedCandidates: [
          {
            source: snapshotSource,
            temporalClass: 'unknown',
            selected: !!snapshot,
            reason: snapshot ? 'legacy_snapshot_cache_selection' : undefined,
            skipReason: snapshot ? undefined : 'snapshot-unavailable',
            eventId: step.eventId,
            sourceNodeId: step.destinationNodeId ?? step.sourceNodeId,
            confidenceScore: snapshot ? 0.5 : 0,
          },
        ],
      };
    }

    step.assertions = step.assertions.map(assertion => {
      if (!assertionNeedsDomContext(assertion)) {
        return assertion;
      }
      return {
        ...assertion,
        assertionSnapshotSelection: selection.provenance,
        assertionCandidateTrace: selection.evaluatedCandidates,
        assertionTemporalClass: selection.provenance.temporalClass,
      };
    });
  }
}
