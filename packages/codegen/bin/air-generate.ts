#!/usr/bin/env node
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { CodegenService } from '../src/index';
import { LlmOrchestrator } from '../src/llm-orchestrator';

function resolveDbPath(): string {
  if (process.env['AIR_DB_PATH']) return process.env['AIR_DB_PATH'];
  switch (process.platform) {
    case 'win32': return path.join(process.env['APPDATA'] || os.homedir(), 'air-desktop', 'air-data.db');
    case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'air-desktop', 'air-data.db');
    default: return path.join(os.homedir(), '.config', 'air-desktop', 'air-data.db');
  }
}

async function main() {
  const sessionId = process.argv[2];
  if (!sessionId) {
    console.error("\n[ERR] Please provide a sessionId: npx air generate <sessionId>\n");
    process.exit(1);
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`\n[ERR] Database not found at: ${dbPath}\n`);
    process.exit(1);
  }

  const service = new CodegenService({ dbPath, minConfidence: 0.0 });

  try {
    console.log(`\n[AIR] Building Semantic Timeline for session: ${sessionId}...`);
    const session = service.buildSession(sessionId);

    const projectRoot = process.cwd();
    // Defaulting output to a 'tests/pages' directory at your project root
    const outputDir = path.join(projectRoot, 'tests', 'pages');

    console.log(`[AIR] Requesting Page Object Model generation...`);
    await LlmOrchestrator.generatePageObjects(session, outputDir, projectRoot);

    console.log(`\n[SUCCESS] Generated files written to: ${outputDir}`);
    console.log(`[SUCCESS] .air/session-map.json updated.\n`);
    
  } catch (error) {
    console.error(`\n[ERR] Generation failed:`, error);
    process.exit(1);
  } finally {
    service.close();
  }
}

main();