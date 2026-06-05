/**
 * packages/codegen/src/flow-review.types.ts
 *
 * Data contracts for the FlowReview presentation layer.
 *
 * FlowReview is a fully enriched DTO derived from CodegenSession.
 * It contains no raw graph data (no HTML, no DB references).
 * It is designed to be consumed by:
 *   - The Electron renderer UI (session review screen)
 *   - FlowReviewFormatter (CLI / console output)
 *   - Future: MCP tool response payload
 */
import type { CodegenAssertion, ActionType, OutcomeType, SelectorPriority } from './types';
export type SelectorQuality = 'best' | 'good' | 'fragile' | 'unknown';
export type WarningSeverity = 'error' | 'warning' | 'info';
export type WarningType = 'low_flow_confidence' | 'false_confidence' | 'flaky_step' | 'fragile_selector' | 'sensitive_data' | 'low_sample_size';
export interface FlowReviewWarning {
    type: WarningType;
    severity: WarningSeverity;
    /** Present for step-scoped warnings; absent for session-level warnings. */
    step?: number;
    message: string;
}
export interface FlowReviewStep {
    /** 1-based — matches the @air-step breadcrumb that will be in generated code. */
    stepNumber: number;
    /** Humanized intent, e.g. "Login Button" from "click_login_btn_". Always a string. */
    intent: string;
    /** Original raw intent string from CodegenStep — preserved for debugging. */
    rawIntent: string;
    action: ActionType;
    /** Display-friendly verb: "Click", "Type", "Submit", "Select". */
    displayAction: string;
    selector: string;
    selectorPriority: SelectorPriority;
    selectorQuality: SelectorQuality;
    /** Raw value from CodegenStep — may be masked stars or '<LLM_GENERATE_MOCK_DATA>'. */
    value?: string;
    /** Display-safe version of value — emails partially masked, sensitive fields shown as ••. */
    displayValue?: string;
    outcomeType?: OutcomeType;
    /** Destination URL — only when outcomeType === 'navigation'. */
    navigatesTo?: string;
    /** AI-derived assertions for this step. Empty unless outcomeType === 'navigation'. */
    assertions: CodegenAssertion[];
    confidence: number;
    /**
     * Human-readable confidence label:
     *   'unverified' — sampleSize === 1 with confidence 1.0 (ambiguous: no edge or seen once)
     *   '95%'        — high confidence
     *   '62% (low)'  — below reliable threshold
     */
    confidenceLabel: string;
    sampleSize: number;
    pageUrl: string;
    /** True when this step is the first action recorded on a new page visit. */
    isFirstOnPage: boolean;
}
export interface FlowReviewPage {
    /** 1-based sequential visit counter. Allows labeling repeated visits: "Page A (visit 2)". */
    visitIndex: number;
    /** Raw URL from the first step on this page. */
    url: string;
    /** Just the pathname portion, e.g. "/auth/login". For display. */
    urlPathname: string;
    /**
     * Derived human name.
     * Root path → hostname-based, e.g. "Orangehrmlive Root".
     * Path with segments → last stable segments title-cased, e.g. "Auth Login".
     * Path with only numeric/UUID segments → "Page N".
     */
    pageName: string;
    /** All steps recorded while on this page, in order. */
    steps: FlowReviewStep[];
    /** True if at least one step on this page navigated to a new page. */
    hasNavigation: boolean;
}
export interface FlowReviewStats {
    totalSteps: number;
    totalPages: number;
    /** Steps where outcomeType === 'navigation'. */
    navigationCount: number;
    /** Total assertions across all steps (AI-derived only; userAssertions excluded). */
    assertionCount: number;
    /** Steps with selectorQuality === 'fragile' or 'unknown'. */
    fragileSteps: number;
    /** Steps where confidence < 0.8 AND sampleSize > 1 (genuinely flaky). */
    lowConfidenceSteps: number;
    /** Steps where value === '<LLM_GENERATE_MOCK_DATA>' (sensitive fields). */
    sensitiveDataSteps: number;
}
export interface FlowReview {
    sessionId: string;
    /**
     * Derived display title, e.g. "Orangehrmlive — Login Flow".
     * Derived from URL hostname + flow type inferred from step intents.
     */
    flowTitle: string;
    /** ISO timestamp from CodegenSession.recordedAt. */
    recordedAt: string;
    /** Starting URL of the recorded flow. */
    startUrl: string;
    stats: FlowReviewStats;
    /**
     * The Laplace-smoothed flow confidence from CodegenSession.
     * NOTE: 1.0 is ambiguous — check stats.navigationCount === 0 to detect
     * the false-high case where no navigation edges were recorded.
     */
    flowConfidence: number;
    /** One entry per page visit, in chronological order. */
    pages: FlowReviewPage[];
    /** Flat ordered list of all enriched steps. Mirrors page.steps concatenated. */
    steps: FlowReviewStep[];
    /** Ordered by: session-level (first) then step-level (ascending by step number). */
    warnings: FlowReviewWarning[];
}
