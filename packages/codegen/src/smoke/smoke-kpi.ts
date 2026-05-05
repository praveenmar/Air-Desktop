import * as fs from 'fs';
import * as path from 'path';
import type { AirMetadata, AirMethodMeta } from '../sidecar.types';
import type { SmokeFailureType, SmokeReport } from './smoke-report';

export interface SmokeKpiSummaryEntry {
  key: string;
  count: number;
}

export interface SmokeKpiSummary {
  generatedAt: string;
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  firstRunSmokePassRate: number;
  compileErrorRate: number;
  locatorNotFoundRate: number;
  locatorAmbiguousRate: number;
  actionTimeoutRate: number;
  navigationTimeoutRate: number;
  assertionFailureRate: number;
  airBlockedStepRate: number;
  airUnvalidatedStepRate: number;
  runtimeUnknownRate: number;
  failureTypeBreakdown: Record<string, number>;
  proofLevelBreakdown: Record<string, number>;
  engineBreakdown: Record<string, number>;
  selectorCategoryBreakdown: Record<string, number>;
  warningBreakdown: Record<string, number>;
  mostCommonFailingSteps: Array<{ step: number; count: number }>;
  mostCommonFailureTypes: SmokeKpiSummaryEntry[];
  failuresByProofLevel: Record<string, number>;
  failuresByEngine: Record<string, number>;
  failuresBySelectorCategory: Record<string, number>;
  failuresByWarningCode: Record<string, number>;
  topFailures: SmokeKpiSummaryEntry[];
  skippedReports?: string[];
}

export interface SmokeKpiOptions {
  reportFiles?: string[];
  reportRoot?: string;
  outputFile?: string;
  sessionMapFile?: string;
  cwd?: string;
}

interface SessionMapData {
  version?: number;
  mappings?: Record<
    string,
    {
      canonicalSessionId?: string;
      previousSessionIds?: string[];
      lastUpdated?: string;
      startingUrl?: string;
    }
  >;
}

interface EnrichedSmokeRecord {
  report: SmokeReport;
  sessionId?: string;
  proofLevel: string;
  engine: string;
  selectorCategory: string;
  warningCodes: string[];
  usedSelectorSpec: boolean | null;
}

function normalizeKey(value: string | null | undefined, fallback = 'unknown'): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function incrementBucket(bucket: Record<string, number>, key: string | null | undefined): void {
  const normalized = normalizeKey(key);
  bucket[normalized] = (bucket[normalized] ?? 0) + 1;
}

function toSortedEntries(bucket: Record<string, number>): SmokeKpiSummaryEntry[] {
  return Object.entries(bucket)
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.key.localeCompare(right.key);
    });
}

function toSortedStepEntries(bucket: Record<string, number>): Array<{ step: number; count: number }> {
  return Object.entries(bucket)
    .map(([step, count]) => ({ step: Number(step), count }))
    .filter((entry) => Number.isFinite(entry.step))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      return left.step - right.step;
    });
}

function discoverSmokeReportFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) return [];
  const resolvedRoot = path.resolve(rootDir);
  const discovered: string[] = [];

  const walk = (currentDir: string): void => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'smoke-report.json') {
        discovered.push(fullPath);
      }
    }
  };

  walk(resolvedRoot);
  return discovered.sort((left, right) => left.localeCompare(right));
}

function readSmokeReportSafe(reportFile: string): SmokeReport | null {
  try {
    const raw = fs.readFileSync(reportFile, 'utf8');
    return JSON.parse(raw) as SmokeReport;
  } catch {
    return null;
  }
}

function readSidecarSafe(sidecarFile?: string | null): AirMetadata | null {
  if (!sidecarFile) return null;
  try {
    const resolved = path.resolve(sidecarFile);
    if (!fs.existsSync(resolved)) return null;
    return JSON.parse(fs.readFileSync(resolved, 'utf8')) as AirMetadata;
  } catch {
    return null;
  }
}

function readSessionMapSafe(sessionMapFile?: string | null): SessionMapData | null {
  if (!sessionMapFile) return null;
  try {
    const resolved = path.resolve(sessionMapFile);
    if (!fs.existsSync(resolved)) return null;
    return JSON.parse(fs.readFileSync(resolved, 'utf8')) as SessionMapData;
  } catch {
    return null;
  }
}

function findMethodMeta(sidecar: AirMetadata | null, report: SmokeReport): AirMethodMeta | null {
  if (!sidecar?.methods) return null;
  if (report.failingMethodName && sidecar.methods[report.failingMethodName]) {
    return sidecar.methods[report.failingMethodName] ?? null;
  }
  if (typeof report.firstFailingStep === 'number') {
    return (
      Object.values(sidecar.methods).find((methodMeta) => methodMeta.step === report.firstFailingStep) ?? null
    );
  }
  return null;
}

function resolveSessionId(
  report: SmokeReport,
  sessionMap: SessionMapData | null,
  sessionMapFile?: string,
): string | undefined {
  if (report.sessionId) return report.sessionId;
  if (!sessionMap?.mappings || !sessionMapFile) return undefined;
  const projectRoot = path.dirname(path.resolve(sessionMapFile));
  const relativeGenerated = path
    .relative(projectRoot, path.resolve(report.generatedFile))
    .replace(/\\/g, '/');
  return sessionMap.mappings[relativeGenerated]?.canonicalSessionId;
}

