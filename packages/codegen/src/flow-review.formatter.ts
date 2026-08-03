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

import type {
  FlowReview,
  FlowReviewStep,
  FlowReviewWarning,
  SelectorQuality,
  WarningSeverity,
} from './flow-review.types';
import { formatOutcomeEffect } from './flow-review.utils';

// ─────────────────────────────────────────────────────────────────────────────
// SYMBOL MAPS  (ASCII only — safe in every terminal and CI log)
// ─────────────────────────────────────────────────────────────────────────────

const QUALITY_BADGE: Record<SelectorQuality, string> = {
  best:    '[*]',   // data-testid — best
  good:    '[+]',   // id / attribute / text — good
  fragile: '[!]',   // class / xpath / path — fragile
  unknown: '[?]',   // unrecognized priority — unknown
};

const SEVERITY_PREFIX: Record<WarningSeverity, string> = {
  error:   'ERR',
  warning: 'WRN',
  info:    'INF',
};

const ACTION_GLYPH: Record<string, string> = {
  click:          '->',
  input:          '~>',
  submit:         '=>',
  'custom-control-open':'o>',
  'custom-select':'v>',
  'custom-menu-select':'v>',
  scroll:         '^v',
  hover:          '..',
  navigate:       '>>',
};

const LINE_WIDTH = 70;
const HR  = '─'.repeat(LINE_WIDTH);
const DHR = '═'.repeat(LINE_WIDTH);

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTER
// ─────────────────────────────────────────────────────────────────────────────

