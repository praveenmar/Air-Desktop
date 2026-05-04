import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import AirSmokeReporter from '../src/smoke/air-reporter';
import { classifySmokeFailure } from '../src/smoke/smoke-classifier';
import { writeControlledPlaywrightConfig } from '../src/smoke/playwright-config-writer';
import { readRawPlaywrightResult } from '../src/smoke/smoke-report';
import { runSmokeBaseline } from '../src/smoke/smoke-runner';

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function lineNumberOf(source: string, needle: string): number {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(needle));
  if (index === -1) {
    throw new Error(`Missing needle: ${needle}`);
  }
  return index + 1;
}

function makeGeneratedPageSource(): string {
  return [
    `export class DemoPage {`,
    `  // AIR step 7 | action=click | selectorType=path | resolvedBy=blocked-semantic-mismatch | score=0`,
    `  async clickBlocked() {`,
    `    throw new Error("AIR unresolved step 7: selector proof level \\"blocked\\" is not safe for confident codegen.");`,
    `  }`,
    ``,
    `  // AIR step 8 | action=click | selectorType=attribute | resolvedBy=kept-original | score=0.9`,
    `  async clickUnvalidated() {`,
    `    throw new Error("AIR unresolved step 8: selector proof level \\"unvalidated\\" is not safe for confident codegen.");`,
    `  }`,
    ``,
    `  // AIR step 9 | action=click | selectorType=attribute | resolvedBy=kept-original | score=0.9`,
    `  async clickSearchButton() {`,
    `    const target = this.page.locator("button[type=\\"submit\\"]");`,
    `    await target.click();`,
    `  }`,
    `}`,
    ``,
  ].join('\n');
}

function makeSidecar(sessionId = 'session-demo') {
  return {
    version: 1,
    session: sessionId,
    generatedAt: '2026-05-04T00:00:00.000Z',
    methods: {
      clickBlocked: {
        step: 7,
        intent: 'click_blocked',
        checksum: 'blocked-checksum',
        originalSelector: 'div > div:nth-of-type(1)',
        selectorUsed: 'div > div:nth-of-type(1)',
        resolvedSelectorSpec: {
          selector: 'div > div:nth-of-type(1)',
          engine: 'css',
          source: 'resolver',
          proofLevel: 'blocked',
          rejectReason: 'semantic_mismatch',
        },
        emittedLocator: null,
        emittedLocatorEngine: 'css',
        emittedLocatorProofLevel: 'blocked',
        emittedLocatorSource: 'resolver',
        emittedLocatorWarnings: ['blocked-selector'],
        usedSelectorSpec: true,
      },
      clickUnvalidated: {
        step: 8,
        intent: 'click_unvalidated',
        checksum: 'unvalidated-checksum',
        originalSelector: 'button[type="submit"]',
        selectorUsed: 'button[type="submit"]',
        resolvedSelectorSpec: {
          selector: 'button[type="submit"]',
          engine: 'css',
          source: 'resolver',
          proofLevel: 'unvalidated',
        },
        emittedLocator: null,
        emittedLocatorEngine: 'css',
        emittedLocatorProofLevel: 'unvalidated',
        emittedLocatorSource: 'resolver',
        emittedLocatorWarnings: ['unvalidated-selector'],
        usedSelectorSpec: true,
      },
      clickSearchButton: {
        step: 9,
        intent: 'click_search_button',
        checksum: 'search-checksum',
        originalSelector: 'button[type="submit"]',
        selectorUsed: 'button[type="submit"]',
        resolvedSelectorSpec: {
          selector: 'button[type="submit"]',
          engine: 'css',
          source: 'resolver',
          proofLevel: 'semantic_validated',
        },
        emittedLocator: 'locator("button[type=\\"submit\\"]")',
        emittedLocatorEngine: 'css',
        emittedLocatorProofLevel: 'semantic_validated',
        emittedLocatorSource: 'resolver',
        emittedLocatorWarnings: [],
        usedSelectorSpec: true,
      },
    },
  };
}

function makePassingRawResult(specFile: string) {
  return {
    reporterVersion: 1,
    runStatus: 'passed',
    startedAt: '2026-05-04T00:00:00.000Z',
    finishedAt: '2026-05-04T00:00:01.000Z',
    durationMs: 1000,
    outputDir: path.join(path.dirname(specFile), 'artifacts'),
    tests: [
      {
        file: specFile,
        title: 'smoke passes',
        titlePath: ['smoke passes'],
        status: 'passed',
        duration: 1000,
        retry: 0,
        attachments: [],
        error: null,
        errors: [],
        annotations: [],
      },
    ],
    globalErrors: [],
  };
}

