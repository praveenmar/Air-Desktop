export interface SqliteStatement {
  get<T = any>(...params: any[]): T | undefined;
  all<T = any>(...params: any[]): T[];
  run(...params: any[]): unknown;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

type DatabaseSyncCtor = new (filename: string) => SqliteDatabase;

function loadDatabaseSyncCtor(): DatabaseSyncCtor {
  try {
    // Lazy load to avoid static resolver issues in tooling.
    // In CJS/ts-node contexts, require is module-scoped (not global),
    // so avoid Function('return require') which can fail.
    const dynamicRequire = typeof require === 'function' ? require : null;
    if (!dynamicRequire) {
      throw new Error('require is unavailable in this runtime');
    }
    const mod = dynamicRequire('node:sqlite') as { DatabaseSync?: DatabaseSyncCtor };
    if (typeof mod?.DatabaseSync === 'function') {
      return mod.DatabaseSync;
    }
  } catch {
    // Handled by explicit throw below.
  }

  throw new Error('node:sqlite is unavailable. Use a Node.js runtime that provides node:sqlite (Node 22+).');
}

export function openSqliteReadonlyDatabase(dbPath: string): SqliteDatabase {
  try {
    const DatabaseSync = loadDatabaseSyncCtor();
    const db = new DatabaseSync(dbPath);
    // Hard read-only posture for codegen/tracing paths.
    db.exec('PRAGMA query_only = ON');
    return db;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to open SQLite database via node:sqlite at "${dbPath}": ${message}`);
  }
}
