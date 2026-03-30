import { describe, it, expect } from 'vitest';
import { 
  normalizeSelectorPriority,
  rankFromPriority,
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
