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

export type AirMcpToolResponse = {
  content: Array<{
    type: 'text';
    text: string;
  }>;
};

export type AirMcpToolHandler = {
  definition: AirMcpToolDefinition;
  handle: (args: unknown, context: McpContext) => Promise<AirMcpToolResponse>;
};

import { getToolHandlers } from './tools';

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

  const tools = getToolHandlers();

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: tools.map(tool => tool.definition),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = tools.find(t => t.definition.name === request.params.name);

    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }

    return tool.handle(request.params.arguments ?? {}, context);
  });

  return server;
}
