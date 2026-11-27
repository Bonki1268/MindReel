import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema>;

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

/** 開啟 SQLite 並套用 migration；測試可傳 ':memory:' */
export function openDatabase(file: string): AppDatabase {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema });
  // 重建資料表的 migration（例如 0014 把 temple_id 改成 nullable）要在外鍵關閉時執行；
  // PRAGMA foreign_keys 在交易裡不會生效，所以在 migrate 之前關、之後打開
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder });
  sqlite.pragma('foreign_keys = ON');
  return db;
}
