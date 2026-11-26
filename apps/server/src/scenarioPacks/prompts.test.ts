import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scenarioPacksDir } from '../paths.js';
import { loadPackPrompts } from './prompts.js';

// 情境包自己的指令：scenario-packs/<id>/prompts/*.json（格式與 Prompt Studio 的指令檔相同）

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'pack-prompts-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const productView = readFileSync(path.join(scenarioPacksDir, 'ecommerce', 'prompts', 'product-view.json'), 'utf8');

function addPrompt(pack: string, name: string, content: string) {
  mkdirSync(path.join(tmp, pack, 'prompts'), { recursive: true });
  writeFileSync(path.join(tmp, pack, 'prompts', name), content);
}

describe('讀取情境包自己的指令', () => {
  it('電商包有 product-view，通過 Zod 驗證', () => {
    const prompts = loadPackPrompts([scenarioPacksDir]);
    expect([...prompts.keys()]).toEqual(['product-view']);
    expect(prompts.get('product-view')).toMatchObject({ id: 'product-view', target: { kind: 'image' } });
  });

  it('沒有 prompts 資料夾的情境包（廟埕包）略過', () => {
    mkdirSync(path.join(tmp, 'temple'));
    expect(loadPackPrompts([tmp]).size).toBe(0);
  });

  it('新增情境包只要放一個資料夾，指令跟著載入', () => {
    addPrompt('workshop', 'product-view.json', productView);
    expect([...loadPackPrompts([tmp]).keys()]).toEqual(['product-view']);
  });

  it('指令檔格式不正確時，錯誤指出情境包與檔名', () => {
    addPrompt('workshop', 'broken.json', JSON.stringify({ id: 'broken', step: 9 }));
    expect(() => loadPackPrompts([tmp])).toThrow(/workshop.*broken\.json/s);
  });

  it('兩個情境包有相同的指令 id 時丟出錯誤', () => {
    addPrompt('one', 'product-view.json', productView);
    addPrompt('two', 'product-view.json', productView);
    expect(() => loadPackPrompts([tmp])).toThrow(/product-view/);
  });
});
