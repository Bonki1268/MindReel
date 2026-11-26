import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { scenarioPacksDir } from '../paths.js';
import { loadScenarioPacks } from './load.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const extraPacksDir = path.join(here, '__fixtures__', 'extra-packs');

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 在暫存資料夾放一個情境包；mutate 可以改掉內容 */
function packDir(folder: string, mutate?: (pack: Record<string, unknown>) => void, raw?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'packs-'));
  tempDirs.push(root);
  const dir = path.join(root, folder);
  mkdirSync(dir, { recursive: true });
  if (raw !== undefined) {
    writeFileSync(path.join(dir, 'pack.json'), raw);
  } else {
    const pack = JSON.parse(readFileSync(path.join(scenarioPacksDir, 'ecommerce', 'pack.json'), 'utf8')) as Record<string, unknown>;
    mutate?.(pack);
    writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(pack));
  }
  return root;
}

describe('載入情境包', () => {
  it('載入 repo 的 scenario-packs：廟埕與電商兩個', () => {
    const registry = loadScenarioPacks([scenarioPacksDir]);
    expect(registry.list().map((pack) => pack.id).sort()).toEqual(['ecommerce', 'temple']);
  });

  it('可以再加一個資料夾：新增第三個情境包只要放設定檔', () => {
    const registry = loadScenarioPacks([scenarioPacksDir, extraPacksDir]);
    expect(registry.list().map((pack) => pack.id).sort()).toEqual(['ecommerce', 'temple', 'workshop']);
    expect(registry.get('workshop')?.labels.board).toBe('工坊定裝版');
  });

  it('缺欄位時，訊息指出檔案與欄位', () => {
    const root = packDir('ecommerce', (pack) => {
      delete pack.labels;
    });
    expect(() => loadScenarioPacks([root])).toThrow(/ecommerce[\\/]pack\.json/);
    expect(() => loadScenarioPacks([root])).toThrow(/labels/);
  });

  it('features 型別錯誤時，訊息指出欄位', () => {
    const root = packDir('ecommerce', (pack) => {
      pack.features = { scriptProposals: 1, styleQuestion: true, productHero: true };
    });
    expect(() => loadScenarioPacks([root])).toThrow(/features\.scriptProposals/);
  });

  it('view_keys 重複時啟動失敗', () => {
    const root = packDir('ecommerce', (pack) => {
      pack.view_keys = [
        { key: 'front', name: '正面' },
        { key: 'front', name: '正面' },
      ];
    });
    expect(() => loadScenarioPacks([root])).toThrow(/view_keys/);
  });

  it('資料夾名稱和設定檔的 id 不同時啟動失敗', () => {
    const root = packDir('shop', (pack) => {
      pack.id = 'ecommerce';
    });
    expect(() => loadScenarioPacks([root])).toThrow(/shop/);
    expect(() => loadScenarioPacks([root])).toThrow(/ecommerce/);
  });

  it('JSON 壞掉時，訊息指出檔案', () => {
    const root = packDir('ecommerce', undefined, '{ "id": ');
    expect(() => loadScenarioPacks([root])).toThrow(/ecommerce[\\/]pack\.json/);
  });

  it('資料夾裡沒有 pack.json 時啟動失敗', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'packs-'));
    tempDirs.push(root);
    mkdirSync(path.join(root, 'empty'));
    expect(() => loadScenarioPacks([root])).toThrow(/empty/);
  });

  it('不同資料夾有相同的情境包代號時啟動失敗', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'packs-'));
    tempDirs.push(root);
    cpSync(path.join(scenarioPacksDir, 'temple'), path.join(root, 'temple'), { recursive: true });
    expect(() => loadScenarioPacks([scenarioPacksDir, root])).toThrow(/temple/);
  });

  it('資料夾不存在時啟動失敗', () => {
    expect(() => loadScenarioPacks([path.join(tmpdir(), 'no-such-packs-dir')])).toThrow(/no-such-packs-dir/);
  });
});
