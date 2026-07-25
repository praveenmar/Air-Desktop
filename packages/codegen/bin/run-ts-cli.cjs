#!/usr/bin/env node
/**
 * packages/codegen/bin/run-ts-cli.cjs
 *
 * Tiny launcher to run TS CLIs in this workspace under CommonJS transpile mode.
 * This avoids Node 22 strip-only TypeScript limitations for CLI scripts.
 */

const path = require('path');

process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
});

require('ts-node/register/transpile-only');

const target = process.argv[2];
if (!target) {
  console.error('[ERR] Missing target script. Example: node bin/run-ts-cli.cjs air-trace.ts --list');
  process.exit(1);
}

const targetPath = path.resolve(__dirname, target);
const forwardedArgs = process.argv.slice(3);
process.argv = [process.argv[0], targetPath, ...forwardedArgs];

require(targetPath);

