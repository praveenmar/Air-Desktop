/**
 * packages/codegen/src/flow-review.formatter.ts
 *
 * Console/ASCII formatter for FlowReview.
 *
 * Design decisions:
 *   - All methods return `string` — callers decide what to do with it (console.log,
 *     write to file, assert in tests). No `console.log` inside this class.
 *   - Uses ASCII-safe symbols throughout so output is readable in CI logs,
 *     Windows cmd, and any terminal that doesn't support Unicode emoji.
 *   - The class is stateless — all methods are static.
 */
import type { FlowReview } from './flow-review.types';
export declare class FlowReviewFormatter {
    /**
     * Returns a full ASCII summary of the FlowReview, suitable for
     * `console.log`, file output, or test snapshots.
     *
     * @example
     * const review = FlowReviewService.build(session);
     * console.log(FlowReviewFormatter.formatForConsole(review));
     */
    static formatForConsole(review: FlowReview): string;
    private static formatStatsBar;
    private static formatFlowPath;
    private static formatStep;
    private static formatWarning;
    private static shortenUrl;
}
