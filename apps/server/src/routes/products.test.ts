import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  apiErrorSchema,
  assetResponseSchema,
  productDetailResponseSchema,
  productListResponseSchema,
  productResponseSchema,
  scenarioSeriesResponseSchema,
} from '@templeyard/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase, type AppDatabase } from '../db/client.js';
import { assets, photos } from '../db/schema.js';
import { scenarioPacksDir } from '../paths.js';
import { loadScenarioPacks } from '../scenarioPacks/load.js';
import type { Clock } from '../series/repository.js';

// 商品主體的 API（F25）：商品、商品照、必填檢查

const ORIGINAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DEID_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function fixedClock(): Clock {
  let minutes = 0;
  let id = 0;
  return { now: () => new Date(Date.UTC(2026, 10, 26, 9, minutes++)), newId: () => `id-${++id}` };
}

let app: FastifyInstance | undefined;
let db: AppDatabase | undefined;
let assetsDir = '';

function currentApp(): FastifyInstance {
  if (!app) throw new Error('app 沒有建立');
  return app;
}
function currentDb(): AppDatabase {
  if (!db) throw new Error('資料庫沒有建立');
  return db;
}

beforeEach(() => {
  assetsDir = mkdtempSync(path.join(tmpdir(), 'templeyard-products-'));
  db = openDatabase(':memory:');
  app = buildApp({ db, clock: fixedClock(), assetsDir, scenarioPacks: loadScenarioPacks([scenarioPacksDir]) });
});

afterEach(async () => {
  await app?.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

const seriesInput = {
  name: '新品短影音',
  visualStyle: '明亮乾淨的棚拍、柔光',
  direction: '新品上市',
  defaultImageModel: 'nano-banana-pro',
  defaultVideoModel: 'gemini-omni-1.1-flash',
};

async function createSeries(pack: 'ecommerce' | 'temple' = 'ecommerce'): Promise<string> {
  const response = await currentApp().inject({
    method: 'POST',
    url: '/api/series',
    payload: { ...seriesInput, scenarioPack: pack, ...(pack === 'temple' ? { direction: '歷史故事' } : {}) },
  });
  return scenarioSeriesResponseSchema.parse(response.json()).series.id;
}

const productInput = {
  name: '玻璃保溫杯',
  brand: '山嵐',
  category: '居家生活',
  sellingPoints: ['雙層真空保溫 12 小時', '食品級不鏽鋼內膽'],
  price: 990,
  priceNote: '原價 1,280，限時 990',
  specs: '容量 500ml',
  notes: '勿放入微波爐',
};

async function createProduct(seriesId: string, payload: Record<string, unknown> = {}) {
  return currentApp().inject({ method: 'POST', url: `/api/series/${seriesId}/products`, payload: { ...productInput, ...payload } });
}

async function productIdOf(seriesId: string): Promise<string> {
  return productResponseSchema.parse((await createProduct(seriesId)).json()).product.id;
}

async function uploadPhoto(productId: string, extra: Record<string, unknown> = {}) {
  const original = await currentApp().inject({
    method: 'POST',
    url: `/api/products/${productId}/photos/originals`,
    payload: { mime: 'image/png', dataBase64: ORIGINAL_PNG },
  });
  expect(original.statusCode).toBe(201);
  const asset = assetResponseSchema.parse(original.json()).asset;
  return {
    asset,
    response: await currentApp().inject({
      method: 'POST',
      url: `/api/products/${productId}/photos`,
      payload: { originalAssetId: asset.id, deidentified: { mime: 'image/png', dataBase64: DEID_PNG }, deidBoxes: [], ...extra },
    }),
  };
}

describe('POST /api/series/:id/products（建立商品）', () => {
  it('品名、類別、賣點填好就建立，其他欄位照填的存', async () => {
    const seriesId = await createSeries();

    const response = await createProduct(seriesId);

    expect(response.statusCode).toBe(201);
    expect(productResponseSchema.parse(response.json()).product).toMatchObject({ seriesId, ...productInput });
  });

  it.each([
    ['沒有品名', { name: '' }, 'name', '請填寫品名'],
    ['沒有類別', { category: '' }, 'category', '請選擇商品類別'],
    ['類別不在電商包的清單', { category: '玩具' }, 'category', '這個類別不在電商包的清單裡'],
    ['沒有賣點', { sellingPoints: [] }, 'sellingPoints', '至少填寫 1 條賣點'],
    ['賣點超過 5 條', { sellingPoints: ['1', '2', '3', '4', '5', '6'] }, 'sellingPoints', '賣點最多 5 條'],
  ])('%s：400，說明哪一欄不對，不建立商品', async (_name, override, field, message) => {
    const seriesId = await createSeries();

    const response = await createProduct(seriesId, override);

    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).fieldErrors?.[field]).toBe(message);
    const list = await currentApp().inject({ method: 'GET', url: `/api/series/${seriesId}/products` });
    expect(productListResponseSchema.parse(list.json()).products).toEqual([]);
  });

  it('廟埕系列不能建立商品：409', async () => {
    const seriesId = await createSeries('temple');

    const response = await createProduct(seriesId);

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).message).toBe('只有電商系列可以建立商品');
  });

  it('找不到系列：404', async () => {
    const response = await createProduct('no-such-series');
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).message).toBe('找不到這個系列');
  });
});

