import * as fs from 'fs';
import * as path from 'path';

export type SmokeFailureType =
  | 'compile_error'
  | 'locator_not_found'
  | 'locator_ambiguous'
  | 'action_timeout'
  | 'navigation_timeout'
  | 'assertion_failure'
  | 'air_blocked_step'
  | 'air_unvalidated_step'
  | 'runtime_unknown';

export interface SmokeStackLocation {
  file: string;
  line: number;
  column?: number;
}

export interface SmokeReporterAttachment {
  name?: string;
  contentType?: string;
  path?: string | null;
}

export interface SmokeReporterError {
  message?: string | null;
  stack?: string | null;
  location?: SmokeStackLocation | null;
}

export interface SmokeReporterAnnotation {
  type: string;
  description?: string;
}

export interface SmokeReporterTestResult {
  file: string;
  title: string;
  titlePath: string[];
  status: string;
  duration: number;
  retry: number;
  attachments: SmokeReporterAttachment[];
  error?: SmokeReporterError | null;
  errors?: SmokeReporterError[];
  annotations?: SmokeReporterAnnotation[];
}

export interface RawPlaywrightResult {
  reporterVersion: 1;
  runStatus: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  outputDir?: string | null;
  tests: SmokeReporterTestResult[];
  globalErrors?: SmokeReporterError[];
}

export interface SmokeReport {
  runId: string;
  sessionId?: string;
  generatedFile: string;
  sidecarFile?: string;
  passed: boolean;
  firstFailingStep?: number | null;
  failingMethodName?: string | null;
  failureType?: SmokeFailureType | null;
  failureMessage?: string | null;
  proofLevel?: string | null;
  selector?: string | null;
  emittedLocator?: string | null;
  emittedLocatorWarnings?: string[];
  screenshotPath?: string | null;
  tracePath?: string | null;
  rawPlaywrightResultPath?: string | null;
  stackLocation?: SmokeStackLocation | null;
  recommendedNextAction?: string | null;
}

export function writeSmokeReport(report: SmokeReport, outputFile: string): void {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function readRawPlaywrightResult(resultPath: string): RawPlaywrightResult | null {
  if (!fs.existsSync(resultPath)) return null;
  return JSON.parse(fs.readFileSync(resultPath, 'utf8')) as RawPlaywrightResult;
}

export function pickFirstFailingResult(
  raw: RawPlaywrightResult | null,
): SmokeReporterTestResult | null {
  if (!raw) return null;
  return raw.tests.find((test) => test.status !== 'passed' && test.status !== 'skipped') ?? null;
}

export function getRecommendedNextAction(
  failureType: SmokeFailureType | null | undefined,
): string | null {
  switch (failureType) {
    case 'compile_error':
      return 'fix-generated-script-compile-error';
    case 'locator_not_found':
    case 'locator_ambiguous':
    case 'action_timeout':
      return 'inspect-selector-proof-and-page-state';
    case 'navigation_timeout':
      return 'check-navigation-auth-and-waits';
    case 'assertion_failure':
      return 'inspect-expected-outcome';
    case 'air_blocked_step':
    case 'air_unvalidated_step':
      return 'review-generated-flow-and-selector-proof';
    case 'runtime_unknown':
      return 'inspect-raw-playwright-result';
    default:
      return null;
  }
}
