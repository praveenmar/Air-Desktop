import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export function getAirHome(): string {
  if (process.env.AIR_HOME) {
    return process.env.AIR_HOME;
  }
  if (process.env.AIR_DB_PATH) {
    return path.dirname(process.env.AIR_DB_PATH);
  }
  return path.join(os.homedir(), '.air');
}

export function ensureAirHome(): void {
  const home = getAirHome();
  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true });
  }
}

export function getDatabasePath(): string {
  if (process.env.AIR_DB_PATH) {
    return process.env.AIR_DB_PATH;
  }
  return path.join(getAirHome(), 'air-data.db');
}

export function getConfigPath(): string {
  return path.join(getAirHome(), 'config.json');
}

export function getExportsPath(): string {
  const exportsPath = path.join(getAirHome(), 'exports');
  if (!fs.existsSync(exportsPath)) {
    fs.mkdirSync(exportsPath, { recursive: true });
  }
  return exportsPath;
}

export function getSessionMapsPath(): string {
  const sessionMapsPath = path.join(getAirHome(), 'session-maps');
  if (!fs.existsSync(sessionMapsPath)) {
    fs.mkdirSync(sessionMapsPath, { recursive: true });
  }
  return sessionMapsPath;
}
