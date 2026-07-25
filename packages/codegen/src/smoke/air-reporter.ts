import * as fs from 'fs';
import * as path from 'path';
import type {
  RawPlaywrightResult,
  SmokeReporterAttachment,
  SmokeReporterError,
  SmokeReporterTestResult,
} from './smoke-report';

function toSerializableError(error: any): SmokeReporterError {
  return {
    message: error?.message ?? null,
    stack: error?.stack ?? null,
    location: error?.location
      ? {
          file: error.location.file,
          line: error.location.line,
          column: error.location.column,
        }
      : null,
  };
}

function toSerializableAttachments(attachments: any[] | undefined): SmokeReporterAttachment[] {
  return (attachments ?? []).map((attachment) => ({
    name: attachment?.name,
    contentType: attachment?.contentType,
    path: attachment?.path ?? null,
  }));
}

function safeTitlePath(test: any): string[] {
  try {
    return typeof test?.titlePath === 'function' ? test.titlePath() : [String(test?.title ?? '')];
  } catch {
    return [String(test?.title ?? '')];
  }
}

export default class AirSmokeReporter {
  private outputFile: string;
  private outputDir: string | null;
  private startedAt = new Date().toISOString();
  private tests: SmokeReporterTestResult[] = [];
  private globalErrors: SmokeReporterError[] = [];
  private runStatus = 'unknown';

  constructor(options: { outputFile?: string; outputDir?: string } = {}) {
    this.outputFile = options.outputFile ?? path.resolve(process.cwd(), '.air', 'smoke', 'raw-playwright-result.json');
    this.outputDir = options.outputDir ?? null;
  }

  onError(error: any): void {
    this.globalErrors.push(toSerializableError(error));
    this.persist();
  }

  onTestEnd(test: any, result: any): void {
    const errors: SmokeReporterError[] = [];
    if (Array.isArray(result?.errors)) {
      for (const error of result.errors) {
        errors.push(toSerializableError(error));
      }
    } else if (result?.error) {
      errors.push(toSerializableError(result.error));
    }

    this.tests.push({
      file: test?.location?.file ?? '',
      title: test?.title ?? '',
      titlePath: safeTitlePath(test),
      status: result?.status ?? 'unknown',
      duration: result?.duration ?? 0,
      retry: result?.retry ?? 0,
      attachments: toSerializableAttachments(result?.attachments),
      error: errors[0] ?? null,
      errors,
      annotations: Array.isArray(test?.annotations)
        ? test.annotations.map((annotation: any) => ({
            type: annotation?.type ?? '',
            description: annotation?.description,
          }))
        : [],
    });
    this.persist();
  }

  async onEnd(result: any): Promise<void> {
    this.runStatus = result?.status ?? this.runStatus;
    this.persist();
  }

  private buildPayload(): RawPlaywrightResult {
    const finishedAt = new Date().toISOString();
    return {
      reporterVersion: 1,
      runStatus: this.runStatus,
      startedAt: this.startedAt,
      finishedAt,
      durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(this.startedAt)),
      outputDir: this.outputDir,
      tests: this.tests,
      globalErrors: this.globalErrors,
    };
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
      fs.writeFileSync(this.outputFile, `${JSON.stringify(this.buildPayload(), null, 2)}\n`, 'utf8');
    } catch {
      // Never hide the original Playwright failure because of AIR reporter I/O.
    }
  }
}
