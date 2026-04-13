import * as vscode from 'vscode';
import { chromium, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';

let activeBrowser: Browser | null = null;
let activeContext: BrowserContext | null = null;
let currentSessionId: string | null = null;
let extensionContext: vscode.ExtensionContext | null = null;

let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let stdoutBuffer = '';

let serverReadyResolve: ((port: number) => void) | null = null;
let serverReadyReject: ((error: Error) => void) | null = null;
let serverReadyPromise: Promise<number> | null = null;

let isStoppingRecording = false;

const SCOPE = 'Extension';

function createServerReadyPromise(): Promise<number> {
  serverReadyPromise = new Promise<number>((resolve, reject) => {
    serverReadyResolve = resolve;
    serverReadyReject = reject;
  });
  return serverReadyPromise;
}

async function waitForServerReady(timeoutMs = 10_000): Promise<number> {
  if (serverPort && serverPort > 0) {
    return serverPort;
  }

  if (!serverReadyPromise) {
    createServerReadyPromise();
  }

  const timeoutPromise = new Promise<number>((_, reject) => {
    setTimeout(() => reject(new Error('Timed out waiting for AIR server port')), timeoutMs);
  });

  return Promise.race([serverReadyPromise!, timeoutPromise]);
}

async function getServerBaseUrl(): Promise<string> {
  const port = await waitForServerReady(10_000);
  return `http://127.0.0.1:${port}`;
}

async function startBackgroundServer(context: vscode.ExtensionContext, dbPath: string): Promise<void> {
  if (serverProcess) return;

  createServerReadyPromise();

  const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'index.js'));

  if (!fs.existsSync(serverModule)) {
    throw new Error(`Server module not found: ${serverModule}`);
  }

  console.log(`[${SCOPE}] Spawning background server`, {
    serverModule,
    dbPath,
    node: process.execPath,
  });

  serverProcess = spawn(process.execPath, [serverModule], {
    env: { ...process.env, AIR_DB_PATH: dbPath },
    stdio: ['ipc', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout?.on('data', (data) => {
    const out = data.toString();
    stdoutBuffer += out;

    const match = stdoutBuffer.match(/AIR_SERVER_PORT:(\d+)/);
    if (match && !serverPort) {
      serverPort = parseInt(match[1], 10);
      console.log(`[${SCOPE}] Server started`, { port: serverPort });
      serverReadyResolve?.(serverPort);
      serverReadyResolve = null;
      serverReadyReject = null;
    }
  });

  serverProcess.stderr?.on('data', (data) => {
    console.error(`[${SCOPE}] Server stderr`, { error: data.toString() });
  });

  serverProcess.on('error', (error) => {
    console.error(`[${SCOPE}] Server spawn failed`, error);
    serverPort = null;
    serverProcess = null;
    serverReadyReject?.(error instanceof Error ? error : new Error(String(error)));
    serverReadyResolve = null;
    serverReadyReject = null;
  });

  serverProcess.on('exit', (code, signal) => {
    console.warn(`[${SCOPE}] Server exited`, { code, signal });
    serverPort = null;
    serverProcess = null;

    if (serverReadyReject) {
      serverReadyReject(
        new Error(`AIR server exited before ready (code=${code}, signal=${signal ?? 'none'})`),
      );
    }

    serverReadyResolve = null;
    serverReadyReject = null;
  });
}

function buildConfigScript(sessionId: string, port: number): string {
  return `
    window.__AIR_CONFIG__ = {
      sessionId: ${JSON.stringify(sessionId)},
      serverUrl: ${JSON.stringify(`http://127.0.0.1:${port}`)},
      version: ${Date.now()}
    };
  `;
}

async function loadInterceptorPath(context: vscode.ExtensionContext): Promise<string> {
  const interceptorPath = context.asAbsolutePath('interceptor.js');

  if (!fs.existsSync(interceptorPath)) {
    console.error(`[${SCOPE}] Interceptor not found`, { interceptorPath });
    throw new Error(`Interceptor missing at: ${interceptorPath}`);
  }

  console.log(`[${SCOPE}] Loaded interceptor path`, { interceptorPath });
  return interceptorPath;
}

async function flushAndCloseBrowser(): Promise<void> {
  if (!activeContext || !activeBrowser) {
    return;
  }

  const pages = activeContext.pages();

  await Promise.all(
    pages.map(async (page) => {
      try {
        await page.evaluate(() => {
          const interceptor = (window as any)._airInterceptor;
          if (interceptor && typeof interceptor.flushQueue === 'function') {
            return interceptor.flushQueue();
          }
          return undefined;
        });
        console.log('[AIR] Flush triggered before browser close');
      } catch (error) {
        console.warn(`[${SCOPE}] Failed to flush page before stop`, { error: String(error) });
      }
    }),
  );

  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    await activeBrowser.close();
  } finally {
    activeBrowser = null;
    activeContext = null;
  }
}

async function startRecording() {
  if (!extensionContext) {
    await vscode.window.showErrorMessage('AIR: Extension not initialized correctly');
    return;
  }

  if (activeBrowser) {
    await vscode.window.showWarningMessage('AIR: Recording already in progress');
    return;
  }

  const url = await vscode.window.showInputBox({
    prompt: 'Enter URL to record',
    placeHolder: 'https://example.com',
    validateInput: (value: string) => {
      try {
        new URL(value);
        return null;
      } catch {
        return 'Invalid URL';
      }
    },
  });

  if (!url) return;

  try {
    const baseUrl = await getServerBaseUrl();

    currentSessionId = randomUUID();

    const configScript = buildConfigScript(
      currentSessionId,
      Number(baseUrl.split(':').pop()),
    );

    const interceptorPath = await loadInterceptorPath(extensionContext);

    serverProcess?.send({
      type: 'SET_SESSION',
      sessionId: currentSessionId,
    });

    console.log('[AIR] Using server:', baseUrl);
    console.log(`[${SCOPE}] Starting recording`, {
      sessionId: currentSessionId,
      url,
      serverUrl: baseUrl,
    });

    activeBrowser = await chromium.launch({ headless: false });
    activeContext = await activeBrowser.newContext();

    await activeContext.addInitScript({ content: configScript });
    await activeContext.addInitScript({ path: interceptorPath });

    activeContext.on('page', async (page) => {
      console.log(`[${SCOPE}] New page detected`);
      try {
        await page.waitForLoadState('domcontentloaded');
      } catch (error) {
        console.warn(`[${SCOPE}] Page load wait failed`, { error: String(error) });
      }
    });

    activeBrowser.on('disconnected', () => {
      if (!isStoppingRecording) {
        void stopRecording();
      }
    });

    const page = await activeContext.newPage();
    await page.goto(url);

    console.log(`[${SCOPE}] Recording started`, {
      sessionId: currentSessionId,
      url,
      serverUrl: baseUrl,
    });

    void vscode.window.showInformationMessage(`AIR Recording: ${currentSessionId}`);
  } catch (error) {
    console.error(`[${SCOPE}] Failed to start recording`, error);

    void vscode.window.showErrorMessage(`Failed to start recording: ${String(error)}`);

    currentSessionId = null;

    try {
      if (activeBrowser) {
        await activeBrowser.close();
      }
    } catch (closeError) {
      console.warn(`[${SCOPE}] Browser close failed after start error`, {
        error: String(closeError),
      });
    } finally {
      activeBrowser = null;
      activeContext = null;
    }
  }
}

async function stopRecording() {
  if (isStoppingRecording) return;
  isStoppingRecording = true;

  try {
    if (!activeContext || !activeBrowser) {
      return;
    }

    void vscode.window.showInformationMessage('AIR: Stopping and flushing...');

    await flushAndCloseBrowser();

    if (currentSessionId && serverPort) {
      try {
        const baseUrl = `http://127.0.0.1:${serverPort}`;
        await fetch(`${baseUrl}/api/sessions/${currentSessionId}/end`, {
          method: 'POST',
        });
      } catch (error) {
        console.warn(`[${SCOPE}] Failed to mark session ended`, {
          sessionId: currentSessionId,
          error: String(error),
        });
      }
    }

    console.log(`[${SCOPE}] Recording stopped`, { sessionId: currentSessionId });
    currentSessionId = null;
    void vscode.window.showInformationMessage('AIR: Recording stopped');
  } catch (error) {
    console.error(`[${SCOPE}] Error during stop`, error);
  } finally {
    activeBrowser = null;
    activeContext = null;
    currentSessionId = null;
    isStoppingRecording = false;
  }
}