describe('商品清單、讀取、修改', () => {
  it('清單只列這個系列的商品，帶照片張數；沒有確認過的定裝版時 boardConfirmed 是 false', async () => {
    const seriesId = await createSeries();
    const otherSeries = await createSeries();
    const productId = await productIdOf(seriesId);
    await productIdOf(otherSeries);
    await uploadPhoto(productId, { viewKey: 'front' });

    const response = await currentApp().inject({ method: 'GET', url: `/api/series/${seriesId}/products` });

    const { products } = productListResponseSchema.parse(response.json());
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({ id: productId, name: '玻璃保溫杯', photoCount: 1, boardConfirmed: false });
  });

  it('GET /api/products/:pid：商品與商品照', async () => {
    const productId = await productIdOf(await createSeries());
    await uploadPhoto(productId, { viewKey: 'front' });

    const response = await currentApp().inject({ method: 'GET', url: `/api/products/${productId}` });

    const detail = productDetailResponseSchema.parse(response.json());
    expect(detail.product.id).toBe(productId);
    expect(detail.photos).toHaveLength(1);
    expect(detail.photos[0]).toMatchObject({ productId, viewKey: 'front', videoId: null });
  });

  it('找不到商品：404', async () => {
    const response = await currentApp().inject({ method: 'GET', url: '/api/products/nope' });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).message).toBe('找不到這件商品');
  });

  it('PATCH 只改有送的欄位，更新時間跟著變', async () => {
    const productId = await productIdOf(await createSeries());

    const response = await currentApp().inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: { price: 790, priceNote: '特價 790' } });

    expect(response.statusCode).toBe(200);
    const { product } = productResponseSchema.parse(response.json());
    expect(product).toMatchObject({ ...productInput, price: 790, priceNote: '特價 790' });
    expect(product.updatedAt).not.toBe(product.createdAt);
  });

  it('PATCH 的類別也要在電商包的清單裡；賣點不能清空；不能沒有要修改的欄位', async () => {
    const productId = await productIdOf(await createSeries());
    const patch = (payload: Record<string, unknown>) => currentApp().inject({ method: 'PATCH', url: `/api/products/${productId}`, payload });

    expect(apiErrorSchema.parse((await patch({ category: '玩具' })).json()).fieldErrors?.category).toBe('這個類別不在電商包的清單裡');
    expect(apiErrorSchema.parse((await patch({ sellingPoints: [] })).json()).fieldErrors?.sellingPoints).toBe('至少填寫 1 條賣點');
    expect((await patch({})).statusCode).toBe(400);
  });
});

