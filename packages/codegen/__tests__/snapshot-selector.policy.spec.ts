import { describe, expect, it } from 'vitest';
import { selectSnapshotForStep, type SnapshotInventory, type SnapshotHandle } from '../src/snapshot-selector';
import type { CodegenStep } from '../src/types';

function makeDocument(
  selectorMap: Record<string, Element[]>,
  html = '<html><body></body></html>'
): Document {
  return {
    querySelectorAll(selector: string) {
      if (!Object.prototype.hasOwnProperty.call(selectorMap, selector)) {
        throw new Error(`Unknown selector in test doc: ${selector}`);
      }
      return selectorMap[selector];
    },
    querySelector(selector: string) {
      return selectorMap[selector]?.[0] ?? null;
    },
    documentElement: { outerHTML: html },
    body: { outerHTML: html },
  } as unknown as Document;
}

function makeElement(attrs: Record<string, string> = {}, text = ''): Element {
  return {
    textContent: text,
    parentElement: null,
    attrs,
    hasAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    getAttribute(name: string) {
      return attrs[name] ?? null;
    },
    getBoundingClientRect() {
      return { width: 10, height: 10 };
    },
    offsetParent: {},
  } as unknown as Element;
}

function handle(
  source: SnapshotHandle['source'],
  temporalClass: SnapshotHandle['temporalClass'],
  doc: Document,
  overrides: Partial<SnapshotHandle> = {},
): SnapshotHandle {
  return {
    source,
    temporalClass,
    load: () => doc,
    ...overrides,
  };
}

function baseStep(overrides: Partial<CodegenStep> = {}): CodegenStep {
  return {
    step: 1,
    eventId: 'ev-1',
    traceId: 'trace-1',
    timestamp: 1000,
    tabId: 'tab-1',
    intent: 'click_save',
    action: 'click',
    selector: '[name="email"]',
    selectorPriority: 'attribute',
    selectorRank: 3,
    sourceNodeId: 'node-1',
    assertions: [],
    userAssertions: [],
    confidence: 1,
    sampleSize: 1,
    pageUrl: 'https://app.test/profile',
    normalizedUrl: 'https://app.test/profile',
    ...overrides,
  };
}

function emptyInventory(): SnapshotInventory {
  return {
    snapshotEngineAvailable: true,
    hardBoundaries: [],
    icBoundaryToleranceMs: 75,
    eventLocalByEventId: new Map(),
    interactionContextExactStable: new Map(),
    interactionContextExactAny: new Map(),
    interactionContextStableByUrl: new Map(),
    interactionContextAnyByUrl: new Map(),
    outcomeEventByTraceId: new Map(),
    sourceNodeById: new Map(),
    destinationNodeById: new Map(),
    urlEventFallbackByNormalizedUrl: new Map(),
  };
}

