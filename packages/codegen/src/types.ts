/**
 * packages/codegen/src/types.ts
 *
 * Core type contracts for the AIR code generation package.
 *
 * These types define the "Semantic Timeline" — the compressed, intent-driven
 * representation of a recorded session that gets fed to the AI code generator
 * and stored as the .semantic.json blueprint alongside every generated test.
 *
 * Design principles:
 *   - No raw HTML, no DOM snapshots — AI context window is precious
 *   - Every step preserves WHY (intent) not just WHAT (selector)
 *   - Confidence + sampleSize tell the AI which steps are reliable
 *   - Assertions are split: AI-derived (from anchors) vs user-defined (stub)
 *   - The @air-step breadcrumb links generated code back to this blueprint
 *     enabling the future self-healing loop without schema changes
 */

// ─────────────────────────────────────────────────────────────────────────────
// STEP — one user interaction in the recorded flow
// ─────────────────────────────────────────────────────────────────────────────

export type ActionType =
  | 'click'
  | 'input'
  | 'submit'
  | 'custom-control-open'
  | 'custom-select'
  | 'custom-menu-select'
  | 'hover'
  | 'scroll'
  | 'navigate';

export type OutcomeType =
  | 'navigation'
  | 'no_change'
  | 'state_refresh'
  | 'immediate_action';

export type SelectorPriority =
  | 'data-testid'
  | 'id'
  | 'attribute'
  | 'class'
  | 'path'
  | 'text'
  | 'xpath'
  | 'other'
  | 'chained'
  | 'unknown';

export type SelectorEngine =
  | 'css'
  | 'xpath'
  | 'text'
  | 'testid'
  | 'role'
  | 'label'
  | 'scoped'
  | 'label-context'
  | 'trigger-context'
  | 'bounded-field'
  | 'placeholder'
  | 'playwright';

export type SelectorSource =
  | 'interceptor'
  | 'resolver'
  | 'llm'
  | 'manual'
  | 'codegen'
  | 'smoke-repair';

export type SelectorProofLevel =
  | 'recorded'
  | 'snapshot_validated'
  | 'semantic_validated'
  | 'live_smoke_validated'
  | 'proven_equivalent'
  | 'inferred_unproven'
  | 'weak_but_usable'
  | 'blocked'
  | 'unvalidated';

export type LabelContextRenderStatus =
  | 'clean-direct-selector'
  | 'clean-scoped-locator'
  | 'proven-structural-fallback'
  | 'proof-only-no-clean-render'
  | 'blocked-unsafe-render';

export interface LabelContextSelectorSpec {
  source: 'snapshot-label-context';
  labelText: string;
  targetTag: 'input' | 'textarea' | 'select';
  association: 'label-for' | 'wrapped-label' | 'aria-labelledby' | 'bounded-field';
  targetId?: string;
  ariaLabelledBy?: string;
  containerSelector?: string;
  boundedContainerSummary?: string;
  snapshotSource?: ResolverSnapshotSource | null;
  labelStructureEvidenceReason?: string | null;
  recoveredFromSelector?: string;
  renderStatus?: LabelContextRenderStatus;
  renderReason?: string | null;
  cleanParentSelector?: string;
  cleanChildSelector?: string;
  structuralFallbackLocator?: string;
  warningCodes?: string[];
}

export interface TriggerContextSelectorSpec {
  source: 'snapshot-trigger-context';
  labelText: string;
  controlFamily?: string;
  association: 'bounded-field';
  triggerSelector: string;
  containerSelector?: string;
  labelElementTag?: string;
  boundedContainerSummary?: string;
  snapshotSource?: ResolverSnapshotSource | null;
  recoveredFromSelector?: string;
  renderStatus?: LabelContextRenderStatus;
  renderReason?: string | null;
  cleanParentSelector?: string;
  cleanChildSelector?: string;
  structuralFallbackLocator?: string;
  warningCodes?: string[];
}

export type BoundedFieldControlKind =
  | 'input'
  | 'textarea'
  | 'select'
  | 'custom-trigger'
  | 'combobox'
  | 'searchbox'
  | 'contenteditable'
  | 'unknown';

