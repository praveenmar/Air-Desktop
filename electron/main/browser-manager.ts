// Fix (Bug #5a — Production path): BrowserManager previously used a hardcoded relative path
//   path.join(__dirname, '../../interceptor/interceptor.js') with no app.isPackaged check.
//   In a packaged Electron build __dirname points inside the asar bundle where that relative
//   path does not exist. electron-builder.yml already copies the interceptor to
//   process.resourcesPath/interceptor.js via extraResources. Added the same isDev guard
//   that CDPBridge already uses correctly.
//
// Fix (Bug #5b — URL validation): page.goto(url) was called on any string arriving from
//   the renderer with zero validation. A javascript: URI, a file:// path, or a malformed
//   string would be passed straight through to Playwright. Added validateUrl() which only
//   allows http: and https: protocols and throws a clear error for anything else.
//
// Note (Duplication): Both BrowserManager and CDPBridge load the interceptor, run the same
//   port-replacement regex, and inject it. Any future change must be made in both places.
//   These should be consolidated into a shared loadInterceptor(serverPort) utility.

import { app } from 'electron';
import { chromium, Browser, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';

/**
 * Validates that a URL is safe to navigate to.
 * Only http: and https: are permitted — file://, javascript:, data: etc. are rejected.
 */
function validateUrl(url: string): void {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}" could not be parsed.`);
  }

  const allowed = ['http:', 'https:'];
  if (!allowed.includes(parsed.protocol)) {
    throw new Error(
      `Unsafe URL protocol "${parsed.protocol}". Only http: and https: are allowed.`
    );
  }
}

/**
 * Resolves the interceptor script path correctly for both dev and production builds.
 * Mirrors the logic already present in CDPBridge.injectInterceptor().
 */
function resolveInterceptorPath(): string {
  const isDev = !app.isPackaged;
  return isDev
    ? path.join(__dirname, '../../interceptor/interceptor.js')  // dev: relative to compiled output
    : path.join(process.resourcesPath, 'interceptor.js');        // prod: copied by electron-builder extraResources
}

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  public async startRecording(url: string, serverPort: number): Promise<void> {
    // Validate before doing anything — throws a clear error the IPC handler will surface
    validateUrl(url);

    // 1. Launch a raw, lightweight Chromium instance (visible to the user)
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false,
        args: ['--window-size=1280,800', '--disable-infobars'],
      });
    }

    // 2. Create a clean, isolated context (no stale cookies/cache)
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
    });

    // 3. Load the Interceptor script from the correct path for this environment
    const interceptorPath = resolveInterceptorPath();
    let interceptorCode = fs.readFileSync(interceptorPath, 'utf-8');

    // 4. Dynamically point the interceptor to our live EventServer port
    interceptorCode = interceptorCode.replace(
      /http:\/\/localhost:3000/g,
      `http://localhost:${serverPort}`
    );

    // 5. Playwright injects this into EVERY page before any page JS runs
    await this.context.addInitScript({ content: interceptorCode });

    // 6. Navigate to the target URL
    const page = await this.context.newPage();
    await page.goto(url);

    // 7. Clean up state when the user closes the browser window
    this.browser.on('disconnected', () => {
      console.log('🛑 Playwright browser closed by user');
      this.browser = null;
      this.context = null;
    });
  }

  public async stopRecording(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }
}

export const browserManager = new BrowserManager();