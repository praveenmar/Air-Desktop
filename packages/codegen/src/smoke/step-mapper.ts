import * as fs from 'fs';
import * as path from 'path';
import type { AirMetadata, AirMethodMeta } from '../sidecar.types';
import type { SmokeReporterError, SmokeStackLocation } from './smoke-report';

export interface MappedSmokeStep {
  stackLocation: SmokeStackLocation | null;
  firstFailingStep: number | null;
  failingMethodName: string | null;
  methodMeta: AirMethodMeta | null;
}

function normalizeFilePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
}

export function extractStackLocations(stack: string | null | undefined): SmokeStackLocation[] {
  if (!stack) return [];

  const matches: SmokeStackLocation[] = [];
  const regex = /((?:[A-Za-z]:\\|\/)[^:\n()]+?\.(?:[cm]?[jt]sx?|mjs|cjs)):(\d+)(?::(\d+))?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(stack)) !== null) {
    matches.push({
      file: path.resolve(match[1]),
      line: Number(match[2]),
      column: match[3] ? Number(match[3]) : undefined,
    });
  }
  return matches;
}

function choosePreferredLocation(
  locations: SmokeStackLocation[],
  generatedFile?: string | null,
  specFile?: string | null,
): SmokeStackLocation | null {
  if (locations.length === 0) return null;

  const normalizedGenerated = generatedFile ? normalizeFilePath(generatedFile) : null;
  const normalizedSpec = specFile ? normalizeFilePath(specFile) : null;

  if (normalizedGenerated) {
    const generatedMatch = locations.find((location) => normalizeFilePath(location.file) === normalizedGenerated);
    if (generatedMatch) return generatedMatch;
  }

  if (normalizedSpec) {
    const specMatch = locations.find((location) => normalizeFilePath(location.file) === normalizedSpec);
    if (specMatch) return specMatch;
  }

  return locations[0] ?? null;
}

function findNearestAirStep(lines: string[], lineNumber: number): number | null {
  const cappedIndex = Math.min(Math.max(lineNumber - 1, 0), lines.length - 1);
  for (let index = cappedIndex; index >= 0; index -= 1) {
    const match = lines[index]?.match(/\/\/\s*AIR step\s+(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function findEnclosingMethodName(lines: string[], lineNumber: number): string | null {
  const cappedIndex = Math.min(Math.max(lineNumber - 1, 0), lines.length - 1);
  for (let index = cappedIndex; index >= 0; index -= 1) {
    const match = lines[index]?.match(/^\s*async\s+([A-Za-z0-9_]+)\s*\(/);
    if (match) return match[1];
  }
  return null;
}

function readSidecar(sidecarFile: string | null | undefined): AirMetadata | null {
  if (!sidecarFile || !fs.existsSync(sidecarFile)) return null;
  return JSON.parse(fs.readFileSync(sidecarFile, 'utf8')) as AirMetadata;
}

function findMethodMeta(
  metadata: AirMetadata | null,
  methodName: string | null,
  stepNumber: number | null,
): AirMethodMeta | null {
  if (!metadata) return null;
  if (methodName && metadata.methods[methodName]) {
    return metadata.methods[methodName];
  }
  if (typeof stepNumber === 'number') {
    return Object.values(metadata.methods).find((method) => method.step === stepNumber) ?? null;
  }
  return null;
}

export function mapSmokeFailureToStep(params: {
  error: SmokeReporterError | null | undefined;
  generatedFile?: string | null;
  specFile?: string | null;
  sidecarFile?: string | null;
}): MappedSmokeStep {
  const locations = extractStackLocations(params.error?.stack);
  const stackLocation = choosePreferredLocation(locations, params.generatedFile, params.specFile);
  const metadata = readSidecar(params.sidecarFile);

  if (!stackLocation || !fs.existsSync(stackLocation.file)) {
    return {
      stackLocation,
      firstFailingStep: null,
      failingMethodName: null,
      methodMeta: null,
    };
  }

  const contents = fs.readFileSync(stackLocation.file, 'utf8');
  const lines = contents.split(/\r?\n/);
  const firstFailingStep = findNearestAirStep(lines, stackLocation.line);
  const failingMethodName = findEnclosingMethodName(lines, stackLocation.line);
  const methodMeta = findMethodMeta(metadata, failingMethodName, firstFailingStep);

  return {
    stackLocation,
    firstFailingStep: methodMeta?.step ?? firstFailingStep,
    failingMethodName,
    methodMeta,
  };
}
