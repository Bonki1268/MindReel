import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './client.js';

// 第 16 階段的遷移（0014_products）：新增商品相關資料表；videos、photos 的 temple_id 改成 nullable，
// 並新增 product_id 等欄位。SQLite 不能直接改 NOT NULL，要重建資料表，而且既有資料與外鍵都不能壞。

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '..', '..', 'drizzle');

type Journal = { version: string; dialect: string; entries: { idx: number; tag: string }[] };

let tmp: string;
let file: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'templeyard-migrate-'));
  file = path.join(tmp, 'app.db');
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** 只套到第 15 階段（0013）為止的資料庫，外鍵開著（和執行時相同） */
function legacyDatabase(): Database.Database {
  const folder = path.join(tmp, 'drizzle-legacy');
  cpSync(drizzleDir, folder, { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')) as Journal;
  const upTo = journal.entries.findIndex((entry) => entry.tag === '0014_products');
  expect(upTo, '遷移檔 0014_products 要登記在 _journal.json').toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, upTo);
  writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal));

  const sqlite = new Database(file);
  sqlite.pragma('foreign_keys = ON');
  migrate(drizzle(sqlite), { migrationsFolder: folder });
  return sqlite;
}

function seed(sqlite: Database.Database) {
  const now = '2026-11-01T00:00:00Z';
  sqlite.exec(`INSERT INTO series (id, name, visual_style, direction, default_image_model, default_video_model, created_at, updated_at)
    VALUES ('s1', '舊系列', '寫實', '歷史故事', 'nano-banana-pro', 'seedance-2.0', '${now}', '${now}')`);
  sqlite.exec(`INSERT INTO videos (id, series_id, temple_id, stage, image_model, video_model, created_at, updated_at)
    VALUES ('v1', 's1', 't1', 'chat', 'nano-banana-pro', 'seedance-2.0', '${now}', '${now}')`);
  sqlite.exec(`INSERT INTO assets (id, kind, path, mime, sha256, cloud_ok) VALUES ('a1', 'original_photo', 'o/a1', 'image/png', 'x', 0), ('a2', 'deid_photo', 'd/a2', 'image/png', 'y', 1)`);
  sqlite.exec(`INSERT INTO photos (id, series_id, temple_id, video_id, original_asset_id, deidentified_asset_id, view_key, deid_boxes, created_at)
    VALUES ('ph1', 's1', 't1', NULL, 'a1', 'a2', 'front_overview', '[]', '${now}')`);
  sqlite.exec(`INSERT INTO chat_messages (id, video_id, scope, role, content, tool_calls, created_at) VALUES ('m1', 'v1', 'video', 'user', '嗨', '[]', '${now}')`);
}

