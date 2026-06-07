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
});
