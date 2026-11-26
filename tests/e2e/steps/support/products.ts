import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';
import { assetResponseSchema, videoResponseSchema, type Product, type ProductBoard, type ProductSummary, type ProductVideoDetail } from '@templeyard/shared';
import { photoFixtureBase64 } from './api';

// 第 16 階段（商品主體、商品定裝版）情境測試共用的 API 操作（不是 step 定義）

export const PRODUCT_SERIES_INPUT = {
  visualStyle: '明亮乾淨的棚拍、柔光',
  direction: '新品上市',
  defaultImageModel: 'nano-banana-pro',
  defaultVideoModel: 'gemini-omni-1.1-flash',
  scenarioPack: 'ecommerce',
} as const;

export const PRODUCT_INPUT = {
  name: '玻璃保溫杯',
  brand: '山嵐',
  category: '居家生活',
  sellingPoints: ['雙層真空保溫 12 小時', '食品級不鏽鋼內膽'],
  price: 990,
  priceNote: '原價 1,280，限時 990',
  specs: '容量 500ml',
  notes: '勿放入微波爐',
};

/** 電商包的視角名稱 → 代號（scenario-packs/ecommerce/pack.json） */
export const PRODUCT_VIEW_KEYS: Record<string, string> = {
  正面: 'front',
  '45 度角': 'angle_45',
  背面或側面: 'back_side',
  細節特寫: 'detail',
  包裝: 'package',
  使用情境: 'in_use',
};

export function productViewKey(name: string): string {
  const key = PRODUCT_VIEW_KEYS[name];
  if (!key) throw new Error(`電商包沒有這個視角：${name}`);
  return key;
}

export async function createProductViaApi(request: APIRequestContext, seriesId: string, overrides: Record<string, unknown> = {}): Promise<Product> {
  const response = await request.post(`/api/series/${seriesId}/products`, { data: { ...PRODUCT_INPUT, ...overrides } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { product: Product }).product;
}

/** 走完原圖＋去識別圖兩個端點；回傳建立照片的回應 */
export async function uploadProductPhotoViaApi(request: APIRequestContext, productId: string, viewKey: string | null): Promise<APIResponse> {
  const original = await request.post(`/api/products/${productId}/photos/originals`, {
    data: { mime: 'image/png', dataBase64: photoFixtureBase64() },
  });
  expect(original.status()).toBe(201);
  const { asset } = assetResponseSchema.parse(await original.json());
  return request.post(`/api/products/${productId}/photos`, {
    data: { originalAssetId: asset.id, deidentified: { mime: 'image/png', dataBase64: photoFixtureBase64() }, deidBoxes: [], viewKey },
  });
}

export async function listProductsViaApi(request: APIRequestContext, seriesId: string): Promise<ProductSummary[]> {
  const response = await request.get(`/api/series/${seriesId}/products`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { products: ProductSummary[] }).products;
}

export async function createProductVideoViaApi(request: APIRequestContext, seriesId: string, productId: string) {
  return request.post('/api/videos', { data: { seriesId, productId } });
}

export async function videoIdOf(response: APIResponse): Promise<string> {
  return videoResponseSchema.parse(await response.json()).video.id;
}

export async function fetchProductVideo(request: APIRequestContext, videoId: string): Promise<ProductVideoDetail> {
  const response = await request.get(`/api/videos/${videoId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as ProductVideoDetail;
}

export async function fetchProductBoardViaApi(request: APIRequestContext, videoId: string): Promise<ProductBoard> {
  const response = await request.get(`/api/videos/${videoId}/product-board`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { board: ProductBoard }).board;
}

/** 等商品定裝版所有視角都產生完成（假的雲端第 2 次查詢就完成） */
export async function waitProductBoardReady(request: APIRequestContext, videoId: string): Promise<ProductBoard> {
  await expect
    .poll(async () => (await fetchProductBoardViaApi(request, videoId)).views.every((view) => view.state === 'ready'), { timeout: 15_000 })
    .toBe(true);
  return fetchProductBoardViaApi(request, videoId);
}

/** 同意這次的費用，回傳同意憑證 */
export async function consentForUnits(request: APIRequestContext, videoId: string, units: number): Promise<string> {
  const response = await request.post(`/api/videos/${videoId}/consents`, { data: { items: [{ model: 'nano-banana-pro', units }] } });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { consentToken: string }).consentToken;
}

/** 產生商品定裝版（同意費用後送出），等到完成 */
export async function generateProductBoardViaApi(request: APIRequestContext, videoId: string, inferredViewKeys: string[]): Promise<ProductBoard> {
  const detail = await fetchProductVideo(request, videoId);
  const viewKeys = new Set(detail.photos.map((photo) => photo.viewKey).filter((key): key is string => key !== null));
  const units = viewKeys.size + inferredViewKeys.filter((key) => !viewKeys.has(key)).length;
  const response = await request.post(`/api/videos/${videoId}/product-board/generate`, {
    data: { inferredViewKeys, consentToken: await consentForUnits(request, videoId, units) },
  });
  expect(response.status()).toBe(202);
  return waitProductBoardReady(request, videoId);
}
