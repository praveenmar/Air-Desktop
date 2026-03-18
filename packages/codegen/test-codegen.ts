/**
 * packages/codegen/test-codegen.ts
 *
 * Quick smoke test — run this directly with ts-node or compile and run.
 * Prints the semantic timeline for your most recent recorded session.
 *
 * Usage:
 *   npx ts-node packages/codegen/test-codegen.ts
 *   npx ts-node packages/codegen/test-codegen.ts <sessionId>
 */

import * as path from 'path';
import * as os from 'os';
import { CodegenService } from './src/index';

// ── Resolve DB path ──────────────────────────────────────────────────────────
// Electron stores the DB in AppData on Windows, ~/Library on Mac
function getDefaultDbPath(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    return path.join(
      process.env['APPDATA'] || os.homedir(),
      'air-desktop',
      'air-data.db'
    );
  }
  if (platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'air-desktop',
      'air-data.db'
    );
  }
  // Linux
  return path.join(os.homedir(), '.config', 'air-desktop', 'air-data.db');
}

async function main() {
  const dbPath = getDefaultDbPath();
  console.log(`\n📂 DB path: ${dbPath}\n`);

  const service = new CodegenService({
    dbPath,
    includeScrollSteps: false,
    includeHoverSteps:  false,
    minConfidence:      0.0,
  });

  // ── List sessions ────────────────────────────────────────────────────────
  const sessions = service.listSessions();

  if (sessions.length === 0) {
    console.log('❌ No sessions found in DB. Record a flow first.');
    process.exit(1);
  }

  console.log(`✅ Found ${sessions.length} session(s):\n`);
  sessions.forEach((s, i) => {
    console.log(`  [${i + 1}] ${s.sessionId}`);
    console.log(`       URL:        ${s.url}`);
    console.log(`       Recorded:   ${s.startedAt}`);
    console.log(`       Events:     ${s.eventCount}`);
    console.log();
  });

  // ── Pick session ─────────────────────────────────────────────────────────
  // Use CLI arg if provided, otherwise use the most recent
  const targetId = process.argv[2] || sessions[0].sessionId;
  console.log(`🎯 Building semantic timeline for session: ${targetId}\n`);

  try {
    const timeline = service.buildSession(targetId);

    // ── Print summary ──────────────────────────────────────────────────────
    console.log('═'.repeat(60));
    console.log('SEMANTIC TIMELINE SUMMARY');
    console.log('═'.repeat(60));
    console.log(`Session:         ${timeline.sessionId}`);
    console.log(`URL:             ${timeline.url}`);
    console.log(`Title:           ${timeline.title || '(none)'}`);
    console.log(`Recorded:        ${timeline.recordedAt}`);
    console.log(`Steps:           ${timeline.stepCount}`);
    console.log(`Nodes visited:   ${timeline.nodeCount}`);
    console.log(`Flow confidence: ${(timeline.flowConfidence * 100).toFixed(0)}%`);
    console.log();

    // ── Print steps ────────────────────────────────────────────────────────
    console.log('STEPS:');
    console.log('─'.repeat(60));
    for (const step of timeline.steps) {
      console.log(`\n  Step ${step.step}: ${step.intent}`);
      console.log(`    action:   ${step.action}`);
      console.log(`    selector: ${step.selector}`);
      console.log(`    priority: ${step.selectorPriority}`);
      if (step.value) {
        console.log(`    value:    ${step.value}`);
      }
      if (step.outcomeType) {
        console.log(`    outcome:  ${step.outcomeType}`);
      }
      if (step.navigatesTo) {
        console.log(`    goes to:  ${step.navigatesTo}`);
      }
      console.log(`    confidence: ${(step.confidence * 100).toFixed(0)}%  sample_size: ${step.sampleSize}`);

      if (step.assertions.length > 0) {
        console.log(`    assertions (${step.assertions.length}):`);
        for (const a of step.assertions) {
          console.log(`      - [${a.type}] ${a.selector || a.value}`);
        }
      }
    }

    // ── Print full JSON ────────────────────────────────────────────────────
    console.log('\n' + '═'.repeat(60));
    console.log('FULL JSON OUTPUT (what the MCP tool will send to AI):');
    console.log('═'.repeat(60));
    const json = JSON.stringify(timeline, null, 2);
    console.log(json);
    console.log(`\n📦 Payload size: ${Buffer.byteLength(json, 'utf8')} bytes`);
    console.log(`   (Target: < 8,000 bytes for a typical 10-step flow)\n`);

  } catch (err) {
    console.error('❌ Error building timeline:', (err as Error).message);
    process.exit(1);
  } finally {
    service.close();
  }
}

main();