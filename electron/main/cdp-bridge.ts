// Purpose: Manages the Chrome DevTools Protocol connection to inject the interceptor.
// Prototype Origin: New file for Electron architecture.
// Changes: Uses Electron's native WebContents debugger instead of Puppeteer/Playwright.

import { WebContents, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export class CDPBridge {
  private currentWebContents: WebContents | null = null;

  public connect(webContents: WebContents): void {
    try {
      this.currentWebContents = webContents;
      this.currentWebContents.debugger.attach('1.3');
      this.currentWebContents.debugger.sendCommand('Page.enable');
      this.currentWebContents.debugger.sendCommand('Network.enable');
      console.log('🔌 CDP Debugger attached successfully.');
    } catch (error) {
      console.error('❌ Failed to attach CDP Debugger:', error);
    }
  }

  public async injectInterceptor(serverPort: number): Promise<void> {
    if (!this.currentWebContents) {
      throw new Error('Cannot inject interceptor: No active WebContents debugger.');
    }

    try {
      const isDev = !app.isPackaged;
      // Resolve path dynamically based on dev vs. production build
      const interceptorPath = isDev 
        ? path.join(__dirname, '../../interceptor/interceptor.js')
        : path.join(process.resourcesPath, 'interceptor.js');

      const scriptContent = fs.readFileSync(interceptorPath, 'utf-8');
      
      // Dynamically point the interceptor to our random localized port
      const modifiedScript = scriptContent.replace(
        /http:\/\/localhost:3000/g,
        `http://localhost:${serverPort}`
      );

      await this.currentWebContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: modifiedScript,
      });

      console.log(`💉 Interceptor injected. Pointed to http://localhost:${serverPort}`);
    } catch (error) {
      console.error('❌ Failed to inject interceptor script:', error);
    }
  }

  public disconnect(): void {
    if (this.currentWebContents) {
      try {
        this.currentWebContents.debugger.detach();
        console.log('🔌 CDP Debugger detached.');
      } catch (error) {
        console.error('❌ Error detaching CDP Debugger:', error);
      } finally {
        this.currentWebContents = null;
      }
    }
  }
}