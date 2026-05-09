import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { 
  CodegenService,
  normalizeSelectorPriority,
  rankFromPriority,
  collapseRedundantClickBeforeInput,
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
});
