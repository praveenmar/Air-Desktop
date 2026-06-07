import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { 
  CodegenService,
  normalizeSelectorPriority,
  rankFromPriority,
  collapseRedundantClickBeforeInput,
  compressDuplicateSubmitAfterClick,
  compressCustomControlOpenSelectPairs,
  suppressPreNavSetupClicks,
  deduplicateSharedAssertions,
} from '../src/codegen.service';
import { CodegenStep, CodegenAssertion } from '../src/types';

const createStep = (overrides: Partial<CodegenStep> = {}): CodegenStep => ({
  step: 1,
  intent: 'test',
  action: 'click',
  selector: '#test',
  selectorPriority: 'unknown',
  selectorRank: 10,
  pageUrl: 'http://example.com',
  confidence: 1,
  sampleSize: 1,
  assertions: [],
  userAssertions: [],
  ...overrides,
});

afterEach(() => {
  vi.restoreAllMocks();
});

function buildSessionFromEventRows(rows: Array<{
  eventId: string;
  eventType: string;
  timestamp: number;
  pageUrl: string;
  traceId: string;
  nodeId: string | null;
  payload: string;
}>, buildOptions: { preserveCompoundOpenSteps?: boolean } = {}) {
  const fakeDb = {
    prepare(sql: string) {
      if (sql.includes('FROM sessions')) {
        return {
          get: () => ({
            id: 'session-test',
            started_at: 1_700_000_000_000,
          }),
        };
      }

      if (sql.includes('FROM events e')) {
        return {
          all: () => rows,
        };
      }

      if (sql.includes('WHERE ed.fingerprint_hash IN')) {
        return { all: () => [] };
      }

      if (sql.includes('WHERE ed.trigger_event_id IN')) {
        return { all: () => [] };
      }

      if (sql.includes('SELECT control_signature AS controlSignature')) {
        return { get: () => undefined };
      }

      if (sql.includes('FROM nodes')) {
        return {
          all: () => [],
          get: () => undefined,
        };
      }

      return {
        get: () => undefined,
        all: () => [],
      };
    },
    close() {
      return undefined;
    },
  };

  const service = Object.create(CodegenService.prototype) as any;
  service.db = fakeDb;
  service.options = {
    dbPath: ':memory:',
    minConfidence: 0,
    includeScrollSteps: false,
    includeHoverSteps: false,
  };

  return (service as CodegenService).buildSession('session-test', buildOptions);
}

describe('CodegenService - Priority & Rank', () => {
  it('safely handles legacy DB rows missing a selectorPriority', () => {
    expect(normalizeSelectorPriority(undefined)).toBe('unknown');
    expect(rankFromPriority('unknown')).toBe(10);
  });

  it('preserves valid semantic priorities and assigns correct rank', () => {
    expect(normalizeSelectorPriority('data-testid')).toBe('data-testid');
    expect(rankFromPriority('data-testid')).toBe(1);

    expect(normalizeSelectorPriority('id')).toBe('id');
    expect(rankFromPriority('id')).toBe(2);

    expect(normalizeSelectorPriority('attribute')).toBe('attribute');
    expect(rankFromPriority('attribute')).toBe(3);

    expect(normalizeSelectorPriority('class')).toBe('class');
    expect(rankFromPriority('class')).toBe(7);

    expect(normalizeSelectorPriority('text')).toBe('text');
    expect(rankFromPriority('text')).toBe(8);

    expect(normalizeSelectorPriority('path')).toBe('path');
    expect(rankFromPriority('path')).toBe(10);

    expect(normalizeSelectorPriority('xpath')).toBe('xpath');
    expect(rankFromPriority('xpath')).toBe(10);

    expect(normalizeSelectorPriority('other')).toBe('other');
    expect(rankFromPriority('other')).toBe(10);

    expect(normalizeSelectorPriority('chained')).toBe('chained');
    expect(rankFromPriority('chained')).toBe(10);
  });
});

describe('CodegenService - Pre‑Navigation Suppression', () => {
  it('removes fragile setup click that precedes a navigation on same page', () => {
    const steps: CodegenStep[] = [
      createStep({ step: 1, selectorPriority: 'class', outcomeType: 'immediate_action', pageUrl: '/dashboard' }),
      createStep({ step: 2, selectorPriority: 'data-testid', outcomeType: 'navigation', pageUrl: '/dashboard' }),
    ];

    const filtered = suppressPreNavSetupClicks(steps);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].step).toBe(2);
  });

  it('keeps fragile click if it causes state_refresh (not immediate_action)', () => {
    const steps: CodegenStep[] = [
      createStep({ step: 1, selectorPriority: 'class', outcomeType: 'state_refresh', pageUrl: '/settings' }),
    ];

    const filtered = suppressPreNavSetupClicks(steps);
    expect(filtered).toHaveLength(1);
  });

  it('removes trailing fragile click with no further steps on same page', () => {
    const steps: CodegenStep[] = [
      createStep({ step: 1, selectorPriority: 'class', outcomeType: 'immediate_action', pageUrl: '/dashboard' }),
    ];

    const filtered = suppressPreNavSetupClicks(steps);
    expect(filtered).toHaveLength(0);
  });

  it('does NOT remove fragile click if navigation appears after LOOKAHEAD_WINDOW steps', () => {
    // Build steps: fragile click then 5 steps of other actions (e.g., inputs) then navigation
    const steps: CodegenStep[] = [
      createStep({ step: 1, selectorPriority: 'class', outcomeType: 'immediate_action', pageUrl: '/dashboard' }),
      createStep({ step: 2, action: 'input', selectorPriority: 'id', outcomeType: 'no_change', pageUrl: '/dashboard' }),
      createStep({ step: 3, action: 'input', selectorPriority: 'id', outcomeType: 'no_change', pageUrl: '/dashboard' }),
      createStep({ step: 4, action: 'input', selectorPriority: 'id', outcomeType: 'no_change', pageUrl: '/dashboard' }),
      createStep({ step: 5, action: 'input', selectorPriority: 'id', outcomeType: 'no_change', pageUrl: '/dashboard' }),
      createStep({ step: 6, action: 'input', selectorPriority: 'id', outcomeType: 'no_change', pageUrl: '/dashboard' }),
      createStep({ step: 7, selectorPriority: 'data-testid', outcomeType: 'navigation', pageUrl: '/dashboard' }),
    ];

    const filtered = suppressPreNavSetupClicks(steps);
    // The fragile click should be kept because navigation is beyond LOOKAHEAD_WINDOW (4)
    expect(filtered).toHaveLength(7);
  });

  it('does NOT remove non‑fragile click even if it is immediate_action', () => {
    const steps: CodegenStep[] = [
      createStep({ step: 1, selectorPriority: 'data-testid', outcomeType: 'immediate_action', pageUrl: '/dashboard' }),
      createStep({ step: 2, selectorPriority: 'data-testid', outcomeType: 'navigation', pageUrl: '/dashboard' }),
    ];

    const filtered = suppressPreNavSetupClicks(steps);
    expect(filtered).toHaveLength(2); // both kept
  });

  it('keeps custom-control-open when preserveCompoundOpenSteps is true', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'custom-control-open',
        selectorPriority: 'class',
        outcomeType: 'immediate_action',
        pageUrl: '/dashboard',
      }),
      createStep({
        step: 2,
        action: 'custom-menu-select',
        selectorPriority: 'attribute',
        outcomeType: 'navigation',
        pageUrl: '/dashboard',
      }),
    ];

    const filtered = suppressPreNavSetupClicks(steps, { preserveCompoundOpenSteps: true });
    expect(filtered).toHaveLength(2);
    expect(filtered.map(step => step.action)).toEqual(['custom-control-open', 'custom-menu-select']);
  });
});