export type BoundedFieldRelation =
  | 'label-for'
  | 'wrapped-label'
  | 'aria-labelledby'
  | 'sibling-label'
  | 'bounded-container';

export interface BoundedFieldSelectorSpec {
  source: 'snapshot-bounded-field' | 'recorded-bounded-field' | 'live-dom-repair';
  labelText: string;
  target: SelectorSpec;
  controlKind: BoundedFieldControlKind;
  relation: BoundedFieldRelation;
  originalSelector?: string;
  containerSelector?: string;
  labelElementTag?: string;
  boundedContainerSummary?: string;
  snapshotSource?: ResolverSnapshotSource | null;
  renderStatus?: LabelContextRenderStatus;
  renderReason?: string | null;
  cleanParentSelector?: string;
  cleanChildSelector?: string;
  structuralFallbackLocator?: string;
  warningCodes?: string[];
  rejectReason?: string | null;
  visibleControlCountInContainer?: number | null;
  targetIndexWithinContainer?: number | null;
  competingControlCount?: number | null;
  duplicateLabelCount?: number | null;
  recordedValidity?: boolean;
  recordedBlockedReason?: string | null;
}

export type FlatSelectorEngine =
  | 'css'
  | 'xpath'
  | 'text'
  | 'testid'
  | 'role'
  | 'label'
  | 'placeholder'
  | 'playwright'
  | 'label-context'
  | 'trigger-context';

export type ScopedSelectorRelation =
  | 'parent-child'
  | 'bounded-field'
  | 'component-boundary';

interface SelectorSpecBase {
  selector: string;
  source: SelectorSource;
  proofLevel: SelectorProofLevel;
  rank?: number;
  confidence?: number;
  rejectReason?: string;
  warningCodes?: string[];
}

export interface FlatSelectorSpec extends SelectorSpecBase {
  engine: FlatSelectorEngine;
  labelContext?: LabelContextSelectorSpec;
  triggerContext?: TriggerContextSelectorSpec;
}

export interface ScopedSelectorSpec extends SelectorSpecBase {
  engine: 'scoped';
  scope: SelectorSpec;
  target: SelectorSpec;
  relation?: ScopedSelectorRelation;
}

export interface BoundedFieldStructuredSelectorSpec extends SelectorSpecBase {
  engine: 'bounded-field';
  boundedField: BoundedFieldSelectorSpec;
}

export type PlaywrightLocatorKind =
  | 'locator'
  | 'getByRole'
  | 'getByLabel'
  | 'getByPlaceholder'
  | 'getByText'
  | 'getByTestId';

export interface RegexLiteralSpec {
  source: string;
  flags?: string;
}

export interface PlaywrightLocatorOptions {
  name?: string | RegexLiteralSpec;
  exact?: boolean;
  hasText?: string | RegexLiteralSpec;
}

export interface PlaywrightLocatorNode {
  kind: PlaywrightLocatorKind;

  /**
   * For:
   * - locator: CSS/XPath/text selector string
   * - getByRole: role name
   * - getByLabel: label text
   * - getByPlaceholder: placeholder text
   * - getByText: visible text
   * - getByTestId: test id value
   */
  value: string;

  options?: PlaywrightLocatorOptions;

  /**
   * Optional metadata for audit only.
   * Do not use for compiler behavior unless explicitly needed.
   */
  proofSource?: string;
  warningCodes?: string[];
}

export interface PlaywrightLocatorSpec extends SelectorSpecBase {
  engine: 'playwright-locator';
  chain: PlaywrightLocatorNode[];
  debugSelector?: string;
  warnings?: string[];
}

export interface PlaywrightNativeCandidate {
  spec: PlaywrightLocatorSpec;
  reason: string;
  sourceEvidence: 'accessibilityEvidence' | 'attributes' | 'context';
  proofLevel: 'unvalidated';
  warningCodes: string[];
}

export interface EvaluatedPlaywrightNativeCandidate {
  candidate: PlaywrightNativeCandidate;
  status: 'valid' | 'blocked' | 'approximate';
  matchCount: number;
  visibleMatchCount: number;
  isUnique: boolean;
  isAmbiguous: boolean;
  isGloballyAmbiguous: boolean;
  rejectReason?: string;
  warningCodes: string[];
  validationSource: 'snapshot-approximation';
}

