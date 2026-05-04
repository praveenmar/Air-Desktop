#!/usr/bin/env node
/**
 * Local workspace CLI shim:
 *   npx air review [args]
 *   npx air generate [args]
 *   npx air trace [args]
 *   npx air smoke [args]
 */

const path = require('path');

const command = process.argv[2];
const args = process.argv.slice(3);
const runner = path.resolve(__dirname, 'run-ts-cli.cjs');

function run(target, forwardedArgs) {
  process.argv = [process.argv[0], runner, target, ...forwardedArgs];
  require(runner);
}

if (!command || command === '--help' || command === '-h') {
  console.log(
    [
      'AIR CLI',
      '',
      'Usage:',
      '  npx air review [sessionId] [--list] [--db <path>]',
      '  npx air generate <sessionId>',
      '  npx air trace [sessionId] [--list] [--json|--csv] [--out <path>] [--db <path>]',
      '  npx air smoke --spec <spec.ts> [--sidecar <file.air.json>] [--generated <page.ts>] [--out <report.json>]',
    ].join('\n')
  );
  process.exit(0);
}

switch (command) {
  case 'review':
    run('air-review.ts', args);
    break;
  case 'generate':
    run('air-generate.ts', args);
    break;
  case 'trace':
    run('air-trace.ts', args);
    break;
  case 'smoke':
    run('air-smoke.ts', args);
    break;
  default:
    console.error(`[ERR] Unknown command: ${command}`);
    console.error('Run: npx air --help');
    process.exit(1);
}