function makeFailingRawResult(params: {
  file: string;
  message: string;
  stack: string;
  attachments?: Array<{ name?: string; contentType?: string; path?: string | null }>;
}) {
  return {
    reporterVersion: 1,
    runStatus: 'failed',
    startedAt: '2026-05-04T00:00:00.000Z',
    finishedAt: '2026-05-04T00:00:01.000Z',
    durationMs: 1000,
    outputDir: path.join(path.dirname(params.file), 'artifacts'),
    tests: [
      {
        file: params.file,
        title: 'smoke fails',
        titlePath: ['smoke fails'],
        status: 'failed',
        duration: 1000,
        retry: 0,
        attachments: params.attachments ?? [],
        error: {
          message: params.message,
          stack: params.stack,
          location: {
            file: params.file,
            line: 1,
            column: 1,
          },
        },
        errors: [
          {
            message: params.message,
            stack: params.stack,
            location: {
              file: params.file,
              line: 1,
              column: 1,
            },
          },
        ],
        annotations: [],
      },
    ],
    globalErrors: [],
  };
}

describe('air smoke reporter', () => {
  it('writes raw-playwright-result.json on pass', async () => {
    const dir = makeTempDir('air-smoke-reporter-pass-');
    const outputFile = path.join(dir, 'raw-playwright-result.json');
    const reporter = new AirSmokeReporter({ outputFile, outputDir: path.join(dir, 'artifacts') });

    reporter.onTestEnd(
      { title: 'pass test', location: { file: 'demo.spec.ts' }, titlePath: () => ['pass test'], annotations: [] },
      { status: 'passed', duration: 15, retry: 0, attachments: [] },
    );
    await reporter.onEnd({ status: 'passed' });

    const raw = readRawPlaywrightResult(outputFile);
    expect(raw?.runStatus).toBe('passed');
    expect(raw?.tests[0]?.status).toBe('passed');
    expect(raw?.outputDir).toContain('artifacts');
  });

  it('writes raw-playwright-result.json on failure', async () => {
    const dir = makeTempDir('air-smoke-reporter-fail-');
    const outputFile = path.join(dir, 'raw-playwright-result.json');
    const reporter = new AirSmokeReporter({ outputFile });

    reporter.onError({ message: 'Cannot find module ./missing', stack: 'Error: Cannot find module ./missing' });
    await reporter.onEnd({ status: 'failed' });

    const raw = readRawPlaywrightResult(outputFile);
    expect(raw?.runStatus).toBe('failed');
    expect(raw?.globalErrors?.[0]?.message).toContain('Cannot find module');
  });
});

describe('smoke classifier', () => {
  it('distinguishes locator ambiguous vs locator not found', () => {
    expect(
      classifySmokeFailure({
        rawResult: null,
        error: { message: 'strict mode violation: locator resolved to 2 elements', stack: '' },
      }),
    ).toBe('locator_ambiguous');

    expect(
      classifySmokeFailure({
        rawResult: null,
        error: { message: 'locator.waitFor: Timeout 5000ms exceeded while waiting for locator("button")', stack: '' },
      }),
    ).toBe('locator_not_found');
  });
});

