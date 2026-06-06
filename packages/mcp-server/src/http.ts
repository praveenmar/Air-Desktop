import { randomUUID } from 'node:crypto';
import type {
  IncomingHttpHeaders,
  IncomingMessage,
  Server as HttpServer,
  ServerResponse,
} from 'node:http';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { formatHelp, parseArgs, resolveHttpPort, shouldShowHelp } from './config';
import { createContext } from './context';
import { createMcpServer } from './server';

const HTTP_BIND_HOST = '127.0.0.1';
const MAX_HTTP_SESSIONS = 10;
const HTTP_SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const HTTP_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;

type HttpConfig = {
  dbPath: string;
  port: number;
};

type HttpMcpSession = {
  id: string;
  server: ReturnType<typeof createMcpServer>;
  transport: StreamableHTTPServerTransport;
  createdAt: number;
  lastSeenAt: number;
};

type HttpRequestLike = IncomingMessage & {
  headers: IncomingHttpHeaders;
  body?: unknown;
};

type HttpResponseLike = ServerResponse<IncomingMessage> & {
  json: (body: unknown) => void;
  send: (body: string) => void;
  status: (code: number) => HttpResponseLike;
};

function parseHttpArgs(args: string[]): HttpConfig {
  const base = parseArgs(args);

  return {
    dbPath: base.dbPath,
    port: resolveHttpPort(args),
  };
}

async function main() {
  if (shouldShowHelp(process.argv.slice(2))) {
    console.error(formatHelp('http'));
    process.exit(0);
  }

  const config = parseHttpArgs(process.argv.slice(2));
  const context = createContext({ dbPath: config.dbPath });
  const app = createMcpExpressApp();
  const sessions = new Map<string, HttpMcpSession>();

  function getSessionId(req: HttpRequestLike): string | undefined {
    const headerValue = req.headers['mcp-session-id'];
    return typeof headerValue === 'string' ? headerValue : undefined;
  }

  function sendJsonRpcError(res: HttpResponseLike, statusCode: number, message: string): void {
    res.status(statusCode).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message,
      },
      id: null,
    });
  }

  function sendInternalServerError(res: HttpResponseLike): void {
    res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error',
      },
      id: null,
    });
  }

  async function cleanupSession(sessionId: string, reason: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    sessions.delete(sessionId);

    try {
      await session.transport.close?.();
    } catch (error) {
      console.error('[AIR MCP] Failed to close HTTP transport:', error);
    }

    try {
      await session.server.close?.();
    } catch (error) {
      console.error('[AIR MCP] Failed to close MCP server:', error);
    }

    console.error(`[AIR MCP] HTTP session cleaned up: ${sessionId} (${reason})`);
  }

  async function handleExistingSessionRequest(req: HttpRequestLike, res: HttpResponseLike): Promise<void> {
    try {
      const sessionId = getSessionId(req);
      const session = sessionId ? sessions.get(sessionId) : undefined;

      if (!session) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      session.lastSeenAt = Date.now();
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[AIR MCP] HTTP existing-session error:', error);

      if (!res.headersSent) {
        sendInternalServerError(res);
      }
    }
  }

  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastSeenAt > HTTP_SESSION_IDLE_TTL_MS) {
        void cleanupSession(sessionId, 'idle-timeout');
      }
    }
  }, HTTP_SESSION_CLEANUP_INTERVAL_MS);

  cleanupTimer.unref?.();

  app.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({
      ok: true,
      server: 'air-mcp-server',
      transport: 'streamable-http',
    });
  });

  const handleMcpRequest = async (req: HttpRequestLike, res: HttpResponseLike) => {
    const sessionId = getSessionId(req);

    try {
      const existingSession = sessionId ? sessions.get(sessionId) : undefined;

      if (existingSession) {
        existingSession.lastSeenAt = Date.now();
        await existingSession.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!existingSession) {
        if (sessionId || !isInitializeRequest(req.body)) {
          sendJsonRpcError(res, 400, 'Bad Request: No valid session ID provided');
          return;
        }

        if (sessions.size >= MAX_HTTP_SESSIONS) {
          sendJsonRpcError(res, 429, 'Too many active MCP HTTP sessions');
          return;
        }

        const server = createMcpServer(context);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            const now = Date.now();
            sessions.set(newSessionId, {
              id: newSessionId,
              server,
              transport,
              createdAt: now,
              lastSeenAt: now,
            });
          },
        });

        transport.onclose = () => {
          const activeSessionId = transport.sessionId;
          if (activeSessionId) {
            void cleanupSession(activeSessionId, 'transport-close');
          }
        };

        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }
    } catch (error) {
      console.error('[AIR MCP] HTTP transport error:', error);

      if (!res.headersSent) {
        sendInternalServerError(res);
      }
    }
  };

  app.post('/mcp', handleMcpRequest);

  app.get('/mcp', handleExistingSessionRequest);
  app.delete('/mcp', handleExistingSessionRequest);

  const httpServer: HttpServer = app.listen(config.port, HTTP_BIND_HOST, (error?: Error) => {
    if (error) {
      console.error('[AIR MCP] Failed to start HTTP server:', error);
      process.exit(1);
    }

    console.error(`[AIR MCP] Streamable HTTP server listening on http://${HTTP_BIND_HOST}:${config.port}/mcp`);
    console.error(`[AIR MCP] Database path: ${config.dbPath}`);
  });

  async function shutdown(reason: string): Promise<void> {
    clearInterval(cleanupTimer);

    const activeSessionIds = [...sessions.keys()];
    for (const sessionId of activeSessionIds) {
      await cleanupSession(sessionId, reason);
    }

    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }

  process.on('SIGINT', () => {
    void shutdown('sigint').finally(() => process.exit(0));
  });

  process.on('SIGTERM', () => {
    void shutdown('sigterm').finally(() => process.exit(0));
  });
}

main().catch((error) => {
  console.error('[AIR MCP] Fatal HTTP initialization error:', error);
  process.exit(1);
});
