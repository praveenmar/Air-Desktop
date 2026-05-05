import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { summarizeSmokeReports } from '../src/smoke/smoke-kpi';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeSidecar(params: {
  proofLevel: string;
  engine: string;
  category: string;
  warnings?: string[];
  usedSelectorSpec?: boolean;
  session?: string;
}) {
  return {
    version: 1,
    session: params.session ?? 'session-kpi',
    generatedAt: '2026-05-04T00:00:00.000Z',
    methods: {
      clickThing: {
        step: 3,
        intent: 'click_thing',
        checksum: 'checksum-1',
        originalSelector: 'button',
        selectorUsed: 'button[name="thing"]',
        resolvedSelectorSpec: {
          selector: 'button[name="thing"]',
          engine: params.engine,
          source: 'resolver',
          proofLevel: params.proofLevel,
        },
        resolver: {
          resolvedSelector: 'button[name="thing"]',
          resolvedBy: 'deterministic-override',
          bestScore: 0.91,
          effectiveMatchCount: 1,
          snapshotSource: 'latest',
          validationMethod: 'test',
          llmAttempted: false,
          llmAccepted: false,
          llmAlternative: null,
          rejectReason: null,
          warningCodes: params.warnings ?? [],
          resolverVersion: 1,
          selectorEvaluation: {
            selectorSpec: {
              selector: 'button[name="thing"]',
              engine: params.engine,
              source: 'resolver',
              proofLevel: params.proofLevel,
            },
            category: params.category,
            validation: {
              valid: true,
              matchCount: 1,
              visibleMatchCount: 1,
              uniqueVisible: true,
            },
            proof: {
              proofLevel: params.proofLevel,
              proofSource: 'semantic',
            },
            scoring: {
              proofScore: 1,
              stabilityScore: 0.8,
              semanticScore: 0.9,
              brittlenessPenalty: 0,
              entropyPenalty: 0,
              finalScore: 0.91,
            },
            reasons: [`category:${params.category}`],
            warningCodes: params.warnings ?? [],
          },
        },
        emittedLocator: 'locator("button[name=\\"thing\\"]")',
        emittedLocatorEngine: params.engine,
        emittedLocatorProofLevel: params.proofLevel,
        emittedLocatorSource: 'resolver',
        emittedLocatorWarnings: params.warnings ?? [],
        usedSelectorSpec: params.usedSelectorSpec ?? true,
      },
    },
  };
}

function makeSmokeReport(params: {
  generatedFile: string;
  sidecarFile?: string;
  passed: boolean;
  failureType?: string | null;
  proofLevel?: string | null;
  warnings?: string[];
}) {
  return {
    runId: `run-${Math.random().toString(36).slice(2, 7)}`,
    sessionId: 'session-kpi',
    generatedFile: params.generatedFile,
    sidecarFile: params.sidecarFile,
    passed: params.passed,
    firstFailingStep: params.passed ? null : 3,
    failingMethodName: params.passed ? null : 'clickThing',
    failureType: params.failureType ?? null,
    failureMessage: params.passed ? null : 'failure',
    proofLevel: params.proofLevel ?? null,
    selector: 'button[name="thing"]',
    emittedLocator: params.passed ? 'locator("button[name=\\"thing\\"]")' : null,
    emittedLocatorWarnings: params.warnings ?? [],
    screenshotPath: null,
    tracePath: null,
    rawPlaywrightResultPath: null,
    stackLocation: params.passed ? null : { file: params.generatedFile, line: 12, column: 3 },
    recommendedNextAction: params.passed ? null : 'inspect',
  };
}

