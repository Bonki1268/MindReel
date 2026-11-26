import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '..', '..', 'drizzle');

type Journal = { entries: { tag: string }[] };

function statementsOf(tag: string): string[] {
  return readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe('情境包遷移（0013_scenario_packs）', () => {
  it('既有的系列與影片遷移後一律是廟埕包、寺廟主體、16:9', () => {
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8')) as Journal;
    const tags = journal.entries.map((entry) => entry.tag);
    const target = tags.indexOf('0013_scenario_packs');
    expect(target, '遷移檔 0013_scenario_packs 要登記在 _journal.json').toBeGreaterThan(0);

    // 先套到第 14 階段的樣子，放進舊資料，再套這次的遷移
    const sqlite = new Database(':memory:');
    for (const tag of tags.slice(0, target)) for (const statement of statementsOf(tag)) sqlite.exec(statement);
    sqlite.exec(
      `INSERT INTO series (id, name, visual_style, direction, default_image_model, default_video_model, created_at, updated_at)
       VALUES ('s1', '舊系列', '寫實', '歷史故事', 'nano-banana-pro', 'seedance-2.0', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
    );
    sqlite.exec(
      `INSERT INTO videos (id, series_id, temple_id, stage, image_model, video_model, created_at, updated_at)
       VALUES ('v1', 's1', 't1', 'creating', 'nano-banana-pro', 'seedance-2.0', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
    );
    for (const statement of statementsOf(tags[target] ?? '')) sqlite.exec(statement);

    expect(sqlite.prepare('SELECT scenario_pack FROM series WHERE id = ?').get('s1')).toEqual({ scenario_pack: 'temple' });
    expect(sqlite.prepare('SELECT subject_type, aspect_ratio FROM videos WHERE id = ?').get('v1')).toEqual({
      subject_type: 'temple',
      aspect_ratio: '16:9',
    });
    sqlite.close();
  });
});