export interface PlaywrightNativeCandidateReportEntry {
  locator: string;
  engine: 'playwright-locator';
  status: 'valid' | 'blocked' | 'approximate';
  proofLevel: 'unvalidated';
  validationSource: 'snapshot-approximation';
  reason: string;
  sourceEvidence: 'accessibilityEvidence' | 'attributes' | 'context';
  matchCount: number;
  visibleMatchCount: number;
  isUnique: boolean;
  isAmbiguous: boolean;
  isGloballyAmbiguous: boolean;
  warningCodes: string[];
  rejectReason?: string;
}

export type SelectorSpec = 
  | FlatSelectorSpec 
  | ScopedSelectorSpec 
  | BoundedFieldStructuredSelectorSpec;

export type SelectorCategory =
  | 'testid'
  | 'data-cy'
  | 'data-qa'
  | 'id'
  | 'name'
  | 'href'
  | 'placeholder'
  | 'aria-label'
  | 'role-attr'
  | 'text'
  | 'bounded-field'
  | 'label-context'
  | 'class'
  | 'semantic-css'
  | 'parent-scoped'
  | 'structural'
  | 'xpath'
  | 'llm'
  | 'unknown';

export type SelectorProofSource =
  | 'snapshot'
  | 'fingerprint'
  | 'semantic'
  | 'llm-validator'
  | 'recorded'
  | 'smoke'
  | 'none';

export type EquivalentRenderingEngine =
  | 'testid'
  | 'placeholder'
  | 'text'
  | 'role'
  | 'label'
  | 'playwright';

export type EquivalentRenderingProofLevel =
  | 'proven_equivalent'
  | 'live_smoke_validated'
  | 'recorded';

export type EquivalentRenderingProofSource =
  | 'attribute-equivalence'
  | 'text-equivalence'
  | 'accessibility-recorded'
  | 'smoke'
  | 'manual';

export interface EquivalentRendering {
  engine: EquivalentRenderingEngine;
  locator: string;
  proofLevel: EquivalentRenderingProofLevel;
  proofSource: EquivalentRenderingProofSource;
  sourceSelector: string;
  sourceEngine: SelectorEngine;
  warningCodes?: string[];
}

export interface SelectorEvaluation {
  selectorSpec: SelectorSpec;
  category: SelectorCategory;
  validation: {
    valid: boolean;
    matchCount?: number;
    visibleMatchCount?: number;
    uniqueVisible?: boolean;
    invalidReason?: string;
  };
  proof: {
    proofLevel: SelectorProofLevel;
    proofSource: SelectorProofSource;
    snapshotTargetEvidence?: boolean;
  };
  scoring: {
    proofScore: number;
    stabilityScore: number;
    semanticScore: number;
    brittlenessPenalty: number;
    entropyPenalty: number;
    finalScore: number;
  };
  reasons: string[];
  warningCodes: string[];
  rejectReason?: string;
  preferredRenderings?: EquivalentRendering[];
}

export type ResolverResolvedBy =
  | 'kept-original'
  | 'deterministic-override'
  | 'blocked-semantic-mismatch'
  | 'blocked-snapshot-target-missing'
  | 'blocked-unsafe-override'
  | 'llm-accepted'
  | 'unresolved';

export interface RejectedCandidateTrace {
  selector: string;
  reason: string;
}

export type LlmResponseFormat =
  | 'legacy-selector'
  | 'legacy-selectors'
  | 'candidates-v2';

export interface LlmRejectedCandidateTrace {
  selector: string;
  rejectReason: string;
}

export type TemporalClass =
  | 'pre_action'
  | 'action_local'
  | 'post_action'
  | 'outcome_state'
  | 'unknown';

export type ResolverSnapshotSource =
  | 'event-local-pageState'
  | 'event-local-pageSnapshot'
  | 'source-node-snapshot'
  | 'interaction-context-exact'
  | 'interaction-context-stable-by-url'
  | 'interaction-context-any-by-url'
  | 'outcome-event-snapshot'
  | 'destination-node-snapshot'
  | 'url-event-fallback'
  | 'latest'
  | 'latest-stable'
  | 'unavailable';

