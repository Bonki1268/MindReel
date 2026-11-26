import { expect } from '@playwright/test';
import { Given, Then, When } from './fixtures';
import { createSeriesViaApi } from './support/api';
import {
  PRODUCT_INPUT,
  PRODUCT_SERIES_INPUT,
  createProductVideoViaApi,
  createProductViaApi,
  fetchProductBoardViaApi,
  fetchProductVideo,
  generateProductBoardViaApi,
  listProductsViaApi,
  productViewKey,
  uploadProductPhotoViaApi,
  videoIdOf,
} from './support/products';

// 商品主體、商品定裝版（第 16 階段，F25、F26）

type ProductState = { productId?: string; otherSeriesId?: string };

// 場景共用的 state 型別在第 15 階段之前就定了；商品用的狀態另外放，不動既有的 fixtures
const extras = new WeakMap<object, ProductState>();
function productState(state: object): ProductState {
  let found = extras.get(state);
  if (!found) {
    found = {};
    extras.set(state, found);
  }
  return found;
}

function requireSeriesId(state: { seriesId?: string }): string {
  if (!state.seriesId) throw new Error('這個場景還沒有建立系列');
  return state.seriesId;
}
function requireProductId(state: object): string {
  const id = productState(state).productId;
  if (!id) throw new Error('這個場景還沒有建立商品');
  return id;
}
function requireVideoId(state: { videoIds?: string[] }, index = -1): string {
  const id = state.videoIds?.at(index);
  if (!id) throw new Error('這個場景還沒有建立影片');
  return id;
}

// ── 商品與商品照 ──

Given(/^我已經透過 API 建立商品「([^」]+)」$/, async ({ request, state }, name: string) => {
  const product = await createProductViaApi(request, requireSeriesId(state), { name });
  productState(state).productId = product.id;
});

Given(/^我已經透過 API 建立商品「([^」]+)」並上傳商品照，視角是「(.*)」$/, async ({ request, state }, name: string, views: string) => {
  const product = await createProductViaApi(request, requireSeriesId(state), { name });
  productState(state).productId = product.id;
  const names = views.split('、').filter(Boolean);
  for (const viewName of names) expect((await uploadProductPhotoViaApi(request, product.id, productViewKey(viewName))).status()).toBe(201);
});

When(/^我透過 API 建立商品，但(.+)$/, async ({ request, state }, situation: string) => {
  const data: Record<string, unknown> = { ...PRODUCT_INPUT };
  switch (situation) {
    case '沒有品名':
      data.name = '';
      break;
    case '沒有類別':
      data.category = '';
      break;
    case '類別不在電商包的清單':
      data.category = '玩具';
      break;
    case '沒有賣點':
      data.sellingPoints = [];
      break;
    case '賣點超過 5 條':
      data.sellingPoints = ['1', '2', '3', '4', '5', '6'];
      break;
    default:
      throw new Error(`沒有這個情況：${situation}`);
  }
  state.lastResponse = await request.post(`/api/series/${requireSeriesId(state)}/products`, { data });
});

When('我透過 API 在這個系列建立商品', async ({ request, state }) => {
  state.lastResponse = await request.post(`/api/series/${requireSeriesId(state)}/products`, { data: PRODUCT_INPUT });
});

When(/^我透過 API 為這件商品上傳 (\d+) 張商品照$/, async ({ request, state }, count: string) => {
  for (let i = 0; i < Number(count); i += 1) state.lastResponse = await uploadProductPhotoViaApi(request, requireProductId(state), null);
});

Then('這個系列沒有任何商品', async ({ request, state }) => {
  expect(await listProductsViaApi(request, requireSeriesId(state))).toEqual([]);
});

Then(/^這個系列有 (\d+) 件商品$/, async ({ request, state }, count: string) => {
  expect(await listProductsViaApi(request, requireSeriesId(state))).toHaveLength(Number(count));
});

Then(/^這件商品有 (\d+) 張商品照$/, async ({ request, state }, count: string) => {
  const products = await listProductsViaApi(request, requireSeriesId(state));
  expect(products.find((product) => product.id === requireProductId(state))?.photoCount).toBe(Number(count));
});

When(/^我透過 API 把這件商品的品名改成「(.+)」、價格說明改成「(.+)」$/, async ({ request, state }, name: string, note: string) => {
  const response = await request.patch(`/api/products/${requireProductId(state)}`, { data: { name, priceNote: note } });
  expect(response.status()).toBe(200);
});

// ── 商品影片 ──

When('我透過 API 用這件商品建立影片', async ({ request, state }) => {
  const response = await createProductVideoViaApi(request, requireSeriesId(state), requireProductId(state));
  state.lastResponse = response;
  if (response.status() === 201) state.videoIds = [...(state.videoIds ?? []), await videoIdOf(response)];
});