export class FlowReviewFormatter {
  /**
   * Returns a full ASCII summary of the FlowReview, suitable for
   * `console.log`, file output, or test snapshots.
   *
   * @example
   * const review = FlowReviewService.build(session);
   * console.error(FlowReviewFormatter.formatForConsole(review));
   */
  static formatForConsole(review: FlowReview): string {
    const lines: string[] = [];

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

  private static formatStatsBar(review: FlowReview): string {
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

  private static formatFlowPath(pageNames: string[]): string {
    if (pageNames.length === 0) return '   (no pages)';

    const INDENT = '   ';
    const ARROW  = ' -> ';
    const MAX    = LINE_WIDTH - INDENT.length;

    const lines: string[] = [];
    let current = '';

    for (let i = 0; i < pageNames.length; i++) {
      const segment = i === 0 ? pageNames[i] : ARROW + pageNames[i];
      if (current.length + segment.length > MAX && current.length > 0) {
        lines.push(INDENT + current);
        // Continuation lines indented extra to align with the arrow
        current = '   ' + pageNames[i];
      } else {
        current += segment;
      }
    }
    if (current) lines.push(INDENT + current);

    return lines.join('\n');
  }

  private static formatStep(step: FlowReviewStep): string[] {
    const lines: string[] = [];
    const badge  = QUALITY_BADGE[step.selectorQuality];
    const glyph  = ACTION_GLYPH[step.action] ?? '  ';
    const num    = String(step.stepNumber).padStart(2, ' ');

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
    const confPad   = step.confidenceLabel.padStart(12, ' ');
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

  private static formatWarning(w: FlowReviewWarning): string {
    const prefix  = SEVERITY_PREFIX[w.severity];
    const stepTag = w.step !== undefined ? ` [step ${w.step}]` : '';
    return `  [${prefix}]${stepTag} ${w.message}`;
  }

  // ── Utilities ─────────────────────────────────────────────────────────────

  private static shortenUrl(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url.length > 45 ? url.slice(0, 42) + '...' : url;
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// MARKDOWN FORMATTER
// Produces real GitHub-flavoured Markdown: headers, tables, alerts.
// Used by the MCP get_session_flow_review tool and AI consumers.
// ──────────────────────────────────────────────────────────────────────

export class FlowReviewMarkdownFormatter {
  /**
   * Renders the FlowReview as proper GitHub-flavoured Markdown.
   * Suitable for MCP tool responses, AI context, and Markdown viewers.
   */
  static format(review: FlowReview): string {
    const lines: string[] = [];

    // ── Header ─────────────────────────────────────────────────────────────
    lines.push(`# AIR Flow Review: ${review.flowTitle}`);
    lines.push('');
    lines.push(`**Session:** \`${review.sessionId}\``);
    lines.push(`**Recorded:** ${review.recordedAt}`);
    lines.push(`**Start URL:** ${review.startUrl}`);
    lines.push('');

    // ── Stats table ──────────────────────────────────────────────────────────
    const { stats } = review;
    const isFalseConf = review.flowConfidence >= 0.99 && stats.navigationCount === 0;
    const confDisplay = isFalseConf
      ? '? (no nav edges)'
      : `${Math.round(review.flowConfidence * 100)}%`;

    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Steps | ${stats.totalSteps} |`);
    lines.push(`| Pages | ${stats.totalPages} |`);
    lines.push(`| Flow Confidence | ${confDisplay} |`);
    lines.push(`| Page Navigations | ${stats.navigationCount} |`);
    lines.push(`| Assertions | ${stats.assertionCount} |`);
    if (stats.unresolvedSteps > 0) {
      lines.push(`| **⚠️ Unresolved Steps** | **${stats.unresolvedSteps}** |`);
    }
    if (stats.fragileSteps > 0) {
      lines.push(`| Fragile Selectors | ${stats.fragileSteps} |`);
    }
    if (stats.lowConfidenceSteps > 0) {
      lines.push(`| Flaky Steps | ${stats.lowConfidenceSteps} |`);
    }
    lines.push('');

    // ── Critical warnings block at the top (unresolved + flow-level) ─────────
    const criticalWarnings = review.warnings.filter(w => w.severity === 'error');
    if (criticalWarnings.length > 0) {
      lines.push('> [!CAUTION]');
      for (const w of criticalWarnings) {
        const stepTag = w.step !== undefined ? `Step ${w.step}: ` : '';
        lines.push(`> - ${stepTag}${w.message}`);
      }
      lines.push('');
    }

    // ── Flow path ───────────────────────────────────────────────────────────
    lines.push('## Flow Path');
    lines.push('');
    const pageNames = review.pages.map(p => p.pageName);
    lines.push(pageNames.join(' → '));
    lines.push('');

    // ── Per-page step blocks ───────────────────────────────────────────────
    lines.push('## Steps');
    lines.push('');

    for (const page of review.pages) {
      lines.push(`### ${page.pageName}`);
      lines.push(`*${page.urlPathname}*`);
      lines.push('');

      for (const step of page.steps) {
        lines.push(...this.formatStepMd(step));
      }
    }

    // ── Non-critical warnings ─────────────────────────────────────────────
    const nonCritical = review.warnings.filter(w => w.severity !== 'error');
    if (nonCritical.length > 0) {
      lines.push('## Warnings');
      lines.push('');
      for (const w of nonCritical) {
        const prefix = w.severity === 'warning' ? '> [!WARNING]' : '> [!NOTE]';
        lines.push(prefix);
        const stepTag = w.step !== undefined ? `Step ${w.step}: ` : '';
        lines.push(`> ${stepTag}${w.message}`);
        lines.push('');
      }
    }

    // ── Legend ──────────────────────────────────────────────────────────────
    lines.push('---');
    lines.push('**Selector quality:** `[*]` data-testid &nbsp; `[+]` id/attr/ARIA &nbsp; `[!]` fragile &nbsp; `[?]` unknown');
    lines.push('');

    return lines.join('\n');
  }

  // ── Step formatter ─────────────────────────────────────────────────────

  private static formatStepMd(step: FlowReviewStep): string[] {
    const QUALITY_BADGE: Record<SelectorQuality, string> = {
      best:    '[\u2605]', // star
      good:    '[+]',
      fragile: '[!]',
      unknown: '[?]',
    };

    const lines: string[] = [];
    const badge      = QUALITY_BADGE[step.selectorQuality];
    const num        = String(step.stepNumber).padStart(2, ' ');
    const statusIcon = step.locatorStatus === 'unresolved' ? ' ⚠️' : '';

    // Primary line
    let primary = `**${num}. ${step.displayAction}** “${step.intent}”${statusIcon}`;
    if (step.displayValue) primary += ` = \`${step.displayValue}\``;
    if (step.outcomeType === 'navigation' && step.navigatesTo) {
      primary += ` → \`${this.shortenUrl(step.navigatesTo)}\``;
    }
    lines.push(`- ${primary}`);

    // Selector line
    const selectorTrunc = step.selector.length > 60
      ? step.selector.slice(0, 57) + '...'
      : step.selector;
    lines.push(`  ${badge} \`${selectorTrunc}\` &nbsp; *${step.confidenceLabel}*`);

    // Outcome effect line
    if (step.outcomeEffect) {
      lines.push(`  **Effect:** ${formatOutcomeEffect(step.outcomeEffect)}`);
    }

    // Assertion lines
    for (const assertion of step.assertions) {
      const target = assertion.selector ?? assertion.value;
      const trunc  = target.length > 60 ? target.slice(0, 57) + '...' : target;
      lines.push(`  - ✓ assert ${assertion.type}: \`${trunc}\``);
    }

    lines.push('');
    return lines;
  }

  private static shortenUrl(url: string): string {
    try { return new URL(url).pathname; }
    catch { return url.length > 45 ? url.slice(0, 42) + '...' : url; }
  }
}
