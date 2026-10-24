import { DatabaseSync } from 'node:sqlite';
export interface DbConfig {
    dbPath?: string;
    dataDir?: string;
}
export declare function defaultDbPath(): string;
export declare function migrate(db: DatabaseSync): void;
export declare function openWorkbenchDb(config?: DbConfig): DatabaseSync;
export declare function runTransaction<T>(db: DatabaseSync, fn: () => T): T;
//# sourceMappingURL=database.d.ts.map