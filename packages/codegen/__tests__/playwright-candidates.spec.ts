import { describe, it, expect, vi } from 'vitest';
import { generatePlaywrightCandidates } from '../src/resolver/playwright-candidates';
import type { FingerprintData } from '../src/types';

describe('Playwright Native Candidate Generator', () => {
  it('1. returns empty array for null/undefined fingerprint', () => {
    expect(generatePlaywrightCandidates(null)).toEqual([]);
    expect(generatePlaywrightCandidates(undefined)).toEqual([]);
  });

  it('2. returns empty array if no test IDs and no accessibilityEvidence', () => {
    const fingerprint: FingerprintData = { attributes: {}, accessibilityEvidence: {} };
    expect(generatePlaywrightCandidates(fingerprint)).toEqual([]);
  });

  it('3. generates getByTestId from data-testid', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-testid': 'submit-btn' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].spec.chain[0]).toEqual({
      kind: 'getByTestId',
      value: 'submit-btn'
    });
    expect(candidates[0].reason).toBe('found-test-id-attribute');
  });

  it('4. generates getByTestId from data-cy', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-cy': 'cypress-id' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates[0].spec.chain[0].value).toBe('cypress-id');
  });

  it('5. generates getByTestId from data-qa', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-qa': 'qa-id' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates[0].spec.chain[0].value).toBe('qa-id');
  });

  it('6. ignores empty/non-string test id values', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-testid': '  ' }
    };
    expect(generatePlaywrightCandidates(fingerprint)).toEqual([]);
  });

  it('7. generates getByRole without options if only role exists', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: { role: 'button' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates[0].spec.chain[0]).toEqual({
      kind: 'getByRole',
      value: 'button'
    });
  });

  it('8. generates getByRole with exact: true for stable name "Submit"', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: { role: 'button', accessibleName: 'Submit' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates[0].spec.chain[0].options).toEqual({
      name: 'Submit',
      exact: true
    });
    expect(candidates[0].warningCodes).not.toContain('playwright-native-text-volatile');
  });

  it('9. generates getByRole with exact: false and warning for volatile name "Cart (3)"', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: { role: 'button', accessibleName: 'Cart (3)' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates[0].spec.chain[0].options).toEqual({
      name: 'Cart (3)',
      exact: false
    });
    expect(candidates[0].warningCodes).toContain('playwright-native-text-volatile');
  });

  it('10. generates getByLabel for label-for', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: {
        accessibleName: 'Username',
        accessibleNameSource: 'label-for'
      }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.some(c => c.spec.chain[0].kind === 'getByLabel')).toBe(true);
  });

  it('11. generates getByLabel for wrapped-label', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: {
        accessibleName: 'Password',
        accessibleNameSource: 'wrapped-label'
      }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.some(c => c.spec.chain[0].kind === 'getByLabel')).toBe(true);
  });

  it('12. generates getByLabel for aria-labelledby', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: {
        accessibleName: 'Search',
        accessibleNameSource: 'aria-labelledby'
      }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.some(c => c.spec.chain[0].kind === 'getByLabel')).toBe(true);
  });

  it('13. does not generate getByLabel for placeholder', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: {
        accessibleName: 'Search...',
        accessibleNameSource: 'placeholder'
      }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.some(c => c.spec.chain[0].kind === 'getByLabel')).toBe(false);
  });

  it('14. does not generate getByLabel for aria-label in this ticket', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: {
        accessibleName: 'Close',
        accessibleNameSource: 'aria-label'
      }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.some(c => c.spec.chain[0].kind === 'getByLabel')).toBe(false);
  });

  it('15. generates getByPlaceholder for placeholder evidence', () => {
    const fingerprint: FingerprintData = {
      accessibilityEvidence: {
        accessibleName: 'Search...',
        accessibleNameSource: 'placeholder'
      }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.some(c => c.spec.chain[0].kind === 'getByPlaceholder')).toBe(true);
  });

  it('16. handles malformed/throwing attributes object without crashing', () => {
    const fingerprint: any = {
      get attributes() { throw new Error('Crashed!'); }
    };
    const logger = { warn: vi.fn() };
    const candidates = generatePlaywrightCandidates(fingerprint, 'resolver', { logger });
    expect(candidates).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('17. handles malformed/throwing accessibilityEvidence object without crashing', () => {
    const fingerprint: any = {
      attributes: {},
      get accessibilityEvidence() { throw new Error('Crashed!'); }
    };
    const logger = { warn: vi.fn() };
    const candidates = generatePlaywrightCandidates(fingerprint, 'resolver', { logger });
    expect(candidates).toEqual([]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('18. uses optional logger when a block fails', () => {
    const fingerprint: any = {
      get attributes() { throw new Error('Crashed!'); }
    };
    const logger = { warn: vi.fn() };
    generatePlaywrightCandidates(fingerprint, 'resolver', { logger });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to extract testId candidates'));
  });

  it('19. does not call global console.warn', () => {
    const spy = vi.spyOn(console, 'warn');
    const fingerprint: any = {
      get attributes() { throw new Error('Crashed!'); }
    };
    generatePlaywrightCandidates(fingerprint);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('20. all generated candidates have proofLevel: unvalidated', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-testid': 'test' },
      accessibilityEvidence: { role: 'button', accessibleName: 'Submit' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    expect(candidates.length).toBeGreaterThan(0);
    candidates.forEach(c => {
      expect(c.proofLevel).toBe('unvalidated');
      expect(c.spec.proofLevel).toBe('unvalidated');
    });
  });

  it('21. generated candidates are not RawCandidate and do not include score/rank fields', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-testid': 'test' }
    };
    const candidates = generatePlaywrightCandidates(fingerprint);
    const candidate = candidates[0] as any;
    expect(candidate.score).toBeUndefined();
    expect(candidate.rank).toBeUndefined();
    expect(candidate.spec.rank).toBeUndefined();
  });

  it('22. does not mutate input fingerprint', () => {
    const fingerprint: FingerprintData = {
      attributes: { 'data-testid': 'test' },
      accessibilityEvidence: { role: 'button' }
    };
    const frozen = JSON.parse(JSON.stringify(fingerprint));
    generatePlaywrightCandidates(fingerprint);
    expect(fingerprint).toEqual(frozen);
  });
});
