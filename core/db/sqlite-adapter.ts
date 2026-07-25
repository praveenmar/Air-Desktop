import { AsyncLocalStorage } from 'node:async_hooks';

export interface AsyncRunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface AsyncStatement {
  run(...params: any[]): Promise<AsyncRunResult>;
  get<T = any>(...params: any[]): Promise<T | undefined>;
  all<T = any>(...params: any[]): Promise<T[]>;
}

export interface AsyncSQLiteDatabase {
  exec(sql: string): Promise<void>;
  pragma(pragmaSql: string): Promise<void>;
  prepare(sql: string): AsyncStatement;
  transaction<T>(callback: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
  isOpen(): boolean;
}

interface TransactionContext {
  txId: number;
}

interface StatementSyncLike {
  run(...params: any[]): { changes?: number; lastInsertRowid?: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): StatementSyncLike;
  close(): void;
}

type DatabaseSyncCtor = new (filename: string) => DatabaseSyncLike;

function loadDatabaseSyncCtor(): DatabaseSyncCtor {
  try {
    // Lazy load avoids Vite/Vitest builtin resolution issues while preserving
    // the same Node runtime dependency in production.
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

class NodeSqliteAsyncStatement implements AsyncStatement {
  private statement: StatementSyncLike;

  constructor(
    private readonly db: NodeSqliteAsyncDatabase,
    sql: string
  ) {
    this.statement = this.db.raw.prepare(sql);
  }

  public async run(...params: any[]): Promise<AsyncRunResult> {
    return this.db.execute(() => {
      const result = this.statement.run(...params) as { changes?: number; lastInsertRowid?: number | bigint };
      return {
        changes: result.changes ?? 0,
        lastInsertRowid: result.lastInsertRowid,
      };
    });
  }

  public async get<T = any>(...params: any[]): Promise<T | undefined> {
    return this.db.execute(() => this.statement.get(...params) as T | undefined);
  }

  public async all<T = any>(...params: any[]): Promise<T[]> {
    return this.db.execute(() => (this.statement.all(...params) as T[]) ?? []);
  }
}

export class NodeSqliteAsyncDatabase implements AsyncSQLiteDatabase {
  public readonly raw: DatabaseSyncLike;
  private closed = false;
  private gate: Promise<void> = Promise.resolve();
  private txCounter = 0;
  private activeTxId: number | null = null;
  private readonly txStorage = new AsyncLocalStorage<TransactionContext>();

  constructor(dbPath: string) {
    const DatabaseSync = loadDatabaseSyncCtor();
    this.raw = new DatabaseSync(dbPath);
  }

  public isOpen(): boolean {
    return !this.closed;
  }

  public async exec(sql: string): Promise<void> {
    await this.execute(() => {
      this.raw.exec(sql);
    });
  }

  public async pragma(pragmaSql: string): Promise<void> {
    const sql = /^\s*pragma\s/i.test(pragmaSql) ? pragmaSql : `PRAGMA ${pragmaSql}`;
    await this.exec(sql);
  }

  public prepare(sql: string): AsyncStatement {
    this.assertOpen();
    return new NodeSqliteAsyncStatement(this, sql);
  }

  public async transaction<T>(callback: () => Promise<T>): Promise<T> {
    const currentContext = this.txStorage.getStore();
    if (currentContext && this.activeTxId === currentContext.txId) {
      return callback();
    }

    return this.withExclusive(async () => {
      this.assertOpen();
      const txId = ++this.txCounter;
      this.activeTxId = txId;
      this.raw.exec('BEGIN IMMEDIATE');

      try {
        const result = await this.txStorage.run({ txId }, callback);
        this.raw.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          this.raw.exec('ROLLBACK');
        } catch {
          // Intentionally ignore rollback failures and rethrow original error.
        }
        throw error;
      } finally {
        this.activeTxId = null;
      }
    });
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    await this.withExclusive(async () => {
      if (this.closed) return;
      this.raw.close();
      this.closed = true;
    });
  }

  public async execute<T>(operation: () => T): Promise<T> {
    this.assertOpen();
    const txContext = this.txStorage.getStore();
    if (txContext && this.activeTxId === txContext.txId) {
      return operation();
    }
    return this.withExclusive(async () => {
      this.assertOpen();
      return operation();
    });
  }

  private async withExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('SQLite database is closed');
    }
  }
}

export async function openAsyncDatabase(dbPath: string): Promise<AsyncSQLiteDatabase> {
  return new NodeSqliteAsyncDatabase(dbPath);
}