async function listSessions() {
  try {
    const baseUrl = await getServerBaseUrl();
    const res = await fetch(`${baseUrl}/api/sessions`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const sessions: any[] = await res.json();

    if (!Array.isArray(sessions) || sessions.length === 0) {
      void vscode.window.showInformationMessage('AIR: No sessions found');
      return;
    }

    const lines = sessions.map(
      (s) =>
        `${s.id} | ${new Date(s.startedAt).toISOString()} | ${
          s.endedAt ? 'Ended' : 'Active'
        }`,
    );

    lines.forEach((line) => console.log(`[${SCOPE}] ${line}`));
  } catch (error) {
    console.error(`[${SCOPE}] Failed to list sessions`, error);
    void vscode.window.showErrorMessage('Failed to list sessions');
  }
}

async function exportSession() {
  try {
    const baseUrl = await getServerBaseUrl();
    const res = await fetch(`${baseUrl}/api/sessions`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const sessions: any[] = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      void vscode.window.showWarningMessage('No sessions found');
      return;
    }

    const sessionId = await vscode.window.showQuickPick(
      sessions.map((s) => s.id),
      {
        placeHolder: 'Select session to export',
      },
    );
    if (!sessionId) return;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`session-${sessionId}.json`),
      filters: { JSON: ['json'] },
    });
    if (!uri) return;

    const exportRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputPath: uri.fsPath }),
    });

    if (!exportRes.ok) {
      throw new Error(`Export failed with HTTP ${exportRes.status}`);
    }

    console.log(`[${SCOPE}] Session exported`, { sessionId, outputPath: uri.fsPath });
    void vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
  } catch (error) {
    console.error(`[${SCOPE}] Export failed`, error);
    void vscode.window.showErrorMessage('Export failed');
  }
}

