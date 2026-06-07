import { GenerationContextSchemaV1 } from '../types/generation';
import { describe, it, expect } from 'vitest';

describe('GenerationContextV1 Schema Tests', () => {
  it('validates a minimal GenerationContextV1 with no steps', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: []
    };
    expect(() => GenerationContextSchemaV1.parse(context)).not.toThrow();
  });

  it('validates one resolved step with resolvedTarget.kind = "css"', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [{
        stepIndex: 1,
        action: 'click',
        intent: 'click_Button',
        locatorStatus: 'resolved',
        resolvedTarget: {
          kind: 'css',
          value: '.btn-primary',
          source: 'selectorResolution',
          replaySafe: true
        }
      }]
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.steps[0].locatorStatus).toBe('resolved');
    expect(parsed.steps[0].resolvedTarget?.kind).toBe('css');
  });

  it('validates one unresolved step with fallbackHints', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [{
        stepIndex: 1,
        action: 'type',
        intent: 'type_Input',
        locatorStatus: 'unresolved',
        fallbackHints: {
          legacySelector: '#username',
          tagName: 'input'
        }
      }]
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.steps[0].locatorStatus).toBe('unresolved');
    expect(parsed.steps[0].fallbackHints?.tagName).toBe('input');
  });

  it('validates one not_applicable navigation step', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [{
        stepIndex: 1,
        action: 'navigate',
        intent: 'navigate_Home',
        locatorStatus: 'not_applicable'
      }]
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.steps[0].locatorStatus).toBe('not_applicable');
  });

  it('validates assertion shape parses correctly', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [{
        stepIndex: 1,
        action: 'click',
        intent: 'click_Submit',
        locatorStatus: 'not_applicable',
        assertions: [{
          type: 'element_visible',
          selector: '.success-msg',
          source: 'outcome'
        }]
      }]
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.steps[0].assertions[0].type).toBe('element_visible');
    expect(parsed.steps[0].assertions[0].source).toBe('outcome');
  });

  it('rejects invalid resolvedTarget.kind = "playwright"', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [{
        stepIndex: 1,
        action: 'click',
        intent: 'click_Button',
        locatorStatus: 'resolved',
        resolvedTarget: {
          kind: 'playwright',
          value: 'page.locator(".btn")',
          source: 'legacy_fallback',
          replaySafe: false
        }
      }]
    };
    expect(() => GenerationContextSchemaV1.parse(context)).toThrow();
  });

  it('ignoredSteps defaults to empty array when omitted', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [],
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.ignoredSteps).toBeDefined();
    expect(Array.isArray(parsed.ignoredSteps)).toBe(true);
    expect(parsed.ignoredSteps).toHaveLength(0);
  });

  it('ignoredSteps with valid ignoredReason parses correctly', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [],
      ignoredSteps: [{
        stepIndex: 1,
        action: 'click',
        intent: 'click_container',
        locatorStatus: 'unresolved',
        ignoredReason: 'broad_no_change_container_click',
        ignoredExplanation: 'Broad container click with no_change outcome.',
      }],
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.ignoredSteps).toHaveLength(1);
    expect(parsed.ignoredSteps[0].ignoredReason).toBe('broad_no_change_container_click');
    expect(parsed.ignoredSteps[0].ignoredExplanation).toBe('Broad container click with no_change outcome.');
  });

  it('ignoredSteps rejects unknown ignoredReason', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [],
      ignoredSteps: [{
        stepIndex: 1,
        action: 'click',
        intent: 'click_container',
        locatorStatus: 'unresolved',
        ignoredReason: 'invented_unknown_reason',
      }],
    };
    expect(() => GenerationContextSchemaV1.parse(context)).toThrow();
  });

  it('generationGuidance with correct shape parses correctly', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [],
      generationGuidance: {
        replaySource: 'steps',
        ignoredStepsPolicy: 'context_only',
        rules: ['Generate code from steps only.'],
      },
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.generationGuidance).toBeDefined();
    expect(parsed.generationGuidance?.replaySource).toBe('steps');
    expect(parsed.generationGuidance?.ignoredStepsPolicy).toBe('context_only');
    expect(parsed.generationGuidance?.rules).toEqual(['Generate code from steps only.']);
  });

  it('generationGuidance is optional and absent context parses correctly', () => {
    const context = {
      schemaVersion: 'air:generation-context:v1',
      sessionId: 'sess-123',
      url: 'https://example.com',
      recordedAt: 1620000000000,
      steps: [],
    };
    const parsed = GenerationContextSchemaV1.parse(context);
    expect(parsed.generationGuidance).toBeUndefined();
  });
});

