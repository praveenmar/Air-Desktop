import type {
  EvaluatedPlaywrightNativeCandidate,
  PlaywrightNativeCandidateReportEntry,
} from '../types';
import { compilePlaywrightLocator } from '../locator-compiler';

/**
 * Builds a report-ready list of Playwright native candidates for sidecar observability.
 * Transforms evaluated candidates into a serializable format for sidecar metadata.
 */
export function buildPlaywrightCandidateReport(
  evaluatedCandidates: EvaluatedPlaywrightNativeCandidate[],
  options?: {
    maxEntries?: number;
  }
): PlaywrightNativeCandidateReportEntry[] {
  const maxEntries = options?.maxEntries ?? 10;
  
  return evaluatedCandidates
    .slice(0, maxEntries)
    .map(evaluated => {
      let locator = '';
      let status = evaluated.status;
      let rejectReason = evaluated.rejectReason;
      const warningCodes = [...evaluated.warningCodes];

      try {
        // We manually prefix with 'page' as required for the report entries.
        // We do not modify the locator-compiler to maintain strict guardrails.
        locator = `page.${compilePlaywrightLocator(evaluated.candidate.spec)}`;
      } catch (err) {
        // If compilation fails, we mark as blocked/approximate to avoid crashing the report.
        status = status === 'valid' ? 'blocked' : status;
        rejectReason = 'compile-failed';
        warningCodes.push('playwright-native-report-compile-failed');
      }

      return {
        locator,
        engine: 'playwright-locator',
        status,
        proofLevel: 'unvalidated',
        validationSource: 'snapshot-approximation',
        reason: evaluated.candidate.reason,
        sourceEvidence: evaluated.candidate.sourceEvidence,
        matchCount: evaluated.matchCount,
        visibleMatchCount: evaluated.visibleMatchCount,
        isUnique: evaluated.isUnique,
        isAmbiguous: evaluated.isAmbiguous,
        isGloballyAmbiguous: evaluated.isGloballyAmbiguous,
        warningCodes,
        rejectReason,
      };
    });
}
