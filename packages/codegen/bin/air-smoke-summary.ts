import * as path from 'path';
import { summarizeSmokeReports } from '../src/smoke/smoke-kpi';

interface ParsedArgs {
  reportRoot?: string;
  reportFiles: string[];
  outputFile?: string;
  sessionMapFile?: string;
}

function printUsage(): void {
  console.log(
    [
      'AIR Smoke Summary',
      '',
      'Usage:',
      '  npx air smoke summary [--dir <.air/smoke>] [--report <smoke-report.json> ...] [--out <summary.json>] [--session-map <.air/session-map.json>]',
      '  npx air-smoke-summary [--dir <.air/smoke>] [--report <smoke-report.json> ...] [--out <summary.json>] [--session-map <.air/session-map.json>]',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    reportFiles: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    switch (token) {
      case '--dir':
        parsed.reportRoot = next;
        index += 1;
        break;
      case '--report':
        if (next) parsed.reportFiles.push(next);
        index += 1;
        break;
      case '--out':
        parsed.outputFile = next;
        index += 1;
        break;
      case '--session-map':
        parsed.sessionMapFile = next;
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

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  const summary = summarizeSmokeReports({
    reportRoot: args.reportRoot ? path.resolve(args.reportRoot) : undefined,
    reportFiles: args.reportFiles.map((file) => path.resolve(file)),
    outputFile: args.outputFile ? path.resolve(args.outputFile) : undefined,
    sessionMapFile: args.sessionMapFile ? path.resolve(args.sessionMapFile) : undefined,
  });

  console.log(
    [
      `totalRuns: ${summary.totalRuns}`,
      `passedRuns: ${summary.passedRuns}`,
      `failedRuns: ${summary.failedRuns}`,
      `firstRunSmokePassRate: ${(summary.firstRunSmokePassRate * 100).toFixed(2)}%`,
      `topFailures: ${summary.topFailures.map((entry) => `${entry.key}=${entry.count}`).join(', ') || 'none'}`,
      args.outputFile ? `summaryFile: ${path.resolve(args.outputFile)}` : null,
    ].filter(Boolean).join('\n'),
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[AIR] Smoke summary failed:', error);
    process.exit(1);
  });
}
