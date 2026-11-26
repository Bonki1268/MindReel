import { renderPrompt } from '@templeyard/prompts';
import { describe, expect, it } from 'vitest';
import { scenarioPacksDir } from '../paths.js';
import { loadPackPrompts } from '../scenarioPacks/prompts.js';
import { productViewVariables, type ProductViewPromptInput } from './viewPrompt.js';

const base: ProductViewPromptInput = {
  product: { name: '玻璃保溫杯', brand: '山嵐', category: '居家生活' },
  series: { visualStyle: '明亮乾淨的棚拍' },
  view: { key: 'front', name: '正面', source: 'photo' },
  references: [{ viewName: '正面' }, { viewName: '包裝' }, { viewName: null }],
  appearanceLocks: ['matte black body', 'silver lid with embossed logo'],
  lighting: '攝影棚柔光',
  instruction: null,
};

describe('product-view 的變數', () => {
  it('商品、視角、來源、光線、系列風格照欄位帶入；外觀規範以「; 」連接逐字帶入', () => {
    expect(productViewVariables(base)).toMatchObject({
      product: {
        name: '玻璃保溫杯',
        brand: '山嵐',
        category: '居家生活',
        lighting: '攝影棚柔光',
        appearanceLocks: 'matte black body; silver lid with embossed logo',
      },
      view: { key: 'front', name: '正面', source: '依照片' },
      series: { style: '明亮乾淨的棚拍' },
    });
  });

  it('沒有品牌時品牌留白', () => {
    const vars = productViewVariables({ ...base, product: { ...base.product, brand: null } });
    expect((vars.product as Record<string, unknown>).brand ?? '').toBe('');
  });

  it('參考照片依送入順序編號：同一個視角的照片負責這個視角的外觀，其他只負責商品外觀', () => {
    expect(productViewVariables(base).photos).toBe(
      'Image 1（這個視角的外觀）：正面；Image 2（商品外觀）：包裝；Image 3（商品外觀）：沒有指定視角的照片',
    );
  });

  it('AI 推測的視角先說明沒有這個視角的照片', () => {
    const vars = productViewVariables({ ...base, view: { key: 'back_side', name: '背面或側面', source: 'ai_inferred' }, references: [{ viewName: '正面' }] });
    expect(vars.view).toMatchObject({ source: 'AI 推測' });
    expect(vars.photos).toBe('沒有這個視角的照片；Image 1（商品外觀）：正面');
  });

  it('變數裡沒有價格、價格說明、賣點（指令不得帶入價格數字與行銷文字）', () => {
    const text = JSON.stringify(productViewVariables(base));
    expect(text).not.toContain('990');
    expect(text).not.toContain('限時');
    expect(Object.keys(productViewVariables(base).product as object).sort()).toEqual(['appearanceLocks', 'brand', 'category', 'lighting', 'name']);
  });

  it('帶入後 product-view 的必填變數都有值', () => {
    const prompt = loadPackPrompts([scenarioPacksDir]).get('product-view');
    if (!prompt) throw new Error('找不到 product-view');

    const { missing, request } = renderPrompt(prompt, productViewVariables(base), { model: 'nano-banana-pro' });

    expect(missing).toEqual([]);
    expect(request.messages[0]?.content).toContain('外觀規範（逐字帶入）：matte black body; silver lid with embossed logo');
  });
});
