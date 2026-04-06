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
  | 'custom-select'
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

export interface CodegenStep {
  /** 1-based step index — used as the @air-step breadcrumb in generated code */
  step: number;

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

  /**
   * How the selector was derived — drives selector strategy in generated code.
   * data-testid → getByTestId(), aria-label → getByRole(), etc.
   */
  selectorPriority: SelectorPriority;

  /** Optional selector quality rank (1 = most stable, 10 = most fragile). */
  selectorRank?: number;

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
