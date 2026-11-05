import type { Database } from "./db/database.ts";
import { MysqlDatabase } from "./db/mysql.ts";
import { SqliteDatabase } from "./db/sqlite.ts";

export type * from "./db/database.ts";

export type Store = Database;

export interface StoreConfig {
    home: string;
    // A mysql:// URL; without it the database is SQLite in `home`.
    databaseUrl: string | null;
}

export const Store = {
    open(cfg: StoreConfig): Promise<Store> {
        return cfg.databaseUrl
            ? MysqlDatabase.open(cfg.databaseUrl)
            : SqliteDatabase.open(cfg.home);
    },
};
