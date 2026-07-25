// Purpose: Core Database service initialization and connection management.
// Prototype Origin: db.js (initialization logic)
// Changes: Converted to a class-based service, injected configuration, strict typing.

import { runMigrations } from '../db/migrations';
import { AsyncSQLiteDatabase, openAsyncDatabase } from './sqlite-adapter';

export class DatabaseService {
  private constructor(private db: AsyncSQLiteDatabase) {}

  public static async create(dbPath: string): Promise<DatabaseService> {
    try {
      console.log('[AIR-DB] Initialization started', { dbPath });
      const db = await openAsyncDatabase(dbPath);

      // Enforce strict SQLite pragmas for performance and integrity.
      await db.pragma('journal_mode = WAL');
      await db.pragma('foreign_keys = ON');

      console.log('[AIR-DB] Migration started');
      await runMigrations(db);
      console.log('[AIR-DB] Migration finished');
      console.log('[AIR-DB] Database initialized');

      return new DatabaseService(db);
    } catch (error) {
      console.error('[AIR-DB] Database initialization failed', error);
      throw error;
    }
  }

  /** Exposes the underlying database instance to the repositories */
  public getInstance(): AsyncSQLiteDatabase {
    return this.db;
  }

  public async close(): Promise<void> {
    await this.db.close();
  }
}