describe('CodegenService - Click/Input Collapse', () => {
  it('collapses immediate click->input on same selector/page/node', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        selector: 'input[name="username"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/login',
      }),
      createStep({
        step: 2,
        action: 'input',
        selector: 'input[name="username"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/login',
        value: '*****',
      }),
      createStep({
        step: 3,
        action: 'click',
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/login',
      }),
    ];

    const collapsed = collapseRedundantClickBeforeInput(steps);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].action).toBe('input');
    expect(collapsed[0].selector).toBe('input[name="username"]');
    expect(collapsed[1].action).toBe('click');
    expect(collapsed[1].selector).toBe('button[type="submit"]');
  });

  it('keeps click when next step selector differs', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        selector: 'input[name="username"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/login',
      }),
      createStep({
        step: 2,
        action: 'input',
        selector: 'input[name="password"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/login',
        value: '*****',
      }),
    ];

    const collapsed = collapseRedundantClickBeforeInput(steps);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].action).toBe('click');
    expect(collapsed[1].action).toBe('input');
  });

  it('keeps click when click has navigation semantics', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        selector: 'a[href="/dashboard"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/home',
        outcomeType: 'navigation',
        navigatesTo: 'https://example.com/dashboard',
      }),
      createStep({
        step: 2,
        action: 'input',
        selector: 'a[href="/dashboard"]',
        selectorPriority: 'attribute',
        sourceNodeId: 'node-1',
        normalizedUrl: 'https://example.com/home',
        value: '*****',
      }),
    ];

    const collapsed = collapseRedundantClickBeforeInput(steps);
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0].action).toBe('click');
  });
});

describe('CodegenService - Duplicate Submit Compression', () => {
  it('compresses adjacent click submit pair into one executable click action', () => {
    const submitAssertion: CodegenAssertion = {
      type: 'url',
      value: 'https://app.test/dashboard',
      source: 'url_change',
      confidence: 1,
    };

    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/login',
        normalizedUrl: 'https://app.test/login',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1000,
        fingerprint: {
          tagName: 'button',
          textExcerpt: 'Login',
          attributes: { type: 'submit' },
        },
        assertions: [{ type: 'element_visible', value: 'Login', selector: 'button:has-text("Login")', source: 'anchor', confidence: 0.8 }],
        userAssertions: [{ assertionIntent: 'see spinner', selector: '.spinner', checkType: 'visible' }],
      }),
      createStep({
        step: 2,
        action: 'submit',
        selector: '.login-form-shell',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/login',
        normalizedUrl: 'https://app.test/login',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1045,
        outcomeType: 'navigation',
        navigatesTo: 'https://app.test/dashboard',
        destinationNodeId: 'node-dashboard',
        fingerprint: {
          tagName: 'form',
          context: { nearestContainerTag: 'form' },
        },
        assertions: [submitAssertion],
        userAssertions: [{ assertionIntent: 'land on dashboard', selector: 'h1', expectedValue: 'Dashboard', checkType: 'text' }],
      }),
    ];

    const compressed = compressDuplicateSubmitAfterClick(steps);
    expect(compressed).toHaveLength(1);
    expect(compressed[0].action).toBe('click');
    expect(compressed[0].navigatesTo).toBe('https://app.test/dashboard');
    expect(compressed[0].destinationNodeId).toBe('node-dashboard');
    expect(compressed[0].outcomeType).toBe('navigation');
    expect(compressed[0].assertions).toHaveLength(2);
    expect(compressed[0].assertions).toContainEqual(submitAssertion);
    expect(compressed[0].userAssertions).toHaveLength(2);
  });

  it('dedupes identical assertions while preserving unique submit evidence', () => {
    const duplicateAssertion: CodegenAssertion = {
      type: 'url',
      value: 'https://app.test/results',
      source: 'url_change',
      confidence: 1,
    };

    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/search',
        normalizedUrl: 'https://app.test/search',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 2000,
        fingerprint: { tagName: 'button', textExcerpt: 'Search', attributes: { type: 'submit' } },
        assertions: [duplicateAssertion],
      }),
      createStep({
        step: 2,
        action: 'submit',
        selector: '.search-shell',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/search',
        normalizedUrl: 'https://app.test/search',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 2030,
        fingerprint: { tagName: 'form', context: { nearestContainerTag: 'form' } },
        assertions: [
          duplicateAssertion,
          { type: 'element_visible', value: 'Results', selector: 'h1:has-text("Results")', source: 'anchor', confidence: 0.9 },
        ],
      }),
    ];

    const compressed = compressDuplicateSubmitAfterClick(steps);
    expect(compressed).toHaveLength(1);
    expect(compressed[0].assertions).toHaveLength(2);
  });

  it('keeps submit when it is not adjacent to a meaningful click', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'input',
        selector: 'input[name="email"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/login',
        normalizedUrl: 'https://app.test/login',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1000,
      }),
      createStep({
        step: 2,
        action: 'submit',
        selector: '.form-shell',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/login',
        normalizedUrl: 'https://app.test/login',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1050,
        fingerprint: { tagName: 'form', context: { nearestContainerTag: 'form' } },
      }),
    ];

    expect(compressDuplicateSubmitAfterClick(steps)).toHaveLength(2);
  });

  it('keeps submit when trace differs', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'click',
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/login',
        normalizedUrl: 'https://app.test/login',
        traceId: 'trace-click',
        tabId: 'tab-1',
        timestamp: 1000,
        fingerprint: { tagName: 'button', textExcerpt: 'Login', attributes: { type: 'submit' } },
      }),
      createStep({
        step: 2,
        action: 'submit',
        selector: '.form-shell',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/login',
        normalizedUrl: 'https://app.test/login',
        traceId: 'trace-submit',
        tabId: 'tab-1',
        timestamp: 1010,
        fingerprint: { tagName: 'form', context: { nearestContainerTag: 'form' } },
      }),
    ];

    expect(compressDuplicateSubmitAfterClick(steps)).toHaveLength(2);
  });

  it('keeps submit when tab or page differs', () => {
    const baseClick = createStep({
      step: 1,
      action: 'click',
      selector: 'button[type="submit"]',
      selectorPriority: 'attribute',
      pageUrl: 'https://app.test/login',
      normalizedUrl: 'https://app.test/login',
      traceId: 'trace-1',
      tabId: 'tab-1',
      timestamp: 1000,
      fingerprint: { tagName: 'button', textExcerpt: 'Login', attributes: { type: 'submit' } },
    });
    const submitBase = createStep({
      step: 2,
      action: 'submit',
      selector: '.form-shell',
      selectorPriority: 'class',
      pageUrl: 'https://app.test/login',
      normalizedUrl: 'https://app.test/login',
      traceId: 'trace-1',
      tabId: 'tab-1',
      timestamp: 1010,
      fingerprint: { tagName: 'form', context: { nearestContainerTag: 'form' } },
    });

    expect(compressDuplicateSubmitAfterClick([
      baseClick,
      { ...submitBase, tabId: 'tab-2' },
    ])).toHaveLength(2);

    expect(compressDuplicateSubmitAfterClick([
      baseClick,
      { ...submitBase, normalizedUrl: 'https://app.test/other', pageUrl: 'https://app.test/other' },
    ])).toHaveLength(2);
  });

  it('keeps submit-only flow when no prior click exists', () => {
    const submitStep = createStep({
      step: 1,
      action: 'submit',
      selector: 'form[data-test="search"]',
      selectorPriority: 'attribute',
      pageUrl: 'https://app.test/search',
      normalizedUrl: 'https://app.test/search',
      traceId: 'trace-1',
      tabId: 'tab-1',
      timestamp: 1000,
      fingerprint: { tagName: 'form' },
    });

    expect(compressDuplicateSubmitAfterClick([submitStep])).toEqual([submitStep]);
  });
});

