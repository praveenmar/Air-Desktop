import { describe, expect, it } from 'vitest';
import { selectSnapshotForStep, type SnapshotInventory, type SnapshotHandle } from '../src/snapshot-selector';
import type { CodegenStep } from '../src/types';
import { parseHTML } from 'linkedom';

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

function makeHtmlDocument(html: string): Document {
  const { document } = parseHTML(html);
  const elements = [document.documentElement, ...Array.from(document.querySelectorAll('*'))] as Array<Element & {
    offsetParent?: unknown;
    getBoundingClientRect?: () => DOMRect;
  }>;
  for (const element of elements) {
    if (!element) continue;
    element.offsetParent = {};
    element.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      top: 0,
      right: 10,
      bottom: 10,
      left: 0,
      toJSON() {
        return this;
      },
    } as DOMRect);
  }
  return document as unknown as Document;
}

function makeRawHtmlDocument(html: string): Document {
  const { document } = parseHTML(html);
  return document as unknown as Document;
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

  it('selects a richer snapshot for weak class-only input label proof when event-local lacks label structure', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body>
        <div class="field"><input class="oxd-input" type="text" /></div>
      </body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Username</label>
          <div class="input-slot"><input class="oxd-input" type="text" /></div>
        </div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('source-node-snapshot');
    expect(result.provenance.labelStructureEvidence).toBe(true);
    expect(result.provenance.labelStructureEvidenceReason).toBe('bounded_label_structure');
    expect(result.provenance.labelContextSnapshotSource).toBe('source-node-snapshot');
    expect(result.evaluatedCandidates[0]).toEqual(expect.objectContaining({
      source: 'event-local-pageState',
      selected: false,
      labelStructureEvidence: false,
      labelStructureEvidenceReason: 'label_missing',
    }));
    expect(result.evaluatedCandidates[2]).toEqual(expect.objectContaining({
      source: 'source-node-snapshot',
      selected: true,
      labelStructureEvidence: true,
    }));
  });

  it('selects a richer label-proof snapshot from parsed DOM without layout visibility hints', () => {
    const eventLocal = makeRawHtmlDocument(`
      <html><body>
        <div class="field"><input class="oxd-input" type="text" /></div>
      </body></html>
    `);
    const sourceNode = makeRawHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Username</label>
          <div class="input-slot"><input class="oxd-input" type="text" /></div>
        </div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('source-node-snapshot');
    expect(result.provenance.labelStructureEvidence).toBe(true);
    expect(result.evaluatedCandidates[0]).toEqual(expect.objectContaining({
      source: 'event-local-pageState',
      targetPresent: true,
      snapshotTargetEvidenceReason: 'selector_match',
      labelStructureEvidence: false,
      labelStructureEvidenceReason: 'label_missing',
    }));
    expect(result.evaluatedCandidates[2]).toEqual(expect.objectContaining({
      source: 'source-node-snapshot',
      selected: true,
      targetPresent: true,
      labelStructureEvidence: true,
      labelStructureEvidenceReason: 'bounded_label_structure',
    }));
  });

  it('bypasses label-context snapshot competition for strong direct selectors', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body><input placeholder="Search" type="text" /></body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Search</label>
          <div class="input-slot"><input placeholder="Search" type="text" /></div>
        </div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Search',
        selector: 'input[placeholder="Search"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        fingerprint: {
          selector: 'input[placeholder="Search"]',
          selectorPriority: 'attribute',
          selectorRank: 3,
          tagName: 'input',
          attributes: {
            placeholder: 'Search',
            fieldLabelText: 'Search',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.provenance.labelStructureEvidence).toBeUndefined();
    expect(result.evaluatedCandidates[0]?.selected).toBe(true);
    expect(result.evaluatedCandidates[2]?.skipReason).toBe('higher_priority_candidate_already_selected');
  });

  it.each([
    {
      title: 'data-testid',
      selector: '[data-testid="username"]',
      priority: 'data-testid',
      attributes: { dataTestId: 'username', fieldLabelText: 'Username', type: 'text' },
    },
    {
      title: 'name',
      selector: 'input[name="username"]',
      priority: 'attribute',
      attributes: { name: 'username', fieldLabelText: 'Username', type: 'text' },
    },
    {
      title: 'aria-label',
      selector: 'input[aria-label="Username"]',
      priority: 'attribute',
      attributes: { ariaLabel: 'Username', fieldLabelText: 'Username', type: 'text' },
    },
  ])('keeps label-context snapshot competition disabled for strong direct selector: $title', ({ selector, priority, attributes }) => {
    const eventLocal = makeHtmlDocument(`
      <html><body><input data-testid="username" name="username" aria-label="Username" /></body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <div class="field-row"><label>Username</label><input data-testid="username" name="username" aria-label="Username" /></div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector,
        selectorPriority: priority as any,
        selectorRank: 3,
        fingerprint: {
          selector,
          selectorPriority: priority as any,
          selectorRank: 3,
          tagName: 'input',
          attributes,
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.provenance.labelStructureEvidence).toBeUndefined();
  });

  it('never activates label-context snapshot competition for href/link actions', () => {
    const eventLocal = makeHtmlDocument(`<html><body><a href="/admin">Admin</a></body></html>`);
    const sourceNode = makeHtmlDocument(`<html><body><nav><label>Admin</label><a href="/admin">Admin</a></nav></body></html>`);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'click',
        intent: 'click_Admin',
        selector: 'a[href="/admin"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        fingerprint: {
          selector: 'a[href="/admin"]',
          selectorPriority: 'attribute',
          selectorRank: 3,
          tagName: 'a',
          attributes: {
            href: '/admin',
            fieldLabelText: 'Admin',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.labelStructureEvidence).toBeUndefined();
  });

  it('does not claim label evidence when duplicate labels make the structure ambiguous', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body><input class="oxd-input" type="text" /></body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <div class="field-row"><label>Username</label><input class="oxd-input" type="text" /></div>
        <div class="field-row"><label>Username</label><input class="oxd-input" type="text" /></div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.provenance.labelStructureEvidence).toBe(false);
    expect(result.provenance.labelContextBlockedReason).toBe('label_missing');
    expect(result.evaluatedCandidates[2]).toEqual(expect.objectContaining({
      source: 'source-node-snapshot',
      selected: false,
      labelStructureEvidence: false,
      labelStructureEvidenceReason: 'target_selector_ambiguous',
    }));
  });

  it('does not claim label evidence when the bounded container has multiple inputs', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body><input class="oxd-input" type="text" /></body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Employee Id</label>
          <input class="oxd-input" type="text" />
          <input class="oxd-input" type="text" />
        </div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Employee_Id',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Employee Id',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.evaluatedCandidates[2]).toEqual(expect.objectContaining({
      source: 'source-node-snapshot',
      selected: false,
      labelStructureEvidence: false,
      labelStructureEvidenceReason: 'target_selector_ambiguous',
    }));
  });

  it('treats custom select triggers as competing input-like controls inside a bounded container', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body><input class="oxd-input" type="text" /></body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Username</label>
          <input class="oxd-input" type="text" />
          <div role="combobox" aria-haspopup="listbox">Open</div>
        </div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.evaluatedCandidates[2]).toEqual(expect.objectContaining({
      source: 'source-node-snapshot',
      selected: false,
      labelStructureEvidence: false,
      labelStructureEvidenceReason: 'multiple_input_like_targets',
    }));
  });

  it('does not treat broad container text as label structure evidence', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body><input class="oxd-input" type="text" /></body></html>
    `);
    const sourceNode = makeHtmlDocument(`
      <html><body>
        <section>
          <div>Username</div>
          <div class="stack">
            <div>Helper text</div>
            <div><input class="oxd-input" type="text" /></div>
          </div>
        </section>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });
    inventory.sourceNodeById.set(
      'node-1',
      handle('source-node-snapshot', 'pre_action', sourceNode, {
        sourceNodeId: 'node-1',
        timestamp: 990,
        tabId: 'tab-1',
      }),
    );

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.evaluatedCandidates[2]).toEqual(expect.objectContaining({
      source: 'source-node-snapshot',
      selected: false,
      labelStructureEvidence: false,
      labelStructureEvidenceReason: 'label_missing',
    }));
  });

  it('reports target selector ambiguity when a weak class selector binds to multiple visible targets', () => {
    const eventLocal = makeHtmlDocument(`
      <html><body>
        <label>Username</label>
        <input class="oxd-input" type="text" />
        <input class="oxd-input" placeholder="Search" type="text" />
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        eventId: 'ev-1',
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.labelStructureEvidence).toBe(false);
    expect(result.provenance.labelContextBlockedReason).toBe('target_selector_ambiguous');
  });

  it('reports target visibility mismatch instead of generic target_missing when selector exists but only hidden targets match', () => {
    const eventLocal = makeRawHtmlDocument(`
      <html><body>
        <div class="field-row">
          <label>Username</label>
          <div class="input-slot"><input class="oxd-input" type="text" hidden /></div>
        </div>
      </body></html>
    `);
    const inventory = emptyInventory();
    inventory.eventLocalByEventId.set('ev-1', {
      pageState: handle('event-local-pageState', 'action_local', eventLocal, {
        eventId: 'ev-1',
        timestamp: 1000,
        tabId: 'tab-1',
      }),
    });

    const result = selectSnapshotForStep(
      baseStep({
        action: 'input',
        intent: 'input_Username',
        selector: '.oxd-input',
        selectorPriority: 'class',
        selectorRank: 7,
        fingerprint: {
          selector: '.oxd-input',
          selectorPriority: 'class',
          selectorRank: 7,
          tagName: 'input',
          attributes: {
            class: 'oxd-input',
            fieldLabelText: 'Username',
            type: 'text',
          },
        },
      }),
      inventory,
      'action',
    );

    expect(result.provenance.source).toBe('event-local-pageState');
    expect(result.provenance.snapshotTargetEvidence).toBe(true);
    expect(result.provenance.labelStructureEvidence).toBe(false);
    expect(result.provenance.labelStructureEvidenceReason).toBe('target_visibility_mismatch');
    expect(result.provenance.labelContextBlockedReason).toBe('target_visibility_mismatch');
  });
});
