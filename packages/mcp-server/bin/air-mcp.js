#!/usr/bin/env node
const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error('[AIR MCP] Error: Node.js version 22 or higher is required.');
  console.error(`[AIR MCP] You are currently running Node.js ${process.versions.node}.`);
  console.error('[AIR MCP] Please upgrade Node.js to use the AIR MCP Server.');
  process.exit(1);
}

require('../dist/index.js');
