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

const AIR_MCP_INSTRUCTIONS =
  'Use AIR tools first for questions about recorded AIR sessions, AIR flow reviews, or AIR generation context. ' +
  'Prefer list_recorded_sessions instead of searching files or querying SQLite directly when the user asks to list or find sessions. ' +
  'After selecting a session, use get_session_flow_review for a human-readable review and get_session_generation_context for structured machine-readable step data. ' +
  'Do not inspect the AIR database via shell when an AIR MCP tool can answer the request.';

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
      instructions: AIR_MCP_INSTRUCTIONS,
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
