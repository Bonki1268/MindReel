import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SERIES_DIRECTIONS } from './series.js';
import { STANDARD_VIEWS, STANDARD_VIEW_KEYS, viewKeySchema } from './views.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const templePack = JSON.parse(readFileSync(path.resolve(here, '..', '..', '..', 'scenario-packs', 'temple', 'pack.json'), 'utf8')) as {
  view_keys: { key: string; name: string }[];
  directions: string[];
};

describe('寺廟標準視角來自廟埕包設定檔', () => {
  it('STANDARD_VIEWS 與 scenario-packs/temple/pack.json 的 view_keys 完全一致（順序也相同）', () => {
    expect(STANDARD_VIEWS.map((view) => ({ key: view.key, name: view.name }))).toEqual(templePack.view_keys);
  });

  it('視角代號的清單與驗證都跟著設定檔', () => {
    expect([...STANDARD_VIEW_KEYS]).toEqual(templePack.view_keys.map((view) => view.key));
    for (const view of templePack.view_keys) expect(viewKeySchema.safeParse(view.key).success).toBe(true);
    expect(viewKeySchema.safeParse('product_front').success).toBe(false);
  });

  it('廟埕系列的影片方向選項來自設定檔', () => {
    expect([...SERIES_DIRECTIONS]).toEqual(templePack.directions);
  });
});
