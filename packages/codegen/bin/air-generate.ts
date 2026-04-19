#!/usr/bin/env node
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { CodegenService } from '../src/index';
import { LlmOrchestrator } from '../src/llm-orchestrator';
import type { ResolverConfig } from '../src/selector-resolver';

function resolveDbPath(): string {
  if (process.env['AIR_DB_PATH']) return process.env['AIR_DB_PATH'];
  switch (process.platform) {
    case 'win32': return path.join(process.env['APPDATA'] || os.homedir(), 'air-desktop', 'air-data.db');
    case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'air-desktop', 'air-data.db');
    default: return path.join(os.homedir(), '.config', 'air-desktop', 'air-data.db');
  }
}

function parseNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveResolverConfig(): ResolverConfig {
  const enabledRaw = (process.env['AIR_ENABLE_LLM_SELECTOR_FALLBACK'] || '').trim().toLowerCase();

  return {
    enableLLMFallback: enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes',
    resolverMinScore: parseNumberEnv('AIR_RESOLVER_MIN_SCORE'),
    intentMinScore: parseNumberEnv('AIR_INTENT_MIN_SCORE'),
    maxSnapshotBytesForValidation: parseNumberEnv('AIR_MAX_SNAPSHOT_BYTES'),
    maxSnapshotExcerptChars: parseNumberEnv('AIR_MAX_SNAPSHOT_EXCERPT_CHARS'),
    llmTimeoutMs: parseNumberEnv('AIR_SELECTOR_LLM_TIMEOUT_MS'),
    maxLLMFallbackPerSession: parseNumberEnv('AIR_MAX_LLM_FALLBACK_PER_SESSION'),
    llmMaxRetriesPerStep: parseNumberEnv('AIR_LLM_MAX_RETRIES_PER_STEP'),
  };
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
    const resolverConfig = resolveResolverConfig();
    console.log('[AIR] Resolver config', {
      enableLLMFallback: !!resolverConfig.enableLLMFallback,
      resolverMinScore: resolverConfig.resolverMinScore ?? null,
      intentMinScore: resolverConfig.intentMinScore ?? null,
      maxSnapshotBytesForValidation: resolverConfig.maxSnapshotBytesForValidation ?? null,
      maxSnapshotExcerptChars: resolverConfig.maxSnapshotExcerptChars ?? null,
      llmTimeoutMs: resolverConfig.llmTimeoutMs ?? null,
      maxLLMFallbackPerSession: resolverConfig.maxLLMFallbackPerSession ?? null,
      llmMaxRetriesPerStep: resolverConfig.llmMaxRetriesPerStep ?? null,
    });
    const snapshotCache = await service.loadSnapshots(session, resolverConfig);

    const projectRoot = process.cwd();
    // Defaulting output to a 'tests/pages' directory at your project root
    const outputDir = path.join(projectRoot, 'tests', 'pages');

    console.log(`[AIR] Requesting Page Object Model generation...`);
    await LlmOrchestrator.generatePageObjects(session, outputDir, projectRoot, {
      resolverConfig,
      snapshotCache,
    });

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