export interface NestedContextData {
  isShadowDom?: boolean;
  shadowHostTag?: string | null;
  isIframe?: boolean;
  iframeSrc?: string | null;
  iframeName?: string | null;
  iframeSameOrigin?: boolean | null;
  degraded?: boolean;
  degradedReason?: string | null;
}

export interface SnapshotSelectionProvenance {
  source: ResolverSnapshotSource;
  temporalClass: TemporalClass;
  reason: string;
  eventId?: string;
  sourceNodeId?: string;
  timestamp?: number;
  confidenceScore?: number;
  snapshotTargetEvidence?: boolean;
  snapshotTargetEvidenceReason?: string | null;
  labelStructureEvidence?: boolean;
  labelStructureEvidenceReason?: string | null;
  labelContextSnapshotSource?: ResolverSnapshotSource | null;
  labelContextBlockedReason?: string | null;
}

export interface SnapshotCandidateTraceEntry {
  source: ResolverSnapshotSource;
  temporalClass: TemporalClass;
  selected: boolean;
  reason?: string;
  skipReason?: string;
  eventId?: string;
  sourceNodeId?: string;
  timestamp?: number;
  confidenceScore?: number;
  targetPresent?: boolean;
  snapshotTargetEvidenceReason?: string | null;
  shadowDegraded?: boolean;
  labelStructureEvidence?: boolean;
  labelStructureEvidenceReason?: string | null;
}

export interface ResolverMetadata {
  resolvedSelector: string;
  resolvedBy: ResolverResolvedBy;
  bestScore: number;
  effectiveMatchCount: number;
  matchCount?: number;
  confidenceScore?: number;
  ambiguityReason?: string | null;
  snapshotSource: ResolverSnapshotSource;
  validationMethod: string;
  llmAttempted: boolean;
  llmAccepted: boolean;
  llmAlternative: string | null;
  llmCandidatesReturned?: string[];
  llmCandidatesTried?: string[];
  llmAcceptedRank?: number | null;
  llmRejectedCandidates?: LlmRejectedCandidateTrace[];
  llmResponseFormat?: LlmResponseFormat;
  llmRetryTriggered?: boolean;
  llmRetrySelector?: string | null;
  llmRetryRejectReason?: string | null;
  llmRetryAccepted?: boolean;
  llmRetryTimeoutMs?: number;
  llmRetryStatus?:
    | 'not-eligible'
    | 'triggered'
    | 'accepted'
    | 'rejected'
    | 'skipped-provider-error'
    | 'skipped-timeout'
    | 'skipped-empty-response';
  rejectReason: string | null;
  semanticRejectReason?: string | null;
  rejectedCandidates?: RejectedCandidateTrace[];
  semanticCompatibilityScore?: number;
  semanticCompatibilityReasons?: string[];
  idEntropyScore?: number;
  idPenaltyReason?: string[];
  classEntropyScore?: number;
  classPenaltyReason?: string[];
  selectorEvaluation?: SelectorEvaluation;
  preferredRenderings?: EquivalentRendering[];
  triggerResolvedSelector?: string;
  triggerResolvedSelectorSpec?: SelectorSpec;
  triggerContextLabel?: string | null;
  triggerContextRenderStatus?: LabelContextRenderStatus;
  triggerContextRenderReason?: string | null;
  triggerBoundedContainerSummary?: string | null;
  triggerStructuralFallbackLocator?: string | null;
  triggerWarningCodes?: string[];
  warningCodes: string[];
  resolverVersion: 1;
  temporalClass?: TemporalClass;
  selectionReason?: string | null;
  snapshotSelection?: SnapshotSelectionProvenance;
  evaluatedCandidates?: SnapshotCandidateTraceEntry[];
  snapshotTargetEvidence?: boolean;
  snapshotTargetEvidenceReason?: string | null;
  excerptBuildTotalMs?: number;
  pruneMs?: number;
  redactMs?: number;
  finalExcerptChars?: number;
}

