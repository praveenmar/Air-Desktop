import * as path from 'path';
import { DatabaseService } from '../../../../core/db/database';
import { GraphBuilder } from '../../../../core/graph/graph-builder';
import { EventServer } from '../../../../electron/main/event-server';

async function bootstrap() {
  console.log('[AIR-Server] Starting background process...');

  // Fix 7: Strict DB Path enforcement
  const dbPath = process.env.AIR_DB_PATH;
  if (!dbPath) {
    console.error('[AIR-Server] FATAL: AIR_DB_PATH environment variable is missing.');
    process.exit(1);
  }

  try {
    console.log(`[AIR-Server] Initializing SQLite at: ${dbPath}`);
    const dbService = new DatabaseService(dbPath);
    const graphBuilder = new GraphBuilder(dbService);

    let currentSessionId: string | null = null;

    // Fix 6: Secure IPC Validation
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

    const server = new EventServer(graphBuilder, () => currentSessionId);
    
    // EventServer uses listen(0) to find a random free port 
    const port = await server.start();
    
    // Fix 4/5: Handshake Protocol - Print the port clearly for the host to parse
    console.log(`AIR_SERVER_PORT:${port}`);
    console.log('[AIR-Server] Startup sequence complete.');
  } catch (err) {
    console.error('[AIR-Server] Critical failure during bootstrap:', err);
    process.exit(1);
  }
}

bootstrap();