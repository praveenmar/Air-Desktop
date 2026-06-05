import { z } from 'zod';
import * as path from 'path';

export const ConfigSchema = z.object({
  dbPath: z.string().min(1, "DB path must be provided via --db"),
});

export type McpServerConfig = z.infer<typeof ConfigSchema>;

/**
 * Parses simple CLI arguments like --db path/to/air.db
 */
export function parseArgs(args: string[]): McpServerConfig {
  const parsed: Record<string, string> = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) {
      parsed.dbPath = path.resolve(args[i + 1]);
      i++; // Skip the value
    }
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid configuration: ${result.error.message}`);
  }

  return result.data;
}