describe('商品照（沿用 F4 的去識別流程）', () => {
  it('原圖只存本機（cloud_ok = 0）；去識別後的照片可以上雲（cloud_ok = 1）', async () => {
    const productId = await productIdOf(await createSeries());

    const { asset, response } = await uploadPhoto(productId, { viewKey: 'front' });

    expect(response.statusCode).toBe(201);
    const photo = (response.json() as { photo: { originalAssetId: string; deidentifiedAssetId: string } }).photo;
    expect(photo.originalAssetId).toBe(asset.id);
    const original = currentDb().select().from(assets).where(eq(assets.id, photo.originalAssetId)).get();
    const deid = currentDb().select().from(assets).where(eq(assets.id, photo.deidentifiedAssetId)).get();
    expect(original).toMatchObject({ kind: 'original_photo', cloudOk: false });
    expect(deid).toMatchObject({ kind: 'deid_photo', cloudOk: true });
  });

  it('照片存成這件商品的照片：product_id 有值、temple_id 沒有', async () => {
    const productId = await productIdOf(await createSeries());

    await uploadPhoto(productId);

    const row = currentDb().select().from(photos).get();
    expect(row).toMatchObject({ productId, templeId: null, videoId: null });
  });

  it('視角要在電商包的清單裡；沒有指定視角也可以', async () => {
    const productId = await productIdOf(await createSeries());

    const bad = await uploadPhoto(productId, { viewKey: 'front_overview' });
    const none = await uploadPhoto(productId, { viewKey: null });

    expect(bad.response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(bad.response.json()).fieldErrors?.viewKey).toBe('請從清單選擇視角');
    expect(none.response.statusCode).toBe(201);
  });

  it('每件商品最多 5 張，第 6 張回 409', async () => {
    const productId = await productIdOf(await createSeries());
    for (let i = 0; i < 5; i += 1) expect((await uploadPhoto(productId)).response.statusCode).toBe(201);

    const sixth = await uploadPhoto(productId);

    expect(sixth.response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(sixth.response.json()).message).toBe('每件商品最多 5 張照片');
  });

  it('另一件商品的照片數不影響這件', async () => {
    const seriesId = await createSeries();
    const first = await productIdOf(seriesId);
    const second = await productIdOf(seriesId);
    for (let i = 0; i < 5; i += 1) await uploadPhoto(first);

    expect((await uploadPhoto(second)).response.statusCode).toBe(201);
  });

  it('PATCH 改視角；視角不在清單裡回 400；別件商品的照片 404', async () => {
    const seriesId = await createSeries();
    const productId = await productIdOf(seriesId);
    const otherProduct = await productIdOf(seriesId);
    const photoId = ((await uploadPhoto(productId)).response.json() as { photo: { id: string } }).photo.id;

    const changed = await currentApp().inject({ method: 'PATCH', url: `/api/products/${productId}/photos/${photoId}`, payload: { viewKey: 'detail' } });
    const bad = await currentApp().inject({ method: 'PATCH', url: `/api/products/${productId}/photos/${photoId}`, payload: { viewKey: 'courtyard' } });
    const wrong = await currentApp().inject({ method: 'PATCH', url: `/api/products/${otherProduct}/photos/${photoId}`, payload: { viewKey: 'detail' } });

    expect(changed.statusCode).toBe(200);
    expect((changed.json() as { photo: { viewKey: string } }).photo.viewKey).toBe('detail');
    expect(bad.statusCode).toBe(400);
    expect(wrong.statusCode).toBe(404);
  });

  it('照片內容和格式不符：400，不存檔', async () => {
    const productId = await productIdOf(await createSeries());

    const response = await currentApp().inject({
      method: 'POST',
      url: `/api/products/${productId}/photos/originals`,
      payload: { mime: 'image/jpeg', dataBase64: ORIGINAL_PNG },
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).message).toBe('照片內容和格式不符');
  });
});
