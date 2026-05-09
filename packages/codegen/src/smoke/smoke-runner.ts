import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import type { AirMetadata, AirMethodMeta } from '../sidecar.types';
import { classifySmokeFailure } from './smoke-classifier';
import { writeControlledPlaywrightConfig } from './playwright-config-writer';
import {
  getRecommendedNextAction,
  pickFirstFailingResult,
  readRawPlaywrightResult,
  type RawPlaywrightResult,
  type SmokeFailureType,
  type SmokeReport,
  writeSmokeReport,
} from './smoke-report';
import { mapSmokeFailureToStep } from './step-mapper';

export interface SmokeRunOptions {
  specFile: string;
  sidecarFile?: string;
  generatedFile?: string;
  outputReportFile?: string;
  cwd?: string;
  runId?: string;
  runRoot?: string;
  executor?: (request: SmokeExecutionRequest) => Promise<SmokeExecutionResult>;
}

export interface SmokeExecutionRequest {
  command: string;
  args: string[];
  cwd: string;
  configPath: string;
  rawResultPath: string;
  runDir: string;
}

export interface SmokeExecutionResult {
  exitCode: number;
}

function createRunId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `smoke-${Date.now()}-${random}`;
}

function resolvePlaywrightCli(cwd: string): string {
  const localRequire = createRequire(path.join(cwd, 'package.json'));
  try {
    return localRequire.resolve('playwright/cli');
  } catch {
    throw new Error('Unable to resolve Playwright CLI. Ensure the playwright package is installed.');
  }
}

async function defaultExecutor(request: SmokeExecutionRequest): Promise<SmokeExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      stdio: 'pipe',
      windowsHide: true,
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => resolve({ exitCode: code ?? 1 }));
  });
}

function inferGeneratedFile(sidecarFile?: string | null, explicitGeneratedFile?: string | null): string | null {
  if (explicitGeneratedFile) return path.resolve(explicitGeneratedFile);
  if (!sidecarFile) return null;
  const resolved = path.resolve(sidecarFile);
  if (resolved.endsWith('.air.json')) {
    const candidate = resolved.slice(0, -'.air.json'.length) + '.ts';
    return candidate;
  }
  return null;
}

function readSidecar(sidecarFile?: string | null): AirMetadata | null {
  if (!sidecarFile) return null;
  const resolved = path.resolve(sidecarFile);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, 'utf8')) as AirMetadata;
}

function resolveFailureArtifacts(raw: RawPlaywrightResult | null): {
  screenshotPath: string | null;
  tracePath: string | null;
} {
  const failing = pickFirstFailingResult(raw);
  const attachments = failing?.attachments ?? [];

  const screenshot = attachments.find((attachment) =>
    attachment.contentType === 'image/png' || /screenshot/i.test(attachment.name ?? ''),
  );
  const trace = attachments.find((attachment) =>
    attachment.contentType === 'application/zip' || /trace/i.test(attachment.name ?? ''),
  );

  return {
    screenshotPath: screenshot?.path ?? null,
    tracePath: trace?.path ?? null,
  };
}

function enrichFromMethodMeta(methodMeta: AirMethodMeta | null): {
  exactProofSelector: string | null;
  exactProofEngine: string | null;
  exactProofLevel: string | null;
  proofLevel: string | null;
  selector: string | null;
  emittedLocator: string | null;
  emittedLocatorWarnings: string[];
  equivalentRenderingUsed: boolean;
  equivalentProofSource: string | null;
  equivalentSourceSelector: string | null;
} {
  if (!methodMeta) {
    return {
      exactProofSelector: null,
      exactProofEngine: null,
      exactProofLevel: null,
      proofLevel: null,
      selector: null,
      emittedLocator: null,
      emittedLocatorWarnings: [],
      equivalentRenderingUsed: false,
      equivalentProofSource: null,
      equivalentSourceSelector: null,
    };
  }

  const exactProofSelector =
    methodMeta.resolvedSelectorSpec?.selector ??
    methodMeta.selectorUsed ??
    methodMeta.originalSelector ??
    null;
  const exactProofEngine =
    methodMeta.resolvedSelectorSpec?.engine ??
    null;
  const exactProofLevel =
    methodMeta.resolvedSelectorSpec?.proofLevel ??
    (typeof methodMeta.emittedLocatorProofLevel === 'string' ? methodMeta.emittedLocatorProofLevel : null) ??
    null;

  return {
    exactProofSelector,
    exactProofEngine,
    exactProofLevel,
    proofLevel: exactProofLevel,
    selector: exactProofSelector,
    emittedLocator: methodMeta.emittedLocator ?? null,
    emittedLocatorWarnings: methodMeta.emittedLocatorWarnings ?? [],
    equivalentRenderingUsed: methodMeta.equivalentRenderingUsed ?? false,
    equivalentProofSource: methodMeta.equivalentProofSource ?? null,
    equivalentSourceSelector: methodMeta.equivalentSourceSelector ?? null,
  };
}