function extractWarningCodes(report: SmokeReport, methodMeta: AirMethodMeta | null): string[] {
  const warningCodes = new Set<string>();
  for (const warningCode of report.emittedLocatorWarnings ?? []) warningCodes.add(warningCode);
  for (const warningCode of methodMeta?.emittedLocatorWarnings ?? []) warningCodes.add(warningCode);
  for (const warningCode of methodMeta?.resolver?.warningCodes ?? []) warningCodes.add(warningCode);
  for (const warningCode of methodMeta?.resolver?.selectorEvaluation?.warningCodes ?? []) warningCodes.add(warningCode);
  return Array.from(warningCodes).sort((left, right) => left.localeCompare(right));
}

function enrichSmokeRecord(
  report: SmokeReport,
  sidecar: AirMetadata | null,
  sessionMap: SessionMapData | null,
  sessionMapFile?: string,
): EnrichedSmokeRecord {
  const methodMeta = findMethodMeta(sidecar, report);
  return {
    report,
    sessionId: resolveSessionId(report, sessionMap, sessionMapFile),
    proofLevel: normalizeKey(
      report.proofLevel ??
        methodMeta?.emittedLocatorProofLevel ??
        methodMeta?.resolvedSelectorSpec?.proofLevel,
    ),
    engine: normalizeKey(
      methodMeta?.emittedLocatorEngine ??
        methodMeta?.resolvedSelectorSpec?.engine,
    ),
    selectorCategory: normalizeKey(methodMeta?.resolver?.selectorEvaluation?.category),
    warningCodes: extractWarningCodes(report, methodMeta),
    usedSelectorSpec:
      typeof methodMeta?.usedSelectorSpec === 'boolean'
        ? methodMeta.usedSelectorSpec
        : null,
  };
}

export function summarizeSmokeReports(options: SmokeKpiOptions = {}): SmokeKpiSummary {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const reportFiles = options.reportFiles && options.reportFiles.length > 0
    ? options.reportFiles.map((file) => path.resolve(file))
    : discoverSmokeReportFiles(path.resolve(options.reportRoot ?? path.join(cwd, '.air', 'smoke')));

  const skippedReports: string[] = [];
  const sessionMap = readSessionMapSafe(options.sessionMapFile);
  const enrichedRecords: EnrichedSmokeRecord[] = [];

  for (const reportFile of reportFiles) {
    const report = readSmokeReportSafe(reportFile);
    if (!report) {
      skippedReports.push(reportFile);
      continue;
    }
    const sidecar = readSidecarSafe(report.sidecarFile);
    enrichedRecords.push(enrichSmokeRecord(report, sidecar, sessionMap, options.sessionMapFile));
  }

  const failureTypeBreakdown: Record<string, number> = {};
  const proofLevelBreakdown: Record<string, number> = {};
  const engineBreakdown: Record<string, number> = {};
  const selectorCategoryBreakdown: Record<string, number> = {};
  const warningBreakdown: Record<string, number> = {};
  const failingSteps: Record<string, number> = {};
  const failureTypes: Record<string, number> = {};

  let passedRuns = 0;
  let failedRuns = 0;

  for (const record of enrichedRecords) {
    if (record.report.passed) {
      passedRuns += 1;
      continue;
    }

    failedRuns += 1;
    incrementBucket(failureTypeBreakdown, record.report.failureType ?? 'runtime_unknown');
    incrementBucket(proofLevelBreakdown, record.proofLevel);
    incrementBucket(engineBreakdown, record.engine);
    incrementBucket(selectorCategoryBreakdown, record.selectorCategory);
    incrementBucket(failureTypes, record.report.failureType ?? 'runtime_unknown');

    if (typeof record.report.firstFailingStep === 'number') {
      incrementBucket(failingSteps, String(record.report.firstFailingStep));
    }

    if (record.warningCodes.length === 0) {
      incrementBucket(warningBreakdown, 'none');
    } else {
      for (const warningCode of record.warningCodes) {
        incrementBucket(warningBreakdown, warningCode);
      }
    }
  }

  const totalRuns = enrichedRecords.length;
  const firstRunSmokePassRate = totalRuns > 0 ? passedRuns / totalRuns : 0;
  const rateFor = (failureType: SmokeFailureType): number =>
    totalRuns > 0 ? (failureTypeBreakdown[failureType] ?? 0) / totalRuns : 0;

  const summary: SmokeKpiSummary = {
    generatedAt: new Date().toISOString(),
    totalRuns,
    passedRuns,
    failedRuns,
    firstRunSmokePassRate,
    compileErrorRate: rateFor('compile_error'),
    locatorNotFoundRate: rateFor('locator_not_found'),
    locatorAmbiguousRate: rateFor('locator_ambiguous'),
    actionTimeoutRate: rateFor('action_timeout'),
    navigationTimeoutRate: rateFor('navigation_timeout'),
    assertionFailureRate: rateFor('assertion_failure'),
    airBlockedStepRate: rateFor('air_blocked_step'),
    airUnvalidatedStepRate: rateFor('air_unvalidated_step'),
    runtimeUnknownRate: rateFor('runtime_unknown'),
    failureTypeBreakdown,
    proofLevelBreakdown,
    engineBreakdown,
    selectorCategoryBreakdown,
    warningBreakdown,
    mostCommonFailingSteps: toSortedStepEntries(failingSteps),
    mostCommonFailureTypes: toSortedEntries(failureTypes),
    failuresByProofLevel: proofLevelBreakdown,
    failuresByEngine: engineBreakdown,
    failuresBySelectorCategory: selectorCategoryBreakdown,
    failuresByWarningCode: warningBreakdown,
    topFailures: toSortedEntries(failureTypes).slice(0, 5),
    skippedReports: skippedReports.length > 0 ? skippedReports : undefined,
  };

  if (options.outputFile) {
    fs.mkdirSync(path.dirname(path.resolve(options.outputFile)), { recursive: true });
    fs.writeFileSync(path.resolve(options.outputFile), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  }

  return summary;
}
