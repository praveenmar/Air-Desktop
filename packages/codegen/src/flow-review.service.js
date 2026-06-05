"use strict";
/**
 * packages/codegen/src/flow-review.service.ts
 *
 * Pure transformation layer: CodegenSession → FlowReview.
 *
 * Constraints (enforced by design):
 *   - Zero DB access
 *   - Zero side effects (no console.log, no file writes)
 *   - Single pass over session.steps — stats, warnings, pages, and enriched
 *     steps are all accumulated in one loop. Session-level warnings (which
 *     depend on final loop totals) are appended after the loop.
 *   - FlowReview does not embed the original CodegenSession.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowReviewService = void 0;
const flow_review_utils_1 = require("./flow-review.utils");
class FlowReviewService {
    /**
     * Transforms a CodegenSession into an enriched FlowReview DTO.
     * All computation happens here; no async, no I/O.
     */
    static build(session) {
        // ── Accumulators initialized before the loop ─────────────────────────────
        const enrichedSteps = [];
        const pages = [];
        const warnings = [];
        // Page-tracking state (updated as we walk steps in order)
        let currentPageNormalizedUrl = '\x00'; // sentinel: never matches any real URL
        let currentPage = null;
        let pageVisitIndex = 0;
        // Stats counters — incremented inside the loop, never re-iterated
        let navigationCount = 0;
        let assertionCount = 0;
        let fragileSteps = 0;
        let lowConfidenceSteps = 0;
        let sensitiveDataSteps = 0;
        // ── Single pass over all steps ────────────────────────────────────────────
        for (const rawStep of session.steps) {
            const normalizedUrl = (0, flow_review_utils_1.normalizeUrlForGrouping)(rawStep.pageUrl);
            const isFirstOnPage = currentPage === null || normalizedUrl !== currentPageNormalizedUrl;
            // ── Open a new page entry when the URL changes ─────────────────────────
            if (isFirstOnPage) {
                pageVisitIndex++;
                currentPageNormalizedUrl = normalizedUrl;
                currentPage = {
                    visitIndex: pageVisitIndex,
                    url: rawStep.pageUrl,
                    urlPathname: (0, flow_review_utils_1.extractPathname)(rawStep.pageUrl),
                    pageName: (0, flow_review_utils_1.getPageName)(rawStep.pageUrl, pageVisitIndex),
                    steps: [],
                    hasNavigation: false,
                };
                pages.push(currentPage);
            }
            // ── Build the enriched step ────────────────────────────────────────────
            const selectorQuality = (0, flow_review_utils_1.getSelectorQuality)(rawStep.selectorPriority);
            const confidenceLabel = (0, flow_review_utils_1.getConfidenceLabel)(rawStep.confidence, rawStep.sampleSize);
            const displayValue = rawStep.value
                ? (0, flow_review_utils_1.maskDisplayValue)(rawStep.value, rawStep.intent)
                : undefined;
            const step = {
                stepNumber: rawStep.step,
                intent: (0, flow_review_utils_1.humanizeIntent)(rawStep.intent, rawStep.action),
                rawIntent: rawStep.intent,
                action: rawStep.action,
                displayAction: (0, flow_review_utils_1.normalizeActionVerb)(rawStep.action),
                selector: rawStep.selector,
                selectorPriority: rawStep.selectorPriority,
                selectorQuality,
                value: rawStep.value,
                displayValue,
                outcomeType: rawStep.outcomeType,
                navigatesTo: rawStep.navigatesTo,
                assertions: rawStep.assertions,
                // userAssertions intentionally excluded — Phase 2 stub, always empty
                confidence: rawStep.confidence,
                confidenceLabel,
                sampleSize: rawStep.sampleSize,
                pageUrl: rawStep.pageUrl,
                isFirstOnPage,
            };
            // Both arrays hold the same object reference — no duplication
            enrichedSteps.push(step);
            currentPage.steps.push(step);
            // ── Stats accumulation ─────────────────────────────────────────────────
            if (rawStep.outcomeType === 'navigation') {
                navigationCount++;
                currentPage.hasNavigation = true;
            }
            // Count only AI-derived assertions (userAssertions is always [] today)
            assertionCount += rawStep.assertions.length;
            if (selectorQuality === 'fragile' || selectorQuality === 'unknown') {
                fragileSteps++;
            }
            // "Genuinely flaky" requires sampleSize > 1 so we know it's been observed
            // more than once and still shows low probability, not just a defaulted value.
            const isGenuinelyFlaky = rawStep.confidence < 0.8 && rawStep.sampleSize > 1;
            if (isGenuinelyFlaky)
                lowConfidenceSteps++;
            if (rawStep.value === '<LLM_GENERATE_MOCK_DATA>')
                sensitiveDataSteps++;
            // ── Step-level warnings (generated in the same pass) ──────────────────
            if (selectorQuality === 'fragile') {
                warnings.push({
                    type: 'fragile_selector',
                    severity: 'warning',
                    step: rawStep.step,
                    message: `Step ${rawStep.step} uses a ${rawStep.selectorPriority} selector: `
                        + `"${rawStep.selector.slice(0, 60)}". `
                        + `Likely to break on DOM structural changes.`,
                });
            }
            else if (selectorQuality === 'unknown') {
                warnings.push({
                    type: 'fragile_selector',
                    severity: 'info',
                    step: rawStep.step,
                    message: `Step ${rawStep.step} has an unrecognized selector priority `
                        + `("${rawStep.selectorPriority}"). Reliability unconfirmed.`,
                });
            }
            if (isGenuinelyFlaky) {
                warnings.push({
                    type: 'flaky_step',
                    severity: 'warning',
                    step: rawStep.step,
                    message: `Step ${rawStep.step} ("${step.intent}") has low confidence `
                        + `(${Math.round(rawStep.confidence * 100)}%) across `
                        + `${rawStep.sampleSize} observations. `
                        + `This transition doesn't always lead to the same page.`,
                });
            }
            // Ambiguous case: confidence === 1.0 with sampleSize === 1 — could be
            // "seen exactly once" OR "no edge found, both fields defaulted".
            if (rawStep.sampleSize === 1 && Math.abs(rawStep.confidence - 1.0) < 0.001) {
                warnings.push({
                    type: 'low_sample_size',
                    severity: 'info',
                    step: rawStep.step,
                    message: `Step ${rawStep.step} has only one observation or no historical edge. `
                        + `Selector reliability unconfirmed.`,
                });
            }
            if (rawStep.value === '<LLM_GENERATE_MOCK_DATA>') {
                warnings.push({
                    type: 'sensitive_data',
                    severity: 'info',
                    step: rawStep.step,
                    message: `Step ${rawStep.step} contains a sensitive field. `
                        + `The test generator will produce mock data instead of the recorded value.`,
                });
            }
        }
        // ── End of single pass ────────────────────────────────────────────────────
        // ── Session-level warnings (require final loop totals) ───────────────────
        // False confidence: flowConfidence === 1.0 but no navigation edges were
        // recorded. This is the CodegenService default when navProbabilities is empty.
        const isFalseConfidence = session.flowConfidence >= 0.99 && navigationCount === 0;
        if (isFalseConfidence) {
            warnings.unshift({
                type: 'false_confidence',
                severity: 'warning',
                message: 'Flow confidence shows 100% but no page navigations were recorded. '
                    + 'The interceptor may have missed page loads, or this is a single-page '
                    + 'flow with no route changes. Confidence is unverified.',
            });
        }
        else if (session.flowConfidence < 0.7) {
            warnings.unshift({
                type: 'low_flow_confidence',
                severity: 'error',
                message: `Overall flow confidence is ${Math.round(session.flowConfidence * 100)}%. `
                    + 'Multiple recordings produced different outcomes. '
                    + 'The generated test may be unreliable — consider re-recording.',
            });
        }
        // ── Assemble final stats ──────────────────────────────────────────────────
        const stats = {
            totalSteps: enrichedSteps.length,
            totalPages: pages.length,
            navigationCount,
            assertionCount,
            fragileSteps,
            lowConfidenceSteps,
            sensitiveDataSteps,
        };
        return {
            sessionId: session.sessionId,
            flowTitle: (0, flow_review_utils_1.deriveFlowTitle)(session.url, session.title, session.steps),
            recordedAt: session.recordedAt,
            startUrl: session.url,
            stats,
            flowConfidence: session.flowConfidence,
            pages,
            steps: enrichedSteps,
            warnings,
        };
    }
}
exports.FlowReviewService = FlowReviewService;
