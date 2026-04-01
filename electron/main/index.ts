// Purpose: Electron Main Process Entry Point.
// Prototype Origin: server.js (Initialization logic)
// Changes: Orchestrates dependencies, starts the EventServer, and loads the Vite renderer.

import { app, BrowserWindow } from 'electron';
import * as path from 'path';

import { DatabaseService } from '../../core/db/database';
import { NodeRepository } from '../../core/db/repositories/node.repository';
import { EdgeRepository } from '../../core/db/repositories/edge.repository';
import { EventRepository } from '../../core/db/repositories/event.repository';
import { SessionRepository } from '../../core/db/repositories/session.repository';
import { OutcomeRepository } from '../../core/db/repositories/outcome.repository';
import { PendingActionRepository } from '../../core/db/repositories/pending-action.repository';
import { DebugLogger } from '../../core/logger/debug-logger';
import { StateEngine } from '../../core/graph/state-engine';
import { GraphBuilder } from '../../core/graph/graph-builder';

import { WindowManager } from './window-manager';
import { CDPBridge } from './cdp-bridge';
import { EventServer } from './event-server';
import { registerIpcHandlers } from './ipc-handlers';

async function bootstrap() {
  await app.whenReady();

  // 1. Initialize SQLite Database inside UserData directory
  const dbPath = path.join(app.getPath('userData'), 'air-data.db');
  const dbService = new DatabaseService(dbPath);
  const db = dbService.getInstance();

  // 2. Instantiate Repositories
  const nodeRepo = new NodeRepository(db);
  const edgeRepo = new EdgeRepository(db);
  const eventRepo = new EventRepository(db);
  const sessionRepo = new SessionRepository(db);
  const outcomeRepo = new OutcomeRepository(db);
  const pendingRepo = new PendingActionRepository(db);
  const logger = new DebugLogger(db);

  // 3. Assemble the Core Graph Builder
  const graphBuilder = new GraphBuilder(
    db,          // Fix (Bug #3): db injected directly to enable db.transaction()
    nodeRepo,
    edgeRepo,
    eventRepo,
    sessionRepo,
    outcomeRepo,
    pendingRepo,
    StateEngine,
    logger
  );

  // Start background tasks
  graphBuilder.startCleanupService();

  app.on('before-quit', () => {
    graphBuilder.close();  // stop the cleanup interval
    dbService.close();     // then close the SQLite connection
  });

  // 4. Start Local Event Server for Interceptor
  let currentSessionId: string | null = null;
  const eventServer = new EventServer(graphBuilder, () => currentSessionId);
  const serverPort = await eventServer.start();

  // 5. Initialize Electron Window & CDP Management
  const windowManager = new WindowManager();
  const cdpBridge = new CDPBridge();

  // 6. Register IPC Channels
  registerIpcHandlers(
    windowManager,
    cdpBridge,
    graphBuilder,
    nodeRepo,
    edgeRepo,
    sessionRepo,
    dbService,
    serverPort,
    {
    getSessionId: () => currentSessionId,
    setSessionId: (id: string | null) => { currentSessionId = id; }
    }
  );

  // 7. Load Renderer UI
  const mainWindow = windowManager.createMainWindow();
  
  // Use Vite Dev Server if in development, otherwise load local compiled HTML
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

// App lifecycle management
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap();
  }
});

bootstrap().catch(console.error);