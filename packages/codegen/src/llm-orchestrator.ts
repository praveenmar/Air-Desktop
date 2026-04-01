import * as fs from 'fs';
import * as path from 'path';
import { CodegenSession } from './types';
import { AirMetadata, AirMethodMeta } from './sidecar.types';
import { computeActionChecksum } from './checksum.utils';
import { GoogleGenerativeAI } from '@google/generative-ai';

interface LlmResponse {
  className: string;
  methods: Array<{
    stepNumber: number;
    intent: string;
    methodName: string;
    playwrightAction: string;
  }>;
}

export class LlmOrchestrator {
  static async generatePageObjects(session: CodegenSession, outputDir: string, projectRoot: string): Promise<void> {
    const promptPayload = this.buildPrompt(session);
    
    const geminiResponseJson = await this.callGeminiApi(promptPayload);
    const parsedResponse: LlmResponse = JSON.parse(geminiResponseJson);

    if (parsedResponse.methods.length !== session.steps.length) {
      console.warn(`[AIR] Warning: Expected ${session.steps.length} steps, LLM returned ${parsedResponse.methods.length}.`);
    }

    const methodsContent: string[] = [];
    const sidecarMethods: Record<string, AirMethodMeta> = {};

    for (const generatedMethod of parsedResponse.methods) {
      const originalStep = session.steps.find(s => s.step === generatedMethod.stepNumber);
      if (!originalStep) {
        console.error("[AIR] Invalid LLM output (Unknown step):", generatedMethod);
        continue;
      }

      const actionStr = generatedMethod.playwrightAction.trim();
      if (actionStr.startsWith('await ') || actionStr.startsWith('page.') || actionStr.startsWith('this.page.')) {
        console.error("[AIR] Invalid LLM output (Forbidden syntax):", generatedMethod);
        continue;
      }

      const fullAction = `this.page.${actionStr}`;
      const methodCode = `  async ${generatedMethod.methodName}() {\n    await ${fullAction};\n  }`;
      methodsContent.push(methodCode);

      sidecarMethods[generatedMethod.methodName] = {
        step: originalStep.step,
        intent: originalStep.intent,
        originalSelector: originalStep.selector,
        checksum: computeActionChecksum(fullAction)
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
      methods: sidecarMethods
    };

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    
    fs.writeFileSync(pomFilePath, pomContent, 'utf-8');
    fs.writeFileSync(path.join(outputDir, sidecarFileName), JSON.stringify(sidecarContent, null, 2), 'utf-8');

    this.updateSessionMap(pomFilePath, session.sessionId, session.url, projectRoot);
  }

  private static buildPrompt(session: CodegenSession): string {
    return `
You are an expert SDET. Generate Playwright Page Object Model methods for the following recorded session.

STRICT CONTRACT:
1. You MUST return valid JSON matching the exact schema provided.
2. You MUST retain the exact "stepNumber" for each step. Do not alter it. You MUST return all ${session.steps.length} steps.
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
${JSON.stringify(session.steps, null, 2)}
`;
  }

  private static updateSessionMap(pomFilePath: string, newSessionId: string, startingUrl: string, projectRoot: string) {
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
      startingUrl: startingUrl
    };

    const tempPath = `${mapPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(mapData, null, 2), 'utf-8');
    fs.renameSync(tempPath, mapPath);
  }

  private static async callGeminiApi(payload: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("[AIR] GEMINI_API_KEY environment variable is missing.");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash", 
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      }
    });

    console.log("[AIR] Sending session data to Gemini...");
    const result = await model.generateContent(payload);
    const text = result.response.text();
    
    if (!text) throw new Error("[AIR] Gemini returned an empty response.");
    return text;
  }
}