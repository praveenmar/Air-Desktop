import { describe, expect, it } from 'vitest';
import { FlowReviewService } from '../src/flow-review.service';
import { getSelectorQuality } from '../src/flow-review.utils';
import type { CodegenSession } from '../src/types';

describe('flow-review utils - selector quality mapping', () => {
  it('classifies known high-quality priorities correctly', () => {
    expect(getSelectorQuality('data-testid')).toBe('best');
    expect(getSelectorQuality('id')).toBe('good');
    expect(getSelectorQuality('attribute')).toBe('good');
    expect(getSelectorQuality('text')).toBe('good');
  });

  it('classifies weak but known priorities as fragile', () => {
    expect(getSelectorQuality('class')).toBe('fragile');
    expect(getSelectorQuality('path')).toBe('fragile');
    expect(getSelectorQuality('xpath')).toBe('fragile');
    expect(getSelectorQuality('other')).toBe('fragile');
    expect(getSelectorQuality('chained')).toBe('fragile');
  });

  it('keeps truly unknown priorities as unknown', () => {
    expect(getSelectorQuality('multi-attribute')).toBe('unknown');
    expect(getSelectorQuality('legacy')).toBe('unknown');
  });
});

describe('flow-review service - warning severity for known weak priorities', () => {
  const baseSession: Omit<CodegenSession, 'steps'> = {
    sessionId: 'session-test',
    url: 'https://example.com/start',
    title: 'Test Flow',
    recordedAt: new Date('2026-04-07T00:00:00.000Z').toISOString(),
    stepCount: 1,
    flowConfidence: 1,
    nodeCount: 1,
  };

  it('treats "other" selector priority as fragile (warning)', () => {
    const review = FlowReviewService.build({
      ...baseSession,
      steps: [
        {
          step: 1,
          intent: 'click_weird_selector',
          action: 'click',
          selector: 'div > div:nth-of-type(2)',
          selectorPriority: 'other',
          selectorRank: 10,
          pageUrl: 'https://example.com/start',
          confidence: 1,
          sampleSize: 1,
          assertions: [],
          userAssertions: [],
          outcomeType: 'no_change',
        },
      ],
    });

    expect(review.steps[0].selectorQuality).toBe('fragile');
    expect(
      review.warnings.some(
        (w) =>
          w.type === 'fragile_selector' &&
          w.severity === 'warning' &&
          w.step === 1,
      ),
    ).toBe(true);
  });

  it('treats "chained" selector priority as fragile (warning)', () => {
    const review = FlowReviewService.build({
      ...baseSession,
      steps: [
        {
          step: 1,
          intent: 'click_chained_selector',
          action: 'click',
          selector: 'form [name="q"] >> nth=0',
          selectorPriority: 'chained',
          selectorRank: 10,
          pageUrl: 'https://example.com/start',
          confidence: 1,
          sampleSize: 1,
          assertions: [],
          userAssertions: [],
          outcomeType: 'no_change',
        },
      ],
    });

    expect(review.steps[0].selectorQuality).toBe('fragile');
    expect(
      review.warnings.some(
        (w) =>
          w.type === 'fragile_selector' &&
          w.severity === 'warning' &&
          w.step === 1,
      ),
    ).toBe(true);
  });
});
