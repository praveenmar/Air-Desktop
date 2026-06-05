"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlowReviewFormatter = void 0;
// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL MAPS  (ASCII only — safe in every terminal and CI log)
// ─────────────────────────────────────────────────────────────────────────────
const QUALITY_BADGE = {
    best: '[*]', // data-testid — best
    good: '[+]', // id / attribute / text — good
    fragile: '[!]', // class / xpath / path — fragile
    unknown: '[?]', // unrecognized priority — unknown
};
const SEVERITY_PREFIX = {
    error: 'ERR',
    warning: 'WRN',
    info: 'INF',
};
const ACTION_GLYPH = {
    click: '->',
    input: '~>',
    submit: '=>',
    'custom-control-open': 'o>',
    'custom-select': 'v>',
    'custom-menu-select': 'v>',
    scroll: '^v',
    hover: '..',
    navigate: '>>',
};
const LINE_WIDTH = 70;
const HR = '─'.repeat(LINE_WIDTH);
const DHR = '═'.repeat(LINE_WIDTH);
// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER
// ─────────────────────────────────────────────────────────────────────────────
class FlowReviewFormatter {
    /**
     * Returns a full ASCII summary of the FlowReview, suitable for
     * `console.log`, file output, or test snapshots.
     *
     * @example
     * const review = FlowReviewService.build(session);
     * console.log(FlowReviewFormatter.formatForConsole(review));
     */
    static formatForConsole(review) {
        const lines = [];
        lines.push('');
        lines.push(DHR);
        lines.push(` AIR Flow Review`);
        lines.push(` ${review.flowTitle}`);
        lines.push(DHR);
        lines.push(` Session : ${review.sessionId}`);
        lines.push(` Recorded: ${review.recordedAt}`);
        lines.push(` Start   : ${review.startUrl}`);
        lines.push('');
        // Stats summary bar
        lines.push(this.formatStatsBar(review));
        lines.push('');
        // Horizontal page flow path
        lines.push(' Flow path:');
        lines.push(this.formatFlowPath(review.pages.map(p => p.pageName)));
        lines.push('');
        // Per-page blocks with step details
        for (const page of review.pages) {
            lines.push(HR);
            lines.push(` ${page.pageName}  (${page.urlPathname})`);
            lines.push('');
            for (const step of page.steps) {
                lines.push(...this.formatStep(step));
                lines.push('');
            }
        }
        // Warnings section
        if (review.warnings.length > 0) {
            lines.push(HR);
            lines.push(` Warnings (${review.warnings.length}):`);
            lines.push('');
            for (const w of review.warnings) {
                lines.push(this.formatWarning(w));
            }
            lines.push('');
        }
        // Legend
        lines.push(HR);
        lines.push(' Selector quality: [*] data-testid  [+] id/attr/text  [!] fragile  [?] unknown');
        lines.push(` Confidence label: % = Laplace probability  "unverified" = no historical edge`);
        lines.push('');
        return lines.join('\n');
    }
    // ── Section formatters ────────────────────────────────────────────────────
    static formatStatsBar(review) {
        const { stats, flowConfidence } = review;
        const isFalseConf = flowConfidence >= 0.99 && stats.navigationCount === 0;
        const confDisplay = isFalseConf
            ? '? (no nav edges)'
            : `${Math.round(flowConfidence * 100)}%`;
        const parts = [
            `Steps: ${stats.totalSteps}`,
            `Pages: ${stats.totalPages}`,
            `Nav: ${stats.navigationCount}`,
            `Assertions: ${stats.assertionCount}`,
            `Confidence: ${confDisplay}`,
        ];
        if (stats.fragileSteps > 0) {
            parts.push(`Fragile selectors: ${stats.fragileSteps}`);
        }
        if (stats.lowConfidenceSteps > 0) {
            parts.push(`Flaky steps: ${stats.lowConfidenceSteps}`);
        }
        return ' ' + parts.join('  ');
    }
    static formatFlowPath(pageNames) {
        if (pageNames.length === 0)
            return '   (no pages)';
        const INDENT = '   ';
        const ARROW = ' -> ';
        const MAX = LINE_WIDTH - INDENT.length;
        const lines = [];
        let current = '';
        for (let i = 0; i < pageNames.length; i++) {
            const segment = i === 0 ? pageNames[i] : ARROW + pageNames[i];
            if (current.length + segment.length > MAX && current.length > 0) {
                lines.push(INDENT + current);
                // Continuation lines indented extra to align with the arrow
                current = '   ' + pageNames[i];
            }
            else {
                current += segment;
            }
        }
        if (current)
            lines.push(INDENT + current);
        return lines.join('\n');
    }
    static formatStep(step) {
        const lines = [];
        const badge = QUALITY_BADGE[step.selectorQuality];
        const glyph = ACTION_GLYPH[step.action] ?? '  ';
        const num = String(step.stepNumber).padStart(2, ' ');
        // Primary description line
        let desc = `${step.displayAction} "${step.intent}"`;
        if (step.displayValue) {
            desc += ` = "${step.displayValue}"`;
        }
        if (step.outcomeType === 'navigation' && step.navigatesTo) {
            desc += `  ->  ${this.shortenUrl(step.navigatesTo)}`;
        }
        lines.push(`  ${num}. ${glyph}  ${desc}`);
        // Secondary line: selector quality + selector + confidence
        const confPad = step.confidenceLabel.padStart(12, ' ');
        const selectorTrunc = step.selector.length > 48
            ? step.selector.slice(0, 45) + '...'
            : step.selector;
        lines.push(`        ${badge} ${selectorTrunc}  ${confPad}`);
        // Assertion lines (only when present — navigation steps)
        for (const assertion of step.assertions) {
            const target = assertion.selector ?? assertion.value;
            const truncTarget = target.length > 48 ? target.slice(0, 45) + '...' : target;
            lines.push(`        + assert ${assertion.type}: ${truncTarget}`);
        }
        return lines;
    }
    static formatWarning(w) {
        const prefix = SEVERITY_PREFIX[w.severity];
        const stepTag = w.step !== undefined ? ` [step ${w.step}]` : '';
        return `  [${prefix}]${stepTag} ${w.message}`;
    }
    // ── Utilities ─────────────────────────────────────────────────────────────
    static shortenUrl(url) {
        try {
            return new URL(url).pathname;
        }
        catch {
            return url.length > 45 ? url.slice(0, 42) + '...' : url;
        }
    }
}
exports.FlowReviewFormatter = FlowReviewFormatter;
