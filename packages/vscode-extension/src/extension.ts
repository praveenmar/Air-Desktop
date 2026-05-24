import * as vscode from 'vscode';
import { chromium, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { resolveInterceptorAssetPaths } from './utils/interceptor-loader';

let activeBrowser: Browser | null = null;
let activeContext: BrowserContext | null = null;
let currentSessionId: string | null = null;
let extensionContext: vscode.ExtensionContext | null = null;
let outputChannel: vscode.OutputChannel | null = null;

let serverProcess: ChildProcess | null = null;
let serverPort: number | null = null;
let stdoutBuffer = '';
let stdoutLineBuffer = '';
let stderrLineBuffer = '';

let serverReadyResolve: ((port: number) => void) | null = null;
let serverReadyReject: ((error: Error) => void) | null = null;
let serverReadyPromise: Promise<number> | null = null;

let isStoppingRecording = false;

const SCOPE = 'Extension';

function toLogString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function logToOutput(message: string, data?: unknown): void {
  if (!outputChannel) {
    return;
  }

  const timestamp = new Date().toISOString();
  const suffix = data === undefined ? '' : ` ${toLogString(data)}`;
  outputChannel.appendLine(`[${timestamp}] ${message}${suffix}`);
}

function flushServerChunk(stream: 'stdout' | 'stderr', chunk: string): void {
  const normalized = chunk.replace(/\r\n/g, '\n');
  const buffer = stream === 'stdout' ? stdoutLineBuffer : stderrLineBuffer;
  const combined = `${buffer}${normalized}`;
  const lines = combined.split('\n');
  const remainder = lines.pop() ?? '';

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    logToOutput(`[Server ${stream}] ${line}`);
  }

  if (stream === 'stdout') {
    stdoutLineBuffer = remainder;
  } else {
    stderrLineBuffer = remainder;
  }
}

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

  // Define the environment for the background process
 serverProcess = spawn(process.execPath, [serverModule], {
  env: {
    ...process.env,
    AIR_DB_PATH: dbPath,
    ELECTRON_RUN_AS_NODE: '1',
    //NODE_PATH: path.join(context.extensionPath, '..', '..', 'node_modules')
    NODE_PATH: path.join(context.extensionPath, 'node_modules')
  },
  stdio: ['ipc', 'pipe', 'pipe'],
  windowsHide: true,
});

  console.log(`[${SCOPE}] Background server spawned using VS Code's Node 22 runtime`);
  logToOutput(`[${SCOPE}] Background server spawned`, { runtime: process.execPath, dbPath });

  serverProcess.stdout?.on('data', (data) => {
    const out = data.toString();
    stdoutBuffer += out;
    flushServerChunk('stdout', out);

    const match = stdoutBuffer.match(/AIR_SERVER_PORT:(\d+)/);
    if (match && !serverPort) {
      serverPort = parseInt(match[1], 10);
      console.log(`[${SCOPE}] Server started`, { port: serverPort });
      logToOutput(`[${SCOPE}] Server started`, { port: serverPort });
      serverReadyResolve?.(serverPort);
      serverReadyResolve = null;
      serverReadyReject = null;
    }
  });

  serverProcess.stderr?.on('data', (data) => {
    const err = data.toString();
    flushServerChunk('stderr', err);
    console.error(`[${SCOPE}] Server stderr: ${err}`);
  });

  serverProcess.on('error', (error) => {
    console.error(`[${SCOPE}] Server spawn failed`, error);
    logToOutput(`[${SCOPE}] Server spawn failed`, { error: String(error) });
    serverPort = null;
    serverProcess = null;
    serverReadyReject?.(error instanceof Error ? error : new Error(String(error)));
    serverReadyResolve = null;
    serverReadyReject = null;
  });

  serverProcess.on('exit', (code, signal) => {
    console.warn(`[${SCOPE}] Server exited`, { code, signal });
    logToOutput(`[${SCOPE}] Server exited`, { code, signal });
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
  const serverUrl = `http://127.0.0.1:${port}`;
  const eventEndpoint = `${serverUrl}/api/events`;
  return `
    window.__AIR_CONFIG__ = {
      sessionId: ${JSON.stringify(sessionId)},
      serverUrl: ${JSON.stringify(serverUrl)},
      version: ${Date.now()},
      selectorEngineShadowMode: true,
      selectorEngineShadowLogDiffs: true,
      selectorEngineShadowMaxCandidates: 12
    };
    window.__air_gmSend = async (url, payload) => {
      const targetUrl = typeof url === 'string' ? url : ${JSON.stringify(eventEndpoint)};
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});

      try {
        // Browser fetch path keeps /api/events visible in DevTools Network.
        return await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          mode: 'cors',
          keepalive: true
        });
      } catch (_) {
        // Fall through to node bridge fallback.
      }

      if (typeof window.__air_nodeSend !== 'function') {
        return { ok: false, status: 0, statusText: 'Transport unavailable' };
      }

      return window.__air_nodeSend(targetUrl, body);
    };
    window.__air_gmBeacon = (url, payload) => {
      const targetUrl = typeof url === 'string' ? url : ${JSON.stringify(eventEndpoint)};
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});

      try {
        const blob = new Blob([body], { type: 'application/json' });
        const sent = navigator.sendBeacon(targetUrl, blob);
        if (sent) {
          return true;
        }
      } catch (_) {}

      try {
        if (typeof window.__air_nodeSend === 'function') {
          window.__air_nodeSend(targetUrl, body).catch(() => {});
          return true;
        }
      } catch (_) {}

      return false;
    };
  `;
}

async function loadInterceptorAssets(context: vscode.ExtensionContext): Promise<{
  shellPath: string;
  selectorEnginePath: string | null;
}> {
  const assets = resolveInterceptorAssetPaths(context.extensionPath);

  if (!fs.existsSync(assets.shellPath)) {
    console.error(`[${SCOPE}] Interceptor shell not found`, { shellPath: assets.shellPath });
    throw new Error(`Interceptor shell missing at: ${assets.shellPath}`);
  }

  console.log(`[${SCOPE}] Loaded interceptor assets`, assets);
  return assets;
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

    currentSessionId = `session-${randomUUID()}`;

    const configScript = buildConfigScript(
      currentSessionId,
      Number(baseUrl.split(':').pop()),
    );

    const interceptorAssets = await loadInterceptorAssets(extensionContext);

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
    logToOutput(`[${SCOPE}] Starting recording`, {
      sessionId: currentSessionId,
      url,
      serverUrl: baseUrl,
    });

    activeBrowser = await chromium.launch({ headless: false });
    activeContext = await activeBrowser.newContext({
    bypassCSP: true
    });

    const eventEndpoint = `http://127.0.0.1:${Number(baseUrl.split(':').pop())}/api/events`;
    await activeContext.exposeBinding(
      '__air_nodeSend',
      async (_source, targetUrl: unknown, payload: unknown) => {
        if (targetUrl !== eventEndpoint) {
          return { ok: false, status: 400, statusText: 'Blocked URL' };
        }
        if (typeof payload !== 'string') {
          return { ok: false, status: 400, statusText: 'Invalid payload' };
        }

        try {
          const response = await fetch(eventEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });

          let body: unknown = null;
          try {
            body = await response.json();
          } catch {
            // Non-JSON response is allowed for the bridge contract.
          }

          return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            body,
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            statusText: (error as Error).message || 'Network error',
          };
        }
      },
    );

    await activeContext.addInitScript({ content: configScript });
    if (interceptorAssets.selectorEnginePath) {
      await activeContext.addInitScript({ path: interceptorAssets.selectorEnginePath });
    }
    await activeContext.addInitScript({ path: interceptorAssets.shellPath });

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
    logToOutput(`[${SCOPE}] Recording started`, {
      sessionId: currentSessionId,
      url,
      serverUrl: baseUrl,
    });

    void vscode.window.showInformationMessage(`AIR Recording: ${currentSessionId}`);
  } catch (error) {
    console.error(`[${SCOPE}] Failed to start recording`, error);
    logToOutput(`[${SCOPE}] Failed to start recording`, { error: String(error) });

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
    logToOutput(`[${SCOPE}] Recording stopped`, { sessionId: currentSessionId });
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

async function inspectSession() {
  try {
    const baseUrl = await getServerBaseUrl();
    const listRes = await fetch(`${baseUrl}/api/sessions`);
    if (!listRes.ok) {
      throw new Error(`HTTP ${listRes.status}`);
    }

    const sessions: Array<{ id: string }> = await listRes.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      void vscode.window.showInformationMessage('AIR: No sessions found');
      return;
    }

    const sessionId = await vscode.window.showQuickPick(
      sessions.map((s) => s.id),
      { placeHolder: 'Inspect session data' },
    );
    if (!sessionId) return;

    const inspectRes = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/inspect`);
    if (!inspectRes.ok) {
      throw new Error(`Inspect failed with HTTP ${inspectRes.status}`);
    }

    const snapshot = await inspectRes.json();
    const doc = await vscode.workspace.openTextDocument({
      language: 'json',
      content: JSON.stringify(snapshot, null, 2),
    });
    await vscode.window.showTextDocument(doc, { preview: false });
    logToOutput(`[${SCOPE}] Session inspection opened`, { sessionId });
  } catch (error) {
    console.error(`[${SCOPE}] Inspect session failed`, error);
    logToOutput(`[${SCOPE}] Inspect session failed`, { error: String(error) });
    void vscode.window.showErrorMessage('AIR: Failed to inspect session');
  }
}

export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('AIR');
  context.subscriptions.push(outputChannel);

  const envDbPath = process.env.AIR_DB_PATH?.trim();
  const dbPath = envDbPath && envDbPath.length > 0
    ? path.resolve(envDbPath)
    : path.join(context.globalStorageUri.fsPath, 'air-data.db');
  const dbPathSource = envDbPath && envDbPath.length > 0 ? 'AIR_DB_PATH' : 'globalStorage';
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  console.log(`[${SCOPE}] Extension activated`, { dbPath, dbPathSource });
  logToOutput(`[${SCOPE}] Extension activated`, { dbPath, dbPathSource });

  try {
    await startBackgroundServer(context, dbPath);
  } catch (error) {
    console.error(`[${SCOPE}] Failed to start background server`, error);
    logToOutput(`[${SCOPE}] Failed to start background server`, { error: String(error) });
    void vscode.window.showErrorMessage('AIR: Failed to start local event server');
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('air.startRecording', startRecording),
    vscode.commands.registerCommand('air.stopRecording', stopRecording),
    vscode.commands.registerCommand('air.exportSession', exportSession),
    vscode.commands.registerCommand('air.listSessions', listSessions),
    vscode.commands.registerCommand('air.deleteSession', deleteSession),
    vscode.commands.registerCommand('air.debugEvents', debugEvents),
    vscode.commands.registerCommand('air.inspectSession', inspectSession),
    vscode.commands.registerCommand('air.showLogs', () => {
      if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('AIR');
      }
      outputChannel.show(true);
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
    logToOutput(`[${SCOPE}] Extension deactivated`);
  } catch (error) {
    console.error(`[${SCOPE}] Failed during extension deactivation`, error);
    logToOutput(`[${SCOPE}] Failed during extension deactivation`, { error: String(error) });
  } finally {
    activeBrowser = null;
    activeContext = null;
    currentSessionId = null;
    isStoppingRecording = false;
    outputChannel = null;
  }
}
