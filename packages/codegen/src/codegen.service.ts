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

import * as Database from 'better-sqlite3';
import * as crypto from 'crypto';
import {
  CodegenSession,
  CodegenStep,
  CodegenAssertion,
  CodegenServiceOptions,
  ActionType,
  SelectorPriority,
  AssertionType,
} from './types';
import {
  getUserDefinedAssertions,
  hasUserAssertionSupport,
} from './assertion.stub';

// ─────────────────────────────────────────────────────────────────────────────
// ACTION TYPES THAT PRODUCE MEANINGFUL TEST STEPS
// ─────────────────────────────────────────────────────────────────────────────

const ACTIONABLE_TYPES = new Set(['click', 'input', 'submit', 'custom-select']);

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

    const tag    = anchor.slice(0, colonIdx).toLowerCase();
    const rest   = anchor.slice(colonIdx + 1);
    const eqIdx  = rest.indexOf('=');
    if (eqIdx === -1) continue;

    const attrType = rest.slice(0, eqIdx);   // "text", "id", "name", "role"
    const attrVal  = rest.slice(eqIdx + 1);  // "Log out", "submit", etc.

    if (!attrVal || attrVal.length < 2) continue;

    let assertionType: AssertionType = 'element_visible';
    let selector = '';

    switch (attrType) {
      case 'text':
        // Playwright: getByText() or getByRole() with name
        selector       = `${tag}:has-text("${attrVal}")`;
        assertionType  = 'element_visible';
        break;
      case 'testid':
        selector      = `[data-testid="${attrVal}"]`;
        assertionType = 'element_visible';
        break;
      case 'id':
        selector      = `#${attrVal}`;
        assertionType = 'element_visible';
        break;
      case 'name':
        selector      = `[name="${attrVal}"]`;
        assertionType = 'element_visible';
        break;
      case 'role':
        selector      = `[role="${attrVal}"]`;
        assertionType = 'element_visible';
        break;
      default:
        selector      = `${tag}[${attrType}="${attrVal}"]`;
        assertionType = 'element_visible';
    }

    assertions.push({
      type:       assertionType,
      value:      attrVal,
      selector,
      source:     'anchor',
      confidence: confidence * 0.9, // Slightly lower than URL confidence
    });
  }

  return assertions;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECTOR EXTRACTION
// Fingerprint is stored as JSON in event payload.
// ─────────────────────────────────────────────────────────────────────────────

interface FingerprintData {
  selector?: string;
  selectorPriority?: string;
  textExcerpt?: string | null;
  attributes?: Record<string, string>;
  attributesHash?: string;
}

function extractFingerprint(payloadJson: string | null): FingerprintData | null {
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson);
    return payload.fingerprint || null;
  } catch {
    return null;
  }
}

function normalizeSelectorPriority(raw: string | undefined): SelectorPriority {
  const valid: SelectorPriority[] = [
    'data-testid', 'id', 'attribute', 'class', 'path', 'text', 'xpath',
  ];
  return (valid.includes(raw as SelectorPriority) ? raw : 'unknown') as SelectorPriority;
}

