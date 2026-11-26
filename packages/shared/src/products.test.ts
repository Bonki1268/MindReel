import { describe, expect, it } from 'vitest';
import {
  MAX_PRODUCT_PHOTOS,
  MAX_SELLING_POINTS,
  createProductPhotoSchema,
  createProductSchema,
  makeProductSnapshot,
  productSnapshotSchema,
  updateProductSchema,
  type Product,
} from './products.js';

const valid = {
  name: '玻璃保溫杯',
  category: '居家生活',
  sellingPoints: ['雙層真空保溫 12 小時'],
};

function messageOf(input: unknown, schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { message: string }[] } } } = createProductSchema): string {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  return result.error?.issues[0]?.message ?? '';
}

describe('建立商品的欄位規則（F25）', () => {
  it('只填品名、類別、一條賣點就通過，其他欄位補成空值', () => {
    expect(createProductSchema.parse(valid)).toEqual({
      name: '玻璃保溫杯',
      brand: null,
      category: '居家生活',
      sellingPoints: ['雙層真空保溫 12 小時'],
      price: null,
      priceNote: null,
      specs: null,
      notes: null,
    });
  });

  it('品名與賣點前後的空白會被去掉', () => {
    const parsed = createProductSchema.parse({ ...valid, name: '  玻璃保溫杯  ', sellingPoints: ['  保溫 12 小時 '] });
    expect(parsed.name).toBe('玻璃保溫杯');
    expect(parsed.sellingPoints).toEqual(['保溫 12 小時']);
  });

  it.each([
    ['沒有品名', { ...valid, name: undefined }, '請填寫品名'],
    ['品名只有空白', { ...valid, name: '   ' }, '請填寫品名'],
    ['沒有類別', { ...valid, category: undefined }, '請選擇商品類別'],
    ['類別是空白', { ...valid, category: '' }, '請選擇商品類別'],
    ['沒有賣點', { ...valid, sellingPoints: [] }, '至少填寫 1 條賣點'],
    ['賣點超過 5 條', { ...valid, sellingPoints: ['1', '2', '3', '4', '5', '6'] }, `賣點最多 ${MAX_SELLING_POINTS} 條`],
    ['賣點是空白', { ...valid, sellingPoints: ['  '] }, '賣點不能是空白'],
    ['價格是負數', { ...valid, price: -1 }, '價格要是 0 以上的整數'],
    ['價格不是整數', { ...valid, price: 99.5 }, '價格要是 0 以上的整數'],
  ])('%s：回報中文說明', (_name, input, message) => {
    expect(messageOf(input)).toBe(message);
  });

  it('賣點上限是 5 條、商品照上限是 5 張', () => {
    expect(MAX_SELLING_POINTS).toBe(5);
    expect(MAX_PRODUCT_PHOTOS).toBe(5);
  });
});

describe('修改商品', () => {
  it('只改有送的欄位', () => {
    expect(updateProductSchema.parse({ price: 990 })).toEqual({ price: 990 });
  });

  it('什麼都沒送時回報沒有要修改的欄位', () => {
    expect(messageOf({}, updateProductSchema)).toBe('沒有要修改的欄位');
  });

  it('修改時賣點也不能全部清空', () => {
    expect(messageOf({ sellingPoints: [] }, updateProductSchema)).toBe('至少填寫 1 條賣點');
  });
});

describe('商品快照（影片建立時保存，之後腳本、字幕、指令都讀這份）', () => {
  const product: Product = {
    id: 'p1',
    seriesId: 's1',
    name: '玻璃保溫杯',
    brand: '山嵐',
    category: '居家生活',
    sellingPoints: ['保溫 12 小時', '食品級不鏽鋼'],
    price: 990,
    priceNote: '原價 1,280，限時 990',
    specs: '容量 500ml',
    notes: '勿放入微波爐',
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
  };

  it('帶入商品編號與所有商品資料，不含系列與時間', () => {
    expect(makeProductSnapshot(product)).toEqual({
      productId: 'p1',
      name: '玻璃保溫杯',
      brand: '山嵐',
      category: '居家生活',
      sellingPoints: ['保溫 12 小時', '食品級不鏽鋼'],
      price: 990,
      priceNote: '原價 1,280，限時 990',
      specs: '容量 500ml',
      notes: '勿放入微波爐',
    });
  });

  it('快照是複本：之後改商品的賣點陣列，不會動到快照', () => {
    const snapshot = makeProductSnapshot(product);
    product.sellingPoints.push('新賣點');
    expect(snapshot.sellingPoints).toEqual(['保溫 12 小時', '食品級不鏽鋼']);
    product.sellingPoints.pop();
  });

  it('快照通過自己的 schema', () => {
    expect(() => productSnapshotSchema.parse(makeProductSnapshot(product))).not.toThrow();
  });
});

describe('商品照', () => {
  const base = { originalAssetId: 'a1', deidentified: { mime: 'image/png', dataBase64: 'AAAA' }, deidBoxes: [] };

  it('視角可以省略、是 null，或是一個代號（是否在情境包清單裡由後端檢查）', () => {
    expect(createProductPhotoSchema.parse(base).viewKey).toBeUndefined();
    expect(createProductPhotoSchema.parse({ ...base, viewKey: null }).viewKey).toBeNull();
    expect(createProductPhotoSchema.parse({ ...base, viewKey: 'front' }).viewKey).toBe('front');
  });

  it('沒有原圖編號時回報中文說明', () => {
    expect(messageOf({ ...base, originalAssetId: undefined }, createProductPhotoSchema)).toBe('請提供原圖編號');
  });
});