describe('CodegenService - Custom Control Open/Select Compression', () => {
  it('compresses immediate custom-control-open + custom-select pair into one semantic select step with preserved evidence', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'custom-control-open',
        intent: 'open_user_role',
        selector: '.custom-trigger',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1000,
        eventId: 'ev-open',
        controlFamily: 'combobox',
        triggerSelector: '.custom-trigger',
        triggerSelectorPriority: 'class',
        triggerSelectorSpec: {
          selector: '.custom-trigger',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 7,
        },
      }),
      createStep({
        step: 2,
        action: 'custom-select',
        intent: 'select_admin',
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1250,
        eventId: 'ev-select',
        controlFamily: 'combobox',
        optionSelector: '[role="option"]',
        optionText: 'Admin',
        optionValue: 'Admin',
        optionSelectorSpec: {
          selector: '[role="option"]',
          engine: 'css',
          source: 'interceptor',
          proofLevel: 'recorded',
          rank: 3,
        },
        value: 'Admin',
      }),
    ];

    const compressed = compressCustomControlOpenSelectPairs(steps);

    expect(compressed).toHaveLength(1);
    expect(compressed[0]).toEqual(expect.objectContaining({
      action: 'custom-select',
      triggerSelector: '.custom-trigger',
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      optionValue: 'Admin',
      absorbedOpenEventId: 'ev-open',
      absorbedOpenTraceId: 'trace-1',
      compressedFromEvents: ['ev-open', 'ev-select'],
    }));
    expect(compressed[0].triggerSelectorSpec).toEqual(expect.objectContaining({
      selector: '.custom-trigger',
      proofLevel: 'recorded',
    }));
    expect(compressed[0].optionSelectorSpec).toEqual(expect.objectContaining({
      selector: '[role="option"]',
      proofLevel: 'recorded',
    }));
  });

  it('keeps open-only controls separate', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'custom-control-open',
        selector: '.custom-trigger',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1000,
        controlFamily: 'combobox',
      }),
    ];

    expect(compressCustomControlOpenSelectPairs(steps)).toHaveLength(1);
  });

  it('does not compress autocomplete selection yet', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'custom-control-open',
        selector: '.autocomplete-trigger',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1000,
        controlFamily: 'autocomplete',
        triggerSelector: '.autocomplete-trigger',
      }),
      createStep({
        step: 2,
        action: 'custom-select',
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1200,
        controlFamily: 'autocomplete',
        optionSelector: '[role="option"]',
        optionText: 'Kori Bogisich',
      }),
    ];

    expect(compressCustomControlOpenSelectPairs(steps)).toHaveLength(2);
  });

  it('does not compress delayed menu selections', () => {
    const steps: CodegenStep[] = [
      createStep({
        step: 1,
        action: 'custom-control-open',
        selector: '.user-menu-trigger',
        selectorPriority: 'class',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 1000,
        controlFamily: 'menu',
        triggerSelector: '.user-menu-trigger',
      }),
      createStep({
        step: 2,
        action: 'custom-menu-select',
        selector: '[role="menuitem"]',
        selectorPriority: 'attribute',
        pageUrl: 'https://app.test/admin',
        normalizedUrl: 'https://app.test/admin',
        traceId: 'trace-1',
        tabId: 'tab-1',
        timestamp: 9000,
        controlFamily: 'menu',
        optionSelector: '[role="menuitem"]',
        optionText: 'Logout',
      }),
    ];

    expect(compressCustomControlOpenSelectPairs(steps)).toHaveLength(2);
  });
});

