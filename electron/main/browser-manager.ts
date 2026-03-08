import { chromium, Browser, BrowserContext } from 'playwright';
import fs from 'fs';
import path from 'path';

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  public async startRecording(url: string, serverPort: number): Promise<void> {
    // 1. Launch a raw, lightweight Chromium instance (visible to the user)
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: false, // We want the user to see what they are recording!
        args: ['--window-size=1280,800', '--disable-infobars']
      });
    }

    // 2. Create a clean, isolated context (no stale cookies/cache)
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 }
    });

    // 3. Load the Interceptor script
    // Note: Adjust this path if your interceptor is located elsewhere!
    const interceptorPath = path.join(__dirname, '../../interceptor/interceptor.js');
    let interceptorCode = fs.readFileSync(interceptorPath, 'utf-8');

    // 4. Dynamically point the interceptor to our live EventServer port
    interceptorCode = interceptorCode.replace(
      /http:\/\/localhost:3000/g,
      `http://localhost:${serverPort}`
    );

    // 5. THE MAGIC: Playwright injects this into EVERY page automatically!
    await this.context.addInitScript({ content: interceptorCode });

    // 6. Open a new tab and go to the URL
    const page = await this.context.newPage();
    await page.goto(url);

    // 7. Handle cleanup when the user closes the browser
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