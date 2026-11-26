import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { apiErrorSchema } from '@templeyard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { addProductPhoto, addProductVideo, createProductWorld, type ProductWorld } from '../productBoards/__fixtures__/productWorld.js';
import { scenarioPacksDir } from '../paths.js';
import { loadScenarioPacks } from '../scenarioPacks/load.js';

// 商品定裝版的 API 外殼：路徑、狀態碼與錯誤說明。生成流程由 productBoards/service.test.ts 與情境測試驗證。

let world: ProductWorld;
let app: FastifyInstance;
let assetsDir: string;

beforeEach(async () => {
  assetsDir = mkdtempSync(path.join(tmpdir(), 'templeyard-pboard-'));
  world = await createProductWorld();
  // 不設定生成服務：生成相關的端點回 503
  app = buildApp({ db: world.db, assetsDir, scenarioPacks: loadScenarioPacks([scenarioPacksDir]), generationUnavailableMessage: '還沒設定生成服務' });
  addProductVideo(world, { id: 'v1' });
});

afterEach(async () => {
  await app.close();
  await world.close();
  rmSync(assetsDir, { recursive: true, force: true });
});

describe('商品定裝版 API', () => {
  it('GET /api/videos/:id/product-board：還沒產生時 404，說明沒有商品定裝版', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/videos/v1/product-board' });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).message).toBe('這支影片還沒產生商品定裝版');
  });

  it('找不到影片：404', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/videos/nope/product-board/generate', payload: {} });
    expect(response.statusCode).toBe(404);
    expect(apiErrorSchema.parse(response.json()).message).toBe('找不到這支影片');
  });

  it('沒有設定生成服務時，產生回 503 並說明', async () => {
    addProductPhoto(world, { viewKey: 'front' });
    const response = await app.inject({ method: 'POST', url: '/api/videos/v1/product-board/generate', payload: {} });
    expect(response.statusCode).toBe(503);
    expect(apiErrorSchema.parse(response.json()).message).toBe('還沒設定生成服務');
  });

  it('請求格式不對：400，說明第一個欄位的錯誤', async () => {
    const response = await app.inject({ method: 'PATCH', url: '/api/videos/v1/product-board', payload: { defaultLighting: '月光' } });
    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).message).toBe('請從清單選擇光線與時段');
  });

  it('沒有確認過的版本時沿用回 409', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/videos/v1/product-board/reuse' });
    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).message).toBe('這件商品在這個系列還沒有確認過的商品定裝版');
  });
});
