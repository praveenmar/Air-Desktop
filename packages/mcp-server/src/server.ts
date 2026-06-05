import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { McpContext } from './context';

export type AirMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type AirMcpToolHandler = {
  definition: AirMcpToolDefinition;
  handle: (args: unknown, context: McpContext) => Promise<unknown>;
};

export function createMcpServer(context: McpContext): Server {
  const server = new Server(
    {
      name: 'air-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Modular tool registry
  const toolDefinitions: AirMcpToolDefinition[] = [];
  
  // Example tool definition shape (will be populated in Phase 3E-B)
  /*
  toolDefinitions.push({
    name: 'list_recorded_sessions',
    description: 'List available recorded AIR sessions',
    inputSchema: { ... }
  });
  */

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // Modular routing
    switch (request.params.name) {
      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
    }
  });

  return server;
}