describe('商品遷移（0014_products）', () => {
  it('既有的寺廟影片與照片遷移後資料不變，主體仍是寺廟、新欄位預設為空', () => {
    const sqlite = legacyDatabase();
    seed(sqlite);
    sqlite.close();

    const db = openDatabase(file);
    const raw = (db as unknown as { $client: Database.Database }).$client;

    expect(raw.prepare('SELECT id, series_id, temple_id, stage, subject_type, aspect_ratio, product_id, product_snapshot, product_board_version_id FROM videos').all()).toEqual([
      { id: 'v1', series_id: 's1', temple_id: 't1', stage: 'chat', subject_type: 'temple', aspect_ratio: '16:9', product_id: null, product_snapshot: null, product_board_version_id: null },
    ]);
    expect(raw.prepare('SELECT id, temple_id, product_id, view_key FROM photos').all()).toEqual([{ id: 'ph1', temple_id: 't1', product_id: null, view_key: 'front_overview' }]);
    raw.close();
  });

  it('遷移完成後外鍵仍開著、沒有壞掉的參照；子表仍然指向 videos', () => {
    const sqlite = legacyDatabase();
    seed(sqlite);
    sqlite.close();

    const db = openDatabase(file);
    const raw = (db as unknown as { $client: Database.Database }).$client;

    expect(raw.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(raw.pragma('foreign_key_check')).toEqual([]);
    expect(raw.prepare('SELECT id FROM chat_messages').all()).toEqual([{ id: 'm1' }]);
    expect(() =>
      raw.exec(`INSERT INTO chat_messages (id, video_id, scope, role, content, tool_calls, created_at) VALUES ('m2', 'no-such-video', 'video', 'user', 'x', '[]', 'x')`),
    ).toThrow(/FOREIGN KEY/);
    // 重建資料表時，原本的索引也要在
    const indexes = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('videos', 'photos')").all() as { name: string }[];
    expect(indexes.map((index) => index.name)).toEqual(expect.arrayContaining(['videos_series_idx', 'photos_series_temple_idx']));
    raw.close();
  });

  it('商品影片與商品照的 temple_id 可以是 null', () => {
    const db = openDatabase(':memory:');
    const raw = (db as unknown as { $client: Database.Database }).$client;
    const now = 'x';
    raw.exec(`INSERT INTO series (id, name, visual_style, direction, default_image_model, default_video_model, scenario_pack, created_at, updated_at)
      VALUES ('s1', '電商', '棚拍', '新品上市', 'nano-banana-pro', 'seedance-2.0', 'ecommerce', '${now}', '${now}')`);
    raw.exec(`INSERT INTO products (id, series_id, name, category, selling_points, created_at, updated_at) VALUES ('p1', 's1', '保溫杯', '居家生活', '["保溫"]', '${now}', '${now}')`);

    raw.exec(`INSERT INTO videos (id, series_id, temple_id, product_id, subject_type, stage, image_model, video_model, created_at, updated_at)
      VALUES ('v1', 's1', NULL, 'p1', 'product', 'creating', 'nano-banana-pro', 'seedance-2.0', '${now}', '${now}')`);
    raw.exec(`INSERT INTO assets (id, kind, path, mime, sha256, cloud_ok) VALUES ('a1', 'original_photo', 'o', 'image/png', 'x', 0), ('a2', 'deid_photo', 'd', 'image/png', 'y', 1)`);
    raw.exec(`INSERT INTO photos (id, series_id, temple_id, product_id, video_id, original_asset_id, deidentified_asset_id, deid_boxes, created_at)
      VALUES ('ph1', 's1', NULL, 'p1', NULL, 'a1', 'a2', '[]', '${now}')`);

    expect(raw.prepare('SELECT temple_id, product_id FROM videos').get()).toEqual({ temple_id: null, product_id: 'p1' });
    expect(raw.prepare('SELECT temple_id, product_id FROM photos').get()).toEqual({ temple_id: null, product_id: 'p1' });
    raw.close();
  });

  it('商品定裝版三張表：同系列同一件商品只有一份、同一版同一視角只有一列', () => {
    const db = openDatabase(':memory:');
    const raw = (db as unknown as { $client: Database.Database }).$client;
    const now = 'x';
    raw.exec(`INSERT INTO series (id, name, visual_style, direction, default_image_model, default_video_model, scenario_pack, created_at, updated_at)
      VALUES ('s1', '電商', '棚拍', '新品上市', 'nano-banana-pro', 'seedance-2.0', 'ecommerce', '${now}', '${now}')`);
    raw.exec(`INSERT INTO products (id, series_id, name, category, selling_points, created_at, updated_at) VALUES ('p1', 's1', '保溫杯', '居家生活', '["保溫"]', '${now}', '${now}')`);
    raw.exec(`INSERT INTO product_boards (id, series_id, product_id) VALUES ('b1', 's1', 'p1')`);
    expect(() => raw.exec(`INSERT INTO product_boards (id, series_id, product_id) VALUES ('b2', 's1', 'p1')`)).toThrow(/UNIQUE/);

    raw.exec(`INSERT INTO product_board_versions (id, board_id, version, image_model, appearance_locks, default_lighting) VALUES ('bv1', 'b1', 1, 'nano-banana-pro', '[]', '攝影棚柔光')`);
    raw.exec(`INSERT INTO product_views (id, board_version_id, view_key, view_name, source) VALUES ('pv1', 'bv1', 'front', '正面', 'photo')`);
    expect(() => raw.exec(`INSERT INTO product_views (id, board_version_id, view_key, view_name, source) VALUES ('pv2', 'bv1', 'front', '正面', 'photo')`)).toThrow(/UNIQUE/);
    expect(raw.prepare('SELECT confirmed FROM product_views').get()).toEqual({ confirmed: 0 });
    raw.close();
  });
});