export interface FingerprintAttributes {
  [key: string]: string | undefined;
  id?: string;
  name?: string;
  role?: string;
  ariaLabel?: string;
  'aria-label'?: string;
  placeholder?: string;
  type?: string;
  href?: string;
  title?: string;
  alt?: string;
  value?: string;
  dataTestId?: string;
  'data-testid'?: string;
  dataCy?: string;
  'data-cy'?: string;
  dataQa?: string;
  'data-qa'?: string;
  class?: string;
  classList?: string;
}

export interface FingerprintSelectorAmbiguity {
  originalSelector: string;
  originalPriority?: string;
  matchCount: number;
  visibleMatchCount: number;
  positionInMatches?: number | null;
  isUnique: boolean;
  isAmbiguous: boolean;
}

export type CapturedSelectorCandidateEngine = 'css' | 'text' | 'xpath';

export type CapturedSelectorCandidateFamily =
  | 'primary'
  | 'test-id'
  | 'id'
  | 'name'
  | 'placeholder'
  | 'aria-label'
  | 'href'
  | 'role-attr'
  | 'text'
  | 'class'
  | 'parent-scoped-css'
  | 'tight-container-css';

export type CapturedSelectorCandidateStrength = 'strong' | 'medium' | 'weak';

export interface CapturedSelectorCandidate {
  selector: string;
  engine: CapturedSelectorCandidateEngine;
  family: CapturedSelectorCandidateFamily;
  strength: CapturedSelectorCandidateStrength;
  source: 'capture';
  isPrimary?: boolean;
  matchCount?: number | null;
  visibleMatchCount?: number | null;
  positionInAllMatches?: number | null;
  positionInVisibleMatches?: number | null;
  usesDynamicClass?: boolean;
  usesIndex?: boolean;
  warningCodes?: string[];
}

export interface FingerprintBoundedContainerSelectorCandidate {
  selector: string;
  kind: string;
  isClean?: boolean;
}

export interface FingerprintBoundedFieldContext {
  fieldLabelText?: string | null;
  fieldRelation?: BoundedFieldRelation | null;
  targetControlKind?: BoundedFieldControlKind | null;
  visibleControlCountInContainer?: number | null;
  targetIndexWithinContainer?: number | null;
  boundedContainerSummary?: string | null;
  boundedContainerSelectorCandidates?: FingerprintBoundedContainerSelectorCandidate[];
  cleanParentSelector?: string | null;
  cleanChildSelector?: string | null;
  containerSelector?: string | null;
  competingControlCount?: number | null;
  duplicateLabelCount?: number | null;
  isValid?: boolean;
  blockedReason?: string | null;
  recordedBlockedReason?: string | null;
}

export interface AccessibilityEvidence {
  role?: string | null;
  accessibleName?: string | null;
  accessibleNameSource?:
    | 'aria-label'
    | 'aria-labelledby'
    | 'label-for'
    | 'wrapped-label'
    | 'button-text'
    | 'link-text'
    | 'placeholder'
    | 'title'
    | 'role-text'
    | 'none';
  labelText?: string | null;
  labelledByIds?: string[];
  isNativeLabelAssociation?: boolean;
}

export interface FingerprintData {
  selector?: string;
  selectorPriority?: string;
  selectorRank?: number;
  tagName?: string;
  parentSelector?: string | null;
  textExcerpt?: string | null;
  context?: {
    parentTag?: string | null;
    nearestContainerTag?: string | null;
  };
  attributes?: FingerprintAttributes;
  selectorCandidates?: CapturedSelectorCandidate[];
  selectorAmbiguity?: FingerprintSelectorAmbiguity;
  boundedFieldContext?: FingerprintBoundedFieldContext;
  accessibilityEvidence?: AccessibilityEvidence;
  attributesHash?: string;
}

export interface CodegenStep {
  /** 1-based step index — used as the @air-step breadcrumb in generated code */
  step: number;

  /** Raw AIR event identity for exact event-local snapshot selection. */
  eventId?: string;

  /** Raw AIR trace identity for provenance and outcome correlation. */
  traceId?: string;

  /** Original event timestamp used for state-window selection and provenance. */
  timestamp?: number;

  /** Additive per-step tab identity for state-bounded selection when available. */
  tabId?: string | null;

