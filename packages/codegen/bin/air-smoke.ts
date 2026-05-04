import * as path from 'path';
import { runSmokeBaseline } from '../src/smoke/smoke-runner';

interface ParsedArgs {
  specFile?: string;
  sidecarFile?: string;
  generatedFile?: string;
  outputReportFile?: string;
}

function printUsage(): void {
  console.log(
    [
      'AIR Smoke Runner',
      '',
      'Usage:',
      '  npx air smoke --spec <spec.ts> [--sidecar <file.air.json>] [--generated <page.ts>] [--out <report.json>]',
      '  npx air-smoke --spec <spec.ts> [--sidecar <file.air.json>] [--generated <page.ts>] [--out <report.json>]',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case '--spec':
        parsed.specFile = next;
        index += 1;
        break;
      case '--sidecar':
        parsed.sidecarFile = next;
        index += 1;
        break;
      case '--generated':
        parsed.generatedFile = next;
        index += 1;
        break;
      case '--out':
        parsed.outputReportFile = next;
        index += 1;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        break;
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.specFile) {
    printUsage();
    process.exit(1);
    return;
  }

  const report = await runSmokeBaseline({
    specFile: path.resolve(args.specFile),
    sidecarFile: args.sidecarFile ? path.resolve(args.sidecarFile) : undefined,
    generatedFile: args.generatedFile ? path.resolve(args.generatedFile) : undefined,
    outputReportFile: args.outputReportFile ? path.resolve(args.outputReportFile) : undefined,
  });

  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        runId: report.runId,
        report: args.outputReportFile ?? path.join(path.dirname(report.rawPlaywrightResultPath ?? '.'), 'smoke-report.json'),
        failureType: report.failureType ?? null,
        firstFailingStep: report.firstFailingStep ?? null,
      },
      null,
      2,
    ),
  );

  process.exit(report.passed ? 0 : 1);
}

main().catch((error) => {
  console.error('[AIR] Smoke runner failed:', error);
  process.exit(1);
});
