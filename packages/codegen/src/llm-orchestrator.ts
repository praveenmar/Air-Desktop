import * as fs from 'fs';
import * as path from 'path';
import { CodegenSession, CodegenStep } from './types';
import { AirMetadata, AirMethodMeta } from './sidecar.types';
import { computeActionChecksum } from './checksum.utils';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  resolveSelectorsForSession,
} from './selector-resolver';
import type {
  LlmFallbackRequest,
  LlmFallbackSuggestion,
  ResolverConfig,
  SnapshotCache,
} from './selector-resolver';

interface LlmResponse {
  className: string;
  methods: Array<{
    stepNumber: number;
    intent: string;
    methodName: string;
    playwrightAction: string;
  }>;
}

export interface GeneratePageObjectsOptions {
  resolverConfig?: ResolverConfig;
  snapshotCache?: SnapshotCache;
}

export class LlmOrchestrator {
  static async generatePageObjects(
    session: CodegenSession,
    outputDir: string,
    projectRoot: string,
    options: GeneratePageObjectsOptions = {}
  ): Promise<void> {
    const resolverConfig = options.resolverConfig ?? {};
    const snapshotCache = options.snapshotCache ?? {
      get: (_nodeId: string, _normalizedUrl?: string, _controlSignature?: string) => null,
      getSource: (_nodeId: string, _normalizedUrl?: string, _controlSignature?: string) => 'unavailable',
    } as SnapshotCache & { snapshotEngineAvailable?: boolean };
    console.log('[DEBUG] snapshotCache received, engineAvailable:', !!(snapshotCache as any).snapshotEngineAvailable);
    const debugTrace = /^(1|true|yes)$/i.test(process.env.AIR_DEBUG_RESOLVER_TRACE || '');

    if (debugTrace) {
      console.log('--- SESSION STEPS ---');
      for (const step of session.steps) {
        console.log({
          step: step.step,
          selector: step.selector,
          sourceNodeId: step.sourceNodeId ?? null,
        });
      }

      console.log('--- SNAPSHOT AVAILABILITY ---');
      for (const step of session.steps) {
        const nodeId = step.sourceNodeId;
        const snapshot = snapshotCache.get(nodeId ?? '', step.normalizedUrl, step.controlSignature);
        console.log(`Step ${step.step} snapshot:`, snapshot ? 'YES' : 'NO');
      }
    }

    const resolverResult = await resolveSelectorsForSession(
      session,
      snapshotCache,
      resolverConfig,
      resolverConfig.enableLLMFallback
        ? (request: LlmFallbackRequest) => this.requestSelectorFallback(request)
        : undefined,
    );
    const resolutionMap = new Map(
      resolverResult.resolutions.map(resolution => [resolution.stepNumber, resolution]),
    );

    if (resolverResult.unresolvedStepNumbers.length > 0) {
      console.warn('[AIR] Some selectors unresolved:', resolverResult.unresolvedStepNumbers);
    }

    if (debugTrace) {
      console.log('--- RESOLVER OUTPUT ---');
      for (const resolution of resolverResult.resolutions) {
        console.log({
          step: resolution.stepNumber,
          original: resolution.originalSelector,
          resolved: resolution.resolvedSelector,
          resolvedBy: resolution.resolverMetadata.resolvedBy,
          score: resolution.resolverMetadata.bestScore,
          warnings: resolution.resolverMetadata.warningCodes,
        });
      }
    }

    // Generation-only view. Recorded session truth remains unchanged.
    const generationSteps: CodegenStep[] = session.steps.map(step => {
      const resolution = resolutionMap.get(step.step);
      return {
        ...step,
        selector: resolution?.resolvedSelector ?? step.selector,
        resolvedSelector: resolution?.resolvedSelector ?? step.selector,
        resolverMetadata: resolution?.resolverMetadata,
      };
    });

    if (debugTrace) {
      console.log('--- FINAL SELECTORS USED ---');
      for (const step of generationSteps) {
        console.log({
          step: step.step,
          selectorUsed: step.selector,
        });
      }
    }

    const promptPayload = this.buildPrompt(generationSteps);

    const geminiResponseJson = await this.callGeminiApi(promptPayload);
    const parsedResponse: LlmResponse = JSON.parse(geminiResponseJson);

    if (parsedResponse.methods.length !== generationSteps.length) {
      console.warn(
        `[AIR] Warning: Expected ${generationSteps.length} steps, LLM returned ${parsedResponse.methods.length}.`,
      );
    }

    const methodsContent: string[] = [];
    const sidecarMethods: Record<string, AirMethodMeta> = {};
    const originalStepMap = new Map(session.steps.map(step => [step.step, step]));

    for (const generatedMethod of parsedResponse.methods) {
      const originalStep = originalStepMap.get(generatedMethod.stepNumber);
      if (!originalStep) {
        console.error('[AIR] Invalid LLM output (Unknown step):', generatedMethod);
        continue;
      }

      const actionStr = generatedMethod.playwrightAction.trim();
      if (actionStr.startsWith('await ') || actionStr.startsWith('page.') || actionStr.startsWith('this.page.')) {
        console.error('[AIR] Invalid LLM output (Forbidden syntax):', generatedMethod);
        continue;
      }

      const fullAction = `this.page.${actionStr}`;
      const methodCode = `  async ${generatedMethod.methodName}() {\n    await ${fullAction};\n  }`;
      methodsContent.push(methodCode);

      sidecarMethods[generatedMethod.methodName] = {
        step: originalStep.step,
        intent: originalStep.intent,
        originalSelector: originalStep.selector,
        checksum: computeActionChecksum(fullAction),
        resolver: resolutionMap.get(originalStep.step)?.resolverMetadata,
      };
    }

    const pomFileName = `${parsedResponse.className}.ts`;
    const sidecarFileName = `${parsedResponse.className}.air.json`;
    const pomFilePath = path.join(outputDir, pomFileName);

    const pomContent = `import { AirBasePage } from '@air/reporter';
import metadata from './${sidecarFileName}';
import { Page, TestInfo } from '@playwright/test';

export class ${parsedResponse.className} extends AirBasePage {
  constructor(page: Page, testInfo: TestInfo) {
    super(page, testInfo, metadata as any);
  }

${methodsContent.join('\n\n')}
}
`;

    const sidecarContent: AirMetadata = {
      version: 1,
      session: session.sessionId,
      generatedAt: new Date().toISOString(),
      methods: sidecarMethods,
    };

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(pomFilePath, pomContent, 'utf-8');
    fs.writeFileSync(path.join(outputDir, sidecarFileName), JSON.stringify(sidecarContent, null, 2), 'utf-8');

    this.updateSessionMap(pomFilePath, session.sessionId, session.url, projectRoot);
  }