describe('CodegenService - Replay-Preserving Compound Open Steps', () => {
  it('preserves real custom-control-open steps in buildSession when preserveCompoundOpenSteps is true', () => {
    const makePayload = (payload: Record<string, unknown>) => JSON.stringify(payload);
    const pageUrl = 'https://app.test/admin';
    const menuUrl = 'https://app.test/profile';

    const session = buildSessionFromEventRows([
      {
        eventId: 'ev-open-role',
        eventType: 'custom-control-open',
        timestamp: 1_700_000_000_100,
        pageUrl,
        traceId: 'trace-role',
        nodeId: 'node-1',
        payload: makePayload({
          normalizedUrl: pageUrl,
          controlFamily: 'combobox',
          fingerprint: {
            selector: '.role-trigger',
            selectorPriority: 'class',
            selectorRank: 7,
            tagName: 'div',
            textExcerpt: 'User Role',
          },
        }),
      },
      {
        eventId: 'ev-select-role',
        eventType: 'custom-select',
        timestamp: 1_700_000_000_200,
        pageUrl,
        traceId: 'trace-role',
        nodeId: 'node-1',
        payload: makePayload({
          normalizedUrl: pageUrl,
          controlFamily: 'combobox',
          fingerprint: {
            selector: '[role="option"]',
            selectorPriority: 'attribute',
            selectorRank: 3,
            tagName: 'div',
            textExcerpt: 'Admin',
          },
          triggerFingerprint: {
            selector: '.role-trigger',
            selectorPriority: 'class',
            selectorRank: 7,
            tagName: 'div',
            textExcerpt: 'User Role',
          },
          selection: {
            label: 'Admin',
            value: 'Admin',
            index: 0,
          },
          meta: {
            triggerSelector: '.role-trigger',
          },
        }),
      },
      {
        eventId: 'ev-open-status',
        eventType: 'custom-control-open',
        timestamp: 1_700_000_000_300,
        pageUrl,
        traceId: 'trace-status',
        nodeId: 'node-1',
        payload: makePayload({
          normalizedUrl: pageUrl,
          controlFamily: 'combobox',
          fingerprint: {
            selector: '.status-trigger',
            selectorPriority: 'class',
            selectorRank: 7,
            tagName: 'div',
            textExcerpt: 'Status',
          },
        }),
      },
      {
        eventId: 'ev-select-status',
        eventType: 'custom-select',
        timestamp: 1_700_000_000_400,
        pageUrl,
        traceId: 'trace-status',
        nodeId: 'node-1',
        payload: makePayload({
          normalizedUrl: pageUrl,
          controlFamily: 'combobox',
          fingerprint: {
            selector: '[role="option"]',
            selectorPriority: 'attribute',
            selectorRank: 3,
            tagName: 'div',
            textExcerpt: 'Enabled',
          },
          triggerFingerprint: {
            selector: '.status-trigger',
            selectorPriority: 'class',
            selectorRank: 7,
            tagName: 'div',
            textExcerpt: 'Status',
          },
          selection: {
            label: 'Enabled',
            value: 'Enabled',
            index: 1,
          },
          meta: {
            triggerSelector: '.status-trigger',
          },
        }),
      },
      {
        eventId: 'ev-open-menu',
        eventType: 'custom-control-open',
        timestamp: 1_700_000_000_500,
        pageUrl: menuUrl,
        traceId: 'trace-menu',
        nodeId: 'node-2',
        payload: makePayload({
          normalizedUrl: menuUrl,
          controlFamily: 'menu',
          fingerprint: {
            selector: '.menu-trigger',
            selectorPriority: 'class',
            selectorRank: 7,
            tagName: 'button',
            textExcerpt: 'Profile',
          },
        }),
      },
      {
        eventId: 'ev-select-menu',
        eventType: 'custom-menu-select',
        timestamp: 1_700_000_000_600,
        pageUrl: menuUrl,
        traceId: 'trace-menu',
        nodeId: 'node-2',
        payload: makePayload({
          normalizedUrl: menuUrl,
          controlFamily: 'menu',
          fingerprint: {
            selector: '[role="menuitem"]',
            selectorPriority: 'attribute',
            selectorRank: 3,
            tagName: 'a',
            textExcerpt: 'Logout',
          },
          triggerFingerprint: {
            selector: '.menu-trigger',
            selectorPriority: 'class',
            selectorRank: 7,
            tagName: 'button',
            textExcerpt: 'Profile',
          },
          selection: {
            label: 'Logout',
            value: 'Logout',
            index: 2,
          },
          meta: {
            triggerSelector: '.menu-trigger',
          },
        }),
      },
    ], { preserveCompoundOpenSteps: true });

    expect(session.steps.map(step => step.action)).toEqual([
      'custom-control-open',
      'custom-select',
      'custom-control-open',
      'custom-select',
      'custom-control-open',
      'custom-menu-select',
    ]);
    expect(session.steps.map(step => step.eventId)).toEqual([
      'ev-open-role',
      'ev-select-role',
      'ev-open-status',
      'ev-select-status',
      'ev-open-menu',
      'ev-select-menu',
    ]);
  });
});

describe('CodegenService - Shared Assertion Deduplication', () => {
  it('removes assertions that appear on two or more different destination pages', () => {
    // Create two navigation steps to different pages, each with the same anchor assertion
    const assertionCommon: CodegenAssertion = {
      type: 'element_visible',
      value: 'Add',
      selector: 'button:has-text("Add")',
      source: 'anchor',
      confidence: 0.9,
    };
    const assertionUnique: CodegenAssertion = {
      type: 'element_visible',
      value: 'Dashboard',
      selector: 'h1:has-text("Dashboard")',
      source: 'anchor',
      confidence: 0.9,
    };

    const step1 = createStep({
      step: 1,
      outcomeType: 'navigation',
      pageUrl: '/page1',
      assertions: [assertionCommon, assertionUnique],
    });
    const step2 = createStep({
      step: 2,
      outcomeType: 'navigation',
      pageUrl: '/page2',
      assertions: [assertionCommon],
    });

    const steps = [step1, step2];
    const filtered = deduplicateSharedAssertions(steps);

    // step1 should lose the common assertion but keep the unique one
    expect(filtered[0].assertions).toHaveLength(1);
    expect(filtered[0].assertions[0].selector).toBe('h1:has-text("Dashboard")');
    // step2 should lose the common assertion entirely
    expect(filtered[1].assertions).toHaveLength(0);
  });

  it('keeps URL assertions (source: url_change) even if they appear on multiple pages', () => {
    const urlAssertion: CodegenAssertion = {
      type: 'url',
      value: '/page1',
      source: 'url_change',
      confidence: 1,
    };
    const step1 = createStep({
      step: 1,
      outcomeType: 'navigation',
      pageUrl: '/page1',
      assertions: [urlAssertion],
    });
    const step2 = createStep({
      step: 2,
      outcomeType: 'navigation',
      pageUrl: '/page2',
      assertions: [urlAssertion],
    });

    const steps = [step1, step2];
    const filtered = deduplicateSharedAssertions(steps);
    // URL assertions are never stripped
    expect(filtered[0].assertions).toHaveLength(1);
    expect(filtered[1].assertions).toHaveLength(1);
  });
});