describe('smoke KPI summary', () => {
  it('aggregates pass/fail reports and computes first-run smoke pass rate correctly', () => {
    const dir = makeTempDir('air-smoke-kpi-aggregate-');
    const pageFile = path.join(dir, 'DemoPage.ts');
    const passReport = path.join(dir, 'pass', 'smoke-report.json');
    const locatorSidecar = path.join(dir, 'locator', 'DemoPage.air.json');
    const locatorReport = path.join(dir, 'locator', 'smoke-report.json');
    const blockedSidecar = path.join(dir, 'blocked', 'DemoPage.air.json');
    const blockedReport = path.join(dir, 'blocked', 'smoke-report.json');

    writeJson(passReport, makeSmokeReport({ generatedFile: pageFile, passed: true }));
    writeJson(locatorSidecar, makeSidecar({
      proofLevel: 'semantic_validated',
      engine: 'css',
      category: 'name',
      warnings: ['deterministic-override'],
      usedSelectorSpec: true,
    }));
    writeJson(locatorReport, makeSmokeReport({
      generatedFile: pageFile,
      sidecarFile: locatorSidecar,
      passed: false,
      failureType: 'locator_not_found',
      proofLevel: 'semantic_validated',
      warnings: ['deterministic-override'],
    }));
    writeJson(blockedSidecar, makeSidecar({
      proofLevel: 'blocked',
      engine: 'css',
      category: 'structural',
      warnings: ['blocked-selector'],
      usedSelectorSpec: false,
    }));
    writeJson(blockedReport, makeSmokeReport({
      generatedFile: pageFile,
      sidecarFile: blockedSidecar,
      passed: false,
      failureType: 'air_blocked_step',
      proofLevel: 'blocked',
      warnings: ['blocked-selector'],
    }));

    const summary = summarizeSmokeReports({
      reportFiles: [passReport, locatorReport, blockedReport],
      cwd: dir,
    });

    expect(summary.totalRuns).toBe(3);
    expect(summary.passedRuns).toBe(1);
    expect(summary.failedRuns).toBe(2);
    expect(summary.firstRunSmokePassRate).toBeCloseTo(1 / 3, 5);
    expect(summary.failureTypeBreakdown).toEqual({
      locator_not_found: 1,
      air_blocked_step: 1,
    });
    expect(summary.compileErrorRate).toBe(0);
    expect(summary.locatorNotFoundRate).toBeCloseTo(1 / 3, 5);
    expect(summary.airBlockedStepRate).toBeCloseTo(1 / 3, 5);
  });

  it('groups proof levels, engines, selector categories, and warning codes from sidecar metadata', () => {
    const dir = makeTempDir('air-smoke-kpi-groups-');
    const pageFile = path.join(dir, 'DemoPage.ts');
    const reportFile = path.join(dir, 'run', 'smoke-report.json');
    const sidecarFile = path.join(dir, 'run', 'DemoPage.air.json');

    writeJson(sidecarFile, makeSidecar({
      proofLevel: 'semantic_validated',
      engine: 'css',
      category: 'testid',
      warnings: ['deterministic-override', 'weak-selector'],
      usedSelectorSpec: true,
    }));
    writeJson(reportFile, makeSmokeReport({
      generatedFile: pageFile,
      sidecarFile,
      passed: false,
      failureType: 'action_timeout',
      proofLevel: 'semantic_validated',
      warnings: ['deterministic-override'],
    }));

    const summary = summarizeSmokeReports({
      reportFiles: [reportFile],
      cwd: dir,
    });

    expect(summary.proofLevelBreakdown.semantic_validated).toBe(1);
    expect(summary.engineBreakdown.css).toBe(1);
    expect(summary.selectorCategoryBreakdown.testid).toBe(1);
    expect(summary.warningBreakdown['deterministic-override']).toBe(1);
    expect(summary.warningBreakdown['weak-selector']).toBe(1);
    expect(summary.failuresByProofLevel.semantic_validated).toBe(1);
    expect(summary.failuresByEngine.css).toBe(1);
    expect(summary.failuresBySelectorCategory.testid).toBe(1);
    expect(summary.failuresByWarningCode['weak-selector']).toBe(1);
  });

  it('handles malformed and missing reports safely', () => {
    const dir = makeTempDir('air-smoke-kpi-malformed-');
    const goodReport = path.join(dir, 'good', 'smoke-report.json');
    const malformedReport = path.join(dir, 'bad', 'smoke-report.json');
    const missingReport = path.join(dir, 'missing', 'smoke-report.json');

    writeJson(goodReport, makeSmokeReport({
      generatedFile: path.join(dir, 'DemoPage.ts'),
      passed: true,
    }));
    fs.mkdirSync(path.dirname(malformedReport), { recursive: true });
    fs.writeFileSync(malformedReport, '{bad json', 'utf8');

    const summary = summarizeSmokeReports({
      reportFiles: [goodReport, malformedReport, missingReport],
      cwd: dir,
    });

    expect(summary.totalRuns).toBe(1);
    expect(summary.skippedReports).toEqual(
      expect.arrayContaining([malformedReport, missingReport]),
    );
  });

  it('handles empty input and writes summary JSON', () => {
    const dir = makeTempDir('air-smoke-kpi-empty-');
    const outputFile = path.join(dir, 'summary.json');

    const summary = summarizeSmokeReports({
      reportRoot: path.join(dir, '.air', 'smoke'),
      outputFile,
      cwd: dir,
    });

    expect(summary.totalRuns).toBe(0);
    expect(summary.firstRunSmokePassRate).toBe(0);
    expect(fs.existsSync(outputFile)).toBe(true);

    const persisted = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    expect(persisted.totalRuns).toBe(0);
    expect(persisted.generatedAt).toEqual(expect.any(String));
  });
});
