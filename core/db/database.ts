// Purpose: Core Database service initialization and connection management.
// Prototype Origin: db.js (initialization logic)
// Changes: Converted to a class-based service, injected configuration, strict typing.

import SQLiteDatabase, { Database } from 'better-sqlite3';
import { runMigrations } from '../db/migrations';

export class DatabaseService {
  private db: Database;

  constructor(dbPath: string) {
    try {
      console.log(`🔌 Initializing database at ${dbPath}...`);
      this.db = new SQLiteDatabase(dbPath);
      
      // Enforce strict SQLite pragmas for performance and integrity
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');

      // Run schema initialization and migrations
      runMigrations(this.db);
      
      console.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  /** Exposes the underlying database instance to the repositories */
  public getInstance(): Database {
    return this.db;
  }

  public close(): void {
    this.db.close();
  }
}