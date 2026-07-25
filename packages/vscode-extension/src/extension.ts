import * as vscode from 'vscode';
import { chromium, Browser, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { resolveInterceptorAssetPaths } from './utils/interceptor-loader';
import { ensureAirHome, getDatabasePath } from '../../../core/utils/air-home';
import { SessionManagerPanel } from './webview/session-manager-panel';
import { DevConsolePanel, LogEntry, McpConfigVariant } from './webview/dev-console-panel';

let activeBrowser: Browser | null = null;
let activeContext: BrowserContext | null = null;
let currentSessionId: string | null = null;
let extensionContext: vscode.ExtensionContext | null = null;
let outputChannel: vscode.OutputChannel | null = null;
let startRecordingStatusBarItem: vscode.StatusBarItem | null = null;
let stopRecordingStatusBarItem: vscode.StatusBarItem | null = null;
let historyStatusBarItem: vscode.StatusBarItem | null = null;
let sessionManagerPanel: SessionManagerPanel | null = null;
let devConsolePanel: DevConsolePanel | null = null;

const MAX_EXTENSION_LOG_ENTRIES = 500;
let extensionLogBuffer: LogEntry[] = [];

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

interface BackgroundServerRuntime {
  executable: string;
  nodePath?: string;
  requiresElectronNodeMode: boolean;
}

type ChromiumLaunchOptions = NonNullable<Parameters<typeof chromium.launch>[0]>;

async function launchRecordingBrowser(): Promise<Browser> {
  const launchCandidates: Array<{
    label: string;
    options: ChromiumLaunchOptions;
  }> = [
    {
      label: 'Google Chrome',
      options: { headless: false, channel: 'chrome', args: ['--start-maximized'] },
    },
    {
      label: 'Microsoft Edge',
      options: { headless: false, channel: 'msedge', args: ['--start-maximized'] },
    },
    {
      label: 'Playwright Chromium',
      options: { headless: false, args: ['--start-maximized'] },
    },
  ];

  const errors: string[] = [];

  for (const candidate of launchCandidates) {
    try {
      logToOutput(`[${SCOPE}] Launching browser`, { browser: candidate.label });
      return await chromium.launch(candidate.options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate.label}: ${message}`);
      logToOutput(`[${SCOPE}] Browser launch candidate failed`, {
        browser: candidate.label,
        error: message,
      });
    }
  }

  throw new Error(
    [
      'Unable to launch a browser. Install Microsoft Edge or Google Chrome, or run "npx playwright install chromium".',
      ...errors,
    ].join('\n'),
  );
}

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
  const timestamp = Date.now();
  extensionLogBuffer.push({ timestamp, source: 'extension', message, data });
  if (extensionLogBuffer.length > MAX_EXTENSION_LOG_ENTRIES) {
    extensionLogBuffer = extensionLogBuffer.slice(extensionLogBuffer.length - MAX_EXTENSION_LOG_ENTRIES);
  }

  if (!outputChannel) {
    return;
  }

  const suffix = data === undefined ? '' : ` ${toLogString(data)}`;
  outputChannel.appendLine(`[${new Date(timestamp).toISOString()}] ${message}${suffix}`);
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

function createStatusBarItems(context: vscode.ExtensionContext): void {
  startRecordingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  startRecordingStatusBarItem.command = 'air.startRecording';
  startRecordingStatusBarItem.text = '$(record) AIR Start';
  startRecordingStatusBarItem.tooltip = 'Start AIR recording';
  startRecordingStatusBarItem.show();
  context.subscriptions.push(startRecordingStatusBarItem);

  stopRecordingStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  stopRecordingStatusBarItem.command = 'air.stopRecording';
  stopRecordingStatusBarItem.text = '$(debug-stop) AIR Stop';
  stopRecordingStatusBarItem.tooltip = 'Stop AIR recording';
  stopRecordingStatusBarItem.hide();
  context.subscriptions.push(stopRecordingStatusBarItem);

  historyStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  historyStatusBarItem.command = 'air.showSessionHistory';
  historyStatusBarItem.text = '$(history) AIR History';
  historyStatusBarItem.tooltip = 'View all AIR session IDs';
  historyStatusBarItem.show();
  context.subscriptions.push(historyStatusBarItem);
}

function updateStatusBarItems(): void {
  if (!startRecordingStatusBarItem || !stopRecordingStatusBarItem) {
    return;
  }

  const isRecording = Boolean(activeBrowser);
  if (isRecording) {
    startRecordingStatusBarItem.hide();
    stopRecordingStatusBarItem.show();
  } else {
    stopRecordingStatusBarItem.hide();
    startRecordingStatusBarItem.show();
  }
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

function resolveBackgroundServerRuntime(context: vscode.ExtensionContext): BackgroundServerRuntime {
  const explicitRuntime = process.env.AIR_SERVER_NODE_EXECUTABLE?.trim();
  if (explicitRuntime) {
    return {
      executable: explicitRuntime,
      nodePath: fs.existsSync(path.join(context.extensionPath, '..', '..', 'node_modules'))
        ? path.join(context.extensionPath, '..', '..', 'node_modules')
        : undefined,
      requiresElectronNodeMode: false,
    };
  }

  const execBaseName = path.basename(process.execPath).toLowerCase();
  const workspaceNodeModules = path.join(context.extensionPath, '..', '..', 'node_modules');
  const extensionNodeModules = path.join(context.extensionPath, 'node_modules');
  const nodePath = fs.existsSync(workspaceNodeModules)
    ? workspaceNodeModules
    : (fs.existsSync(extensionNodeModules) ? extensionNodeModules : undefined);

  if (execBaseName === 'node' || execBaseName === 'node.exe') {
    return {
      executable: process.execPath,
      nodePath,
      requiresElectronNodeMode: false,
    };
  }

  return {
    executable: 'node',
    nodePath,
    requiresElectronNodeMode: false,
  };
}

async function startBackgroundServer(context: vscode.ExtensionContext, dbPath: string): Promise<void> {

  if (serverProcess) return;

  createServerReadyPromise();

  const serverModule = context.asAbsolutePath(path.join('dist', 'server', 'index.js'));

  if (!fs.existsSync(serverModule)) {
    throw new Error(`Server module not found: ${serverModule}`);
  }

  const runtime = resolveBackgroundServerRuntime(context);
  const serverEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AIR_DB_PATH: dbPath,
  };

  if (runtime.requiresElectronNodeMode) {
    serverEnv.ELECTRON_RUN_AS_NODE = '1';
  } else {
    delete serverEnv.ELECTRON_RUN_AS_NODE;
  }

  if (runtime.nodePath) {
    serverEnv.NODE_PATH = runtime.nodePath;
  } else {
    delete serverEnv.NODE_PATH;
  }

  serverProcess = spawn(runtime.executable, [serverModule], {
    env: serverEnv,
    stdio: ['ipc', 'pipe', 'pipe'],
    windowsHide: true,
  });

  console.log(`[${SCOPE}] Background server spawned`, runtime);
  logToOutput(`[${SCOPE}] Background server spawned`, {
    runtime: runtime.executable,
    nodePath: runtime.nodePath ?? null,
    requiresElectronNodeMode: runtime.requiresElectronNodeMode,
    dbPath,
  });

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
  const interceptorDiagnosticsEndpoint = `${serverUrl}/api/debug/logs/interceptor`;
  const enableModularDirectCandidateParity =
    process.env.AIR_ENABLE_MODULAR_DIRECT_CANDIDATE_PARITY === '1';
  const enableModularStructuralParity =
    process.env.AIR_ENABLE_MODULAR_STRUCTURAL_PARITY === '1';
  const enableModularDirectCandidateReplacement =
    process.env.AIR_ENABLE_MODULAR_DIRECT_CANDIDATE_REPLACEMENT === '1';
  return `
    window.__AIR_CONFIG__ = {
      sessionId: ${JSON.stringify(sessionId)},
      serverUrl: ${JSON.stringify(serverUrl)},
      version: ${Date.now()},
      selectorEngineShadowMode: true,
      selectorEngineShadowLogDiffs: true,
      selectorEngineShadowMaxCandidates: 12,
      enableModularStructuralParity: ${enableModularStructuralParity ? 'true' : 'false'},
      enableModularDirectCandidateParity: ${enableModularDirectCandidateParity ? 'true' : 'false'},
      enableModularDirectCandidateReplacement: ${enableModularDirectCandidateReplacement ? 'true' : 'false'},
      persistInterceptorDiagnostics: true,
      interceptorDiagnosticsEndpoint: ${JSON.stringify(interceptorDiagnosticsEndpoint)}
    };
    window.__air_gmSend = async (url, payload) => {
      const targetUrl = typeof url === 'string' ? url : ${JSON.stringify(eventEndpoint)};
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
      // Node bridge is always primary - bypasses browser CORS and PNA entirely.
      // The call executes in Node.js (driver side), so no browser origin exists.
      if (typeof window.__air_nodeSend === 'function') {
        return window.__air_nodeSend(targetUrl, body);
      }
      // Fallback: browser fetch - works only on HTTP origins (no HTTPS->localhost PNA issue).
      return fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        mode: 'cors',
        keepalive: true
      });
    };
    window.__air_gmBeacon = (url, payload) => {
      const targetUrl = typeof url === 'string' ? url : ${JSON.stringify(eventEndpoint)};
      const body = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
      // Node bridge first - bypasses CORS/PNA on all origins.
      try {
        if (typeof window.__air_nodeSend === 'function') {
          window.__air_nodeSend(targetUrl, body).catch(() => {});
          return true;
        }
      } catch (_) {}
      // Fallback: sendBeacon - works only on HTTP origins.
      try {
        const blob = new Blob([body], { type: 'application/json' });
        const sent = navigator.sendBeacon(targetUrl, blob);
        if (sent) return true;
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

  let tempBrowser: Browser;
  try {
    tempBrowser = await launchRecordingBrowser();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`AIR: ${msg}`);
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

  if (!url) {
    await tempBrowser.close();
    return;
  }

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

    activeBrowser = tempBrowser;
    updateStatusBarItems();
    activeContext = await activeBrowser.newContext({
      bypassCSP: true,
      viewport: null,
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

    void vscode.window
      .showInformationMessage(`AIR: Recording started (${currentSessionId})`, 'View History')
      .then((choice) => {
        if (choice === 'View History') {
          void showSessionManager();
        }
      });
    void getSessionManagerPanel().refreshIfOpen();
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
    void getSessionManagerPanel().refreshIfOpen();
  } catch (error) {
    console.error(`[${SCOPE}] Error during stop`, error);
  } finally {
    activeBrowser = null;
    activeContext = null;
    currentSessionId = null;
    isStoppingRecording = false;
    updateStatusBarItems();
  }
}

function getSessionManagerPanel(): SessionManagerPanel {
  if (!sessionManagerPanel) {
    sessionManagerPanel = SessionManagerPanel.getInstance({
      getBaseUrl: getServerBaseUrl,
      onLog: (message, data) => logToOutput(message, data),
      onError: (message, error) => {
        console.error(`[${SCOPE}] ${message}`, error);
        logToOutput(`[${SCOPE}] ${message}`, { error: String(error) });
      },
    });
  }
  return sessionManagerPanel;
}

async function showSessionManager() {
  try {
    await getSessionManagerPanel().show();
  } catch (error) {
    console.error(`[${SCOPE}] Failed to load session manager`, error);
    void vscode.window.showErrorMessage('AIR: Failed to load session manager');
  }
}

async function showSessionHistory() {
  await showSessionManager();
}

async function listSessions() {
  await showSessionManager();
}

async function exportSession() {
  await showSessionManager();
}

async function deleteSession() {
  await showSessionManager();
}

function buildProductionMcpConfig(): McpConfigVariant {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = ['-y', 'air-mcp-server@latest'];
  return { label: 'Production (NPX)', command, args, available: true };
}

function buildDevelopmentMcpConfig(): McpConfigVariant {
  const isDev = extensionContext?.extensionMode === vscode.ExtensionMode.Development;
  if (!isDev || !extensionContext) {
    return {
      label: 'Local Development',
      command: '',
      args: [],
      available: false,
      unavailableReason: 'Only available when the extension is running in development mode.',
    };
  }

  const mcpPath = vscode.Uri.joinPath(
    extensionContext.extensionUri,
    '..',
    'mcp-server',
    'bin',
    'air-mcp.js',
  ).fsPath;

  return {
    label: 'Local Development',
    command: 'node',
    args: [mcpPath],
    available: true,
  };
}

function getDevConsolePanel(): DevConsolePanel {
  if (!devConsolePanel) {
    devConsolePanel = DevConsolePanel.getInstance({
      getBaseUrl: getServerBaseUrl,
      onLog: (message, data) => logToOutput(message, data),
      onError: (message, error) => {
        console.error(`[${SCOPE}] ${message}`, error);
        logToOutput(`[${SCOPE}] ${message}`, { error: String(error) });
      },
      getExtensionLogs: () => extensionLogBuffer.slice(),
      clearExtensionLogs: () => {
        extensionLogBuffer = [];
      },
      getProductionMcpConfig: buildProductionMcpConfig,
      getDevelopmentMcpConfig: buildDevelopmentMcpConfig,
    });
  }
  return devConsolePanel;
}

async function showDevConsole(tab: 'inspector' | 'events' | 'logs' | 'mcp') {
  try {
    await getDevConsolePanel().show(tab);
  } catch (error) {
    console.error(`[${SCOPE}] Failed to open developer console`, error);
    void vscode.window.showErrorMessage('AIR: Failed to open developer console');
  }
}

async function debugEvents() {
  await showDevConsole('events');
}

async function inspectSession() {
  await showDevConsole('inspector');
}

async function showLogsCommand() {
  await showDevConsole('logs');
}

async function copyMcpConfig() {
  await showDevConsole('mcp');
}


export async function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('AIR');
  context.subscriptions.push(outputChannel);

  console.log(`[${SCOPE}] Extension activation started`);
  logToOutput(`[${SCOPE}] Extension activation started`);

  // Register commands FIRST, before any async/heavy operations
  context.subscriptions.push(
    vscode.commands.registerCommand('air.startRecording', startRecording),
    vscode.commands.registerCommand('air.stopRecording', stopRecording),
    vscode.commands.registerCommand('air.exportSession', exportSession),
    vscode.commands.registerCommand('air.listSessions', listSessions),
    vscode.commands.registerCommand('air.deleteSession', deleteSession),
    vscode.commands.registerCommand('air.debugEvents', debugEvents),
    vscode.commands.registerCommand('air.inspectSession', inspectSession),
    vscode.commands.registerCommand('air.showSessionHistory', showSessionHistory),
    vscode.commands.registerCommand('air.showLogs', showLogsCommand),
    vscode.commands.registerCommand('air.copyMcpConfig', copyMcpConfig),
  );

  console.log(`[${SCOPE}] Commands registered`);
  logToOutput(`[${SCOPE}] Commands registered`);

  createStatusBarItems(context);
  updateStatusBarItems();

  // Initialize server in background (non-blocking)
  try {
    const legacyDbPath = path.join(context.globalStorageUri.fsPath, 'air-data.db');
    const universalDbPath = getDatabasePath();

    if (fs.existsSync(legacyDbPath) && !fs.existsSync(universalDbPath)) {
      ensureAirHome();
      try {
        fs.copyFileSync(legacyDbPath, universalDbPath);
        console.log(`[${SCOPE}] Migrated legacy database to unified home: ${universalDbPath}`);
        logToOutput(`[${SCOPE}] Migrated legacy database to unified home: ${universalDbPath}`);
      } catch (err) {
        console.error(`[${SCOPE}] Failed to migrate database`, err);
        logToOutput(`[${SCOPE}] Failed to migrate database`, { error: String(err) });
      }
    }

    let dbPath = universalDbPath;
    let dbPathSource = process.env.AIR_DB_PATH?.trim() ? 'AIR_DB_PATH' : 'universalHome';

    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    } catch (err) {
      console.warn(`[${SCOPE}] Failed to create database directory at ${dbPath}, falling back to temp`, { error: String(err) });
      logToOutput(`[${SCOPE}] Failed to create database directory, using temp folder`);
      dbPath = path.join(require('os').tmpdir(), 'air-desktop', 'air-data.db');
      dbPathSource = 'tempFallback';
      try {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      } catch (fallbackErr) {
        console.error(`[${SCOPE}] Failed to create fallback temp directory`, fallbackErr);
        logToOutput(`[${SCOPE}] Failed to create database directory`, { error: String(fallbackErr) });
      }
    }

    console.log(`[${SCOPE}] Extension activated`, { dbPath, dbPathSource });
    logToOutput(`[${SCOPE}] Extension activated`, { dbPath, dbPathSource });

    await startBackgroundServer(context, dbPath);
  } catch (error) {
    console.error(`[${SCOPE}] Failed during initialization`, error);
    logToOutput(`[${SCOPE}] Failed during initialization`, { error: String(error) });
  }
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
    sessionManagerPanel?.dispose();
    sessionManagerPanel = null;
    devConsolePanel?.dispose();
    devConsolePanel = null;
  }
}