function synthesizeCompileErrorRawResult(error: Error): RawPlaywrightResult {
  return {
    reporterVersion: 1,
    runStatus: 'failed',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: 0,
    tests: [],
    globalErrors: [
      {
        message: error.message,
        stack: error.stack ?? null,
        location: null,
      },
    ],
  };
}

export async function runSmokeBaseline(options: SmokeRunOptions): Promise<SmokeReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const specFile = path.resolve(options.specFile);
  const sidecarFile = options.sidecarFile ? path.resolve(options.sidecarFile) : undefined;
  const generatedFile = inferGeneratedFile(sidecarFile, options.generatedFile) ?? specFile;
  const runId = options.runId ?? createRunId();
  const runRoot = options.runRoot
    ? path.resolve(options.runRoot)
    : path.join(cwd, '.air', 'smoke', runId);
  const outputReportFile = path.resolve(options.outputReportFile ?? path.join(runRoot, 'smoke-report.json'));
  const reporterFile = fileURLToPath(new URL('./air-reporter.ts', import.meta.url));

  const config = writeControlledPlaywrightConfig({
    runId,
    runRoot,
    specFile,
    reporterFile,
    cwd,
  });

  let rawResult = readRawPlaywrightResult(config.rawResultPath);
  const executor = options.executor ?? defaultExecutor;

  try {
    const request: SmokeExecutionRequest = {
      command: process.execPath,
      args: [options.executor ? 'playwright/cli' : resolvePlaywrightCli(cwd), 'test', '--config', config.configPath],
      cwd,
      configPath: config.configPath,
      rawResultPath: config.rawResultPath,
      runDir: config.runDir,
    };
    await executor(request);
    rawResult = readRawPlaywrightResult(config.rawResultPath);
  } catch (error) {
    rawResult = synthesizeCompileErrorRawResult(
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  const firstFailingResult = pickFirstFailingResult(rawResult);
  const selectedError =
    firstFailingResult?.error ??
    firstFailingResult?.errors?.[0] ??
    rawResult?.globalErrors?.[0] ??
    null;

  const mapping = mapSmokeFailureToStep({
    error: selectedError,
    generatedFile,
    specFile,
    sidecarFile,
  });
  const metadata = readSidecar(sidecarFile);
  const methodMeta = mapping.methodMeta;
  const artifacts = resolveFailureArtifacts(rawResult);
  const failureType = classifySmokeFailure({
    rawResult,
    error: selectedError,
    testStatus: firstFailingResult?.status ?? rawResult?.runStatus ?? null,
  });
  const emitted = enrichFromMethodMeta(methodMeta);

  const report: SmokeReport = {
    runId,
    sessionId: metadata?.session,
    generatedFile,
    sidecarFile,
    passed: failureType == null && rawResult?.runStatus === 'passed',
    firstFailingStep: mapping.firstFailingStep,
    failingMethodName: mapping.failingMethodName,
    failureType,
    failureMessage: selectedError?.message ?? null,
    exactProofSelector: emitted.exactProofSelector,
    exactProofEngine: emitted.exactProofEngine,
    exactProofLevel: emitted.exactProofLevel,
    proofLevel: emitted.proofLevel,
    selector: emitted.selector,
    emittedLocator: emitted.emittedLocator,
    emittedLocatorWarnings: emitted.emittedLocatorWarnings,
    equivalentRenderingUsed: emitted.equivalentRenderingUsed,
    equivalentProofSource: emitted.equivalentProofSource,
    equivalentSourceSelector: emitted.equivalentSourceSelector,
    screenshotPath: artifacts.screenshotPath,
    tracePath: artifacts.tracePath,
    rawPlaywrightResultPath: config.rawResultPath,
    stackLocation: mapping.stackLocation,
    recommendedNextAction: getRecommendedNextAction(failureType),
  };

  writeSmokeReport(report, outputReportFile);
  return report;
}
