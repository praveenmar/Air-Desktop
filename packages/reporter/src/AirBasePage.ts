import { Page, TestInfo } from '@playwright/test';

export interface AirMethodMeta {
  step: number;
  intent: string;
  checksum: string;
  originalSelector: string;
}

export interface AirMetadata {
  version: 1;
  session: string;
  generatedAt: string;
  methods: Record<string, AirMethodMeta>;
}

export class AirBasePage {
  private methodMap: Map<string, AirMethodMeta>;

  constructor(
    protected page: Page,
    protected testInfo: TestInfo,
    metadata: AirMetadata
  ) {
    this.methodMap = new Map(Object.entries(metadata.methods));
    
    try {
      this.testInfo.annotations.push({ type: 'air-session', description: metadata.session });
    } catch {
      // Fail silently if testInfo is malformed
    }

    this.wrapRegisteredMethods();
  }

  private wrapRegisteredMethods() {
    const PROTECTED = new Set(['constructor', 'wrapRegisteredMethods', 'toString', 'valueOf', 'toJSON']);

    for (const [methodName, meta] of this.methodMap) {
      if (PROTECTED.has(methodName)) continue;

      const original = (this as any)[methodName];
      if (typeof original !== 'function') continue;

      (this as any)[methodName] = async (...args: any[]) => {
        try {
          this.testInfo.annotations.push(
            { type: 'air-step', description: String(meta.step) },
            { type: 'air-intent', description: meta.intent },
            { type: 'air-checksum', description: meta.checksum }
          );
        } catch {}
        return original.call(this, ...args);
      };
    }
  }
}