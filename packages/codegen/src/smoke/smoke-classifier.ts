import type { RawPlaywrightResult, SmokeFailureType, SmokeReporterError } from './smoke-report';

function normalizeMessage(error: SmokeReporterError | null | undefined): string {
  const message = `${error?.message ?? ''}\n${error?.stack ?? ''}`.trim();
  return message.toLowerCase();
}

export function classifySmokeFailure(params: {
  rawResult: RawPlaywrightResult | null;
  error: SmokeReporterError | null | undefined;
  testStatus?: string | null;
}): SmokeFailureType | null {
  const normalized = normalizeMessage(params.error);

  if (!params.error && params.rawResult?.runStatus === 'passed') {
    return null;
  }

  if (normalized.includes('air unresolved step') && normalized.includes('proof level "blocked"')) {
    return 'air_blocked_step';
  }
  if (normalized.includes('air unresolved step') && normalized.includes('proof level "unvalidated"')) {
    return 'air_unvalidated_step';
  }

  const hasGlobalErrors = (params.rawResult?.globalErrors?.length ?? 0) > 0;
  const hasNoExecutedTests = (params.rawResult?.tests?.length ?? 0) === 0;
  if (
    hasGlobalErrors && (
      hasNoExecutedTests ||
      normalized.includes('cannot find module') ||
      normalized.includes('syntaxerror') ||
      normalized.includes('unexpected token') ||
      normalized.includes('failed to load') ||
      normalized.includes('cannot use import statement') ||
      normalized.includes('playwright test did not expect')
    )
  ) {
    return 'compile_error';
  }

  if (
    normalized.includes('strict mode violation') ||
    normalized.includes('resolved to ') ||
    normalized.includes('multiple elements')
  ) {
    return 'locator_ambiguous';
  }

  if (
    normalized.includes('page.goto') ||
    normalized.includes('waitforurl') ||
    normalized.includes('tohaveurl') ||
    normalized.includes('navigation')
  ) {
    return 'navigation_timeout';
  }

  if (
    normalized.includes('locator.waitfor') ||
    normalized.includes('waiting for locator') ||
    normalized.includes('resolved to 0 elements') ||
    normalized.includes('element(s) not found')
  ) {
    return 'locator_not_found';
  }

  if (
    normalized.includes('locator.click') ||
    normalized.includes('locator.fill') ||
    normalized.includes('locator.press') ||
    normalized.includes('locator.hover') ||
    normalized.includes('locator.check') ||
    normalized.includes('locator.selectoption') ||
    normalized.includes('timeout')
  ) {
    return 'action_timeout';
  }

  if (
    normalized.includes('expect(') ||
    normalized.includes('expect.to') ||
    normalized.includes('expect(received)') ||
    normalized.includes('assertion')
  ) {
    return 'assertion_failure';
  }

  if (params.testStatus && params.testStatus !== 'passed' && hasGlobalErrors && hasNoExecutedTests) {
    return 'compile_error';
  }

  return 'runtime_unknown';
}
