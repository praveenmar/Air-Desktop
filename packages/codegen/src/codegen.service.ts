/**
 * packages/codegen/src/codegen.service.ts
 *
 * The AIR Code Generation Service — "The Compressor".
 *
 * Reads raw recording data from SQLite and produces a compressed,
 * intent-driven CodegenSession (the Semantic Timeline) that can be
 * fed directly to an AI without blowing up the context window.
 *
 * What gets stripped:
 *   - Raw HTML snapshots (can be 100KB-500KB each)
 *   - Network events (not actionable in tests)
 *   - Scroll events (excluded by default — noise for most tests)
 *   - Hover events (excluded by default)
 *   - Input heartbeats (trigger=input:progress — already filtered at DB level)
 *   - Duplicate edges (deduped by fingerprint hash)
 *   - Pre-navigation UI setup clicks (hamburger expands, container taps)   ← Fix B
 *   - Assertions shared across 2+ destination pages (layout chrome)        ← Fix C
 *
 * What gets preserved:
 *   - Selectors + selector priority (how to find the element)
 *   - Intents (why the user interacted — drives self-healing)
 *   - Outcome types (navigation/no_change — drives waitForURL/assertions)
 *   - Confidence + sample size (reliability signal for the AI)
 *   - Anchor fingerprints from destination nodes (drives assertions)
 *   - Page URLs (drives page.goto() when needed)
 *
 * Output size target: < 8KB per session for a typical 10-step flow.
 * This fits comfortably in any AI context window alongside the prompt.
 */

import * as crypto from 'crypto';
import {
  CodegenSession,
  CodegenStep,
  CodegenAssertion,
  CodegenServiceOptions,
  ActionType,
  SelectorPriority,
  AssertionType,
  FingerprintData,
} from './types';
import type { ResolverConfig, SnapshotCache } from './selector-resolver';
import {
  getUserDefinedAssertions,
  hasUserAssertionSupport,
} from './assertion.stub';
import { normalizeUrl } from '@air/shared';
import { openSqliteReadonlyDatabase, SqliteDatabase } from './sqlite-client';

export const SELECTOR_RANK_MAP: Record<string, number> = {
  'data-testid': 1,
  id: 2,
  attribute: 3,
  class: 7,
  text: 8,
  path: 10,
  xpath: 10,
  other: 10,
  chained: 10,
  unknown: 10,
};

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\A ')
    .replace(/\r/g, '\\D ')
    .replace(/\t/g, '\\9 ');
}

export function rankFromPriority(priority: SelectorPriority): number {
  return SELECTOR_RANK_MAP[priority] ?? 10;
}

function getStepNormalizedUrl(step: Pick<CodegenStep, 'pageUrl'> & { normalizedUrl?: string }): string {
  return step.normalizedUrl ?? normalizeUrl(step.pageUrl);
}

export function getSourceNodeId(
  event: Pick<{ nodeId?: string | null }, 'nodeId'> | null | undefined,
  edge: Pick<{ fromNodeId?: string | null; toNodeId?: string | null }, 'fromNodeId' | 'toNodeId'> | null | undefined
): string | null {
  return event?.nodeId ?? edge?.fromNodeId ?? edge?.toNodeId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION TYPES THAT PRODUCE MEANINGFUL TEST STEPS
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONABLE_TYPES = new Set(['click', 'input', 'submit', 'custom-select']);

// ─────────────────────────────────────────────────────────────────────────────
// FIX B — FRAGILE SELECTOR PRIORITIES
// Steps with these priorities AND immediate_action outcome are candidates for
// pre-navigation setup suppression (hamburger expands, container taps, etc.)
// ─────────────────────────────────────────────────────────────────────────────

const FRAGILE_PRIORITIES = new Set<string>(['class', 'path', 'xpath']);

// ─────────────────────────────────────────────────────────────────────────────
// ANCHOR PARSING
// Anchors are stored as JSON arrays of strings like:
//   ["URL:/dashboard", "BUTTON:text=Log out", "H1:text=Congratulations"]
// We parse these into CodegenAssertions.
// ─────────────────────────────────────────────────────────────────────────────

function parseAnchorsToAssertions(
  anchorsJson: string | null,
  pageUrl: string | null,
  confidence: number
): CodegenAssertion[] {
  const assertions: CodegenAssertion[] = [];

  // Always assert the URL when we have one
  if (pageUrl) {
    assertions.push({
      type: 'url',
      value: pageUrl,
      source: 'url_change',
      confidence,
    });
  }

  if (!anchorsJson) return assertions;

  let anchors: string[];
  try {
    anchors = JSON.parse(anchorsJson);
  } catch {
    return assertions;
  }

  for (const anchor of anchors) {
    // Skip URL anchors — already handled above
    if (anchor.startsWith('URL:')) continue;

    // Parse format: "TAG:attr=value" e.g. "BUTTON:text=Log out"
    const colonIdx = anchor.indexOf(':');
    if (colonIdx === -1) continue;

    const tag = anchor.slice(0, colonIdx).toLowerCase();
    const rest = anchor.slice(colonIdx + 1);
    const eqIdx = rest.indexOf('=');
    if (eqIdx === -1) continue;

    const attrType = rest.slice(0, eqIdx);
    const attrVal = rest.slice(eqIdx + 1);

    if (!attrVal || attrVal.length < 2) continue;

    let assertionType: AssertionType = 'element_visible';
    let selector = '';
    const safeVal = escapeCssString(attrVal);

    switch (attrType) {
      case 'text':
        selector = `${tag}:has-text("${safeVal}")`;
        break;
      case 'testid':
        selector = `[data-testid="${safeVal}"]`;
        break;
      case 'id': {
        const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(attrVal)
          : escapeCssString(attrVal);
        selector = `#${safeId}`;
        break;
      }
      case 'name':
        selector = `[name="${safeVal}"]`;
        break;
      case 'role':
        selector = `[role="${safeVal}"]`;
        break;
      default:
        selector = `${tag}[${attrType}="${safeVal}"]`;
    }

    assertions.push({
      type: assertionType,
      value: attrVal,
      selector,
      source: 'anchor',
      confidence: confidence * 0.9,
    });
  }

  return assertions;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR EXTRACTION
// Fingerprint is stored as JSON in event payload.
// ─────────────────────────────────────────────────────────────────────────────

function extractFingerprint(payloadJson: string | null): FingerprintData | null {
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson);
    return payload.fingerprint || null;
  } catch {
    return null;
  }
}

