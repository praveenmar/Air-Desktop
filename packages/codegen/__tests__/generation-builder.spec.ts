import { describe, expect, it } from 'vitest';
import { deriveGenerationContext } from '../src/generation-builder';
import { CodegenSession, GenerationEventMetadata } from '../src/types';
import { GenerationContextSchemaV1 } from '../../../core/types/generation';

describe('Phase 3C: GenerationContext Builder', () => {
  const createBaseSession = (steps: any[]): CodegenSession => ({
    sessionId: 'session-123',
    url: 'https://example.com',
    title: 'Example',
    recordedAt: '2023-01-01T12:00:00Z',
    stepCount: steps.length,
    flowConfidence: 0.9,
    nodeCount: 1,
    steps,
  });

  it('Test 1: maps resolved CSS selectorResolution correctly', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-1',
        action: 'click',
        intent: 'click_button',
        selector: '.fallback',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-1', {
      id: 'evt-1',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '.primary-btn',
          engine: 'css',
          source: 'shadow-preference',
          replaySafe: true,
        },
      },
    });

    const context = deriveGenerationContext({ session, eventsById });
    expect(context.steps).toHaveLength(1);
    
    const step = context.steps[0];
    expect(step.locatorStatus).toBe('resolved');
    expect(step.resolvedTarget).toBeDefined();
    expect(step.resolvedTarget?.kind).toBe('css');
    expect(step.resolvedTarget?.value).toBe('.primary-btn');
    expect(step.resolvedTarget?.source).toBe('selectorResolution');
    expect(step.resolvedTarget?.replaySafe).toBe(true);
    expect(step.fallbackHints).toBeUndefined();
  });

  it('Test 2: maps resolved XPath selectorResolution correctly', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-2',
        action: 'input',
        intent: 'type_text',
        selector: '.fallback',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-2', {
      id: 'evt-2',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '//button[text()="Submit"]',
          engine: 'xpath',
          source: 'legacy-primary',
          replaySafe: true,
        },
      },
    });

    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('resolved');
    expect(step.resolvedTarget?.kind).toBe('xpath');
    expect(step.resolvedTarget?.value).toBe('//button[text()="Submit"]');
  });

  it('Test 3: falls back when selectorResolution is unresolved, retaining resolution data', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-3',
        action: 'click',
        intent: 'click_bad',
        selector: '.fallback',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-3', {
      id: 'evt-3',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'unresolved',
        blockedReason: 'ambiguous_target'
      },
      fallbackHints: {
        legacySelector: '.legacy',
        elementText: 'Broken',
      },
    });

    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('unresolved');
    expect(step.resolvedTarget).toBeUndefined();
    expect(step.fallbackHints).toEqual({ legacySelector: '.legacy', elementText: 'Broken' });
    expect(step.selectorResolution?.status).toBe('unresolved'); // Keeps context why it failed
  });

  it('Test 4: handles missing selectorResolution entirely, falling back to hints', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-4',
        action: 'click',
        intent: 'click_old',
        selector: '.from-step',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-4', {
      id: 'evt-4',
      fallbackHints: {
        tagName: 'DIV',
      },
    });

    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('unresolved');
    expect(step.fallbackHints).toEqual({ tagName: 'DIV', legacySelector: '.from-step' });
    expect(step.selectorResolution).toBeUndefined();
  });

  it('Test 5: treats replaySafe false as unresolved', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-5',
        action: 'click',
        intent: 'click_unsafe',
        selector: '.fallback',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-5', {
      id: 'evt-5',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '.dynamic-1234',
          engine: 'css',
          source: 'shadow-preference',
          replaySafe: false,
        },
      },
    });

    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('unresolved');
    expect(step.resolvedTarget).toBeUndefined();
    expect(step.fallbackHints?.legacySelector).toBe('.fallback');
  });

  it('Test 6: treats empty selector string as unresolved', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-6',
        action: 'click',
        intent: 'click_empty',
        selector: '.fallback',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-6', {
      id: 'evt-6',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '   ', // whitespace only
          engine: 'css',
          source: 'shadow-preference',
          replaySafe: true,
        },
      },
    });

    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('unresolved');
  });

  it('Test 7: extracts fallback hints from step if no metadata exists', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-missing', // Not in eventsById
        action: 'click',
        intent: 'click_missing',
        selector: '.step-selector',
        fingerprint: {
          textExcerpt: 'Click Me',
          tagName: 'SPAN',
        }
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();

    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('unresolved');
    expect(step.fallbackHints).toEqual({
      legacySelector: '.step-selector',
      elementText: 'Click Me',
      tagName: 'SPAN',
    });
  });

  it('Test 8: maps assertions leanly and safely', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-8',
        action: 'click',
        intent: 'assert_test',
        selector: '.btn',
        assertions: [
          { type: 'url', value: '/dashboard', source: 'navigation', confidence: 1 }, // Maps to outcome
          { type: 'element_visible', selector: '.modal', source: 'anchor', confidence: 0.8 }, // Maps to anchor
          { type: 'unknown_type', value: 'foo', source: 'weird' } // Maps to custom/anchor
        ],
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.assertions).toHaveLength(3);
    expect(step.assertions[0]).toEqual({ type: 'url', value: '/dashboard', source: 'outcome', confidence: 1 });
    expect(step.assertions[1]).toEqual({ type: 'element_visible', selector: '.modal', source: 'anchor', confidence: 0.8 });
    expect(step.assertions[2]).toEqual({ type: 'custom', value: 'foo', source: 'anchor' });
  });

  it('Test 9: handles not_applicable actions', () => {
    const session = createBaseSession([
      {
        step: 1,
        action: 'navigate',
        intent: 'go_home',
        value: 'https://example.com',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    const context = deriveGenerationContext({ session, eventsById });
    const step = context.steps[0];
    
    expect(step.locatorStatus).toBe('not_applicable');
    expect(step.resolvedTarget).toBeUndefined();
    expect(step.fallbackHints).toBeUndefined();
    expect(step.action).toBe('navigate');
    expect(step.value).toBe('https://example.com');
  });

  it('Test 10: passes output schema validation', () => {
    const session = createBaseSession([
      {
        step: 1,
        eventId: 'evt-10',
        action: 'input',
        intent: 'type_username',
        selector: '#username',
        value: 'alice',
      },
    ]);

    const eventsById = new Map<string, GenerationEventMetadata>();
    eventsById.set('evt-10', {
      id: 'evt-10',
      selectorResolution: {
        schemaVersion: 'air:selector-resolution:v1',
        status: 'resolved',
        selected: {
          selector: '#username',
          engine: 'css',
          source: 'legacy-primary',
          replaySafe: true,
        }
      }
    });

    const context = deriveGenerationContext({ session, eventsById });
    
    // This will throw if invalid
    const validated = GenerationContextSchemaV1.parse(context);
    expect(validated.schemaVersion).toBe('air:generation-context:v1');
    expect(validated.steps).toHaveLength(1);
    expect(validated.recordedAt).toBe(Date.parse('2023-01-01T12:00:00Z'));
  });
});