function extractValue(payloadJson: string | null, eventType: string): string | undefined {
  if (!payloadJson) return undefined;
  try {
    const payload = JSON.parse(payloadJson);

    // custom-select: use the selection label
    if (eventType === 'custom-select' && payload.selection?.label) {
      return payload.selection.label;
    }

    // input: use masked value or length hint
    if (eventType === 'input') {
      if (payload.inputValueMasked) {
        // Fix (Hallucination Trap): [REDACTED] means sensitive field (password, SSN etc).
        // Returning it literally causes AI to emit: .fill('[REDACTED]') which breaks tests.
        // Signal the AI to generate appropriate mock data instead.
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

function computeFpHash(fp: FingerprintData, eventType: string): string {
    const raw = [
      fp.selector       || '',
      fp.textExcerpt    || '',
      fp.attributesHash || '',
      eventType
    ].join('|');
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class CodegenService {
  private db: Database.Database;

  constructor(private options: CodegenServiceOptions) {
    this.db = new Database(options.dbPath, { readonly: true });
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
    // Only actionable types — skip network, outcome, scroll (default), hover (default)
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
    // Fix: extract fingerprint hashes from session events in JS, then query
    // edges by those hashes — correctly finds edges across all sessions.

    // Extract all fingerprint hashes from session event payloads
    const sessionFpHashes = new Set<string>();
    const sessionEventIds = new Set<string>();
    for (const ev of events) {
      if (ev.eventId) sessionEventIds.add(ev.eventId);
      const fp = extractFingerprint(ev.payload);
      const recomputed = computeFpHash(fp, ev.eventType);
      sessionFpHashes.add(recomputed);
    }

    const fpHashList  = Array.from(sessionFpHashes);
    const eventIdList = Array.from(sessionEventIds);

    // Query edges by fingerprint_hash OR trigger_event_id (belt and suspenders)
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

    // Deduplicate edges and key by fingerprint_hash
    // Keep the highest-confidence (navigation > others) edge per fingerprint

    // Build TWO lookup maps in a single pass
    const edgeByEventId = new Map<string, any>();
    const edgeByFingerprint = new Map<string, any>();
    
    const outcomeTypePriority: Record<string, number> = {
      navigation: 3, state_refresh: 2, no_change: 1, immediate_action: 0
    };

    for (const edge of allEdgeRows) {
      const newPriority = outcomeTypePriority[edge.outcomeType] ?? -1;

      // Map 1: By exact Event ID (Current Session)
      if (edge.triggerEventId) {
        const existingEvent = edgeByEventId.get(edge.triggerEventId);
        const oldEventPriority = outcomeTypePriority[existingEvent?.outcomeType] ?? -1;
        if (!existingEvent || newPriority > oldEventPriority) {
          edgeByEventId.set(edge.triggerEventId, edge);
        }
      }

      // Map 2: By Fingerprint Hash (Historical Sessions)
      if (edge.fingerprintHash) {
        const existingFp = edgeByFingerprint.get(edge.fingerprintHash);
        const oldFpPriority = outcomeTypePriority[existingFp?.outcomeType] ?? -1;
        if (!existingFp || newPriority > oldFpPriority) {
          edgeByFingerprint.set(edge.fingerprintHash, edge);
        }
      }
    }
    
    // Extract unique edges for graph calculations (keeps flowConfidence accurate)
    const edgeRows = Array.from(edgeByFingerprint.values());

    // ── 4. Load destination nodes for navigation edges ──────────────────────
    const navEdges = edgeRows.filter(e => e.outcomeType === 'navigation');
    const toNodeIds = Array.from(new Set(navEdges.map(e => e.toNodeId).filter(Boolean)));

    const nodeMap = new Map<string, any>();
    if (toNodeIds.length > 0) {
      const nodePlaceholders = toNodeIds.map(() => '?').join(', ');
      const nodes = this.db.prepare(`
        SELECT id, page_url, page_title, anchors
        FROM nodes
        WHERE id IN (${nodePlaceholders})
      `).all(...toNodeIds) as any[];
      for (const node of nodes) {
        nodeMap.set(node.id, node);
      }
    }

    // ── 5. Build steps ───────────────────────────────────────────────────────
    const steps: CodegenStep[] = [];
    let stepNum = 0;
    const minConfidence = this.options.minConfidence ?? 0.0;

    for (const ev of events) {
      if (!ACTIONABLE_TYPES.has(ev.eventType)) continue;

      const fingerprint = extractFingerprint(ev.payload);
      if (!fingerprint?.selector) continue;

      // Look up edge by fingerprint attributesHash — works across all sessions
      const recomputedHash = computeFpHash(fingerprint, ev.eventType);
      const edge = edgeByEventId.get(ev.eventId) || edgeByFingerprint.get(recomputedHash);
      const confidence = edge?.probability ?? 1.0;

      if (confidence < minConfidence) continue;

      stepNum++;

      // Fix 1: strip double underscores from intent
      // Caused by old intent detector producing _username → click__username
      // Synthesize intent directly from the selector and action type
      const safeSelectorName = fingerprint.selector.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').substring(0, 20);
      const rawIntent = `${ev.eventType}_${safeSelectorName}`.replace(/_$/, '');

      const step: CodegenStep = {
        step:             stepNum,
        intent:           rawIntent,
        action:           ev.eventType as ActionType,
        selector:         fingerprint.selector,
        selectorPriority: normalizeSelectorPriority(fingerprint.selectorPriority),
        pageUrl:          ev.pageUrl || '',
        confidence,
        sampleSize:       edge?.sampleSize ?? 1,
        assertions:       [],   // populated below if outcomeType=navigation
        userAssertions:   [],   // stub — Phase 2
      };

      // Value for input/select actions
      const value = extractValue(ev.payload, ev.eventType);
      if (value) step.value = value;

      // Outcome information + step-level assertions
      if (edge) {
        step.outcomeType = edge.outcomeType;

        if (edge.outcomeType === 'navigation' && edge.toNodeId) {
          const destNode = nodeMap.get(edge.toNodeId);
          if (destNode?.page_url) {
            step.navigatesTo = destNode.page_url;
          }

          // Fix (Regression): Assertions belong on the step where navigation
          // occurs, not at the session root. This ensures multi-step flows
          // like Login → Dashboard → Settings emit mid-flow assertions at each
          // navigation boundary, not just a single assertion at the very end.
          if (destNode) {
            step.assertions = parseAnchorsToAssertions(
              destNode.anchors,
              destNode.page_url,
              edge.probability ?? 1.0
            );
          }

          // User-defined assertions for this step (stub — Phase 2)
          step.userAssertions = hasUserAssertionSupport(this.db)
            ? getUserDefinedAssertions(sessionId, this.db)
            : [];
        }
      }

      // Fix 2: Consecutive duplicate filter
      // Same selector + action consecutively = user re-focused or stash/beacon
      // sent same event twice with different IDs. Keep the last one — it
      // carries the final committed value (correction wins over original typo).
      const prevStep = steps[steps.length - 1];
      if (
        prevStep &&
        prevStep.selector === step.selector &&
        prevStep.action   === step.action
      ) {
        // Replace previous step with current — current is the authoritative one
        // Re-number to keep step numbers consistent
        step.step = prevStep.step;
        steps[steps.length - 1] = step;
        stepNum--; // don't advance step counter
      } else {
        steps.push(step);
      }
    }

    // ── 6. (No root-level assertions — they live on steps now) ───────────────
    // Each navigation step carries its own assertions derived from the
    // destination node's anchor fingerprints. This correctly models
    // multi-step flows where assertions are needed at each page transition.

    // ── 8. Flow confidence — average probability of navigation edges ─────────
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
      stepCount:      steps.length,
      steps,
      flowConfidence,
      nodeCount:      visitedNodes.size,
    };
  }

  public close(): void {
    this.db.close();
  }
}