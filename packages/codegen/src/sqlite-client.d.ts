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
export declare function openSqliteReadonlyDatabase(dbPath: string): SqliteDatabase;
