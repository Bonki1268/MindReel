import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  NO_PRODUCT_PHOTO_MESSAGE,
  PRODUCT_SERIES_MISMATCH_MESSAGE,
  apiErrorSchema,
  productResponseSchema,
  productVideoDetailResponseSchema,
  scenarioSeriesResponseSchema,
  scenarioVideoResponseSchema,
  seriesVideosResponseSchema,
} from '@templeyard/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase, type AppDatabase } from '../db/client.js';
import { videos } from '../db/schema.js';
import { scenarioPacksDir } from '../paths.js';
import { loadScenarioPacks } from '../scenarioPacks/load.js';
import type { Clock } from '../series/repository.js';

// 電商影片：用同系列的商品建立影片（F25），影片保存商品快照

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
  assetsDir = mkdtempSync(path.join(tmpdir(), 'templeyard-pvideos-'));
  db = openDatabase(':memory:');
  app = buildApp({ db, clock: fixedClock(), assetsDir, scenarioPacks: loadScenarioPacks([scenarioPacksDir]) });
});

afterEach(async () => {
  await app?.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

async function createSeries(pack: 'ecommerce' | 'temple' = 'ecommerce'): Promise<string> {
  const response = await currentApp().inject({
    method: 'POST',
    url: '/api/series',
    payload: {
      name: '新品短影音',
      visualStyle: '明亮乾淨的棚拍、柔光',
      direction: pack === 'temple' ? '歷史故事' : '新品上市',
      defaultImageModel: 'nano-banana-pro',
      defaultVideoModel: 'seedance-2.0',
      scenarioPack: pack,
    },
  });
  return scenarioSeriesResponseSchema.parse(response.json()).series.id;
}

async function createProduct(seriesId: string, override: Record<string, unknown> = {}): Promise<string> {
  const response = await currentApp().inject({
    method: 'POST',
    url: `/api/series/${seriesId}/products`,
    payload: { name: '玻璃保溫杯', category: '居家生活', sellingPoints: ['保溫 12 小時'], price: 990, priceNote: '限時 990', ...override },
  });
  return productResponseSchema.parse(response.json()).product.id;
}

async function addPhoto(productId: string): Promise<void> {
  const original = await currentApp().inject({
    method: 'POST',
    url: `/api/products/${productId}/photos/originals`,
    payload: { mime: 'image/png', dataBase64: ORIGINAL_PNG },
  });
  const originalAssetId = (original.json() as { asset: { id: string } }).asset.id;
  const photo = await currentApp().inject({
    method: 'POST',
    url: `/api/products/${productId}/photos`,
    payload: { originalAssetId, deidentified: { mime: 'image/png', dataBase64: DEID_PNG }, deidBoxes: [], viewKey: 'front' },
  });
  expect(photo.statusCode).toBe(201);
}

function createVideo(payload: Record<string, unknown>) {
  return currentApp().inject({ method: 'POST', url: '/api/videos', payload });
}

describe('POST /api/videos（電商系列用商品建立影片）', () => {
  it('商品有照片：建立商品影片，主體是商品、比例用電商包的預設 9:16，模型帶入系列預設', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);

    const response = await createVideo({ seriesId, productId });

    expect(response.statusCode).toBe(201);
    expect(scenarioVideoResponseSchema.parse(response.json()).video).toMatchObject({
      seriesId,
      productId,
      subjectType: 'product',
      aspectRatio: '9:16',
      stage: 'creating',
      imageModel: 'nano-banana-pro',
      videoModel: 'seedance-2.0',
      modelsLockedAt: null,
      productBoardVersionId: null,
    });
  });

  it('影片保存建立當下的商品資料（快照）', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);

    const video = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;

    expect(video.productSnapshot).toEqual({
      productId,
      name: '玻璃保溫杯',
      brand: null,
      category: '居家生活',
      sellingPoints: ['保溫 12 小時'],
      price: 990,
      priceNote: '限時 990',
      specs: null,
      notes: null,
    });
  });

  it('商品還沒有照片：409，不建立影片', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);

    const response = await createVideo({ seriesId, productId });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).message).toBe(NO_PRODUCT_PHOTO_MESSAGE);
    expect(currentDb().select().from(videos).all()).toEqual([]);
  });

  it('商品不屬於這個系列：409，不建立影片', async () => {
    const seriesId = await createSeries();
    const otherSeries = await createSeries();
    const productId = await createProduct(otherSeries);
    await addPhoto(productId);

    const response = await createVideo({ seriesId, productId });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).message).toBe(PRODUCT_SERIES_MISMATCH_MESSAGE);
    expect(currentDb().select().from(videos).all()).toEqual([]);
  });

  it('找不到商品：404', async () => {
    const seriesId = await createSeries();

    const response = await createVideo({ seriesId, productId: 'nope' });

    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).message).toBe('找不到這件商品');
  });

  it('同系列的第二支影片可以用同一件商品：商品只有一件，兩支影片各有快照', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);

    const first = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;
    const second = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;

    expect(second.id).not.toBe(first.id);
    expect(second.productId).toBe(productId);
    const list = await currentApp().inject({ method: 'GET', url: `/api/series/${seriesId}/products` });
    expect((list.json() as { products: unknown[] }).products).toHaveLength(1);
  });
});

