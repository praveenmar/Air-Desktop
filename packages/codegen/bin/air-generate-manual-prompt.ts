#!/usr/bin/env node
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CodegenService } from '../src/index';
import { LlmOrchestrator } from '../src/llm-orchestrator';
import {
  resolveSelectorsForSession,
  type ResolverConfig,
  type LlmFallbackRequest,
  type LlmFallbackSuggestion,
} from '../src/selector-resolver';

interface CliArgs {
  sessionId: string | null;
  outPath: string | null;
  enableResolverLlm: boolean | null;
  selectorSuggestionsPath: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    sessionId: null,
    outPath: null,
    enableResolverLlm: null,
    selectorSuggestionsPath: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '--out' || arg === '-o') && argv[i + 1]) {
      args.outPath = argv[++i];
      continue;
    }
    if (arg === '--enable-resolver-llm') {
      args.enableResolverLlm = true;
      continue;
    }
    if (arg === '--disable-resolver-llm') {
      args.enableResolverLlm = false;
      continue;
    }
    if ((arg === '--selector-suggestions' || arg === '-s') && argv[i + 1]) {
      args.selectorSuggestionsPath = argv[++i];
      continue;
    }
    if (!arg.startsWith('-') && args.sessionId === null) {
      args.sessionId = arg;
    }
  }

  return args;
}

function resolveDbPath(): string {
  if (process.env['AIR_DB_PATH']) return process.env['AIR_DB_PATH'];
  switch (process.platform) {
    case 'win32':
      return path.join(process.env['APPDATA'] || os.homedir(), 'air-desktop', 'air-data.db');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'air-desktop', 'air-data.db');
    default:
      return path.join(os.homedir(), '.config', 'air-desktop', 'air-data.db');
  }
}

function parseNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveResolverConfigFromEnv(enableResolverLlmOverride: boolean | null): ResolverConfig {
  const enabledRaw = (process.env['AIR_ENABLE_LLM_SELECTOR_FALLBACK'] || '').trim().toLowerCase();
  const envEnableLlmFallback = enabledRaw === '1' || enabledRaw === 'true' || enabledRaw === 'yes';
  const effectiveEnableLlmFallback = enableResolverLlmOverride ?? envEnableLlmFallback;

  return {
    // Manual prompt mode still allows optional resolver LLM fallback.
    // Final codegen call remains external/manual via prompt file.
    enableLLMFallback: effectiveEnableLlmFallback,
    resolverMinScore: parseNumberEnv('AIR_RESOLVER_MIN_SCORE'),
    intentMinScore: parseNumberEnv('AIR_INTENT_MIN_SCORE'),
    maxSnapshotBytesForValidation: parseNumberEnv('AIR_MAX_SNAPSHOT_BYTES'),
    maxSnapshotExcerptChars: parseNumberEnv('AIR_MAX_SNAPSHOT_EXCERPT_CHARS'),
    llmTimeoutMs: parseNumberEnv('AIR_SELECTOR_LLM_TIMEOUT_MS'),
    maxLLMFallbackPerSession: parseNumberEnv('AIR_MAX_LLM_FALLBACK_PER_SESSION'),
    llmMaxRetriesPerStep: parseNumberEnv('AIR_LLM_MAX_RETRIES_PER_STEP'),
    __envEnableLlmFallback: envEnableLlmFallback,
    __effectiveEnableLlmFallback: effectiveEnableLlmFallback,
  } as ResolverConfig & {
    __envEnableLlmFallback?: boolean;
    __effectiveEnableLlmFallback?: boolean;
  };
}

function resolvePromptOutputPath(sessionId: string, providedOutPath: string | null): string {
  if (providedOutPath && providedOutPath.trim().length > 0) {
    return path.resolve(process.cwd(), providedOutPath);
  }

  const outputDir = path.join(process.cwd(), '.air', 'manual-prompts');
  return path.join(outputDir, `${sessionId}.prompt.txt`);
}

function resolveMetaOutputPath(promptPath: string): string {
  const parsed = path.parse(promptPath);
  return path.join(parsed.dir, `${parsed.name}.meta.json`);
}

function resolveStemFromPromptPath(promptPath: string): { dir: string; stem: string } {
  const parsed = path.parse(promptPath);
  const stem = parsed.name.endsWith('.prompt')
    ? parsed.name.slice(0, -'.prompt'.length)
    : parsed.name;
  return { dir: parsed.dir, stem };
}

function resolveSelectorFallbackPromptPath(promptPath: string): string {
  const { dir, stem } = resolveStemFromPromptPath(promptPath);
  return path.join(dir, `${stem}.selector-fallback.prompt.txt`);
}

