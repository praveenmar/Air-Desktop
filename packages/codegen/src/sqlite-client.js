"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openSqliteReadonlyDatabase = openSqliteReadonlyDatabase;
function loadDatabaseSyncCtor() {
    try {
        // Lazy load to avoid static resolver issues in tooling.
        // In CJS/ts-node contexts, require is module-scoped (not global),
        // so avoid Function('return require') which can fail.
        const dynamicRequire = typeof require === 'function' ? require : null;
        if (!dynamicRequire) {
            throw new Error('require is unavailable in this runtime');
        }
        const mod = dynamicRequire('node:sqlite');
        if (typeof mod?.DatabaseSync === 'function') {
            return mod.DatabaseSync;
        }
    }
    catch {
        // Handled by explicit throw below.
    }
    throw new Error('node:sqlite is unavailable. Use a Node.js runtime that provides node:sqlite (Node 22+).');
}
function openSqliteReadonlyDatabase(dbPath) {
    try {
        const DatabaseSync = loadDatabaseSyncCtor();
        const db = new DatabaseSync(dbPath);
        // Hard read-only posture for codegen/tracing paths.
        db.exec('PRAGMA query_only = ON');
        return db;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to open SQLite database via node:sqlite at "${dbPath}": ${message}`);
    }
}