  private static toPromptSteps(steps: CodegenStep[]): Array<Record<string, unknown>> {
    return steps.map(step => ({
      step: step.step,
      intent: step.intent,
      action: step.action,
      selector: step.selector,
      selectorPriority: step.selectorPriority,
      selectorRank: step.selectorRank,
      value: step.value,
      outcomeType: step.outcomeType,
      navigatesTo: step.navigatesTo,
      assertions: step.assertions,
      userAssertions: step.userAssertions,
      confidence: step.confidence,
      sampleSize: step.sampleSize,
      pageUrl: step.pageUrl,
      normalizedUrl: step.normalizedUrl,
      sourceNodeId: step.sourceNodeId,
    }));
  }

  private static buildPrompt(steps: CodegenStep[]): string {
    return `
You are an expert SDET. Generate Playwright Page Object Model methods for the following recorded session.

STRICT CONTRACT:
1. You MUST return valid JSON matching the exact schema provided.
2. You MUST retain the exact "stepNumber" for each step. Do not alter it. You MUST return all ${steps.length} steps.
3. The "playwrightAction" MUST be a suffix chain that can be appended directly to "this.page.".

EXAMPLES:
Valid: "getByTestId('login-btn').click()"
Valid: "goto('https://example.com')"
INVALID (Do not include await): "await getByTestId('btn').click()"
INVALID (Do not include page): "page.getByTestId('btn').click()"
INVALID (Do not include this): "this.page.getByTestId('btn').click()"

JSON SCHEMA:
{
  "className": "YourChosenClassName",
  "methods": [
    {
      "stepNumber": 1,
      "intent": "click_login_btn",
      "methodName": "clickLoginButton",
      "playwrightAction": "getByTestId('login-btn').click()"
    }
  ]
}

SESSION DATA:
${JSON.stringify(this.toPromptSteps(steps), null, 2)}
`;
  }