When('我透過 API 在另一個電商系列用這件商品建立影片', async ({ request, state }) => {
  const other = await createSeriesViaApi(request, PRODUCT_SERIES_INPUT);
  productState(state).otherSeriesId = other.id;
  state.lastResponse = await createProductVideoViaApi(request, other.id, requireProductId(state));
});

Then(/^這支影片的商品快照品名是「(.+)」、價格說明是「(.+)」$/, async ({ request, state }, name: string, note: string) => {
  const detail = await fetchProductVideo(request, requireVideoId(state));
  expect({ name: detail.product.name, priceNote: detail.product.priceNote }).toEqual({ name, priceNote: note });
});

Then(/^第 (\d+) 支影片的商品快照品名(仍是|是)「(.+)」、價格說明是「(.+)」$/, async ({ request, state }, nth: string, _word: string, name: string, note: string) => {
  const detail = await fetchProductVideo(request, requireVideoId(state, Number(nth) - 1));
  expect({ name: detail.product.name, priceNote: detail.product.priceNote }).toEqual({ name, priceNote: note });
});

Then('兩支影片使用同一件商品', async ({ request, state }) => {
  const first = await fetchProductVideo(request, requireVideoId(state, 0));
  const second = await fetchProductVideo(request, requireVideoId(state, 1));
  expect(first.video.productId).toBe(requireProductId(state));
  expect(second.video.productId).toBe(first.video.productId);
});

// ── 商品定裝版 ──

When(/^我透過 API 產生商品定裝版，讓 AI 推測「(.*)」$/, async ({ request, state }, inferred: string) => {
  const keys = inferred.split('、').filter(Boolean).map(productViewKey);
  await generateProductBoardViaApi(request, requireVideoId(state), keys);
});

When('我透過 API 產生商品定裝版，但沒有同意憑證', async ({ request, state }) => {
  state.lastResponse = await request.post(`/api/videos/${requireVideoId(state)}/product-board/generate`, { data: { inferredViewKeys: [] } });
});

Then(/^商品定裝版的視角來源依序是「(.+)」$/, async ({ request, state }, expected: string) => {
  const board = await fetchProductBoardViaApi(request, requireVideoId(state));
  const label = (source: string) => (source === 'photo' ? '依照片' : 'AI 推測');
  expect(board.views.map((view) => `${view.viewName}=${label(view.source)}`).join('、')).toBe(expected);
});

Then(/^這支商品影片的模型(還沒有|已經)鎖定$/, async ({ request, state }, which: string) => {
  const detail = await fetchProductVideo(request, requireVideoId(state));
  if (which === '還沒有') expect(detail.video.modelsLockedAt).toBeNull();
  else expect(detail.video.modelsLockedAt).not.toBeNull();
});

Then('這支影片的商品定裝版已確認', async ({ request, state }) => {
  const videoId = requireVideoId(state);
  await expect.poll(async () => (await fetchProductBoardViaApi(request, videoId)).version.confirmedAt).not.toBeNull();
  expect((await fetchProductVideo(request, videoId)).video.stage).toBe('chat');
});

When('我透過 API 確認這支影片的商品定裝版', async ({ request, state }) => {
  const response = await request.post(`/api/videos/${requireVideoId(state)}/product-board/confirm`);
  expect(response.status()).toBe(200);
});

When('我透過 API 沿用這件商品的定裝版', async ({ request, state }) => {
  state.lastResponse = await request.post(`/api/videos/${requireVideoId(state)}/product-board/reuse`);
});

Then('兩支影片使用同一版商品定裝版', async ({ request, state }) => {
  const first = await fetchProductBoardViaApi(request, requireVideoId(state, 0));
  const second = await fetchProductBoardViaApi(request, requireVideoId(state, 1));
  expect(second.version.id).toBe(first.version.id);
});

When(/^我透過 API 為第 (\d+) 支影片另存商品定裝版新版本$/, async ({ request, state }, nth: string) => {
  const response = await request.post(`/api/videos/${requireVideoId(state, Number(nth) - 1)}/product-board/versions`);
  expect(response.status()).toBe(201);
});

Then('第 1 支影片使用商品定裝版第 2 版，第 2 支影片仍使用第 1 版', async ({ request, state }) => {
  expect((await fetchProductBoardViaApi(request, requireVideoId(state, 0))).version.version).toBe(2);
  expect((await fetchProductBoardViaApi(request, requireVideoId(state, 1))).version.version).toBe(1);
});

// ── 頁面 ──

When('我打開這件商品的資料頁', async ({ page, state }) => {
  await page.goto(`/series/${requireSeriesId(state)}/products/${requireProductId(state)}`);
});

When('我打開這支影片的商品定裝版頁', async ({ page, state }) => {
  await page.goto(`/videos/${requireVideoId(state)}/product-board`);
});

Then(/^我看不到「(.+)」$/, async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toHaveCount(0);
});
