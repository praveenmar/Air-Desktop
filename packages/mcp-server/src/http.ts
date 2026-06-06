import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { formatHelp, parseArgs, resolveHttpPort, shouldShowHelp } from './config';
import { createContext } from './context';
import { createMcpServer } from './server';

type HttpConfig = {
  dbPath: string;
  port: number;
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
  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({
      ok: true,
      server: 'air-mcp-server',
      transport: 'streamable-http',
    });
  });

  const handleMcpRequest = async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    try {
      let transport = sessionId ? transports[sessionId] : undefined;

      if (!transport) {
        if (sessionId || !isInitializeRequest(req.body)) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport!;
          },
        });

        transport.onclose = () => {
          const activeSessionId = transport?.sessionId;
          if (activeSessionId) {
            delete transports[activeSessionId];
          }
        };

        const server = createMcpServer(context);
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[AIR MCP] HTTP transport error:', error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', handleMcpRequest);

  app.get('/mcp', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    await transport.handleRequest(req, res);
  });

  app.delete('/mcp', async (req: any, res: any) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    const transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }

    await transport.handleRequest(req, res);
  });

  app.listen(config.port, (error?: Error) => {
    if (error) {
      console.error('[AIR MCP] Failed to start HTTP server:', error);
      process.exit(1);
    }

    console.error(`[AIR MCP] Streamable HTTP server listening on http://localhost:${config.port}/mcp`);
    console.error(`[AIR MCP] Database path: ${config.dbPath}`);
  });
}

main().catch((error) => {
  console.error('[AIR MCP] Fatal HTTP initialization error:', error);
  process.exit(1);
});
