import type { TempleViewSource } from '@templeyard/shared';

// product-view 節點的變數（scenario-packs/ecommerce/prompts/product-view.json 的變數清單）
// 價格、價格說明、賣點都不帶進圖片指令：價格只會在合成時以字幕疊上（01 F27）。

export type ProductViewPromptInput = {
  product: { name: string; brand: string | null; category: string };
  series: { visualStyle: string };
  view: { key: string; name: string; source: TempleViewSource };
  /** 依送入順序的參考照片：拍到哪個視角（沒有指定時為 null） */
  references: readonly { viewName: string | null }[];
  appearanceLocks: readonly string[];
  lighting: string;
  instruction: string | null;
};

/**
 * 組出 product-view 的變數：
 * - view.source：依照片／AI 推測
 * - photos：「Image 1（這個視角的外觀）：正面；Image 2（商品外觀）：包裝」——這個視角自己的照片負責這個視角的外觀，
 *   其他視角的照片只負責商品外觀；AI 推測的視角開頭說明沒有這個視角的照片
 * - product.appearanceLocks：以「; 」連接，逐字帶入
 */
export function productViewVariables(input: ProductViewPromptInput): Record<string, unknown> {
  const listed = input.references.map((reference, index) => {
    const own = input.view.source === 'photo' && reference.viewName === input.view.name;
    const role = own ? '這個視角的外觀' : '商品外觀';
    return `Image ${index + 1}（${role}）：${reference.viewName ?? '沒有指定視角的照片'}`;
  });
  const photos = input.view.source === 'ai_inferred' ? ['沒有這個視角的照片', ...listed] : listed;
  return {
    product: {
      name: input.product.name,
      brand: input.product.brand ?? '',
      category: input.product.category,
      appearanceLocks: input.appearanceLocks.join('; '),
      lighting: input.lighting,
    },
    view: { key: input.view.key, name: input.view.name, source: input.view.source === 'photo' ? '依照片' : 'AI 推測' },
    photos: photos.join('；'),
    series: { style: input.series.visualStyle },
    instruction: input.instruction ?? '',
  };
}
