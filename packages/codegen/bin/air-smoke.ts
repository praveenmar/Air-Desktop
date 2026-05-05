import * as path from 'path';
import { runSmokeBaseline } from '../src/smoke/smoke-runner';
import { main as runSmokeSummaryCli } from './air-smoke-summary';

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
      '  npx air smoke summary [--dir <.air/smoke>] [--report <smoke-report.json> ...] [--out <summary.json>] [--session-map <.air/session-map.json>]',
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
  const argv = process.argv.slice(2);
  if (argv[0] === 'summary') {
    await runSmokeSummaryCli(argv.slice(1));
    process.exit(0);
    return;
  }

  const args = parseArgs(argv);
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
