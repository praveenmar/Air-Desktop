#!/usr/bin/env node

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const helpRequested = args.includes('--help') || args.includes('-h');
const transportArgIndex = args.findIndex(
  (arg) => arg === '--transport' || arg.startsWith('--transport=')
);

let transport = process.env.AIR_MCP_TRANSPORT || 'stdio';
const forwardedArgs = [...args];

if (transportArgIndex >= 0) {
  const arg = args[transportArgIndex];

  if (arg === '--transport') {
    transport = args[transportArgIndex + 1] || transport;
    forwardedArgs.splice(transportArgIndex, 2);
  } else {
    transport = arg.slice('--transport='.length);
    forwardedArgs.splice(transportArgIndex, 1);
  }
}

if (!['stdio', 'http'].includes(transport)) {
  console.error(`[AIR MCP] Unsupported transport: ${transport}`);
  process.exit(1);
}

if (helpRequested) {
  console.error('AIR MCP launcher');
  console.error('');
  console.error('Usage:');
  console.error('  node scripts/air-mcp.cjs [--transport stdio|http] [--db <path>] [--port <number>]');
  console.error('');
  console.error('Environment variables:');
  console.error('  AIR_MCP_DB_PATH   Path to AIR SQLite database');
  console.error('  AIR_MCP_PORT      HTTP port when using --transport http');
  console.error('  AIR_MCP_TRANSPORT Default transport when --transport is omitted');
  process.exit(0);
}

const repoRoot = path.resolve(__dirname, '..');
const tsxCliPath = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const builtEntryFile = transport === 'http'
  ? path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'http.js')
  : path.join(repoRoot, 'packages', 'mcp-server', 'dist', 'index.js');
const sourceEntryFile = transport === 'http'
  ? path.join(repoRoot, 'packages', 'mcp-server', 'src', 'http.ts')
  : path.join(repoRoot, 'packages', 'mcp-server', 'src', 'index.ts');

let childArgs;

if (fs.existsSync(builtEntryFile)) {
  childArgs = [builtEntryFile, ...forwardedArgs];
} else {
  if (!fs.existsSync(tsxCliPath)) {
    console.error('[AIR MCP] Could not find a built MCP entrypoint or local tsx fallback.');
    console.error(`[AIR MCP] Expected one of:`);
    console.error(`  ${builtEntryFile}`);
    console.error(`  ${tsxCliPath}`);
    process.exit(1);
  }

  childArgs = [tsxCliPath, sourceEntryFile, ...forwardedArgs];
}

const child = spawn(process.execPath, childArgs, {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[AIR MCP] Failed to start launcher:', error);
  process.exit(1);
});
