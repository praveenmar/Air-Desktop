import { describe, it, expect } from 'vitest';
import { buildPlaywrightCandidateReport } from '../src/resolver/playwright-candidate-report';
import { EvaluatedPlaywrightNativeCandidate } from '../src/types';

describe('Playwright Candidate Report Builder', () => {
  const mockEvaluated: EvaluatedPlaywrightNativeCandidate = {
    candidate: {
      spec: {
        engine: 'playwright-locator',
        selector: '',
        source: 'resolver',
        proofLevel: 'unvalidated',
        chain: [{ kind: 'getByRole', value: 'button', options: { name: 'Submit', exact: true } }],
      },
      reason: 'accessibility-role-match',
      sourceEvidence: 'accessibilityEvidence',
      proofLevel: 'unvalidated',
      warningCodes: [],
    },
    status: 'valid',
    matchCount: 1,
    visibleMatchCount: 1,
    isUnique: true,
    isAmbiguous: false,
    isGloballyAmbiguous: false,
    warningCodes: [],
    validationSource: 'snapshot-approximation',
  };

  it('1. builds valid report entry with page root', () => {
    const report = buildPlaywrightCandidateReport([mockEvaluated]);
    expect(report).toHaveLength(1);
    expect(report[0].locator).toBe('page.getByRole("button", { name: "Submit", exact: true })');
    expect(report[0].status).toBe('valid');
    expect(report[0].engine).toBe('playwright-locator');
  });

  it('2. handles compile failures gracefully', () => {
    const malformed: EvaluatedPlaywrightNativeCandidate = {
      ...mockEvaluated,
      candidate: {
        ...mockEvaluated.candidate,
        spec: {
          ...mockEvaluated.candidate.spec,
          chain: [], // Empty chain triggers throw in compiler
        },
      },
    };
    
    const report = buildPlaywrightCandidateReport([malformed]);
    expect(report).toHaveLength(1);
    expect(report[0].status).toBe('blocked');
    expect(report[0].rejectReason).toBe('compile-failed');
    expect(report[0].warningCodes).toContain('playwright-native-report-compile-failed');
  });

  it('3. bounds entries to maxEntries', () => {
    const many = Array(20).fill(mockEvaluated);
    const report = buildPlaywrightCandidateReport(many, { maxEntries: 5 });
    expect(report).toHaveLength(5);
  });

  it('4. preserves evaluation metadata', () => {
    const ambiguous: EvaluatedPlaywrightNativeCandidate = {
      ...mockEvaluated,
      matchCount: 2,
      visibleMatchCount: 1,
      isUnique: true,
      isGloballyAmbiguous: true,
      warningCodes: ['playwright-native-global-ambiguity'],
    };
    
    const report = buildPlaywrightCandidateReport([ambiguous]);
    expect(report[0].isUnique).toBe(true);
    expect(report[0].isGloballyAmbiguous).toBe(true);
    expect(report[0].warningCodes).toContain('playwright-native-global-ambiguity');
  });

  it('5. preserves rejectReason', () => {
    const blocked: EvaluatedPlaywrightNativeCandidate = {
      ...mockEvaluated,
      status: 'blocked',
      rejectReason: 'multiple-visible-matches',
    };
    
    const report = buildPlaywrightCandidateReport([blocked]);
    expect(report[0].status).toBe('blocked');
    expect(report[0].rejectReason).toBe('multiple-visible-matches');
  });
});