describe('CodegenService - Step Metadata Preservation', () => {
  it('buildSession populates step.controlSignature and step.fingerprint', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/profile',
      interactionContext: {
        controlSignature: 'sig-profile-v1',
      },
      fingerprint: {
        selector: '[data-testid="save"]',
        selectorPriority: 'data-testid',
        selectorRank: 1,
        tagName: 'button',
        parentSelector: '#profile-form',
        textExcerpt: 'Save',
        context: {
          parentTag: 'div',
          nearestContainerTag: 'form',
        },
        attributes: {
          dataTestId: 'save',
        },
        attributesHash: 'abc123',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-1',
                eventType: 'click',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/profile',
                traceId: 'trace-1',
                nodeId: 'node-1',
                payload: eventPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].controlSignature).toBe('sig-profile-v1');
    expect(session.steps[0].fingerprint?.tagName).toBe('button');
    expect(session.steps[0].fingerprint?.parentSelector).toBe('#profile-form');
  });

  it('buildSession preserves role-text accessibility evidence on fingerprints', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/admin',
      fingerprint: {
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'div',
        textExcerpt: 'Admin',
        context: {
          parentTag: 'div',
          nearestContainerTag: 'div',
        },
        attributes: {
          role: 'option',
        },
        accessibilityEvidence: {
          role: 'option',
          accessibleName: 'Admin',
          accessibleNameSource: 'role-text',
        },
        attributesHash: 'role-text-hash',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-role-text',
                eventType: 'click',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/admin',
                traceId: 'trace-role-text',
                nodeId: 'node-1',
                payload: eventPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint?.accessibilityEvidence).toEqual(expect.objectContaining({
      accessibleName: 'Admin',
      accessibleNameSource: 'role-text',
    }));
  });

  it('buildSession normalizes unknown accessibleNameSource values to none', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/admin',
      fingerprint: {
        selector: '[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'username',
        },
        accessibilityEvidence: {
          role: 'textbox',
          accessibleName: 'Username',
          accessibleNameSource: 'unexpected-source',
        },
        attributesHash: 'unknown-source-hash',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-unknown-source',
                eventType: 'input',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/admin',
                traceId: 'trace-unknown-source',
                nodeId: 'node-1',
                payload: eventPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint?.accessibilityEvidence?.accessibleNameSource).toBe('none');
  });

  it('buildSession preserves valid selectorCandidates on fingerprints', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/login',
      fingerprint: {
        selector: '[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'username',
        },
        selectorCandidates: [
          {
            selector: '[name="username"]',
            engine: 'css',
            family: 'primary',
            strength: 'strong',
            source: 'capture',
            isPrimary: true,
            matchCount: 1,
            visibleMatchCount: 1,
            positionInAllMatches: 0,
            positionInVisibleMatches: 0,
            warningCodes: ['recorded-primary'],
          },
        ],
        attributesHash: 'selector-candidates-valid-hash',
      },
    });

    const session = buildSessionFromEventRows([{
      eventId: 'ev-selector-candidates',
      eventType: 'input',
      timestamp: 1_700_000_000_100,
      pageUrl: 'https://app.test/login',
      traceId: 'trace-selector-candidates',
      nodeId: 'node-1',
      payload: eventPayload,
    }]);

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint?.selectorCandidates).toEqual([
      expect.objectContaining({
        selector: '[name="username"]',
        engine: 'css',
        family: 'primary',
        strength: 'strong',
        source: 'capture',
        isPrimary: true,
        matchCount: 1,
        visibleMatchCount: 1,
        positionInAllMatches: 0,
        positionInVisibleMatches: 0,
        warningCodes: ['recorded-primary'],
      }),
    ]);
  });

  it('buildSession preserves snapshot-backed target identity fields and mirrors targetNodeId onto the step', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/login',
      fingerprint: {
        selector: '[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'username',
        },
        targetNodeId: 'air-node-1',
        targetIdentitySource: 'pageSnapshot',
        targetIdentityStatus: 'emitted',
        attributesHash: 'target-identity-hash',
      },
    });

    const session = buildSessionFromEventRows([{
      eventId: 'ev-target-identity',
      eventType: 'input',
      timestamp: 1_700_000_000_100,
      pageUrl: 'https://app.test/login',
      traceId: 'trace-target-identity',
      nodeId: 'node-1',
      payload: eventPayload,
    }]);

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint).toEqual(expect.objectContaining({
      targetNodeId: 'air-node-1',
      targetIdentitySource: 'pageSnapshot',
      targetIdentityStatus: 'emitted',
    }));
    expect(session.steps[0].targetNodeId).toBe('air-node-1');
  });

  it('buildSession caps selectorCandidates at 8 and dedupes by engine + family + selector', () => {
    const selectorCandidates = [
      {
        selector: '[name="username"]',
        engine: 'css',
        family: 'primary',
        strength: 'strong',
        source: 'capture',
      },
      {
        selector: '[name="username"]',
        engine: 'css',
        family: 'primary',
        strength: 'weak',
        source: 'capture',
        warningCodes: ['duplicate-should-drop'],
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        selector: `[data-testid="candidate-${index + 1}"]`,
        engine: 'css' as const,
        family: 'test-id' as const,
        strength: index % 2 === 0 ? 'strong' as const : 'medium' as const,
        source: 'capture' as const,
      })),
    ];

    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/login',
      fingerprint: {
        selector: '[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'username',
        },
        selectorCandidates,
        attributesHash: 'selector-candidates-cap-hash',
      },
    });

    const session = buildSessionFromEventRows([{
      eventId: 'ev-selector-candidates-cap',
      eventType: 'input',
      timestamp: 1_700_000_000_101,
      pageUrl: 'https://app.test/login',
      traceId: 'trace-selector-candidates-cap',
      nodeId: 'node-1',
      payload: eventPayload,
    }]);

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint?.selectorCandidates).toHaveLength(8);
    expect(session.steps[0].fingerprint?.selectorCandidates?.[0]).toEqual(
      expect.objectContaining({
        selector: '[name="username"]',
        engine: 'css',
        family: 'primary',
      }),
    );
    expect(session.steps[0].fingerprint?.selectorCandidates?.filter(candidate =>
      candidate.selector === '[name="username"]' &&
      candidate.engine === 'css' &&
      candidate.family === 'primary',
    )).toHaveLength(1);
    expect(session.steps[0].fingerprint?.selectorCandidates?.some(candidate =>
      candidate.selector === '[data-testid="candidate-8"]',
    )).toBe(false);
  });

  it('buildSession drops invalid selectorCandidates safely and omits empty normalized arrays', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/login',
      fingerprint: {
        selector: '[name="username"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'username',
        },
        selectorCandidates: [
          {
            selector: '[name="username"]',
            engine: 'css',
            family: 'name',
            strength: 'strong',
            source: 'capture',
          },
          {
            selector: '.bad-engine',
            engine: 'playwright',
            family: 'class',
            strength: 'weak',
            source: 'capture',
          },
          {
            selector: '',
            engine: 'css',
            family: 'class',
            strength: 'weak',
            source: 'capture',
          },
        ],
        attributesHash: 'selector-candidates-invalid-hash',
      },
    });

    const noValidCandidatesPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/login',
      fingerprint: {
        selector: '[name="password"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: null,
        context: {
          parentTag: 'form',
          nearestContainerTag: 'form',
        },
        attributes: {
          name: 'password',
        },
        selectorCandidates: [
          {
            selector: '.bad-engine',
            engine: 'playwright',
            family: 'class',
            strength: 'weak',
            source: 'capture',
          },
        ],
        attributesHash: 'selector-candidates-empty-hash',
      },
    });

    const session = buildSessionFromEventRows([
      {
        eventId: 'ev-selector-candidates-invalid',
        eventType: 'input',
        timestamp: 1_700_000_000_102,
        pageUrl: 'https://app.test/login',
        traceId: 'trace-selector-candidates-invalid',
        nodeId: 'node-1',
        payload: eventPayload,
      },
      {
        eventId: 'ev-selector-candidates-empty',
        eventType: 'input',
        timestamp: 1_700_000_000_103,
        pageUrl: 'https://app.test/login',
        traceId: 'trace-selector-candidates-empty',
        nodeId: 'node-1',
        payload: noValidCandidatesPayload,
      },
    ]);

    expect(session.steps).toHaveLength(2);
    expect(session.steps[0].fingerprint?.selectorCandidates).toEqual([
      expect.objectContaining({
        selector: '[name="username"]',
        engine: 'css',
        family: 'name',
      }),
    ]);
    expect(session.steps[1].fingerprint?.selectorCandidates).toBeUndefined();
  });

  it('buildSession preserves selectorCandidates on triggerFingerprint for custom-control events', () => {
    const customSelectPayload = JSON.stringify({
      normalizedUrl: 'https://example.test/admin',
      fingerprint: {
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'div',
        textExcerpt: 'Admin',
        attributes: {
          role: 'option',
        },
        selectorCandidates: [
          {
            selector: '[role="option"]',
            engine: 'css',
            family: 'primary',
            strength: 'strong',
            source: 'capture',
          },
        ],
        attributesHash: 'hash-option-selector-candidates',
      },
      triggerFingerprint: {
        selector: '.oxd-select-text',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'User Role',
        attributes: {
          role: 'combobox',
        },
        selectorCandidates: [
          {
            selector: '.oxd-select-text',
            engine: 'css',
            family: 'primary',
            strength: 'weak',
            source: 'capture',
            usesDynamicClass: true,
          },
        ],
        attributesHash: 'hash-trigger-selector-candidates',
      },
      selection: {
        label: 'Admin',
        value: 'Admin',
        index: 0,
      },
      controlFamily: 'combobox',
      meta: {
        triggerSelector: '.oxd-select-text',
      },
    });

    const session = buildSessionFromEventRows([{
      eventId: 'ev-custom-select-selector-candidates',
      eventType: 'custom-select',
      timestamp: 1_700_000_000_104,
      pageUrl: 'https://example.test/admin',
      traceId: 'trace-custom-select-selector-candidates',
      nodeId: 'node-1',
      payload: customSelectPayload,
    }]);

    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint?.selectorCandidates).toEqual([
      expect.objectContaining({
        selector: '[role="option"]',
        engine: 'css',
        family: 'primary',
      }),
    ]);
    expect(session.steps[0].triggerFingerprint?.selectorCandidates).toEqual([
      expect.objectContaining({
        selector: '.oxd-select-text',
        engine: 'css',
        family: 'primary',
        usesDynamicClass: true,
      }),
    ]);
  });

  it('buildSession preserves nestedContext fields used by snapshot selection', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/profile',
      nestedContext: {
        isShadowDom: true,
        isIframe: true,
        iframeSrc: 'https://app.test/embedded-profile',
        degradedReason: 'probable_closed_shadow_host',
      },
      pageSnapshot: {
        html: '<div>shadow content</div>',
      },
      fingerprint: {
        selector: '[name="email"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: 'Email',
        attributes: {
          name: 'email',
        },
        attributesHash: 'nested-context-hash',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([{
              eventId: 'ev-1',
              eventType: 'click',
              timestamp: 1_700_000_000_100,
              pageUrl: 'https://app.test/profile',
              traceId: 'trace-1',
              nodeId: 'node-1',
              payload: eventPayload,
            }]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].nestedContext).toEqual(expect.objectContaining({
      isShadowDom: true,
      isIframe: true,
      iframeSrc: 'https://app.test/embedded-profile',
      degradedReason: 'probable_closed_shadow_host',
    }));
  });

  it('falls back to source-node control_signature when payload signature is missing', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/profile',
      fingerprint: {
        selector: '[name="email"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'input',
        textExcerpt: 'Email',
        attributes: {
          name: 'email',
        },
        attributesHash: 'def456',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-1',
                eventType: 'click',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/profile',
                traceId: 'trace-1',
                nodeId: 'node-1',
                payload: eventPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => ({ controlSignature: 'node-sig-v1' }) };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].sourceNodeId).toBe('node-1');
    expect(session.steps[0].controlSignature).toBe('node-sig-v1');
  });

  it('buildSession intent falls back to fingerprint title for icon-only clicks', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/dashboard',
      fingerprint: {
        selector: '.icon-settings',
        selectorPriority: 'class',
        selectorRank: 7,
        textExcerpt: null,
        attributes: {
          title: 'Settings',
        },
        attributesHash: 'icon-title-hash',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-1',
                eventType: 'click',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/dashboard',
                traceId: 'trace-1',
                nodeId: 'node-1',
                payload: eventPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].intent).toBe('click_Settings');
  });

  it('anchors submit step to last resolved node when submit node is missing', () => {
    const clickPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/profile',
      fingerprint: {
        selector: '[name="email"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        attributes: { name: 'email' },
        attributesHash: 'click-hash',
      },
    });

    const submitPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/profile',
      fingerprint: {
        selector: 'form',
        selectorPriority: 'path',
        selectorRank: 10,
        attributes: {},
        attributesHash: 'submit-hash',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-1',
                eventType: 'click',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/profile',
                traceId: 'trace-1',
                nodeId: 'node-click',
                payload: clickPayload,
              },
              {
                eventId: 'ev-2',
                eventType: 'submit',
                timestamp: 1_700_000_000_200,
                pageUrl: 'https://app.test/profile',
                traceId: 'trace-2',
                nodeId: null,
                payload: submitPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(2);
    expect(session.steps[0].action).toBe('click');
    expect(session.steps[0].sourceNodeId).toBe('node-click');
    expect(session.steps[1].action).toBe('submit');
    expect(session.steps[1].sourceNodeId).toBe('node-click');
  });

  it('compresses same-trace submit shell after submit click during buildSession and renumbers steps', () => {
    const clickPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/search',
      fingerprint: {
        selector: 'button[type="submit"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'button',
        textExcerpt: 'Search',
        attributes: { type: 'submit' },
        attributesHash: 'click-hash',
      },
    });

    const submitPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/search',
      fingerprint: {
        selector: '.search-shell',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'form',
        context: { nearestContainerTag: 'form' },
        attributes: {},
        attributesHash: 'submit-hash',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-1',
                eventType: 'click',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://app.test/search',
                traceId: 'trace-1',
                nodeId: 'node-click',
                payload: clickPayload,
              },
              {
                eventId: 'ev-2',
                eventType: 'submit',
                timestamp: 1_700_000_000_150,
                pageUrl: 'https://app.test/search',
                traceId: 'trace-1',
                nodeId: null,
                payload: submitPayload,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return {
            all: () => ([
              {
                fingerprintHash: 'unused-click-edge',
                edgeId: 'edge-1',
                triggerEventId: 'ev-1',
                fromNodeId: 'node-click',
                toNodeId: 'node-results',
                outcomeType: 'navigation',
                sampleSize: 2,
                probability: 0.95,
              },
              {
                fingerprintHash: 'unused-submit-edge',
                edgeId: 'edge-2',
                triggerEventId: 'ev-2',
                fromNodeId: 'node-click',
                toNodeId: 'node-results',
                outcomeType: 'navigation',
                sampleSize: 2,
                probability: 0.96,
              },
            ]),
          };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return {
            all: () => ([
              {
                fingerprintHash: 'unused-click-edge',
                edgeId: 'edge-1',
                triggerEventId: 'ev-1',
                fromNodeId: 'node-click',
                toNodeId: 'node-results',
                outcomeType: 'navigation',
                sampleSize: 2,
                probability: 0.95,
              },
              {
                fingerprintHash: 'unused-submit-edge',
                edgeId: 'edge-2',
                triggerEventId: 'ev-2',
                fromNodeId: 'node-click',
                toNodeId: 'node-results',
                outcomeType: 'navigation',
                sampleSize: 2,
                probability: 0.96,
              },
            ]),
          };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => ([{
              id: 'node-results',
              page_url: 'https://app.test/results',
              page_title: 'Results',
              anchors: JSON.stringify(['H1:text=Results']),
            }]),
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].step).toBe(1);
    expect(session.steps[0].action).toBe('click');
    expect(session.steps[0].selector).toBe('button[type="submit"]');
    expect(session.steps[0].navigatesTo).toBe('https://app.test/results');
    expect(session.steps[0].assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'url', value: 'https://app.test/results' }),
        expect.objectContaining({ selector: 'h1:has-text("Results")' }),
      ]),
    );
  });

  it('preserves extended fingerprint attributes and aliases into CodegenStep.fingerprint', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://app.test/profile',
      fingerprint: {
        selector: '[data-cy="save-profile"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'button',
        parentSelector: '#profile-form',
        textExcerpt: 'Save Profile',
        context: {
          parentTag: 'div',
          nearestContainerTag: 'form',
        },
        attributes: {
          id: 'save-profile',
          name: 'saveProfile',
          role: 'button',
          ariaLabel: 'Save profile',
          class: 'btn btn-primary profile-save',
          classList: 'btn btn-primary profile-save',
          placeholder: 'unused',
          type: 'submit',
          href: 'https://app.test/profile/save',
          title: 'Save profile',
          alt: 'Save icon',
          value: 'Save',
          dataTestId: 'save-profile',
          dataCy: 'save-profile',
          'data-qa': 'save-profile',
        },
        attributesHash: 'fingerprint-hash-123',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([{
              eventId: 'ev-1',
              eventType: 'click',
              timestamp: 1_700_000_000_100,
              pageUrl: 'https://app.test/profile',
              traceId: 'trace-1',
              nodeId: 'node-1',
              payload: eventPayload,
            }]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint).toEqual(expect.objectContaining({
      selector: '[data-cy="save-profile"]',
      selectorPriority: 'attribute',
      selectorRank: 3,
      tagName: 'button',
      parentSelector: '#profile-form',
      textExcerpt: 'Save Profile',
      attributesHash: 'fingerprint-hash-123',
      context: {
        parentTag: 'div',
        nearestContainerTag: 'form',
      },
      attributes: expect.objectContaining({
        id: 'save-profile',
        name: 'saveProfile',
        role: 'button',
        ariaLabel: 'Save profile',
        'aria-label': 'Save profile',
        class: 'btn btn-primary profile-save',
        classList: 'btn btn-primary profile-save',
        placeholder: 'unused',
        type: 'submit',
        href: 'https://app.test/profile/save',
        title: 'Save profile',
        alt: 'Save icon',
        value: 'Save',
        dataTestId: 'save-profile',
        'data-testid': 'save-profile',
        dataCy: 'save-profile',
        'data-cy': 'save-profile',
        dataQa: 'save-profile',
        'data-qa': 'save-profile',
      }),
    }));
  });

  it('preserves OrangeHRM Admin href in click fingerprint from payload into CodegenStep', () => {
    const eventPayload = JSON.stringify({
      normalizedUrl: 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index',
      fingerprint: {
        selector: '.oxd-main-menu-item',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'a',
        parentSelector: 'li',
        textExcerpt: 'Admin',
        context: {
          parentTag: 'li',
          nearestContainerTag: 'nav',
        },
        attributes: {
          href: 'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewAdminModule',
          role: 'link',
        },
        attributesHash: 'admin-hash-456',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([{
              eventId: 'ev-1',
              eventType: 'click',
              timestamp: 1_700_000_000_100,
              pageUrl: 'https://opensource-demo.orangehrmlive.com/web/index.php/dashboard/index',
              traceId: 'trace-1',
              nodeId: 'node-1',
              payload: eventPayload,
            }]),
          };
        }

        if (sql.includes('WHERE ed.fingerprint_hash IN')) {
          return { all: () => [] };
        }

        if (sql.includes('WHERE ed.trigger_event_id IN')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0].fingerprint?.attributes?.href).toBe(
      'https://opensource-demo.orangehrmlive.com/web/index.php/admin/viewAdminModule'
    );
    expect(session.steps[0].fingerprint?.textExcerpt).toBe('Admin');
  });

  it('documents inventory policy as HTML/provenance/controlSignature-centered', () => {
    const codegenSource = fs.readFileSync(
      path.join(process.cwd(), 'packages/codegen/src/codegen.service.ts'),
      'utf8',
    );

    // Capture/schema durability for compositeAnchors, metrics, and snapshotBuildId is already
    // covered in event-schema-survival.spec.ts and active-path-contract-fixture.e2e.spec.ts.
    // The current inventory contract intentionally reconstructs from HTML plus lightweight
    // provenance/control-signature fields instead of rich snapshot metadata.
    expect(codegenSource).toContain('SELECT snapshot_html AS snapshotHtml');
    expect(codegenSource).toContain('normalized_url AS normalizedUrl');
    expect(codegenSource).toContain('control_signature AS controlSignature');
    expect(codegenSource).toContain('is_stable AS isStable');
    expect(codegenSource).toContain('captured_at AS capturedAt');
    expect(codegenSource).toContain('payload?.[fieldName]?.html');
    expect(codegenSource).not.toContain('payload?.[fieldName]?.compositeAnchors');
    expect(codegenSource).not.toContain('payload?.[fieldName]?.metrics');
    expect(codegenSource).not.toContain('payload?.[fieldName]?.snapshotBuildId');
  });

  it('buildSession keeps semantic custom-control events actionable and preserves menu selection labels', () => {
    const customOpenPayload = JSON.stringify({
      normalizedUrl: 'https://example.test/admin',
      fingerprint: {
        selector: '.oxd-select-text',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'User Role',
        attributes: {
          role: 'combobox',
        },
        attributesHash: 'hash-open',
      },
      controlFamily: 'dropdown',
    });

    const menuSelectPayload = JSON.stringify({
      normalizedUrl: 'https://example.test/admin',
      fingerprint: {
        selector: '[role="menuitem"]:has-text("Logout")',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'li',
        textExcerpt: 'Logout',
        attributes: {
          role: 'menuitem',
        },
        attributesHash: 'hash-logout',
      },
      triggerFingerprint: {
        selector: '.oxd-userdropdown-name',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'span',
        textExcerpt: 'Paul Collings',
        attributes: {
          role: 'button',
        },
        attributesHash: 'hash-trigger',
      },
      selection: {
        label: 'Logout',
        value: 'logout',
        index: 0,
      },
      controlFamily: 'menu',
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-open',
                eventType: 'custom-control-open',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://example.test/admin',
                traceId: 'trace-open',
                nodeId: 'node-1',
                payload: customOpenPayload,
              },
              {
                eventId: 'ev-menu',
                eventType: 'custom-menu-select',
                timestamp: 1_700_000_000_200,
                pageUrl: 'https://example.test/admin',
                traceId: 'trace-open',
                nodeId: 'node-1',
                payload: menuSelectPayload,
              },
            ]),
          };
        }

        if (sql.includes('FROM edges ed')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(2);
    expect(session.steps[0].action).toBe('custom-control-open');
    expect(session.steps[0].selector).toBe('.oxd-select-text');
    expect(session.steps[1].action).toBe('custom-menu-select');
    expect(session.steps[1].selector).toBe('[role="menuitem"]:has-text("Logout")');
    expect(session.steps[1].value).toBe('Logout');
  });

  it('buildSession compresses bounded custom-control open/select pairs and preserves trigger-option evidence', () => {
    const customOpenPayload = JSON.stringify({
      normalizedUrl: 'https://example.test/admin',
      fingerprint: {
        selector: '.oxd-select-text',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'User Role',
        attributes: {
          role: 'combobox',
        },
        attributesHash: 'hash-open',
      },
      controlFamily: 'combobox',
    });

    const customSelectPayload = JSON.stringify({
      normalizedUrl: 'https://example.test/admin',
      fingerprint: {
        selector: '[role="option"]',
        selectorPriority: 'attribute',
        selectorRank: 3,
        tagName: 'div',
        textExcerpt: 'Admin',
        attributes: {
          role: 'option',
        },
        attributesHash: 'hash-option',
      },
      triggerFingerprint: {
        selector: '.oxd-select-text',
        selectorPriority: 'class',
        selectorRank: 7,
        tagName: 'div',
        textExcerpt: 'User Role',
        attributes: {
          role: 'combobox',
        },
        attributesHash: 'hash-trigger',
      },
      selection: {
        label: 'Admin',
        value: 'Admin',
        index: 0,
      },
      controlFamily: 'combobox',
      meta: {
        triggerSelector: '.oxd-select-text',
        containerRole: 'listbox',
      },
    });

    const fakeDb = {
      prepare(sql: string) {
        if (sql.includes('FROM sessions')) {
          return {
            get: () => ({
              id: 'session-test',
              started_at: 1_700_000_000_000,
            }),
          };
        }

        if (sql.includes('FROM events e')) {
          return {
            all: () => ([
              {
                eventId: 'ev-open',
                eventType: 'custom-control-open',
                timestamp: 1_700_000_000_100,
                pageUrl: 'https://example.test/admin',
                traceId: 'trace-open',
                nodeId: 'node-1',
                payload: customOpenPayload,
              },
              {
                eventId: 'ev-select',
                eventType: 'custom-select',
                timestamp: 1_700_000_000_250,
                pageUrl: 'https://example.test/admin',
                traceId: 'trace-open',
                nodeId: 'node-1',
                payload: customSelectPayload,
              },
            ]),
          };
        }

        if (sql.includes('FROM edges ed')) {
          return { all: () => [] };
        }

        if (sql.includes('SELECT control_signature AS controlSignature')) {
          return { get: () => undefined };
        }

        if (sql.includes('FROM nodes')) {
          return {
            all: () => [],
            get: () => undefined,
          };
        }

        return {
          get: () => undefined,
          all: () => [],
        };
      },
      close() {
        return undefined;
      },
    };

    const service = Object.create(CodegenService.prototype) as any;
    service.db = fakeDb;
    service.options = {
      dbPath: ':memory:',
      minConfidence: 0,
      includeScrollSteps: false,
      includeHoverSteps: false,
    };

    const session = (service as CodegenService).buildSession('session-test');
    expect(session.steps).toHaveLength(1);
    expect(session.steps[0]).toEqual(expect.objectContaining({
      action: 'custom-select',
      selector: '[role="option"]',
      value: 'Admin',
      controlFamily: 'combobox',
      triggerSelector: '.oxd-select-text',
      optionSelector: '[role="option"]',
      optionText: 'Admin',
      absorbedOpenEventId: 'ev-open',
      absorbedOpenTraceId: 'trace-open',
      compressedFromEvents: ['ev-open', 'ev-select'],
    }));
  });
});
