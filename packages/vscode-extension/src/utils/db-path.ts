/**
 * DB path helper and safety guidance.
 *
 * - Prefer overriding with `AIR_DB_PATH` env var.
 * - Default location is ~/.air/data/air.db to avoid read-only install locations.
 * - Ensure parent directories are created with correct permissions before opening.
 */

import path from 'path';
import os from 'os';
import fs from 'fs';

export function getDefaultDbPath(): string {
  const env = process.env.AIR_DB_PATH;
  if (env && env.trim()) return env;
  const base = path.join(os.homedir(), '.air', 'data');
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  return path.join(base, 'air.db');
}
