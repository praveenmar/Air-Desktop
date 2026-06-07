import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CodegenService } from '../src/codegen.service';
import { CodegenSession, GenerationEventMetadata, CodegenStep } from '../src/types';

describe('Phase 3D: buildGenerationContext', () => {
  let service: CodegenService;

  beforeEach(() => {
    // Create an empty service instance
    service = Object.create(CodegenService.prototype) as CodegenService;
    (service as any).options = { dbPath: ':memory:' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockStep = (overrides: Partial<CodegenStep>): CodegenStep => ({
    step: 1,
    action: 'click',
    selector: 'test',
    selectorPriority: 'class',
    confidence: 1,
    sampleSize: 1,
    assertions: [],
    userAssertions: [],
    ...overrides
  } as CodegenStep);

  it('Test 1: builds GenerationContext for session with resolved target', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 1,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-1',
          action: 'click',
          intent: 'test click',
          selector: 'button#login',
          selectorPriority: 'class',
        })
      ]
    };

    const mockMetadata = new Map<string, GenerationEventMetadata>();
    mockMetadata.set('event-1', {
      id: 'event-1',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          engine: 'css',
          selector: 'button#login',
          replaySafe: true,
          confidence: 'high',
          source: 'legacy-primary'
        }
      } as any
    });

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(mockMetadata);

    const context = service.buildGenerationContext('session-1');

    expect(service.buildSession).toHaveBeenCalledWith('session-1', { preserveCompoundOpenSteps: true });
    expect(service.getGenerationEventMetadataByIds).toHaveBeenCalledWith(['event-1']);
    
    expect(context.schemaVersion).toBe('air:generation-context:v1');
    expect(context.sessionId).toBe('session-1');
    expect(context.steps.length).toBe(1);

    const step1 = context.steps[0];
    expect(step1.eventId).toBe('event-1');
    expect(step1.locatorStatus).toBe('resolved');
    expect(step1.resolvedTarget?.kind).toBe('css');
    expect(step1.resolvedTarget?.value).toBe('button#login');
  });

  it('Test 2: old event fallback correctly populates fallbackHints', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 1,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-2',
          action: 'click',
          intent: 'test click',
          selector: '.old-btn',
          selectorPriority: 'class',
        })
      ]
    };

    const mockMetadata = new Map<string, GenerationEventMetadata>();
    mockMetadata.set('event-2', {
      id: 'event-2',
      fallbackHints: {
        legacySelector: '.old-btn',
        elementText: 'Submit',
        tagName: 'BUTTON'
      }
    });

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(mockMetadata);

    const context = service.buildGenerationContext('session-1');
    const step2 = context.steps[0];

    expect(step2.eventId).toBe('event-2');
    expect(step2.locatorStatus).toBe('unresolved');
    expect(step2.resolvedTarget).toBeUndefined();
    expect(step2.fallbackHints).toBeDefined();
    expect(step2.fallbackHints?.legacySelector).toBe('.old-btn');
    expect(step2.fallbackHints?.elementText).toBe('Submit');
    expect(step2.fallbackHints?.tagName).toBe('BUTTON');
  });

  it('Test 3: missing/invalid selectorResolution safely uses fallbackHints', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 1,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-3',
          action: 'click',
          intent: 'test click',
          selector: 'button',
          selectorPriority: 'class',
        })
      ]
    };

    const mockMetadata = new Map<string, GenerationEventMetadata>();
    // No selectorResolution provided
    mockMetadata.set('event-3', {
      id: 'event-3'
    });

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(mockMetadata);

    const context = service.buildGenerationContext('session-1');
    const step3 = context.steps[0];

    expect(step3.eventId).toBe('event-3');
    expect(step3.locatorStatus).toBe('unresolved');
    expect(step3.resolvedTarget).toBeUndefined();
  });

  it('Test 4: no extra behavior changes on existing buildSession', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 0,
      flowConfidence: 1,
      nodeCount: 1,
      steps: []
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const sessionBefore = service.buildSession('session-1');
    const context = service.buildGenerationContext('session-1');
    const sessionAfter = service.buildSession('session-1');

    expect(context).toBeDefined();
    expect(sessionAfter).toEqual(sessionBefore);
  });

  it('Test 5: preserves custom-control-open and custom-select as separate GenerationContext steps', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 2,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-open',
          action: 'custom-control-open',
          intent: 'custom-control-open_role',
          selector: '.trigger',
          selectorPriority: 'class',
        }),
        createMockStep({
          step: 2,
          eventId: 'event-select',
          action: 'custom-select',
          intent: 'custom-select_value',
          selector: '[role="option"]',
          selectorPriority: 'attribute',
          value: 'Admin',
        }),
      ],
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-1');

    expect(service.buildSession).toHaveBeenCalledWith('session-1', { preserveCompoundOpenSteps: true });
    expect(context.steps.map(step => step.action)).toEqual(['custom-control-open', 'custom-select']);
  });

  it('Test 6: preserves custom-control-open and custom-menu-select as separate GenerationContext steps', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 2,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-open',
          action: 'custom-control-open',
          intent: 'custom-control-open_menu',
          selector: '.trigger',
          selectorPriority: 'class',
        }),
        createMockStep({
          step: 2,
          eventId: 'event-menu-select',
          action: 'custom-menu-select',
          intent: 'custom-menu-select_value',
          selector: '[role="menuitem"]',
          selectorPriority: 'attribute',
          value: 'Logout',
        }),
      ],
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-1');

    expect(service.buildSession).toHaveBeenCalledWith('session-1', { preserveCompoundOpenSteps: true });
    expect(context.steps.map(step => step.action)).toEqual(['custom-control-open', 'custom-menu-select']);
  });

  it('Test 7: drops conflicting outcome URL assertion when next step location clearly disagrees', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 2,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-1',
          intent: 'step-1',
          assertions: [
            {
              type: 'url',
              value: 'https://test.com/item?id=3',
              source: 'outcome',
              confidence: 1,
            } as any,
          ],
          pageUrl: 'https://test.com/list',
          normalizedUrl: 'https://test.com/list',
        }),
        createMockStep({
          step: 2,
          eventId: 'event-2',
          intent: 'step-2',
          pageUrl: 'https://test.com/item?id=5',
          normalizedUrl: 'https://test.com/item?id=5',
        }),
      ],
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-1');

    expect(context.steps[0].assertions).toEqual([]);
  });

  it('Test 8: keeps matching outcome URL assertion when next step location agrees', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 2,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-1',
          intent: 'step-1',
          assertions: [
            {
              type: 'url',
              value: 'https://test.com/cart',
              source: 'outcome',
              confidence: 1,
            } as any,
          ],
          pageUrl: 'https://test.com/list',
          normalizedUrl: 'https://test.com/list',
        }),
        createMockStep({
          step: 2,
          eventId: 'event-2',
          intent: 'step-2',
          pageUrl: 'https://test.com/cart',
          normalizedUrl: 'https://test.com/cart',
        }),
      ],
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-1');

    expect(context.steps[0].assertions).toHaveLength(1);
    expect(context.steps[0].assertions[0]).toMatchObject({
      type: 'url',
      value: 'https://test.com/cart',
      source: 'outcome',
    });
  });

  it('Test 9: keeps final-step URL assertion when no next step exists', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 1,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-1',
          intent: 'step-1',
          assertions: [
            {
              type: 'url',
              value: 'https://test.com/logout',
              source: 'outcome',
              confidence: 1,
            } as any,
          ],
          pageUrl: 'https://test.com/home',
          normalizedUrl: 'https://test.com/home',
        }),
      ],
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-1');

    expect(context.steps[0].assertions).toHaveLength(1);
    expect(context.steps[0].assertions[0]).toMatchObject({
      type: 'url',
      value: 'https://test.com/logout',
      source: 'outcome',
    });
  });

  it('Test 10: does not affect non-url assertions', () => {
    const mockSession: CodegenSession = {
      sessionId: 'session-1',
      url: 'https://test.com',
      title: 'Test',
      recordedAt: '2026-01-01T00:00:00Z',
      stepCount: 2,
      flowConfidence: 1,
      nodeCount: 1,
      steps: [
        createMockStep({
          step: 1,
          eventId: 'event-1',
          intent: 'step-1',
          assertions: [
            {
              type: 'element_visible',
              value: 'Checkout',
              selector: '#checkout',
              source: 'anchor',
              confidence: 0.9,
            } as any,
            {
              type: 'url',
              value: 'https://test.com/item?id=3',
              source: 'outcome',
              confidence: 1,
            } as any,
          ],
          pageUrl: 'https://test.com/list',
          normalizedUrl: 'https://test.com/list',
        }),
        createMockStep({
          step: 2,
          eventId: 'event-2',
          intent: 'step-2',
          pageUrl: 'https://test.com/item?id=5',
          normalizedUrl: 'https://test.com/item?id=5',
        }),
      ],
    };

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-1');

    expect(context.steps[0].assertions).toHaveLength(1);
    expect(context.steps[0].assertions[0]).toMatchObject({
      type: 'element_visible',
      value: 'Checkout',
      selector: '#checkout',
      source: 'anchor',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GC-1A: ignoredSteps classification tests
// ─────────────────────────────────────────────────────────────────────────────

describe('GC-1A: ignoredSteps classification', () => {
  let service: CodegenService;

  beforeEach(() => {
    service = Object.create(CodegenService.prototype) as CodegenService;
    (service as any).options = { dbPath: ':memory:' };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockStep = (overrides: Partial<CodegenStep>): CodegenStep => ({
    step: 1,
    action: 'click',
    selector: 'test',
    selectorPriority: 'class',
    confidence: 1,
    sampleSize: 1,
    assertions: [],
    userAssertions: [],
    ...overrides,
  } as CodegenStep);

  const createSession = (steps: CodegenStep[]): CodegenSession => ({
    sessionId: 'session-gc1a',
    url: 'https://test.com',
    title: 'GC-1A Test',
    recordedAt: '2026-01-01T00:00:00Z',
    stepCount: steps.length,
    flowConfidence: 1,
    nodeCount: 1,
    steps,
  });

  // ── Test GC-1A-1 ──────────────────────────────────────────────────────────

  it('GC-1A-1: broad no_change container click moves to ignoredSteps', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-container',
        action: 'click',
        intent: 'click_container',
        selector: 'div.background-container',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(0);
    expect(context.ignoredSteps).toHaveLength(1);
    expect(context.ignoredSteps[0].ignoredReason).toBe('broad_no_change_container_click');
    expect(context.ignoredSteps[0].stepIndex).toBe(1);
    expect(context.ignoredSteps[0].ignoredExplanation).toBeDefined();
    expect(context.ignoredSteps[0].ignoredExplanation).toContain('background-container');
  });

  // ── Test GC-1A-2 ──────────────────────────────────────────────────────────

  it('GC-1A-2: concrete no_change button click stays in steps', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-btn',
        action: 'click',
        intent: 'click_button',
        selector: 'button.submit-btn',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
    expect(context.steps[0].stepIndex).toBe(1);
  });

  // ── Test GC-1A-3 ──────────────────────────────────────────────────────────

  it('GC-1A-3: custom-control-open always stays in steps regardless of selector', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-cco',
        action: 'custom-control-open',
        intent: 'open_dropdown',
        selector: 'div.wrapper-container',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
    expect(context.steps[0].action).toBe('custom-control-open');
  });

  // ── Test GC-1A-4 ──────────────────────────────────────────────────────────

  it('GC-1A-4: broad click WITH assertions stays in steps (assertion safety guard)', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-asserted-container',
        action: 'click',
        intent: 'click_background_with_assertion',
        selector: 'div.main-background',
        outcomeType: 'no_change',
        assertions: [
          {
            type: 'element_visible',
            selector: '.modal',
            source: 'anchor',
            confidence: 0.9,
          } as any,
        ],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    // Despite broad selector, must stay in steps because it has assertions
    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
  });

  // ── Test GC-1A-5 ──────────────────────────────────────────────────────────

  it('GC-1A-5: input action never moves to ignoredSteps', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-input',
        action: 'input',
        intent: 'type_text',
        selector: 'div.content-wrapper input',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
    expect(context.steps[0].action).toBe('input');
  });

  // ── Test GC-1A-6 ──────────────────────────────────────────────────────────

  it('GC-1A-6: navigation/state_refresh click stays in steps even with broad selector', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-nav',
        action: 'click',
        intent: 'navigate_section',
        selector: 'div.main-content',
        outcomeType: 'navigation',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
  });

  // ── Test GC-1A-7 ──────────────────────────────────────────────────────────

  it('GC-1A-7: ID-based selector click stays in steps even when outcomeType is no_change', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-id',
        action: 'click',
        intent: 'click_element',
        selector: '#main-container',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    // ID selectors are concrete — must not be classified as noise
    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
  });

  // ── Test GC-1A-8 ──────────────────────────────────────────────────────────

  it('GC-1A-8: ignoredSteps survives GenerationContext schema parse', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-noise',
        action: 'click',
        intent: 'click_background',
        selector: 'div.page-wrapper',
        outcomeType: 'no_change',
        assertions: [],
      }),
      createMockStep({
        step: 2,
        eventId: 'evt-real',
        action: 'click',
        intent: 'click_login',
        selector: '#login-button',
        outcomeType: 'navigation',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    // Validate the shape is schema-compliant (parse would throw if not)
    expect(context.schemaVersion).toBe('air:generation-context:v1');
    expect(context.steps).toHaveLength(1);
    expect(context.steps[0].stepIndex).toBe(2);
    expect(context.ignoredSteps).toHaveLength(1);
    expect(context.ignoredSteps[0].stepIndex).toBe(1);
    expect(context.ignoredSteps[0].ignoredReason).toBe('broad_no_change_container_click');
  });

  // ── Test GC-1A-9 ──────────────────────────────────────────────────────────

  it('GC-1A-9: generationGuidance is present with correct shape', () => {
    const mockSession = createSession([]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.generationGuidance).toBeDefined();
    expect(context.generationGuidance?.replaySource).toBe('steps');
    expect(context.generationGuidance?.ignoredStepsPolicy).toBe('context_only');
    expect(Array.isArray(context.generationGuidance?.rules)).toBe(true);
    expect(context.generationGuidance?.rules.length).toBeGreaterThan(0);
    // Key rules must be present
    expect(context.generationGuidance?.rules.some(r => r.includes('ignoredSteps'))).toBe(true);
    expect(context.generationGuidance?.rules.some(r => r.includes('custom-control-open'))).toBe(true);
  });

  // ── Test GC-1A-10 ─────────────────────────────────────────────────────────

  it('GC-1A-10: mixed session splits correctly — concrete in steps, container in ignoredSteps', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-login-fill',
        action: 'input',
        intent: 'type_username',
        selector: 'input[name="username"]',
        outcomeType: 'no_change',
        assertions: [],
      }),
      createMockStep({
        step: 2,
        eventId: 'evt-bg-click',
        action: 'click',
        intent: 'dismiss_overlay',
        selector: 'div.overlay-backdrop',
        outcomeType: 'no_change',
        assertions: [],
      }),
      createMockStep({
        step: 3,
        eventId: 'evt-submit',
        action: 'click',
        intent: 'click_submit',
        selector: 'button[type="submit"]',
        outcomeType: 'navigation',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(2);
    expect(context.steps.map(s => s.stepIndex)).toEqual([1, 3]);
    expect(context.ignoredSteps).toHaveLength(1);
    expect(context.ignoredSteps[0].stepIndex).toBe(2);
    expect(context.ignoredSteps[0].ignoredReason).toBe('broad_no_change_container_click');
  });

  // ── Test GC-1A-11 ─────────────────────────────────────────────────────────

  it('GC-1A-11: scoped selector (container descendant) stays in steps', () => {
    // A selector like "div.container button" targets a button INSIDE a container
    // This must NOT be classified as a broad container click
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-scoped',
        action: 'click',
        intent: 'click_button_in_container',
        selector: 'div.container button.submit',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    // Scoped selector has a descendant combinator — must stay in steps
    expect(context.steps).toHaveLength(1);
    expect(context.ignoredSteps).toHaveLength(0);
  });

  // ── Test GC-1A-12 ─────────────────────────────────────────────────────────

  it('GC-1A-12: ignoredSteps default is empty array when no noise steps exist', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-clean',
        action: 'click',
        intent: 'click_button',
        selector: 'button#login',
        outcomeType: 'navigation',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.ignoredSteps).toBeDefined();
    expect(Array.isArray(context.ignoredSteps)).toBe(true);
    expect(context.ignoredSteps).toHaveLength(0);
  });

  // ── Test GC-1A-13 ─────────────────────────────────────────────────────────

  it('GC-1A-13: underscore-separated token is split correctly — broad container click ignored', () => {
    const mockSession = createSession([
      createMockStep({
        step: 1,
        eventId: 'evt-underscore',
        action: 'click',
        intent: 'click_header',
        selector: 'div.header_secondary_container',
        outcomeType: 'no_change',
        assertions: [],
      }),
    ]);

    vi.spyOn(service, 'buildSession').mockReturnValue(mockSession);
    vi.spyOn(service, 'getGenerationEventMetadataByIds').mockReturnValue(new Map());

    const context = service.buildGenerationContext('session-gc1a');

    expect(context.steps).toHaveLength(0);
    expect(context.ignoredSteps).toHaveLength(1);
    expect(context.ignoredSteps[0].stepIndex).toBe(1);
    expect(context.ignoredSteps[0].ignoredReason).toBe('broad_no_change_container_click');
  });
});