function resolveSelectorFallbackRequestPath(promptPath: string): string {
  const { dir, stem } = resolveStemFromPromptPath(promptPath);
  return path.join(dir, `${stem}.selector-fallback.request.json`);
}

function ensureParentDir(filePath: string): void {
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function parseSelectorSuggestionsFile(filePath: string): LlmFallbackSuggestion[] {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`[AIR] Selector suggestions file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`[AIR] Failed to parse selector suggestions JSON: ${(error as Error).message}`);
  }

  const list = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { suggestions?: unknown[] }).suggestions)
      ? (parsed as { suggestions: unknown[] }).suggestions
      : null);

  if (!list) {
    throw new Error('[AIR] Selector suggestions must be an array or { "suggestions": [] }.');
  }

  const normalized: LlmFallbackSuggestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as {
      stepNumber?: unknown;
      selector?: unknown;
      selectors?: unknown;
    };
    const stepNumber = Number(candidate.stepNumber);
    if (!Number.isFinite(stepNumber) || stepNumber <= 0) continue;

    const selectors: string[] = [];
    if (typeof candidate.selector === 'string' && candidate.selector.trim()) {
      selectors.push(candidate.selector.trim());
    }
    if (Array.isArray(candidate.selectors)) {
      for (const selector of candidate.selectors) {
        if (typeof selector === 'string' && selector.trim()) {
          selectors.push(selector.trim());
        }
      }
    }
    if (selectors.length === 0) continue;

    normalized.push({
      stepNumber,
      selector: selectors[0],
      selectors,
    });
  }

  return normalized;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionId = args.sessionId;

  if (!sessionId) {
    console.error('\n[ERR] Please provide a sessionId:');
    console.error('  node packages/codegen/bin/run-ts-cli.cjs air-generate-manual-prompt.ts <sessionId> [--out <file>] [--enable-resolver-llm] [--selector-suggestions <json>]\n');
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

    const resolverConfig = resolveResolverConfigFromEnv(args.enableResolverLlm);
    const configWithFlags = resolverConfig as ResolverConfig & {
      __envEnableLlmFallback?: boolean;
      __effectiveEnableLlmFallback?: boolean;
    };
    const envEnableLlmFallback = !!configWithFlags.__envEnableLlmFallback;
    const effectiveEnableLlmFallback = !!configWithFlags.__effectiveEnableLlmFallback;
    delete configWithFlags.__envEnableLlmFallback;
    delete configWithFlags.__effectiveEnableLlmFallback;

    console.log('[AIR] Manual prompt mode config', {
      envEnableLLMFallback: envEnableLlmFallback,
      cliEnableResolverLlmOverride: args.enableResolverLlm,
      effectiveEnableLLMFallback: effectiveEnableLlmFallback,
      resolverMinScore: resolverConfig.resolverMinScore ?? null,
      intentMinScore: resolverConfig.intentMinScore ?? null,
      maxSnapshotBytesForValidation: resolverConfig.maxSnapshotBytesForValidation ?? null,
      maxSnapshotExcerptChars: resolverConfig.maxSnapshotExcerptChars ?? null,
      llmTimeoutMs: resolverConfig.llmTimeoutMs ?? null,
      maxLLMFallbackPerSession: resolverConfig.maxLLMFallbackPerSession ?? null,
      llmMaxRetriesPerStep: resolverConfig.llmMaxRetriesPerStep ?? null,
      networkLlmCalls: false,
    });

    const selectorSuggestions = args.selectorSuggestionsPath
      ? parseSelectorSuggestionsFile(args.selectorSuggestionsPath)
      : null;

    const snapshotCache = await service.loadSnapshots(session, resolverConfig);
    let capturedFallbackRequest: LlmFallbackRequest | null = null;
    const llmProvider = effectiveEnableLlmFallback
      ? async (request: LlmFallbackRequest): Promise<LlmFallbackSuggestion[]> => {
          capturedFallbackRequest = request;
          if (selectorSuggestions && selectorSuggestions.length > 0) {
            return selectorSuggestions;
          }
          // Manual mode: capture request and let user run this with external LLM.
          return [];
        }
      : undefined;

    const resolverResult = await resolveSelectorsForSession(
      session,
      snapshotCache,
      resolverConfig,
      llmProvider,
    );

    const resolutionMap = new Map(
      resolverResult.resolutions.map(resolution => [resolution.stepNumber, resolution]),
    );
    const generationSteps = session.steps.map(step => {
      const resolution = resolutionMap.get(step.step);
      return {
        ...step,
        selector: resolution?.resolvedSelector ?? step.selector,
        resolvedSelector: resolution?.resolvedSelector ?? step.selector,
        resolverMetadata: resolution?.resolverMetadata,
      };
    });

    const buildPrompt = (LlmOrchestrator as unknown as { buildPrompt?: (s: typeof session, st: typeof generationSteps) => string }).buildPrompt;
    if (typeof buildPrompt !== 'function') {
      throw new Error('[AIR] Unable to access LLM prompt builder.');
    }

    const promptPayload = buildPrompt.call(LlmOrchestrator, session, generationSteps);
    const promptPath = resolvePromptOutputPath(sessionId, args.outPath);
    const metaPath = resolveMetaOutputPath(promptPath);
    const selectorFallbackPromptPath = resolveSelectorFallbackPromptPath(promptPath);
    const selectorFallbackRequestPath = resolveSelectorFallbackRequestPath(promptPath);
    ensureParentDir(promptPath);
    ensureParentDir(metaPath);
    ensureParentDir(selectorFallbackPromptPath);
    ensureParentDir(selectorFallbackRequestPath);

    fs.writeFileSync(promptPath, promptPayload, 'utf-8');

    let selectorFallbackPromptGenerated = false;
    if (capturedFallbackRequest) {
      fs.writeFileSync(selectorFallbackRequestPath, JSON.stringify(capturedFallbackRequest, null, 2), 'utf-8');
      const buildSelectorFallbackPrompt = (
        LlmOrchestrator as unknown as {
          buildSelectorFallbackPrompt?: (request: LlmFallbackRequest) => string;
        }
      ).buildSelectorFallbackPrompt;
      if (typeof buildSelectorFallbackPrompt === 'function') {
        const selectorFallbackPrompt = buildSelectorFallbackPrompt.call(
          LlmOrchestrator,
          capturedFallbackRequest,
        );
        fs.writeFileSync(selectorFallbackPromptPath, selectorFallbackPrompt, 'utf-8');
        selectorFallbackPromptGenerated = true;
      }
    }

    const meta = {
      version: 1,
      mode: 'manual-llm-prompt',
      generatedAt: new Date().toISOString(),
      sessionId: session.sessionId,
      startUrl: session.url,
      resolver: {
        llmFallbackEnabled: effectiveEnableLlmFallback,
        manualSuggestionsApplied: !!selectorSuggestions,
      },
      stats: {
        totalSteps: session.steps.length,
        unresolved: resolverResult.unresolvedStepNumbers.length,
        llmAttempted: resolverResult.llmAttemptedStepNumbers.length,
        llmAccepted: resolverResult.llmAcceptedStepNumbers.length,
      },
      unresolvedSteps: resolverResult.unresolvedStepNumbers,
      files: {
        prompt: promptPath,
        metadata: metaPath,
        selectorFallbackPrompt: selectorFallbackPromptGenerated ? selectorFallbackPromptPath : null,
        selectorFallbackRequest: capturedFallbackRequest ? selectorFallbackRequestPath : null,
      },
      steps: generationSteps.map(step => ({
        step: step.step,
        action: step.action,
        intent: step.intent,
        originalSelector: session.steps.find(original => original.step === step.step)?.selector ?? step.selector,
        selectorUsedForPrompt: step.selector,
        pageUrl: step.pageUrl,
        normalizedUrl: step.normalizedUrl,
      })),
    };

    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    console.log('[AIR] Manual prompt written:', promptPath);
    console.log('[AIR] Metadata written:', metaPath);
    if (capturedFallbackRequest) {
      console.log('[AIR] Selector fallback request written:', selectorFallbackRequestPath);
      if (selectorFallbackPromptGenerated) {
        console.log('[AIR] Selector fallback prompt written:', selectorFallbackPromptPath);
      }
      if (!selectorSuggestions || selectorSuggestions.length === 0) {
        console.log('[AIR] Next step: paste selector fallback prompt into your external LLM, save JSON response, then rerun with --selector-suggestions <file>.');
      } else {
        console.log('[AIR] Manual selector suggestions were applied from:', path.resolve(process.cwd(), args.selectorSuggestionsPath as string));
      }
    }
    console.log('[AIR] Resolver summary', {
      totalSteps: session.steps.length,
      unresolved: resolverResult.unresolvedStepNumbers.length,
      llmAttempted: resolverResult.llmAttemptedStepNumbers.length,
      llmAccepted: resolverResult.llmAcceptedStepNumbers.length,
    });
    console.log('[AIR] Next step: copy the main prompt file content into your external LLM chat and request JSON-only output.\n');
  } catch (error) {
    console.error('\n[ERR] Manual prompt generation failed:', error);
    process.exit(1);
  } finally {
    service.close();
  }
}

main();
