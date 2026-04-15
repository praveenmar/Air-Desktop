/**
 * Background server entry point for the AIR VS Code Extension.
 * Spawned as a child process by extension.ts.
 * Communicates the chosen port via stdout: AIR_SERVER_PORT:<port>
 */

import { AIRServer } from './src/server/air-server';
import { randomUUID } from 'crypto';

const dbPath = process.env.AIR_DB_PATH;
if (!dbPath) {
  console.error('[AIR-Server] FATAL: AIR_DB_PATH environment variable is missing.');
  process.exit(1);
}

let currentSessionId: string | null = null;

// Receive session updates from the extension host
process.on('message', (msg: any) => {
  if (msg?.type === 'SET_SESSION') {
    if (typeof msg.sessionId === 'string' || msg.sessionId === null) {
      console.log(`[AIR-Server] Session updated to: ${msg.sessionId}`);
      currentSessionId = msg.sessionId;
    } else {
      console.warn('[AIR-Server] Invalid SET_SESSION payload received.');
    }
  }
});

async function bootstrap() {
  console.log('[AIR-Server] Starting background process...');

  // VALIDATION: Immediate check for SQLite binary compatibility
  try {
    require('better-sqlite3');
    console.log('[AIR-Server] SQLite Binary validated: ABI Compatibility OK.');
  } catch (e) {
    console.error('[AIR-Server] FATAL: ABI Mismatch or Binary missing.', e);
    process.exit(1);
  }
  
  console.log(`[AIR-Server] Initializing SQLite at: ${dbPath}`);

  try {
    const server = new AIRServer({
      dbPath: dbPath as string,
      getActiveSessionId: () => currentSessionId,
    });

    const port = await server.start();

    // This line is parsed by extension.ts to discover the port
    console.log(`AIR_SERVER_PORT:${port}`);
    console.log('[AIR-Server] Startup sequence complete.');

    // Keep process alive; extension host kills it on deactivate
    process.on('SIGTERM', async () => {
      await server.stop();
      process.exit(0);
    });
    process.on('SIGINT', async () => {
      await server.stop();
      process.exit(0);
    });
  } catch (err) {
    console.error('[AIR-Server] Critical failure during bootstrap:', err);
    process.exit(1);
  }
}

bootstrap();