  private static buildSelectorFallbackPrompt(request: LlmFallbackRequest): string {
    return `
You are a selector recovery assistant for Playwright code generation.

Return ONLY a JSON array (no markdown) with objects shaped exactly as:
[{ "stepNumber": 1, "selector": "button[type=\\"submit\\"]" }]

Rules:
1. Include only steps that you are confident about.
2. selector must be CSS only (no XPath, no text= syntax).
3. Prefer stable attributes (data-testid, id, aria-label, name, role).
4. Keep selectors concise.

UNRESOLVED STEPS:
${JSON.stringify(request.steps, null, 2)}
`;
  }

  private static async requestSelectorFallback(request: LlmFallbackRequest): Promise<LlmFallbackSuggestion[]> {
    try {
      const prompt = this.buildSelectorFallbackPrompt(request);
      const responseJson = await this.callGeminiApi(prompt);
      const parsed = JSON.parse(responseJson);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(item => item && typeof item === 'object')
        .map(item => ({
          stepNumber: Number((item as any).stepNumber),
          selector: String((item as any).selector ?? ''),
        }))
        .filter(item => Number.isFinite(item.stepNumber) && item.stepNumber > 0 && item.selector.length > 0);
    } catch (error) {
      console.warn('[AIR] Selector fallback parsing failed:', error);
      return [];
    }
  }

  private static updateSessionMap(
    pomFilePath: string,
    newSessionId: string,
    startingUrl: string,
    projectRoot: string
  ): void {
    const airDir = path.join(projectRoot, '.air');
    const mapPath = path.join(airDir, 'session-map.json');

    if (!fs.existsSync(airDir)) fs.mkdirSync(airDir, { recursive: true });

    let mapData = { version: 1, mappings: {} as Record<string, any> };

    if (fs.existsSync(mapPath)) {
      try {
        const rawData = fs.readFileSync(mapPath, 'utf-8');
        if (rawData.trim() !== '') mapData = JSON.parse(rawData);
      } catch (e) {
        console.error(`[AIR] Failed to parse session-map.json. Creating new map. Error: ${e}`);
      }
    }

    const relativePomPath = path.relative(projectRoot, pomFilePath).replace(/\\/g, '/');
    if (!mapData.mappings) mapData.mappings = {};

    const existingMapping = mapData.mappings[relativePomPath];
    const previousIds = existingMapping?.previousSessionIds || [];

    if (existingMapping?.canonicalSessionId && existingMapping.canonicalSessionId !== newSessionId) {
      previousIds.unshift(existingMapping.canonicalSessionId);
    }

    mapData.mappings[relativePomPath] = {
      canonicalSessionId: newSessionId,
      previousSessionIds: previousIds.slice(0, 5),
      lastUpdated: new Date().toISOString(),
      startingUrl: startingUrl,
    };

    const tempPath = `${mapPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(mapData, null, 2), 'utf-8');
    fs.renameSync(tempPath, mapPath);
  }

  private static async callGeminiApi(payload: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('[AIR] GEMINI_API_KEY environment variable is missing.');

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    console.log('[AIR] Sending session data to Gemini...');
    const result = await model.generateContent(payload);
    const text = result.response.text();

    if (!text) throw new Error('[AIR] Gemini returned an empty response.');
    return text;
  }
}
