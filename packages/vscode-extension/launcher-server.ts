/**
 * Launcher for the AIR Background Server.
 * Bridges VS Code extension process management with the AIR Platform core.
 */

import { PlatformServer } from '../../core/platform-server';

const dbPath = process.env.AIR_DB_PATH;
if (!dbPath) {
  console.error('[AIR-Server] FATAL: AIR_DB_PATH environment variable is missing.');
  process.exit(1);
}

const server = new PlatformServer();

process.on('uncaughtException', (error) => {
  console.error('[AIR-Server] Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[AIR-Server] Unhandled rejection', reason);
});

process.on('message', (msg: any) => {
  if (msg?.type === 'SET_SESSION') {
    if (typeof msg.sessionId === 'string' || msg.sessionId === null) {
      server.setActiveSessionId(msg.sessionId);
    } else {
      console.warn('[AIR-Server] Invalid SET_SESSION payload received.');
    }
  }
});

let shutdownTriggered = false;
async function shutdown(signal: string) {
  if (shutdownTriggered) return;
  shutdownTriggered = true;
  console.log(`[AIR-Server] Received signal: ${signal}`);
  try {
    await server.stop();
    process.exit(0);
  } catch (err) {
    console.error('[AIR-Server] Shutdown failed', err);
    process.exit(1);
  }
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('disconnect', () => { void shutdown('disconnect'); });

// Start the server
server.start(dbPath).catch((err) => {
  console.error('[AIR-Server] Fatal error during startup', err);
  process.exit(1);
});