export function normalizeSelectorPriority(raw: string | undefined): SelectorPriority {
  const valid: SelectorPriority[] = [
    'data-testid', 'id', 'attribute', 'class', 'path', 'text', 'xpath', 'chained', 'other',
  ];
  return (valid.includes(raw as SelectorPriority) ? raw : 'unknown') as SelectorPriority;
}

function extractValue(payloadJson: string | null, eventType: string): string | undefined {
  if (!payloadJson) return undefined;
  try {
    const payload = JSON.parse(payloadJson);

    if (eventType === 'custom-select' && payload.selection?.label) {
      return payload.selection.label;
    }

    if (eventType === 'input') {
      if (payload.inputValueMasked) {
        if (payload.inputValueMasked === '[REDACTED]') {
          return '<LLM_GENERATE_MOCK_DATA>';
        }
        return payload.inputValueMasked;
      }
      if (payload.inputLength) return '*'.repeat(Math.min(payload.inputLength, 20));
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function extractControlSignature(payloadJson: string | null): string | undefined {
  if (!payloadJson) return undefined;
  try {
    const payload = JSON.parse(payloadJson);
    const candidates = [
      payload?.interactionContext?.controlSignature,
      payload?.pageSnapshot?.controlSignature,
      payload?.pageState?.controlSignature,
      payload?.controlSignature,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.length > 0) {
        return candidate;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function extractNormalizedUrl(payloadJson: string | null, fallbackPageUrl: string | null): string | undefined {
  if (payloadJson) {
    try {
      const payload = JSON.parse(payloadJson);
      if (typeof payload?.normalizedUrl === 'string' && payload.normalizedUrl.length > 0) {
        return payload.normalizedUrl;
      }
    } catch {
      // Fall through to pageUrl fallback
    }
  }

  if (fallbackPageUrl) {
    return normalizeUrl(fallbackPageUrl);
  }
  return undefined;
}

function computeFpHash(fp: FingerprintData | null, eventType: string): string {
  const raw = [
    fp?.selector       || '',
    fp?.textExcerpt    || '',
    fp?.attributesHash || '',
    eventType,
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX A — INTENT FROM textExcerpt
//
// Previously intent was synthesised entirely from the selector string:
//   click_.oxd_main_menu_item  (same for Admin, PIM and Leave links)
//
// The textExcerpt in the fingerprint holds the visible label the user clicked
// ("Admin", "PIM", "Leave"). Using it makes intents unique and human-readable,
// which also produces better selector guidance for the AI code generator.
//
// Priority order:
//   1. textExcerpt (visible label — most meaningful)
//   2. aria-label attribute (accessibility label)
//   3. title/alt attribute (icon and tooltip labels)
//   4. name attribute (form field names)
//   5. selector string (last resort)
// ─────────────────────────────────────────────────────────────────────────────

function buildIntent(eventType: string, fp: FingerprintData): string {
  const candidates = [
    fp.textExcerpt,
    fp.attributes?.['ariaLabel'],
    fp.attributes?.['aria-label'],
    fp.attributes?.['title'],
    fp.attributes?.['alt'],
    fp.attributes?.['name'],
  ];

  const label = candidates.find(c => typeof c === 'string' && c.trim().length > 1);
  const source = label ?? fp.selector ?? '';

  const safeName = source
    .trim()
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 30);

  return safeName ? `${eventType}_${safeName}` : eventType;
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX B — PRE-NAVIGATION SETUP CLICK SUPPRESSION
//
// SPA sidebar navigation produces noise clicks before the real nav trigger:
//   8.  click .oxd-icon            (immediate_action, fragile class selector)
//   9.  click div > div:nth-of-type  (immediate_action, fragile path selector)
//   10. click .oxd-main-menu-item   (navigation)  ← the only step that matters
//
// A step is suppressed when ALL three conditions hold:
//   1. outcomeType is 'immediate_action' (explicitly did not change page state)
//   2. selectorPriority is fragile (class / path / xpath)
//   3. Within the next LOOKAHEAD_WINDOW steps on the same page URL, there is a
//      navigation step — OR there are no further steps on this page at all
//      (trailing setup clicks with no completion are equally useless).
//
// Steps that do NOT meet all three conditions are always kept, so legitimate
// class-selector clicks that actually change state (e.g. toggling a tab that
// stays on the same page with state_refresh outcome) are never suppressed.
// ─────────────────────────────────────────────────────────────────────────────

const LOOKAHEAD_WINDOW = 4; // scan up to 4 steps ahead for a navigation trigger

export function suppressPreNavSetupClicks(steps: CodegenStep[]): CodegenStep[] {
  const suppress = new Set<number>(); // indices to remove

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];

    // Condition 1: must be immediate_action
    if (step.outcomeType !== 'immediate_action') continue;

    // Condition 2: must have a fragile selector
    if (!FRAGILE_PRIORITIES.has(step.selectorPriority)) continue;

    // Condition 3a: look ahead within the window on the same page
    let foundNavAhead = false;
    let foundAnyStepOnSamePage = false;
    const stepUrl = getStepNormalizedUrl(step);

    for (let j = i + 1; j < steps.length && j <= i + LOOKAHEAD_WINDOW; j++) {
      const nextUrl = getStepNormalizedUrl(steps[j]);
      if (nextUrl !== stepUrl) break; // left the page

      foundAnyStepOnSamePage = true;

      if (steps[j].outcomeType === 'navigation') {
        foundNavAhead = true;
        break;
      }
    }

    // Condition 3b: also suppress if this is the last meaningful step on the
    // page (no further steps exist on this URL — trailing noise).
    const isTrailing = !foundAnyStepOnSamePage ||
      steps.slice(i + 1).every(s => getStepNormalizedUrl(s) !== stepUrl);

    if (foundNavAhead || isTrailing) {
      suppress.add(i);
    }
  }

  return steps.filter((_, i) => !suppress.has(i));
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX C — SHARED ASSERTION DEDUPLICATION
//
// scanPageAnchors() captures global nav/sidebar elements (Add, Reset, Search,
// Upgrade, checkbox, text input) that appear identically on every page of the
// app. These produce the same assertion set on every navigation step, making
// them useless as page-specific checks.
//
// Strategy: count how many distinct destination pages each anchor assertion
// selector appears on. Any selector present on 2+ destination pages is layout
// chrome — strip it. URL assertions are always unique so they are never
// touched. The result: each nav step keeps only the assertions that are
// genuinely specific to its destination page.
// ─────────────────────────────────────────────────────────────────────────────

function isLikelyTextEntryStep(step: CodegenStep): boolean {
  if (step.action !== 'input') return false;
  const selector = (step.selector || '').toLowerCase();
  const tagName = (step.fingerprint?.tagName || '').toLowerCase();

  if (['input', 'textarea', 'select'].includes(tagName)) return true;
  if (selector.startsWith('input') || selector.startsWith('textarea') || selector.startsWith('select')) {
    return true;
  }
  if (/\[(?:name|placeholder|type)=/i.test(selector)) return true;
  return false;
}

/**
 * Collapses redundant focus-click steps when the next step is an input on the
 * same element in the same page context.
 */
export function collapseRedundantClickBeforeInput(steps: CodegenStep[]): CodegenStep[] {
  const out: CodegenStep[] = [];

  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const next = steps[i + 1];

    const shouldCollapse =
      current?.action === 'click' &&
      next?.action === 'input' &&
      current.selector === next.selector &&
      getStepNormalizedUrl(current) === getStepNormalizedUrl(next) &&
      (current.sourceNodeId ?? null) === (next.sourceNodeId ?? null) &&
      !current.navigatesTo &&
      (current.assertions?.length ?? 0) === 0 &&
      current.outcomeType !== 'navigation' &&
      isLikelyTextEntryStep(next);

    if (shouldCollapse) {
      continue;
    }

    out.push(current);
  }

  return out;
}

export function deduplicateSharedAssertions(steps: CodegenStep[]): CodegenStep[] {
  // Count how many NAV steps each anchor selector appears in
  const selectorPageCount = new Map<string, number>();

  for (const step of steps) {
    if (step.outcomeType !== 'navigation') continue;

    // Use a Set so one step with the same selector twice doesn't double-count
    const seen = new Set<string>();
    for (const assertion of step.assertions) {
      if (assertion.source !== 'anchor') continue;
      if (!assertion.selector) continue;
      if (!seen.has(assertion.selector)) {
        seen.add(assertion.selector);
        selectorPageCount.set(
          assertion.selector,
          (selectorPageCount.get(assertion.selector) ?? 0) + 1,
        );
      }
    }
  }

  // Strip selectors that appear on more than one destination page
  return steps.map(step => ({
    ...step,
    assertions: step.assertions.filter(assertion => {
      if (assertion.source !== 'anchor') return true; // always keep URL assertions
      if (!assertion.selector) return true;
      return (selectorPageCount.get(assertion.selector) ?? 0) < 2;
    }),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class CodegenService {
  private db: SqliteDatabase;

  constructor(private options: CodegenServiceOptions) {
    this.db = openSqliteReadonlyDatabase(options.dbPath);
  }

  /**
   * Lists all sessions available for code generation, newest first.
   */
  public listSessions(): Array<{
    sessionId: string;
    url: string;
    startedAt: string;
    eventCount: number;
  }> {
    const rows = this.db.prepare(`
      SELECT
        s.id          AS sessionId,
        s.started_at  AS startedAt,
        s.event_count AS eventCount,
        (
          SELECT e2.page_url FROM events e2
          WHERE e2.session_id = s.id AND e2.page_url IS NOT NULL
          ORDER BY e2.timestamp ASC
          LIMIT 1
        ) AS url
      FROM sessions s
      ORDER BY s.started_at DESC
    `).all() as any[];

    return rows.map(r => ({
      sessionId:  r.sessionId,
      url:        r.url || 'unknown',
      startedAt:  new Date(r.startedAt).toISOString(),
      eventCount: r.eventCount || 0,
    }));
  }

  /**
   * Builds the full Semantic Timeline for a session.
   * This is what gets fed to the AI — no raw HTML, no snapshots.
   */
  public buildSession(sessionId: string): CodegenSession {
    // ── 1. Load session metadata ────────────────────────────────────────────
    const session = this.db.prepare(`
      SELECT id, started_at, last_event_at, metadata
      FROM sessions
      WHERE id = ?
    `).get(sessionId) as any;

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // ── 2. Load ordered events for this session ─────────────────────────────
    const includeTypes = ['click', 'input', 'submit', 'custom-select'];
    if (this.options.includeScrollSteps) includeTypes.push('scroll');
    if (this.options.includeHoverSteps)  includeTypes.push('hover');

    const placeholders = includeTypes.map(() => '?').join(', ');
    const events = this.db.prepare(`
      SELECT
        e.id          AS eventId,
        e.type        AS eventType,
        e.timestamp,
        e.page_url    AS pageUrl,
        e.trace_id    AS traceId,
        e.node_id     AS nodeId,
        e.payload
      FROM events e
      WHERE e.session_id = ?
        AND e.type IN (${placeholders})
      ORDER BY e.timestamp ASC
    `).all(sessionId, ...includeTypes) as any[];

    // ── 3. Load edges keyed by fingerprint_hash ─────────────────────────────
    // CRITICAL: We join via fingerprint_hash not trigger_event_id.
    // When the same action is recorded multiple times, OutcomeHandler calls
    // resolveOutcome() on the EXISTING edge (first session created it).
    // That edge's trigger_event_id points to a DIFFERENT session's event,
    // making it invisible if we filter by current session's event IDs.

    const sessionFpHashes = new Set<string>();
    const sessionEventIds = new Set<string>();
    for (const ev of events) {
      if (ev.eventId) sessionEventIds.add(ev.eventId);
      const fp = extractFingerprint(ev.payload);
      sessionFpHashes.add(computeFpHash(fp, ev.eventType));
    }

    const fpHashList  = Array.from(sessionFpHashes);
    const eventIdList = Array.from(sessionEventIds);

    const allEdgeRows: any[] = [];
    if (fpHashList.length > 0) {
      const fpPlaceholders = fpHashList.map(() => '?').join(', ');
      const byFp = this.db.prepare(`
        SELECT
          ed.fingerprint_hash AS fingerprintHash,
          ed.id               AS edgeId,
          ed.trigger_event_id AS triggerEventId,
          ed.from_node_id     AS fromNodeId,
          ed.to_node_id       AS toNodeId,
          ed.outcome_type     AS outcomeType,
          ed.sample_size      AS sampleSize,
          o.probability
        FROM edges ed
        LEFT JOIN outcomes o ON o.edge_id = ed.id
        WHERE ed.fingerprint_hash IN (${fpPlaceholders})
      `).all(...fpHashList) as any[];
      allEdgeRows.push(...byFp);
    }
    if (eventIdList.length > 0) {
      const evPlaceholders = eventIdList.map(() => '?').join(', ');
      const byEvent = this.db.prepare(`
        SELECT
          ed.fingerprint_hash AS fingerprintHash,
          ed.id               AS edgeId,
          ed.trigger_event_id AS triggerEventId,
          ed.from_node_id     AS fromNodeId,
          ed.to_node_id       AS toNodeId,
          ed.outcome_type     AS outcomeType,
          ed.sample_size      AS sampleSize,
          o.probability
        FROM edges ed
        LEFT JOIN outcomes o ON o.edge_id = ed.id
        WHERE ed.trigger_event_id IN (${evPlaceholders})
      `).all(...eventIdList) as any[];
      allEdgeRows.push(...byEvent);
    }

    // Deduplicate edges — keep highest-confidence outcome per fingerprint
    const edgeByEventId       = new Map<string, any>();
    const edgeByFingerprint   = new Map<string, any>();

    const outcomeTypePriority: Record<string, number> = {
      navigation: 3, state_refresh: 2, no_change: 1, immediate_action: 0,
    };

    for (const edge of allEdgeRows) {
      const newPriority = outcomeTypePriority[edge.outcomeType] ?? -1;

      if (edge.triggerEventId) {
        const existing = edgeByEventId.get(edge.triggerEventId);
        if (!existing || newPriority > (outcomeTypePriority[existing.outcomeType] ?? -1)) {
          edgeByEventId.set(edge.triggerEventId, edge);
        }
      }
      if (edge.fingerprintHash) {
        const existing = edgeByFingerprint.get(edge.fingerprintHash);
        if (!existing || newPriority > (outcomeTypePriority[existing.outcomeType] ?? -1)) {
          edgeByFingerprint.set(edge.fingerprintHash, edge);
        }
      }
    }

    const edgeRows = Array.from(edgeByFingerprint.values());

    // ── 4. Load destination nodes for navigation edges ──────────────────────
    const navEdges  = edgeRows.filter(e => e.outcomeType === 'navigation');
    const toNodeIds = Array.from(new Set(navEdges.map(e => e.toNodeId).filter(Boolean)));

    const nodeMap = new Map<string, any>();
    if (toNodeIds.length > 0) {
      const nodePlaceholders = toNodeIds.map(() => '?').join(', ');
      const nodes = this.db.prepare(`
        SELECT id, page_url, page_title, anchors
        FROM nodes
        WHERE id IN (${nodePlaceholders})
      `).all(...toNodeIds) as any[];
      for (const node of nodes) nodeMap.set(node.id, node);
    }

    // Source-node fallback for control signature when payload lacks it.
    // This is additive and preserves current behavior when payload already carries signature.
    const nodeControlSignatureStmt = this.db.prepare(`
      SELECT control_signature AS controlSignature
      FROM nodes
      WHERE id = ?
      LIMIT 1
    `);
    const controlSignatureByNodeId = new Map<string, string | undefined>();
    const getNodeControlSignature = (nodeId?: string): string | undefined => {
      if (!nodeId) return undefined;
      if (controlSignatureByNodeId.has(nodeId)) {
        return controlSignatureByNodeId.get(nodeId);
      }

      const row = nodeControlSignatureStmt.get(nodeId) as
        | { controlSignature?: string | null }
        | undefined;
      const resolved =
        typeof row?.controlSignature === 'string' && row.controlSignature.length > 0
          ? row.controlSignature
          : undefined;
      controlSignatureByNodeId.set(nodeId, resolved);
      return resolved;
    };

    // ── 5. Build raw steps ───────────────────────────────────────────────────
    const rawSteps: CodegenStep[] = [];
    let stepNum = 0;
    const minConfidence = this.options.minConfidence ?? 0.0;
    let lastResolvedSourceNodeId: string | undefined;

    for (const ev of events) {
      if (!ACTIONABLE_TYPES.has(ev.eventType)) continue;

      const fingerprint = extractFingerprint(ev.payload);
      if (!fingerprint?.selector) continue;

      const recomputedHash = computeFpHash(fingerprint, ev.eventType);
      const edge      = edgeByEventId.get(ev.eventId) || edgeByFingerprint.get(recomputedHash);
      const confidence = edge?.probability ?? 1.0;

      if (confidence < minConfidence) continue;

      stepNum++;

      // FIX A: intent now prefers textExcerpt over the raw selector string.
      // "click_Admin", "click_PIM", "click_Leave" instead of
      // "click__oxd_main_menu_item" for all three navigation steps.
      const intent = buildIntent(ev.eventType, fingerprint);
      const selectorPriority = normalizeSelectorPriority(fingerprint.selectorPriority);
      const selectorRank = fingerprint.selectorRank ?? rankFromPriority(selectorPriority);
      const directSourceNodeId = getSourceNodeId(ev, edge) ?? undefined;
      // Submit events can arrive without node linkage from the event payload/edge.
      // Keep graph truth untouched, but anchor generation to the latest known node
      // so resolver can still fetch a meaningful snapshot.
      const sourceNodeId = directSourceNodeId ?? (
        ev.eventType === 'submit'
          ? lastResolvedSourceNodeId
          : undefined
      );
      const controlSignature =
        extractControlSignature(ev.payload) ??
        getNodeControlSignature(sourceNodeId);

      const step: CodegenStep = {
        step:             stepNum,
        intent,
        action:           ev.eventType as ActionType,
        selector:         fingerprint.selector,
        sourceNodeId,
        selectorPriority,
        selectorRank,
        fingerprint:      fingerprint ?? undefined,
        controlSignature,
        pageUrl:          ev.pageUrl || '',
        normalizedUrl:    extractNormalizedUrl(ev.payload, ev.pageUrl || ''),
        confidence,
        sampleSize:       edge?.sampleSize ?? 1,
        assertions:       [],
        userAssertions:   [],
      };

      if (sourceNodeId) {
        lastResolvedSourceNodeId = sourceNodeId;
      }

      const value = extractValue(ev.payload, ev.eventType);
      if (value) step.value = value;

      if (edge) {
        step.outcomeType = edge.outcomeType;

        if (edge.outcomeType === 'navigation' && edge.toNodeId) {
          const destNode = nodeMap.get(edge.toNodeId);
          if (destNode?.page_url) step.navigatesTo = destNode.page_url;

          if (destNode) {
            step.assertions = parseAnchorsToAssertions(
              destNode.anchors,
              destNode.page_url,
              edge.probability ?? 1.0,
            );
          }

          step.userAssertions = hasUserAssertionSupport(this.db)
            ? getUserDefinedAssertions(sessionId, this.db)
            : [];
        }
      }

      // Consecutive duplicate filter — keep last (carries final committed value)
      const prev = rawSteps[rawSteps.length - 1];
      if (prev && prev.selector === step.selector && prev.action === step.action) {
        step.step = prev.step;
        rawSteps[rawSteps.length - 1] = step;
        stepNum--;
      } else {
        rawSteps.push(step);
      }
    }

    // ── 6. FIX B: suppress pre-navigation setup clicks ──────────────────────
    // Removes hamburger-expand and container-tap noise clicks that precede
    // every SPA sidebar navigation (e.g. .oxd-icon and div > div:nth-of-type).
    const afterClickInputCollapse = collapseRedundantClickBeforeInput(rawSteps);
    const afterSetupFilter = suppressPreNavSetupClicks(afterClickInputCollapse);

    // ── 7. FIX C: strip assertions shared across multiple destination pages ──
    // Removes global layout elements (Add, Reset, Search buttons) that appear
    // identically in the anchor set of every page, leaving only page-specific
    // assertions. URL assertions are never stripped.
    const finalSteps = deduplicateSharedAssertions(afterSetupFilter);

    // Re-number steps sequentially after filtering
    finalSteps.forEach((s, i) => { s.step = i + 1; });

    // ── 8. Flow confidence ───────────────────────────────────────────────────
    const navProbabilities = edgeRows
      .filter(e => e.outcomeType === 'navigation' && e.probability != null)
      .map(e => e.probability as number);

    const flowConfidence = navProbabilities.length > 0
      ? navProbabilities.reduce((sum, p) => sum + p, 0) / navProbabilities.length
      : 1.0;

    // ── 9. Starting URL and title ────────────────────────────────────────────
    const firstEvent = events[0];
    const startUrl   = firstEvent?.pageUrl || 'unknown';
    const startTitle = (() => {
      try {
        const payload = JSON.parse(firstEvent?.payload || '{}');
        return payload.pageTitle || '';
      } catch { return ''; }
    })();

    // ── 10. Unique node count ────────────────────────────────────────────────
    const visitedNodes = new Set<string>();
    for (const ev of events) {
      if (ev.nodeId) visitedNodes.add(ev.nodeId);
    }

    return {
      sessionId,
      url:            startUrl,
      title:          startTitle,
      recordedAt:     new Date(session.started_at).toISOString(),
      stepCount:      finalSteps.length,
      steps:          finalSteps,
      flowConfidence,
      nodeCount:      visitedNodes.size,
    };
  }

  public close(): void {
    this.db.close();
  }

  public async loadSnapshots(session: CodegenSession, options: ResolverConfig = {}): Promise<SnapshotCache> {
    try {
    const nodeIds = Array.from(
      new Set(
        session.steps
          .map(step => step.sourceNodeId)
          .filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0),
      ),
    );
    const normalizedUrls = Array.from(
      new Set(
        session.steps
          .map(step => step.normalizedUrl || normalizeUrl(step.pageUrl))
          .filter((url): url is string => typeof url === 'string' && url.length > 0),
      ),
    );

    const nodeCache = new Map<string, Document | null>();
    const icStableCache = new Map<string, Document | null>();
    const icAnyCache = new Map<string, Document | null>();
    const icStableByUrlFallback = new Map<string, { doc: Document; capturedAt: number }>();
    const icAnyByUrlFallback = new Map<string, { doc: Document; capturedAt: number }>();
    const eventFallbackCache = new Map<string, Document | null>();
    const maxBytes = options.maxSnapshotBytesForValidation ?? 2_000_000;
    type JsdomCtor = new (html: string) => { window: { document: Document } };
    let jsdomCtor: JsdomCtor | null = null;

    const buildIcKey = (normalizedUrl: string, controlSignature?: string | null): string =>
      `${normalizedUrl}|${controlSignature ?? ''}`;

    const dynamicImport = new Function(
      'specifier',
      'return import(specifier);'
    ) as (specifier: string) => Promise<any>;

    let linkedomParse: ((html: string) => { window: { document: Document } }) | null = null;

    try {
      // Try jsdom first
      const jsdomModule = await dynamicImport('jsdom');
      if (typeof jsdomModule.JSDOM === 'function') {
        jsdomCtor = jsdomModule.JSDOM as JsdomCtor;
      }
    } catch (err) {
      // swallow and try linkedom below
    }

    if (!jsdomCtor) {
      try {
        const linkedom = await dynamicImport('linkedom');
        if (typeof linkedom.parseHTML === 'function') {
          linkedomParse = linkedom.parseHTML as any;
        }
      } catch (err) {
        // failed to load linkedom as well
      }
    }

    const snapshotEngineAvailable = !!(jsdomCtor || linkedomParse);
    console.log('[DEBUG] loadSnapshots: jsdomCtor=', !!jsdomCtor, 'linkedomParse=', !!linkedomParse);
    if (!snapshotEngineAvailable) {
      console.warn('[AIR] Failed to load jsdom or linkedom. Snapshot validation disabled.');
      console.warn('[AIR] Snapshot engine unavailable — resolver running in degraded mode');
      for (const nodeId of nodeIds) nodeCache.set(nodeId, null);
      return {
        snapshotEngineAvailable,
        get(nodeId: string, _normalizedUrl?: string, _controlSignature?: string): Document | null {
          return nodeCache.get(nodeId) ?? null;
        },
        getSource(_nodeId?: string, _normalizedUrl?: string, _controlSignature?: string): 'unavailable' {
          return 'unavailable';
        },
      };
    }

    const parseHtmlToDocument = (html: string, debugLabel: string): Document | null => {
      if (!html) return null;
      if (Buffer.byteLength(html, 'utf8') > maxBytes) return null;
      try {
        if (jsdomCtor) {
          const dom = new jsdomCtor(html);
          return dom.window.document;
        }
        if (linkedomParse) {
          const parsed = linkedomParse(html);
          return parsed.window.document as Document;
        }
        return null;
      } catch (err) {
        console.error('[DEBUG] loadSnapshots: parsing error for', debugLabel, err);
        return null;
      }
    };

    if (normalizedUrls.length > 0) {
      const normalizedPlaceholders = normalizedUrls.map(() => '?').join(', ');
      const icRows = this.db.prepare(`
        SELECT
          normalized_url AS normalizedUrl,
          control_signature AS controlSignature,
          snapshot_html AS snapshotHtml,
          is_stable AS isStable,
          captured_at AS capturedAt
        FROM interaction_contexts
        WHERE session_id = ?
          AND normalized_url IN (${normalizedPlaceholders})
        ORDER BY normalized_url ASC, control_signature ASC, is_stable DESC, captured_at DESC
      `).all(session.sessionId, ...normalizedUrls) as Array<{
        normalizedUrl: string;
        controlSignature: string;
        snapshotHtml: string | null;
        isStable: number;
        capturedAt: number;
      }>;

      for (const row of icRows) {
        const normalizedUrl = row.normalizedUrl;
        if (!normalizedUrl || !row.snapshotHtml) continue;
        const cacheKey = buildIcKey(normalizedUrl, row.controlSignature ?? '');

        const needsAny = !icAnyCache.has(cacheKey);
        const needsStable = row.isStable === 1 && !icStableCache.has(cacheKey);
        if (!needsAny && !needsStable) continue;

        const doc = parseHtmlToDocument(
          row.snapshotHtml,
          `interaction_contexts:${normalizedUrl}:${row.controlSignature}:${row.capturedAt}`
        );
        if (!doc) continue;
        if (needsAny) icAnyCache.set(cacheKey, doc);
        if (needsStable) icStableCache.set(cacheKey, doc);

        const existingAny = icAnyByUrlFallback.get(normalizedUrl);
        if (!existingAny || row.capturedAt > existingAny.capturedAt) {
          icAnyByUrlFallback.set(normalizedUrl, { doc, capturedAt: row.capturedAt });
        }

        if (row.isStable === 1) {
          const existingStable = icStableByUrlFallback.get(normalizedUrl);
          if (!existingStable || row.capturedAt > existingStable.capturedAt) {
            icStableByUrlFallback.set(normalizedUrl, { doc, capturedAt: row.capturedAt });
          }
        }
      }
    }

    const extractSnapshotHtmlFromPayload = (payload: any): string | null => {
      if (!payload || typeof payload !== 'object') return null;

      const candidates = [
        payload?.interactionContext?.html,
        payload?.pageSnapshot?.html,
        payload?.pageState?.html,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) {
          return candidate;
        }
      }
      return null;
    };

    const normalizePayloadUrl = (payload: any, pageUrl: string | null): string | null => {
      const candidates = [
        payload?.interactionContext?.normalizedUrl,
        payload?.pageSnapshot?.normalizedUrl,
        payload?.pageState?.normalizedUrl,
        payload?.normalizedUrl,
      ];

      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0) {
          return candidate;
        }
      }
      if (typeof pageUrl === 'string' && pageUrl.length > 0) {
        return normalizeUrl(pageUrl);
      }
      return null;
    };

    if (normalizedUrls.length > 0) {
      const normalizedUrlSet = new Set(normalizedUrls);
      const eventRows = this.db.prepare(`
        SELECT timestamp, page_url AS pageUrl, payload
        FROM events
        WHERE session_id = ?
        ORDER BY timestamp DESC
      `).all(session.sessionId) as Array<{
        timestamp: number;
        pageUrl: string | null;
        payload: string | null;
      }>;

      for (const row of eventRows) {
        if (!row.payload) continue;

        let payload: any;
        try {
          payload = JSON.parse(row.payload);
        } catch {
          continue;
        }

        const normalizedUrl = normalizePayloadUrl(payload, row.pageUrl);
        if (!normalizedUrl || !normalizedUrlSet.has(normalizedUrl)) continue;
        if (eventFallbackCache.has(normalizedUrl)) continue;

        const html = extractSnapshotHtmlFromPayload(payload);
        if (!html) continue;

        const doc = parseHtmlToDocument(html, `events:${normalizedUrl}:${row.timestamp}`);
        if (!doc) continue;
        eventFallbackCache.set(normalizedUrl, doc);
      }
    }

    const getSnapshotStmt = this.db.prepare(`
      SELECT snapshot_html AS snapshotHtml
      FROM nodes
      WHERE id = ?
      LIMIT 1
    `);

    for (const nodeId of nodeIds) {
      const row = getSnapshotStmt.get(nodeId) as { snapshotHtml?: string | null } | undefined;
      const snapshotHtml = row?.snapshotHtml;
      console.log(`[DEBUG] loadSnapshots: nodeId=${nodeId}, snapshotHtml length=${snapshotHtml ? snapshotHtml.length : 0}`);
      if (!snapshotHtml) {
        nodeCache.set(nodeId, null);
        continue;
      }
      nodeCache.set(nodeId, parseHtmlToDocument(snapshotHtml, `nodes:${nodeId}`));
    }

    console.log(
      `[DEBUG] loadSnapshots: icStable=${icStableCache.size}, icAny=${icAnyCache.size}, eventFallback=${eventFallbackCache.size}, nodeFallback=${Array.from(nodeCache.values()).filter(Boolean).length}/${nodeCache.size}`
    );

    return {
      snapshotEngineAvailable,
      get(nodeId: string, normalizedUrl?: string, controlSignature?: string): Document | null {
        if (normalizedUrl) {
          const key = buildIcKey(normalizedUrl, controlSignature ?? '');
          const stable = icStableCache.get(key);
          if (stable) return stable;

          const any = icAnyCache.get(key);
          if (any) return any;

          const stableByUrl = icStableByUrlFallback.get(normalizedUrl)?.doc;
          if (stableByUrl) return stableByUrl;

          const anyByUrl = icAnyByUrlFallback.get(normalizedUrl)?.doc;
          if (anyByUrl) return anyByUrl;

          const eventFallback = eventFallbackCache.get(normalizedUrl);
          if (eventFallback) return eventFallback;
        }

        if (!nodeId) return null;
        return nodeCache.get(nodeId) ?? null;
      },
      getSource(nodeId: string, normalizedUrl?: string, controlSignature?: string): 'latest' | 'latest-stable' | 'unavailable' {
        if (normalizedUrl) {
          const key = buildIcKey(normalizedUrl, controlSignature ?? '');
          if (icStableCache.get(key)) return 'latest-stable';
          if (icAnyCache.get(key)) return 'latest';
          if (icStableByUrlFallback.get(normalizedUrl)) return 'latest-stable';
          if (icAnyByUrlFallback.get(normalizedUrl)) return 'latest';
          if (eventFallbackCache.get(normalizedUrl)) return 'latest';
        }

        if (nodeId && nodeCache.get(nodeId)) {
          return 'latest';
        }
        return 'unavailable';
      },
    };
    } catch (err) {
      console.error('[AIR] loadSnapshots fatal error:', err);
      const fallbackCache = new Map<string, Document | null>();
      for (const nodeId of (session.steps || []).map(s => s.sourceNodeId).filter(Boolean as any)) {
        fallbackCache.set(nodeId as string, null);
      }
      return {
        snapshotEngineAvailable: false,
        get(nodeId: string, _normalizedUrl?: string, _controlSignature?: string): Document | null {
          return fallbackCache.get(nodeId) ?? null;
        },
        getSource(_nodeId?: string, _normalizedUrl?: string, _controlSignature?: string): 'unavailable' {
          return 'unavailable';
        },
      };
    }
  }
}
