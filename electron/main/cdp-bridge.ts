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

  public async injectInterceptor(serverPort: number, sessionId: string): Promise<void> {
  if (!this.currentWebContents) {
    throw new Error('Cannot inject interceptor: No active WebContents debugger.');
  }

  try {
    const isDev = !app.isPackaged;
    const interceptorPath = isDev 
      ? path.join(__dirname, '../../interceptor/interceptor.js')
      : path.join(process.resourcesPath, 'interceptor.js');

    let interceptorCode = fs.readFileSync(interceptorPath, 'utf-8');
    
    // Replace the server URL placeholder
    interceptorCode = interceptorCode.replace(
      /http:\/\/localhost:3000/g,
      `http://localhost:${serverPort}`
    );

    // Build the config injection script
    const configScript = `
      window.__AIR_CONFIG__ = {
        sessionId: "${sessionId}",
        serverUrl: "http://localhost:${serverPort}",
        strictMode: true
      };
    `;

    // Combine config + interceptor
    const fullScript = configScript + interceptorCode;

    await this.currentWebContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: fullScript,
    });

    console.log(`💉 Interceptor injected with session ${sessionId} pointing to http://localhost:${serverPort}`);
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