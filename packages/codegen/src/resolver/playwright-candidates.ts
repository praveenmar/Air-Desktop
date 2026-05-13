import type {
  FingerprintData,
  PlaywrightLocatorNode,
  PlaywrightLocatorSpec,
  PlaywrightNativeCandidate,
} from '../types';

export interface PlaywrightCandidateGenerationOptions {
  logger?: Pick<Console, 'warn'>;
}

/**
 * Generates non-competing Playwright locator hypotheses from FingerprintData.
 * These candidates are unvalidated and should not be used in final resolution yet.
 */
export function generatePlaywrightCandidates(
  fingerprint: FingerprintData | null | undefined,
  source: PlaywrightLocatorSpec['source'] = 'resolver',
  options: PlaywrightCandidateGenerationOptions = {},
): PlaywrightNativeCandidate[] {
  const candidates: PlaywrightNativeCandidate[] = [];

  if (!fingerprint) {
    return candidates;
  }

  function warn(message: string): void {
    options.logger?.warn(message);
  }

  function asNonEmptyString(value: unknown): string | null {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    return null;
  }

  function isVolatileText(value: string): boolean {
    const hasDigits = /\d/.test(value);
    const isLong = value.length > 30;
    return hasDigits || isLong;
  }

  function buildCandidate(
    node: PlaywrightLocatorNode,
    reason: string,
    sourceEvidence: PlaywrightNativeCandidate['sourceEvidence'],
    warningCodes: string[] = []
  ): PlaywrightNativeCandidate {
    return {
      spec: {
        engine: 'playwright-locator',
        selector: '', // Required by SelectorSpecBase
        chain: [node],
        source,
        proofLevel: 'unvalidated',
      },
      reason,
      sourceEvidence,
      proofLevel: 'unvalidated',
      warningCodes,
    };
  }

  // 1. Task 3: getByTestId Candidates
  try {
    const attrs = fingerprint.attributes;
    if (attrs) {
      // Priority: data-testid, data-cy, data-qa, dataTestId
      const testId = asNonEmptyString(attrs['data-testid']) ||
                     asNonEmptyString(attrs['data-cy']) ||
                     asNonEmptyString(attrs['data-qa']) ||
                     asNonEmptyString(attrs.dataTestId);

      if (testId) {
        candidates.push(buildCandidate(
          { kind: 'getByTestId', value: testId },
          'found-test-id-attribute',
          'attributes'
        ));
      }
    }
  } catch (err) {
    warn(`Failed to extract testId candidates: ${err}`);
  }

  // 2. Accessibility Evidence Candidates
  try {
    const evidence = fingerprint.accessibilityEvidence;
    if (evidence) {
      const role = asNonEmptyString(evidence.role);
      const accessibleName = asNonEmptyString(evidence.accessibleName);

      // Task 4: getByRole
      if (role && role !== 'none') {
        const warningCodes: string[] = [];
        const node: PlaywrightLocatorNode = { kind: 'getByRole', value: role };

        if (accessibleName) {
          const volatile = isVolatileText(accessibleName);
          node.options = {
            name: accessibleName,
            exact: !volatile,
          };
          if (volatile) {
            warningCodes.push('playwright-native-text-volatile');
          }
        }

        candidates.push(buildCandidate(
          node,
          'found-role-in-accessibility-evidence',
          'accessibilityEvidence',
          warningCodes
        ));
      }

      // Task 5: getByLabel
      const validLabelSources = ['label-for', 'wrapped-label', 'aria-labelledby'];
      if (accessibleName && evidence.accessibleNameSource && validLabelSources.includes(evidence.accessibleNameSource)) {
        const warningCodes: string[] = [];
        const volatile = isVolatileText(accessibleName);
        if (volatile) {
          warningCodes.push('playwright-native-text-volatile');
        }

        candidates.push(buildCandidate(
          {
            kind: 'getByLabel',
            value: accessibleName,
            options: { exact: !volatile }
          },
          'found-label-association-in-accessibility-evidence',
          'accessibilityEvidence',
          warningCodes
        ));
      }

      // Task 6: getByPlaceholder
      if (accessibleName && evidence.accessibleNameSource === 'placeholder') {
        const warningCodes: string[] = [];
        const volatile = isVolatileText(accessibleName);
        if (volatile) {
          warningCodes.push('playwright-native-text-volatile');
        }

        candidates.push(buildCandidate(
          {
            kind: 'getByPlaceholder',
            value: accessibleName,
            options: { exact: !volatile }
          },
          'found-placeholder-in-accessibility-evidence',
          'accessibilityEvidence',
          warningCodes
        ));
      }
    }
  } catch (err) {
    warn(`Failed to extract accessibility candidates: ${err}`);
  }

  return candidates;
}
