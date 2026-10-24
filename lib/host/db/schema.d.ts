import type { DatabaseSync } from 'node:sqlite';
export declare const SCHEMA_VERSION = 3;
export interface Migration {
    version: number;
    name: string;
    up(db: DatabaseSync): void;
}
export declare const MIGRATIONS: Migration[];
//# sourceMappingURL=schema.d.ts.map