  /**
   * Semantic intent — the "why" behind this action.
   * e.g. "click_submit", "type_username", "select_country"
   * This is the key that drives self-healing: if a selector breaks,
   * the healer reads this intent to find the new element in the live DOM.
   */
  intent: string;

  /** The action type — drives which Playwright method to emit */
  action: ActionType;

  /** The CSS selector or XPath to target the element */
  selector: string;

  /** Additive first-class selector contract for the originally captured selector. */
  selectorSpec?: SelectorSpec;

  /**
   * Node ID of the DOM snapshot before this step executes.
   * Additive-only field used by D3.5 selector resolution for generation.
   */
  sourceNodeId?: string;

  /**
   * How the selector was derived — drives selector strategy in generated code.
   * data-testid → getByTestId(), aria-label → getByRole(), etc.
   */
  selectorPriority: SelectorPriority;

  /** Optional selector quality rank (1 = most stable, 10 = most fragile). */
  selectorRank?: number;

  /** Original captured fingerprint payload for resolver diagnostics and candidate hints. */
  fingerprint?: FingerprintData;

  /** Additive nested-context metadata for shadow DOM / iframe handling. */
  nestedContext?: NestedContextData;

  /** Optional control signature tied to the captured UI state for IC snapshot lookup. */
  controlSignature?: string;

  /** Additive custom-control family for semantic open/select modeling. */
  controlFamily?: string;

  /** Additive trigger evidence preserved for compressed custom-control select steps. */
  triggerSelector?: string;
  triggerSelectorPriority?: SelectorPriority;
  triggerFingerprint?: FingerprintData;
  triggerResolvedSelector?: string;
  triggerSelectorSpec?: SelectorSpec;

  /** Additive option evidence preserved for compressed custom-control select steps. */
  optionSelector?: string;
  optionText?: string;
  optionValue?: string;
  optionResolvedSelector?: string;
  optionSelectorSpec?: SelectorSpec;

  /** Additive provenance for compressed custom-control open+select pairs. */
  absorbedOpenEventId?: string;
  absorbedOpenTraceId?: string;
  compressedFromEvents?: string[];

  /**
   * Input value for 'input' and 'custom-select' actions.
   * Sensitive fields return '<LLM_GENERATE_MOCK_DATA>' so the AI generates
   * appropriate test data instead of blindly emitting [REDACTED].
   * Non-sensitive fields carry the masked value (stars = length hint).
   */
  value?: string;

  /** How the page responded to this action */
  outcomeType?: OutcomeType;

  /**
   * Destination URL — only present when outcomeType = 'navigation'.
   * Used by the code generator to emit waitForURL() assertions.
   */
  navigatesTo?: string;

  /** Destination node used for outcome-state snapshot fallback when available. */
  destinationNodeId?: string;

  /**
   * Assertions to verify AFTER this specific step completes.
   * Only populated when outcomeType = 'navigation' — verifies the user
   * landed on the correct page with the expected elements visible.
   * This ensures multi-step flows (Login → Dashboard → Settings) get
   * mid-flow assertions, not just a single assertion at the end.
   */
  assertions: CodegenAssertion[];

  /**
   * User-defined assertions for this step — stub for Phase 2.
   * Always empty until the interceptor gains assertion-capture capability.
   */
  userAssertions: UserDefinedAssertion[];

  /**
   * Probability from Laplace smoothing (0.0 - 1.0).
   * 1.0 = this transition always happens. < 0.8 = flaky, warn the AI.
   */
  confidence: number;

  /**
   * Number of times this exact action was observed across all recordings.
   * Higher = more reliable selector. Used to rank alternative selectors.
   */
  sampleSize: number;

  /**
   * Page URL where this action was performed.
   * Enables the code generator to emit page.goto() when URL changes mid-flow.
   */
  pageUrl: string;

  /**
   * Normalized URL (origin + pathname) used for grouping/comparison.
   * Additive field; raw pageUrl remains unchanged for debugging/display.
   */
  normalizedUrl?: string;

  /**
   * Additive selector used only for generated output. Does not mutate
   * recorded graph/session truth.
   */
  resolvedSelector?: string;

  /** Additive resolved selector contract used only for generation output. */
  resolvedSelectorSpec?: SelectorSpec;

