import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRODUCT_LIGHTING,
  PRODUCT_LIGHTING_OPTIONS,
  generateProductBoardSchema,
  planProductViews,
  updateProductBoardSchema,
} from './productBoards.js';

const VIEWS = [
  { key: 'front', name: '正面' },
  { key: 'angle_45', name: '45 度角' },
  { key: 'back_side', name: '背面或側面' },
  { key: 'detail', name: '細節特寫' },
  { key: 'package', name: '包裝' },
  { key: 'in_use', name: '使用情境' },
];

describe('規劃商品定裝版的視角（F26）', () => {
  it('有照片的視角依照片，順序同情境包的視角清單', () => {
    const planned = planProductViews(
      [
        { id: 'p2', viewKey: 'detail' },
        { id: 'p1', viewKey: 'front' },
      ],
      [],
      VIEWS,
    );
    expect(planned).toEqual([
      { key: 'front', name: '正面', source: 'photo', photoIds: ['p1'] },
      { key: 'detail', name: '細節特寫', source: 'photo', photoIds: ['p2'] },
    ]);
  });

  it('缺少照片、使用者選了讓 AI 推測的視角為 AI 推測；其他缺少的視角不產生', () => {
    const planned = planProductViews([{ id: 'p1', viewKey: 'front' }], ['angle_45', 'in_use'], VIEWS);
    expect(planned.map((view) => [view.key, view.source])).toEqual([
      ['front', 'photo'],
      ['angle_45', 'ai_inferred'],
      ['in_use', 'ai_inferred'],
    ]);
  });

  it('已有照片的視角即使被選了 AI 推測，仍依照片', () => {
    const planned = planProductViews([{ id: 'p1', viewKey: 'front' }], ['front'], VIEWS);
    expect(planned).toEqual([{ key: 'front', name: '正面', source: 'photo', photoIds: ['p1'] }]);
  });

  it('不在清單裡的照片視角與推測視角都忽略；沒有指定視角的照片不產生視角', () => {
    const planned = planProductViews(
      [
        { id: 'p1', viewKey: null },
        { id: 'p2', viewKey: 'front_overview' },
      ],
      ['custom_gate'],
      VIEWS,
    );
    expect(planned).toEqual([]);
  });

  it('同一個視角有多張照片時全部列入，第一張排最前面', () => {
    const planned = planProductViews(
      [
        { id: 'p1', viewKey: 'front' },
        { id: 'p2', viewKey: 'front' },
      ],
      [],
      VIEWS,
    );
    expect(planned[0]?.photoIds).toEqual(['p1', 'p2']);
  });
});

describe('商品定裝版的請求格式', () => {
  it('產生時不帶 AI 推測的視角就是空陣列', () => {
    expect(generateProductBoardSchema.parse({})).toEqual({ inferredViewKeys: [] });
  });

  it('光線預設是攝影棚柔光，選項與預設值一致', () => {
    expect(DEFAULT_PRODUCT_LIGHTING).toBe('攝影棚柔光');
    expect(PRODUCT_LIGHTING_OPTIONS).toContain(DEFAULT_PRODUCT_LIGHTING);
  });

  it('光線只能選清單裡的', () => {
    const result = updateProductBoardSchema.safeParse({ defaultLighting: '月光' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('請從清單選擇光線與時段');
  });

  it('外觀規範最多 10 條，每條不能是空白', () => {
    expect(updateProductBoardSchema.safeParse({ appearanceLocks: ['  '] }).success).toBe(false);
    expect(updateProductBoardSchema.safeParse({ appearanceLocks: Array.from({ length: 11 }, () => 'matte black') }).success).toBe(false);
    expect(updateProductBoardSchema.parse({ appearanceLocks: ['matte black body'] })).toEqual({ appearanceLocks: ['matte black body'] });
  });
});
