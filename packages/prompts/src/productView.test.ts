import { describe, expect, it } from 'vitest';
import { loadPromptFiles } from './load.js';
import path from 'node:path';
import { repoRoot } from './paths.js';

// product-view 節點（第 16 階段，依 drama-skills 的道具與場景寫法；指令檔格式與 Prompt Studio 相同）

function productView() {
  // 電商包自己的指令放在 scenario-packs/ecommerce/prompts/（新增情境包只放設定與指令，F23）
  const prompt = loadPromptFiles(path.join(repoRoot, 'scenario-packs', 'ecommerce', 'prompts')).get('product-view');
  if (!prompt) throw new Error('scenario-packs/ecommerce/prompts 找不到 product-view');
  return prompt;
}

describe('product-view 節點', () => {
  it('是圖片節點，輸出 prompt 與 notes，綁定 prompt 與比例', () => {
    const prompt = productView();
    expect(prompt.target.kind).toBe('image');
    expect(prompt.output?.format).toBe('json');
    expect(prompt.bindings).toEqual({ prompt: 'output.prompt', aspectRatio: 'target.aspectRatio' });
  });

  it('有 Nano Banana Pro 的寫法，並依 drama-skills 的道具與視角寫法列為依據', () => {
    const prompt = productView();
    expect(Object.keys(prompt.modelRules ?? {})).toContain('nano-banana-pro');
    expect((prompt.basis ?? []).some((item) => item.includes('prop-plate') || item.includes('prop-and-state'))).toBe(true);
  });

  it('限制指令不得要求畫出文字：系統指令要求不加疊字、標籤、浮水印、價格與標語', () => {
    const { system } = productView();
    expect(system).toContain('不加疊字');
    expect(system).toContain('價格');
    expect(system).toContain('標語');
    expect(system).not.toMatch(/寫上|印上|標示價格|加上文字/);
  });

  it('包裝上的文字只在照片拍得清楚時照照片呈現，不編造', () => {
    const { system } = productView();
    expect(system).toContain('照片');
    expect(system).toContain('不編造');
  });

  it('系統指令用「商品定裝版的視角圖」開頭的用途說明，和寺廟定裝版的指令分得開', () => {
    const { system } = productView();
    expect(system).toContain('商品定裝版的視角圖');
    expect(system).not.toContain('寺廟定裝版的視角圖');
  });

  it('變數清單沒有價格、價格說明、賣點', () => {
    const names = productView().variables.map((variable) => variable.name);
    expect(names).toEqual(expect.arrayContaining(['product.name', 'view.name', 'view.source', 'photos', 'product.appearanceLocks', 'product.lighting', 'series.style']));
    expect(names.filter((name) => /price|sellingPoint|priceNote/i.test(name))).toEqual([]);
  });
});
