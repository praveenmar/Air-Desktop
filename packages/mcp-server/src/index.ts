import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { formatHelp, parseArgs, shouldShowHelp } from './config';
import { createContext } from './context';
import { createMcpServer } from './server';

async function main() {
  try {
    if (shouldShowHelp(process.argv.slice(2))) {
      console.error(formatHelp('stdio'));
      process.exit(0);
    }

    // 1. Parse arguments (e.g., node dist/index.js --db path/to/air.db)
    const config = parseArgs(process.argv.slice(2));

    // 2. Initialize context (CodegenService with read-only DB connection)
    const context = createContext(config);

    // 3. Create the MCP Server instance
    const server = createMcpServer(context);

    // 4. Wire up the stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);

    // Provide logging to stderr so it doesn't break the JSON stdio protocol on stdout
    console.error(`[AIR MCP] Server running on stdio`);
    console.error(`[AIR MCP] Database path: ${config.dbPath}`);

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.error(`[AIR MCP] Shutting down...`);
      await server.close();
      process.exit(0);
    });

  } catch (error) {
    console.error(`[AIR MCP] Fatal initialization error:`, error);
    process.exit(1);
  }
}

main().catch(console.error);
