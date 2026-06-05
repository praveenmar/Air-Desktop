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
import type { CodegenSession } from './types';
import type { FlowReview } from './flow-review.types';
export declare class FlowReviewService {
    /**
     * Transforms a CodegenSession into an enriched FlowReview DTO.
     * All computation happens here; no async, no I/O.
     */
    static build(session: CodegenSession): FlowReview;
}