async function deleteSession() {
  try {
    const baseUrl = await getServerBaseUrl();
    const res = await fetch(`${baseUrl}/api/sessions`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const sessions: any[] = await res.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      void vscode.window.showInformationMessage('AIR: No sessions to delete');
      return;
    }

    const sessionId = await vscode.window.showQuickPick(
      sessions.map((s) => s.id),
      { placeHolder: 'Delete session' },
    );
    if (!sessionId) return;

    const confirm = await vscode.window.showWarningMessage(
      `Delete ${sessionId}?`,
      { modal: true },
      'Delete',
    );
    if (confirm !== 'Delete') return;

    const delRes = await fetch(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });

    if (!delRes.ok) {
      throw new Error(`Delete failed with HTTP ${delRes.status}`);
    }

    void vscode.window.showInformationMessage('Deleted.');
  } catch (error) {
    console.error(`[${SCOPE}] Delete failed`, error);
    void vscode.window.showErrorMessage('Delete failed');
  }
}

async function debugEvents() {
  try {
    const baseUrl = await getServerBaseUrl();
    const res = await fetch(`${baseUrl}/api/debug/events`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    console.log(`[${SCOPE}] Recent Events`, data);
  } catch (error) {
    console.error(`[${SCOPE}] Debug events failed`, error);
    void vscode.window.showErrorMessage('Failed to load debug events');
  }
}

export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  const dbPath = path.join(context.globalStorageUri.fsPath, 'air-data.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  console.log(`[${SCOPE}] Extension activated`, { dbPath });

  try {
    await startBackgroundServer(context, dbPath);
  } catch (error) {
    console.error(`[${SCOPE}] Failed to start background server`, error);
    void vscode.window.showErrorMessage('AIR: Failed to start local event server');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('air.startRecording', startRecording),
    vscode.commands.registerCommand('air.stopRecording', stopRecording),
    vscode.commands.registerCommand('air.exportSession', exportSession),
    vscode.commands.registerCommand('air.listSessions', listSessions),
    vscode.commands.registerCommand('air.deleteSession', deleteSession),
    vscode.commands.registerCommand('air.debugEvents', debugEvents),
    vscode.commands.registerCommand('air.showLogs', () => {
        // Since airLogger is gone, this could open the debug console or do nothing.
        vscode.commands.executeCommand('workbench.action.debug.showConsole');
    }),
  );
}

export async function deactivate() {
  try {
    isStoppingRecording = true;

    if (activeBrowser) {
      await flushAndCloseBrowser().catch((error) => {
        console.warn(`[${SCOPE}] Browser flush/close during deactivate failed`, {
          error: String(error),
        });
      });
    }

    if (serverProcess) {
      try {
        serverProcess.kill();
      } catch (error) {
        console.warn(`[${SCOPE}] Failed to kill server process during deactivate`, {
          error: String(error),
        });
      }
      serverProcess = null;
    }

    if (activeBrowser) {
      await activeBrowser.close().catch(() => {});
      activeBrowser = null;
    }

    if (serverPort) {
      serverPort = null;
    }

    console.log(`[${SCOPE}] Extension deactivated`);
  } catch (error) {
    console.error(`[${SCOPE}] Failed during extension deactivation`, error);
  } finally {
    activeBrowser = null;
    activeContext = null;
    currentSessionId = null;
    isStoppingRecording = false;
  }
}