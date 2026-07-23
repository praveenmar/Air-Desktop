const { spawn } = require('child_process');

//const dbPath = 'C:/Users/praveenmar/AppData/Roaming/air-desktop/air-data.db';
const dbPath = 'C:/Users/praveenmar/.air/air-data.db';


console.error('[AIR MCP Wrapper] Booting server via tsx...');

const cp = spawn('node', [
  '--import', 'tsx',
  'packages/mcp-server/src/index.ts',
  '--db', dbPath
], {
  // Pass stdio exactly as-is to the child process so the Inspector can communicate
  stdio: ['inherit', 'inherit', 'inherit']
});

cp.on('error', (err) => {
  console.error('[AIR MCP Wrapper] Failed to start child process:', err);
});

cp.on('exit', (code, signal) => {
  console.error(`[AIR MCP Wrapper] Child process exited with code ${code} and signal ${signal}`);
  process.exit(code || 0);
});