describe('修改商品只影響之後新增的影片', () => {
  it('修改商品後，既有影片的 product_snapshot 不變，新影片帶入新值', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);
    const before = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;

    await currentApp().inject({ method: 'PATCH', url: `/api/products/${productId}`, payload: { name: '新款玻璃保溫杯', price: 790, sellingPoints: ['保溫 24 小時'] } });
    const after = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;

    const stored = currentDb().select().from(videos).where(eq(videos.id, before.id)).get();
    expect(stored?.productSnapshot).toEqual(before.productSnapshot);
    expect(stored?.productSnapshot).toMatchObject({ name: '玻璃保溫杯', price: 990, sellingPoints: ['保溫 12 小時'] });
    expect(after.productSnapshot).toMatchObject({ name: '新款玻璃保溫杯', price: 790, sellingPoints: ['保溫 24 小時'] });
  });
});

describe('GET /api/videos/:id（商品影片）', () => {
  it('回傳影片、商品快照、商品照；沒有寺廟，也沒有可以沿用的定裝版', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);
    const video = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;

    const response = await currentApp().inject({ method: 'GET', url: `/api/videos/${video.id}` });

    expect(response.statusCode).toBe(200);
    const detail = productVideoDetailResponseSchema.parse(response.json());
    expect(detail.video.id).toBe(video.id);
    expect(detail.product).toEqual(video.productSnapshot);
    expect(detail.photos).toHaveLength(1);
    expect(detail.photos[0]).toMatchObject({ productId, viewKey: 'front' });
    expect(detail.temple).toBeNull();
    expect(detail.reusableBoard).toBeNull();
  });

  it('商品影片的模型在鎖定前可以改，圖片模型要在清單裡', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);
    const video = scenarioVideoResponseSchema.parse((await createVideo({ seriesId, productId })).json()).video;

    const response = await currentApp().inject({ method: 'PATCH', url: `/api/videos/${video.id}`, payload: { videoModel: 'wan-2.2' } });

    expect(response.statusCode).toBe(200);
    expect(scenarioVideoResponseSchema.parse(response.json()).video.videoModel).toBe('wan-2.2');
  });
});

describe('系列的影片列表', () => {
  it('商品影片也列在系列的影片裡，標題用品名', async () => {
    const seriesId = await createSeries();
    const productId = await createProduct(seriesId);
    await addPhoto(productId);
    await createVideo({ seriesId, productId });

    const response = await currentApp().inject({ method: 'GET', url: `/api/series/${seriesId}/videos` });

    const { videos: list } = seriesVideosResponseSchema.parse(response.json());
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toContain('玻璃保溫杯');
  });
});
