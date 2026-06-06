import { z } from 'zod';
import * as path from 'path';

export const ConfigSchema = z.object({
  dbPath: z.string().min(1, 'DB path must be provided via --db or AIR_MCP_DB_PATH'),
});

export type McpServerConfig = z.infer<typeof ConfigSchema>;

const DEFAULT_HTTP_PORT = 3333;

function readFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === name && args[i + 1]) {
      return args[i + 1];
    }

    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }

  return undefined;
}

export function resolveDbPath(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const dbArg = readFlag(args, '--db');
  const dbPath = dbArg ?? env.AIR_MCP_DB_PATH ?? env.AIR_DB_PATH;

  if (!dbPath) {
    throw new Error('Database path must be provided via --db or AIR_MCP_DB_PATH');
  }

  return path.resolve(dbPath);
}

export function resolveHttpPort(args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const portValue = readFlag(args, '--port') ?? env.AIR_MCP_PORT ?? env.PORT;

  if (!portValue) {
    return DEFAULT_HTTP_PORT;
  }

  const parsed = Number.parseInt(portValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid port: ${portValue}`);
  }

  return parsed;
}

export function shouldShowHelp(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

export function formatHelp(transport: 'stdio' | 'http'): string {
  const lines = [
    'AIR MCP Server',
    '',
    'Configuration:',
    '  --db <path>           Path to AIR SQLite database',
    '  AIR_MCP_DB_PATH       Database path environment variable',
  ];

  if (transport === 'http') {
    lines.push('  --port <number>       HTTP port for Streamable MCP transport');
    lines.push('  AIR_MCP_PORT          HTTP port environment variable');
  }

  lines.push('');
  lines.push('Examples:');
  lines.push('  stdio: node scripts/air-mcp.cjs --db C:/path/to/air-data.db');
  lines.push('  http:  node scripts/air-mcp.cjs --transport http --db C:/path/to/air-data.db --port 3333');

  return lines.join('\n');
}

/**
 * Parses simple CLI arguments like --db path/to/air.db
 */
export function parseArgs(args: string[]): McpServerConfig {
  const parsed: Record<string, string> = {
    dbPath: resolveDbPath(args),
  };

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  return result.data;
}
