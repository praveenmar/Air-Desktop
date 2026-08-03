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

import type { CodegenSession, GenerationEventMetadata, SelectorResolutionV1 } from './types';
import type {
  FlowReview,
  FlowReviewPage,
  FlowReviewStep,
  FlowReviewWarning,
  FlowReviewStats,
} from './flow-review.types';
import {
  extractPathname,
  normalizeUrlForGrouping,
  getPageName,
  humanizeIntent,
  normalizeActionVerb,
  getSelectorQuality,
  getConfidenceLabel,
  maskDisplayValue,
  deriveFlowTitle,
  getLocatorStatus,
} from './flow-review.utils';

export class FlowReviewService {
  /**
   * Transforms a CodegenSession into an enriched FlowReview DTO.
   * All computation happens here; no async, no I/O.
   *
   * @param session     The raw session from buildSession()
   * @param eventsById  Optional map of eventId → GenerationEventMetadata.
   *                    When present, used to populate locatorStatus and outcomeEffect
   *                    from the live shadow-proof pipeline data.
   *                    When absent (legacy path), sensible defaults are applied.
   */
  static build(
    session: CodegenSession,
    eventsById?: Map<string, GenerationEventMetadata>,
  ): FlowReview {
    // ── Accumulators initialized before the loop ─────────────────────────────
    const enrichedSteps: FlowReviewStep[] = [];
    const pages: FlowReviewPage[] = [];
    const warnings: FlowReviewWarning[] = [];

    // Page-tracking state (updated as we walk steps in order)
    let currentPageNormalizedUrl = '\x00'; // sentinel: never matches any real URL
    let currentPage: FlowReviewPage | null = null;
    let pageVisitIndex = 0;

    // Stats counters — incremented inside the loop, never re-iterated
    let navigationCount    = 0;
    let assertionCount     = 0;
    let fragileSteps       = 0;
    let lowConfidenceSteps = 0;
    let sensitiveDataSteps = 0;
    let unresolvedSteps    = 0;

    // ── Single pass over all steps ────────────────────────────────────────────
    for (const rawStep of session.steps) {
      const normalizedUrl  = normalizeUrlForGrouping(rawStep.pageUrl);
      const isFirstOnPage  = currentPage === null || normalizedUrl !== currentPageNormalizedUrl;

      // ── Open a new page entry when the URL changes ─────────────────────────
      if (isFirstOnPage) {
        pageVisitIndex++;
        currentPageNormalizedUrl = normalizedUrl;
        currentPage = {
          visitIndex:   pageVisitIndex,
          url:          rawStep.pageUrl,
          urlPathname:  extractPathname(rawStep.pageUrl),
          pageName:     getPageName(rawStep.pageUrl, pageVisitIndex),
          steps:        [],
          hasNavigation: false,
        };
        pages.push(currentPage);
      }

      // ── Build the enriched step ────────────────────────────────────────────
      // Look up per-event metadata (shadow-proof pipeline output) if available
      const eventMeta: GenerationEventMetadata | undefined =
        rawStep.eventId && eventsById ? eventsById.get(rawStep.eventId) : undefined;

      const selectorResolution: SelectorResolutionV1 | undefined =
        eventMeta?.selectorResolution ?? undefined;

      // proofSource lives inside selectorResolution.selected when status = resolved
      const proofSource: string | null =
        selectorResolution?.status === 'resolved'
          ? selectorResolution.selected?.proofSource ?? null
          : null;

      const selectorQuality  = getSelectorQuality(rawStep.selectorPriority, proofSource);
      const confidenceLabel  = getConfidenceLabel(rawStep.confidence, rawStep.sampleSize);
      const displayValue     = rawStep.value
        ? maskDisplayValue(rawStep.value, rawStep.intent)
        : undefined;

      const locatorStatus = getLocatorStatus(selectorResolution, rawStep.action);

      const step: FlowReviewStep = {
        stepNumber:       rawStep.step,
        intent:           humanizeIntent(rawStep.intent, rawStep.action),
        rawIntent:        rawStep.intent,
        action:           rawStep.action,
        displayAction:    normalizeActionVerb(rawStep.action),
        selector:         rawStep.selector,
        selectorPriority: rawStep.selectorPriority,
        selectorQuality,
        value:            rawStep.value,
        displayValue,
        outcomeType:      rawStep.outcomeType,
        navigatesTo:      rawStep.navigatesTo,
        assertions:       rawStep.assertions,
        locatorStatus,
        outcomeEffect:    rawStep.outcomeEffect,
        // userAssertions intentionally excluded — Phase 2 stub, always empty
        confidence:       rawStep.confidence,
        confidenceLabel,
        sampleSize:       rawStep.sampleSize,
        pageUrl:          rawStep.pageUrl,
        isFirstOnPage,
      };

      // Both arrays hold the same object reference — no duplication
      enrichedSteps.push(step);
      currentPage!.steps.push(step);

      // ── Stats accumulation ─────────────────────────────────────────────────
      if (rawStep.outcomeType === 'navigation') {
        navigationCount++;
        currentPage!.hasNavigation = true;
      }

      // Count only AI-derived assertions (userAssertions is always [] today)
      assertionCount += rawStep.assertions.length;

      if (selectorQuality === 'fragile' || selectorQuality === 'unknown') {
        fragileSteps++;
      }

      if (locatorStatus === 'unresolved') {
        unresolvedSteps++;
      }

      // "Genuinely flaky" requires sampleSize > 1 so we know it's been observed
      // more than once and still shows low probability, not just a defaulted value.
      const isGenuinelyFlaky = rawStep.confidence < 0.8 && rawStep.sampleSize > 1;
      if (isGenuinelyFlaky) lowConfidenceSteps++;

      if (rawStep.value === '<LLM_GENERATE_MOCK_DATA>') sensitiveDataSteps++;

      // ── Step-level warnings (generated in the same pass) ──────────────────

      if (selectorQuality === 'fragile') {
        warnings.push({
          type:     'fragile_selector',
          severity: 'warning',
          step:     rawStep.step,
          message:  `Step ${rawStep.step} uses a ${rawStep.selectorPriority} selector: `
                  + `"${rawStep.selector.slice(0, 60)}". `
                  + `Likely to break on DOM structural changes.`,
        });
      } else if (selectorQuality === 'unknown') {
        warnings.push({
          type:     'fragile_selector',
          severity: 'info',
          step:     rawStep.step,
          message:  `Step ${rawStep.step} has an unrecognized selector priority `
                  + `("${rawStep.selectorPriority}"). Reliability unconfirmed.`,
        });
      }

      if (isGenuinelyFlaky) {
        warnings.push({
          type:     'flaky_step',
          severity: 'warning',
          step:     rawStep.step,
          message:  `Step ${rawStep.step} ("${step.intent}") has low confidence `
                  + `(${Math.round(rawStep.confidence * 100)}%) across `
                  + `${rawStep.sampleSize} observations. `
                  + `This transition doesn't always lead to the same page.`,
        });
      }

      // Ambiguous case: confidence === 1.0 with sampleSize === 1 — could be
      // "seen exactly once" OR "no edge found, both fields defaulted".
      if (rawStep.sampleSize === 1 && Math.abs(rawStep.confidence - 1.0) < 0.001) {
        warnings.push({
          type:     'low_sample_size',
          severity: 'info',
          step:     rawStep.step,
          message:  `Step ${rawStep.step} has only one observation or no historical edge. `
                  + `Selector reliability unconfirmed.`,
        });
      }

      if (rawStep.value === '<LLM_GENERATE_MOCK_DATA>') {
        warnings.push({
          type:     'sensitive_data',
          severity: 'info',
          step:     rawStep.step,
          message:  `Step ${rawStep.step} contains a sensitive field. `
                  + `The test generator will produce mock data instead of the recorded value.`,
        });
      }

      if (locatorStatus === 'unresolved') {
        warnings.push({
          type:     'unresolved_selector',
          severity: 'error',
          step:     rawStep.step,
          message:  `Step ${rawStep.step} ("${step.intent}") has no replay-safe selector. `
                  + `The selector resolver could not find a stable locator. `
                  + `Manual review required before generating a test.`,
        });
      }
    }
    // ── End of single pass ────────────────────────────────────────────────────

    // ── Session-level warnings (require final loop totals) ───────────────────

    // False confidence: flowConfidence === 1.0 but no navigation edges were
    // recorded. This is the CodegenService default when navProbabilities is empty.
    const isFalseConfidence = session.flowConfidence >= 0.99 && navigationCount === 0;

    if (isFalseConfidence) {
      warnings.unshift({                          // unshift: session warnings lead
        type:     'false_confidence',
        severity: 'warning',
        message:  'Flow confidence shows 100% but no page navigations were recorded. '
                + 'The interceptor may have missed page loads, or this is a single-page '
                + 'flow with no route changes. Confidence is unverified.',
      });
    } else if (session.flowConfidence < 0.7) {
      warnings.unshift({
        type:     'low_flow_confidence',
        severity: 'error',
        message:  `Overall flow confidence is ${Math.round(session.flowConfidence * 100)}%. `
                + 'Multiple recordings produced different outcomes. '
                + 'The generated test may be unreliable — consider re-recording.',
      });
    }

    // ── Assemble final stats ──────────────────────────────────────────────────
    const stats: FlowReviewStats = {
      totalSteps:        enrichedSteps.length,
      totalPages:        pages.length,
      navigationCount,
      assertionCount,
      fragileSteps,
      lowConfidenceSteps,
      sensitiveDataSteps,
      unresolvedSteps,
    };

    return {
      sessionId:      session.sessionId,
      flowTitle:      deriveFlowTitle(session.url, session.title, session.steps),
      recordedAt:     session.recordedAt,
      startUrl:       session.url,
      stats,
      flowConfidence: session.flowConfidence,
      pages,
      steps:          enrichedSteps,
      warnings,
    };
  }
}