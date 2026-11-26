import type { ScenarioPackRegistry } from '@templeyard/shared';
import { insertAsset } from '../../assets/repository.js';
import { loadScenarioPacks } from '../../scenarioPacks/load.js';
import { loadPackPrompts } from '../../scenarioPacks/prompts.js';
import { scenarioPacksDir } from '../../paths.js';
import { photos, products, series, videos } from '../../db/schema.js';
import { DEID_BYTES, ORIGINAL_BYTES, createWorld, type World } from '../../templeBoards/__fixtures__/world.js';

// 商品定裝版測試共用的環境：在寺廟定裝版的測試環境上，加一個電商系列與一件商品。
// 資料直接寫進資料表（不經過儲存層），測試的前置資料不依賴被測的程式。

export type ProductWorld = World & {
  packs: ScenarioPackRegistry;
  /** 電商系列與其中一件商品 */
  productSeriesId: string;
  productId: string;
  /** 另一個電商系列（用來驗證不同系列不能沿用） */
  otherSeriesId: string;
};

let counter = 0;

export async function createProductWorld(options: Parameters<typeof createWorld>[0] = {}): Promise<ProductWorld> {
  const world = await createWorld(options);
  for (const [id, name] of [
    ['es1', '電商系列'],
    ['es2', '另一個電商系列'],
  ] as const) {
    world.db
      .insert(series)
      .values({
        id,
        name,
        visualStyle: '明亮乾淨的棚拍、柔光',
        direction: '新品上市',
        defaultImageModel: 'nano-banana-pro',
        defaultVideoModel: 'gemini-omni-1.1-flash',
        scenarioPack: 'ecommerce',
        createdAt: 'x',
        updatedAt: 'x',
      })
      .run();
  }
  world.db
    .insert(products)
    .values({
      id: 'p1',
      seriesId: 'es1',
      name: '玻璃保溫杯',
      brand: '山嵐',
      category: '居家生活',
      sellingPoints: ['雙層真空保溫 12 小時'],
      price: 990,
      priceNote: '原價 1,280，限時 990',
      specs: '容量 500ml',
      notes: null,
      createdAt: 'x',
      updatedAt: 'x',
    })
    .run();
  return {
    ...world,
    packs: loadScenarioPacks([scenarioPacksDir]),
    // 電商包自己的指令（product-view）放在 scenario-packs/ecommerce/prompts/
    prompts: new Map([...world.prompts, ...loadPackPrompts([scenarioPacksDir])]),
    productSeriesId: 'es1',
    productId: 'p1',
    otherSeriesId: 'es2',
  };
}

/** 新增一支商品影片（模型帶入系列預設），商品快照直接寫入 */
export function addProductVideo(world: ProductWorld, input: { id: string; seriesId?: string; productId?: string; imageModel?: string }): string {
  world.db
    .insert(videos)
    .values({
      id: input.id,
      seriesId: input.seriesId ?? world.productSeriesId,
      templeId: null,
      productId: input.productId ?? world.productId,
      productSnapshot: {
        productId: input.productId ?? world.productId,
        name: '玻璃保溫杯',
        brand: '山嵐',
        category: '居家生活',
        sellingPoints: ['雙層真空保溫 12 小時'],
        price: 990,
        priceNote: '原價 1,280，限時 990',
        specs: '容量 500ml',
        notes: null,
      },
      subjectType: 'product',
      aspectRatio: '9:16',
      stage: 'creating',
      imageModel: input.imageModel ?? 'nano-banana-pro',
      videoModel: 'gemini-omni-1.1-flash',
      createdAt: 'x',
      updatedAt: 'x',
    })
    .run();
  return input.id;
}

/** 新增一張商品照：原圖與去識別圖分開存（內容不同），回傳照片與兩個資產編號 */
export function addProductPhoto(world: ProductWorld, input: { viewKey: string | null; productId?: string; seriesId?: string }) {
  counter += 1;
  const originalId = `p-original-${counter}`;
  const deidId = `p-deid-${counter}`;
  const original = world.store.save({ id: originalId, kind: 'original_photo', mime: 'image/png', bytes: ORIGINAL_BYTES });
  insertAsset(world.db, { id: originalId, kind: 'original_photo', mime: 'image/png', path: original.path, sha256: original.sha256 });
  const deid = world.store.save({ id: deidId, kind: 'deid_photo', mime: 'image/png', bytes: DEID_BYTES });
  insertAsset(world.db, { id: deidId, kind: 'deid_photo', mime: 'image/png', path: deid.path, sha256: deid.sha256 });
  const id = `product-photo-${counter}`;
  world.db
    .insert(photos)
    .values({
      id,
      seriesId: input.seriesId ?? world.productSeriesId,
      templeId: null,
      productId: input.productId ?? world.productId,
      videoId: null,
      originalAssetId: originalId,
      deidentifiedAssetId: deidId,
      viewKey: input.viewKey,
      deidBoxes: [],
      createdAt: `2026-11-26T09:00:${String(counter).padStart(2, '0')}.000Z`,
    })
    .run();
  return { photoId: id, originalAssetId: originalId, deidAssetId: deidId, originalSha256: original.sha256, deidSha256: deid.sha256 };
}
