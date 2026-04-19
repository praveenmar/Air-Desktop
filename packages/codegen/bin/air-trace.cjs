#!/usr/bin/env node
/**
 * Compatibility wrapper for:
 *   npx air-trace [args]
 */

const path = require('path');

const runner = path.resolve(__dirname, 'run-ts-cli.cjs');
const args = process.argv.slice(2);
process.argv = [process.argv[0], runner, 'air-trace.ts', ...args];
require(runner);