describe('controlled playwright config writer', () => {
  it('generates controlled settings and custom reporter', () => {
    const dir = makeTempDir('air-smoke-config-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    writeFile(specFile, 'test("demo", async () => {});');

    const config = writeControlledPlaywrightConfig({
      runId: 'run-123',
      runRoot: path.join(dir, 'run-123'),
      specFile,
      reporterFile: path.join(dir, 'air-reporter.ts'),
      cwd: dir,
    });

    const contents = fs.readFileSync(config.configPath, 'utf8');
    expect(contents).toContain(`actionTimeout: 5000`);
    expect(contents).toContain(`navigationTimeout: 10000`);
    expect(contents).toContain(`trace: 'retain-on-failure'`);
    expect(contents).toContain(`screenshot: 'only-on-failure'`);
    expect(contents).toContain(`video: 'off'`);
    expect(contents).toContain('air-reporter.ts');
  });
});

describe('smoke baseline runner', () => {
  it('writes a smoke report on pass', async () => {
    const dir = makeTempDir('air-smoke-pass-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const generatedFile = path.join(dir, 'DemoPage.ts');
    const sidecarFile = path.join(dir, 'DemoPage.air.json');
    const outputFile = path.join(dir, 'report.json');
    writeFile(specFile, 'test("demo", async () => {});');
    writeFile(generatedFile, makeGeneratedPageSource());
    writeFile(sidecarFile, JSON.stringify(makeSidecar(), null, 2));

    const report = await runSmokeBaseline({
      specFile,
      sidecarFile,
      outputReportFile: outputFile,
      executor: async (request) => {
        fs.writeFileSync(request.rawResultPath, JSON.stringify(makePassingRawResult(specFile), null, 2));
        return { exitCode: 0 };
      },
    });

    expect(report.passed).toBe(true);
    expect(fs.existsSync(outputFile)).toBe(true);
  });

  it('writes a smoke report on failure and maps blocked step', async () => {
    const dir = makeTempDir('air-smoke-blocked-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const generatedFile = path.join(dir, 'DemoPage.ts');
    const sidecarFile = path.join(dir, 'DemoPage.air.json');
    const outputFile = path.join(dir, 'report.json');
    const source = makeGeneratedPageSource();
    writeFile(specFile, 'test("demo", async () => {});');
    writeFile(generatedFile, source);
    writeFile(sidecarFile, JSON.stringify(makeSidecar(), null, 2));
    const line = lineNumberOf(source, 'AIR unresolved step 7');
    const stack = `Error: AIR unresolved step 7: selector proof level "blocked" is not safe for confident codegen.\n    at DemoPage.clickBlocked (${generatedFile}:${line}:11)`;

    const report = await runSmokeBaseline({
      specFile,
      sidecarFile,
      outputReportFile: outputFile,
      executor: async (request) => {
        fs.writeFileSync(
          request.rawResultPath,
          JSON.stringify(
            makeFailingRawResult({
              file: generatedFile,
              message: 'AIR unresolved step 7: selector proof level "blocked" is not safe for confident codegen.',
              stack,
            }),
            null,
            2,
          ),
        );
        return { exitCode: 1 };
      },
    });

    expect(report.passed).toBe(false);
    expect(report.failureType).toBe('air_blocked_step');
    expect(report.firstFailingStep).toBe(7);
    expect(report.failingMethodName).toBe('clickBlocked');
  });

  it('maps deliberate AIR unvalidated step', async () => {
    const dir = makeTempDir('air-smoke-unvalidated-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const generatedFile = path.join(dir, 'DemoPage.ts');
    const sidecarFile = path.join(dir, 'DemoPage.air.json');
    const source = makeGeneratedPageSource();
    writeFile(specFile, 'test("demo", async () => {});');
    writeFile(generatedFile, source);
    writeFile(sidecarFile, JSON.stringify(makeSidecar(), null, 2));
    const line = lineNumberOf(source, 'AIR unresolved step 8');
    const stack = `Error: AIR unresolved step 8: selector proof level "unvalidated" is not safe for confident codegen.\n    at DemoPage.clickUnvalidated (${generatedFile}:${line}:11)`;

    const report = await runSmokeBaseline({
      specFile,
      sidecarFile,
      executor: async (request) => {
        fs.writeFileSync(
          request.rawResultPath,
          JSON.stringify(
            makeFailingRawResult({
              file: generatedFile,
              message: 'AIR unresolved step 8: selector proof level "unvalidated" is not safe for confident codegen.',
              stack,
            }),
            null,
            2,
          ),
        );
        return { exitCode: 1 };
      },
    });

    expect(report.failureType).toBe('air_unvalidated_step');
    expect(report.firstFailingStep).toBe(8);
  });

  it('maps locator failures to method and sidecar metadata using AIR step markers', async () => {
    const dir = makeTempDir('air-smoke-locator-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const generatedFile = path.join(dir, 'DemoPage.ts');
    const sidecarFile = path.join(dir, 'DemoPage.air.json');
    const source = makeGeneratedPageSource();
    writeFile(specFile, 'test("demo", async () => {});');
    writeFile(generatedFile, source);
    writeFile(sidecarFile, JSON.stringify(makeSidecar(), null, 2));
    const line = lineNumberOf(source, 'await target.click();');
    const stack = `locator.click: Timeout 5000ms exceeded.\n    at DemoPage.clickSearchButton (${generatedFile}:${line}:11)`;

    const report = await runSmokeBaseline({
      specFile,
      sidecarFile,
      executor: async (request) => {
        fs.writeFileSync(
          request.rawResultPath,
          JSON.stringify(
            makeFailingRawResult({
              file: generatedFile,
              message: 'locator.click: Timeout 5000ms exceeded.',
              stack,
              attachments: [
                { name: 'trace', contentType: 'application/zip', path: path.join(dir, 'trace.zip') },
                { name: 'test-failed-1', contentType: 'image/png', path: path.join(dir, 'screenshot.png') },
              ],
            }),
            null,
            2,
          ),
        );
        return { exitCode: 1 };
      },
    });

    expect(report.failureType).toBe('action_timeout');
    expect(report.firstFailingStep).toBe(9);
    expect(report.failingMethodName).toBe('clickSearchButton');
    expect(report.proofLevel).toBe('semantic_validated');
    expect(report.emittedLocator).toContain('locator');
    expect(report.tracePath).toContain('trace.zip');
    expect(report.screenshotPath).toContain('screenshot.png');
  });

  it('produces compile_error report from reporter JSON global error', async () => {
    const dir = makeTempDir('air-smoke-compile-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const outputFile = path.join(dir, 'report.json');
    writeFile(specFile, 'test("demo", async () => {});');

    const report = await runSmokeBaseline({
      specFile,
      outputReportFile: outputFile,
      executor: async (request) => {
        fs.writeFileSync(
          request.rawResultPath,
          JSON.stringify(
            {
              reporterVersion: 1,
              runStatus: 'failed',
              startedAt: '2026-05-04T00:00:00.000Z',
              finishedAt: '2026-05-04T00:00:01.000Z',
              durationMs: 1000,
              tests: [],
              globalErrors: [
                {
                  message: 'Cannot find module ./missing-page',
                  stack: 'Error: Cannot find module ./missing-page',
                  location: null,
                },
              ],
            },
            null,
            2,
          ),
        );
        return { exitCode: 1 };
      },
    });

    expect(report.failureType).toBe('compile_error');
    expect(fs.existsSync(outputFile)).toBe(true);
  });

  it('uses reporter JSON instead of executor stdout semantics', async () => {
    const dir = makeTempDir('air-smoke-json-truth-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    writeFile(specFile, 'test("demo", async () => {});');

    const report = await runSmokeBaseline({
      specFile,
      executor: async (request) => {
        fs.writeFileSync(request.rawResultPath, JSON.stringify(makePassingRawResult(specFile), null, 2));
        return { exitCode: 1 };
      },
    });

    expect(report.passed).toBe(true);
  });

  it('does not mutate generated files', async () => {
    const dir = makeTempDir('air-smoke-no-mutate-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const generatedFile = path.join(dir, 'DemoPage.ts');
    const sidecarFile = path.join(dir, 'DemoPage.air.json');
    const source = makeGeneratedPageSource();
    writeFile(specFile, 'test("demo", async () => {});');
    writeFile(generatedFile, source);
    writeFile(sidecarFile, JSON.stringify(makeSidecar(), null, 2));
    const before = fs.readFileSync(generatedFile, 'utf8');

    await runSmokeBaseline({
      specFile,
      sidecarFile,
      executor: async (request) => {
        fs.writeFileSync(request.rawResultPath, JSON.stringify(makePassingRawResult(specFile), null, 2));
        return { exitCode: 0 };
      },
    });

    const after = fs.readFileSync(generatedFile, 'utf8');
    expect(after).toBe(before);
  });

  it('still writes a useful report when sidecar is missing', async () => {
    const dir = makeTempDir('air-smoke-missing-sidecar-');
    const specFile = path.join(dir, 'demo.smoke.spec.ts');
    const generatedFile = path.join(dir, 'DemoPage.ts');
    const source = makeGeneratedPageSource();
    writeFile(specFile, 'test("demo", async () => {});');
    writeFile(generatedFile, source);
    const line = lineNumberOf(source, 'await target.click();');
    const stack = `locator.click: Timeout 5000ms exceeded.\n    at DemoPage.clickSearchButton (${generatedFile}:${line}:11)`;

    const report = await runSmokeBaseline({
      specFile,
      generatedFile,
      executor: async (request) => {
        fs.writeFileSync(
          request.rawResultPath,
          JSON.stringify(
            makeFailingRawResult({
              file: generatedFile,
              message: 'locator.click: Timeout 5000ms exceeded.',
              stack,
            }),
            null,
            2,
          ),
        );
        return { exitCode: 1 };
      },
    });

    expect(report.failureType).toBe('action_timeout');
    expect(report.firstFailingStep).toBe(9);
    expect(report.failingMethodName).toBe('clickSearchButton');
  });
});