  /**
   * Additive D3.5 resolver diagnostics for sidecar and observability.
   */
  resolverMetadata?: ResolverMetadata;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSERTION — what to verify after the flow completes
// ─────────────────────────────────────────────────────────────────────────────

export type AssertionType =
  | 'url'               // expect(page).toHaveURL(...)
  | 'element_visible'   // expect(locator).toBeVisible()
  | 'element_text'      // expect(locator).toHaveText(...)
  | 'title'             // expect(page).toHaveTitle(...)
  | 'custom';           // user-defined — stub for future interceptor support

export type AssertionSource =
  | 'anchor'            // derived from destination node's anchor fingerprints
  | 'url_change'        // derived from navigation outcomeType
  | 'user_defined';     // stub — future: user marks assertions in interceptor

export interface CodegenAssertion {
  type: AssertionType;

  /** The value to assert — URL string, text content, selector, etc. */
  value: string;

  /**
   * Optional selector for element-based assertions.
   * Derived from anchor strings like "BUTTON:text=Log out" → button selector.
   */
  selector?: string;

  /** Where this assertion came from */
  source: AssertionSource;

  /**
   * Confidence that this assertion is meaningful.
   * anchor-derived assertions from high-sample nodes score higher.
   */
  confidence: number;

  /**
   * Additive 2.2A observability for destination-state assertion routing.
   * Populated only for DOM-backed assertions resolved against outcome-mode
   * snapshot selection. URL/title assertions do not use this path.
   */
  assertionSnapshotSelection?: SnapshotSelectionProvenance;
  assertionCandidateTrace?: SnapshotCandidateTraceEntry[];
  assertionTemporalClass?: TemporalClass;
}

// ─────────────────────────────────────────────────────────────────────────────
// USER ASSERTION STUB — future interceptor-level assertion capture
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stub for future Phase 2 feature: user explicitly marks elements in the
 * browser as "assert this" during recording. The interceptor will capture
 * these and store them in a dedicated DB table.
 *
 * Today this is always empty. The codegen service includes it in the
 * CodegenSession so the MCP tool and templates can reference it without
 * schema changes when the feature ships.
 */
export interface UserDefinedAssertion {
  /** What the user wanted to verify */
  assertionIntent: string;
  /** The element they right-clicked / marked */
  selector: string;
  /** Expected value (text, attribute, etc.) */
  expectedValue?: string;
  /** Type of check the user indicated */
  checkType: 'visible' | 'text' | 'value' | 'count' | 'custom';
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION — the complete semantic timeline for one recording
// ─────────────────────────────────────────────────────────────────────────────

export interface CodegenSession {
  /** AIR session ID — ties back to the DB for healing queries */
  sessionId: string;

  /** Starting URL of the recorded flow */
  url: string;

  /** Page title at recording start */
  title: string;

  /** ISO timestamp of when recording happened */
  recordedAt: string;

  /** Total number of meaningful steps (excludes scroll, hover, network) */
  stepCount: number;

  /**
   * The ordered sequence of user interactions.
   * This is what the AI uses to write the test body.
   * Filtered to only actionable steps — no scroll noise, no heartbeats.
   */
  steps: CodegenStep[];

  /**
   * Overall flow confidence — average probability across all navigation edges.
   * < 0.7: warn AI that this flow has inconsistent outcomes across recordings.
   * >= 0.9: high confidence, reliable test candidate.
   */
  flowConfidence: number;

  /** Unique nodes visited during the flow (page count) */
  nodeCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface CodegenServiceOptions {
  /**
   * Path to the SQLite database file.
   * Defaults to the Electron app's userData path when not specified.
   */
  dbPath: string;

  /**
   * Only include steps with confidence >= this threshold.
   * Default: 0.0 (include all steps, let AI decide what to trust)
   */
  minConfidence?: number;

  /**
   * Include scroll events in the semantic timeline.
   * Default: false — scrolls are noise for most test generation scenarios.
   * Set true if generating seek/scroll verification tests.
   */
  includeScrollSteps?: boolean;

  /**
   * Include hover events in the semantic timeline.
   * Default: false — hovers are rarely needed in Playwright tests.
   */
  includeHoverSteps?: boolean;
}