describe('snapshot-selector IC policy', () => {
  it('marks event-local snapshot target evidence when original target is present', () => {
    const doc = makeDocument({
      '[name="email"]': [makeElement({ name: 'email' }, 'Email')],
      '*': [makeElement({ name: 'email' }, 'Email')],
    });
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', doc, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });

    const result = selectSnapshotForStep(baseStep(), inventory, 'action');

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.provenance.snapshotTargetEvidence).toBe(true);
    expect(result.provenance.snapshotTargetEvidenceReason).toBe('selector_match');
  });

  it('keeps exact interaction-context snapshot valid when target evidence exists', () => {
    const doc = makeDocument({
      '[name="email"]': [makeElement({ name: 'email' }, 'Email')],
      '*': [makeElement({ name: 'email' }, 'Email')],
    });
    const inventory = emptyInventory();
    inventory.interactionContextExactAny.set(
      'https://app.test/profile|sig-1',
      handle('interaction-context-exact', 'post_action', doc, {
        timestamp: 1001,
        tabId: 'tab-1',
        normalizedUrl: 'https://app.test/profile',
        controlSignature: 'sig-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({ controlSignature: 'sig-1', sourceNodeId: undefined, eventId: undefined }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('interaction-context-exact');
    expect(result.provenance.snapshotTargetEvidence).toBe(true);
  });

  it('falls through target-missing action snapshots and surfaces missing-target fallback explicitly', () => {
    const sourceDoc = makeDocument({
      '[name="email"]': [],
      '*': [makeElement({ placeholder: 'Search', type: 'search' })],
    });
    const inventory = emptyInventory();
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceDoc, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        selector: 'div > div:nth-of-type(1)',
        selectorPriority: 'path',
        selectorRank: 10,
        intent: 'click_Select',
        fingerprint: {
          selector: 'div > div:nth-of-type(1)',
          selectorPriority: 'path',
          selectorRank: 10,
          tagName: 'div',
          textExcerpt: '-- Select --',
          attributes: {},
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('source-node-snapshot');
    expect(result.provenance.snapshotTargetEvidence).toBe(false);
    expect(result.provenance.snapshotTargetEvidenceReason).toBe('target_missing_in_snapshot');
  });

  it('treats closed shadow hosts as intentional degraded target-missing fallbacks', () => {
    const doc = makeDocument({
      '[name="email"]': [],
      '*': [makeElement({}, 'Profile')],
    });
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', doc, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });

    const result = selectSnapshotForStep(
      baseStep({
        nestedContext: {
          isShadowDom: true,
          isIframe: true,
          degradedReason: 'probable_closed_shadow_host',
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.provenance.snapshotTargetEvidence).toBe(false);
    expect(result.provenance.snapshotTargetEvidenceReason).toBe('closed_shadow_dom_unobservable');
    expect(result.evaluatedCandidates[0]).toEqual(expect.objectContaining({
      selected: true,
      shadowDegraded: true,
      skipReason: 'closed_shadow_dom_unobservable',
    }));
  });

  it('skips exact IC when controlSignature is missing and downgrades stable-by-url fallback', () => {
    const doc = makeDocument({
      '[name="email"]': [makeElement({ name: 'email' }, 'Email')],
      '*': [makeElement({ name: 'email' }, 'Email')],
    });
    const inventory = emptyInventory();
    inventory.interactionContextStableByUrl.set(
      'https://app.test/profile',
      handle('interaction-context-stable-by-url', 'post_action', doc, {
        timestamp: 980,
        normalizedUrl: 'https://app.test/profile',
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(baseStep({ controlSignature: undefined, sourceNodeId: undefined }), inventory, 'action');

    expect(result.provenance.source).toBe('interaction-context-stable-by-url');
    expect(result.provenance.confidenceScore).toBeLessThanOrEqual(0.3);
    expect(result.evaluatedCandidates[3]?.skipReason).toBe('exact_ic_skipped_missing_control_signature');
    expect(result.evaluatedCandidates[4]?.selected).toBe(true);
    expect(result.evaluatedCandidates[4]?.skipReason).toBeUndefined();
  });

  it('keeps outcome post-boundary IC valid', () => {
    const doc = makeDocument({
      '[name="email"]': [],
      '*': [makeElement({}, 'Dashboard')],
    });
    const inventory = emptyInventory();
    inventory.hardBoundaries.push({
      timestamp: 1020,
      kind: 'navigation',
      tabId: 'tab-1',
    });
    inventory.interactionContextExactStable.set(
      'https://app.test/profile|sig-dest',
      handle('interaction-context-exact', 'outcome_state', doc, {
        timestamp: 1100,
        tabId: 'tab-1',
        normalizedUrl: 'https://app.test/profile',
        controlSignature: 'sig-dest',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        controlSignature: 'sig-dest',
        outcomeType: 'navigation',
        destinationNodeId: 'node-dest',
      }),
      inventory,
      'outcome',
    );

    expect(result.provenance.source).toBe('interaction-context-exact');
    expect(result.provenance.temporalClass).toBe('outcome_state');
    expect(result.provenance.reason).toBe('selected_ic_exact_stable_for_outcome_state');
    expect(result.evaluatedCandidates[0]?.selected).toBe(true);
    expect(result.evaluatedCandidates[0]?.skipReason).toBeUndefined();
  });

  it('keeps outcome snapshot selection permissive even when original action target is absent', () => {
    const doc = makeDocument({
      '[name="email"]': [],
      '*': [makeElement({}, 'Dashboard')],
    });
    const inventory = emptyInventory();
    inventory.destinationNodeById.set(
      'node-dest',
      handle('destination-node-snapshot', 'outcome_state', doc, {
        sourceNodeId: 'node-dest',
        timestamp: 1100,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        outcomeType: 'navigation',
        destinationNodeId: 'node-dest',
      }),
      inventory,
      'outcome',
    );

    expect(result.provenance.source).toBe('destination-node-snapshot');
    expect(result.evaluatedCandidates.some(candidate => candidate.selected)).toBe(true);
  });
});
