import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import {
  scenarioPacksResponseSchema,
  scenarioSeriesListResponseSchema,
} from '@templeyard/shared';
import { Given, Then, When } from './fixtures';
import { createSeriesViaApi } from './support/api';

// 情境包框架與選擇情境包（第 15 階段，F23、F24）

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const brokenPacksDir = path.join(repoRoot, 'tests', 'e2e', 'fixtures', 'scenario-packs', 'broken');
const extraPacksDir = path.join(repoRoot, 'apps', 'server', 'src', 'scenarioPacks', '__fixtures__', 'extra-packs');

function requireSeriesId(state: { seriesId?: string }): string {
  if (!state.seriesId) throw new Error('這個場景還沒有建立系列');
  return state.seriesId;
}

function seriesCard(page: Page, name: string) {
  return page
    .getByRole('region', { name: '你的系列' })
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
}

// ── 首頁：建立系列時選情境包 ──

Then(/^這個系列的卡片有情境包標籤「(.+)」$/, async ({ page, state }, tag: string) => {
  const name = state.seriesName ?? '';
  await expect(seriesCard(page, name).getByRole('list', { name: `${name}的標籤` }).getByText(tag, { exact: true })).toBeVisible();
});

Then(/^「影片方向」有「(.+)」選項$/, async ({ page }, option: string) => {
  await expect(page.getByRole('group', { name: '影片方向' }).getByRole('button', { name: option, exact: true })).toBeVisible();
});

Then(/^「影片方向」沒有「(.+)」選項$/, async ({ page }, option: string) => {
  await expect(page.getByRole('group', { name: '影片方向' }).getByRole('button', { name: option, exact: true })).toHaveCount(0);
});

Then('「影片方向」沒有任何選項被選取', async ({ page }) => {
  const options = page.getByRole('group', { name: '影片方向' }).getByRole('button');
  const count = await options.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) await expect(options.nth(i)).toHaveAttribute('aria-pressed', 'false');
});

// ── 電商系列的頁面 ──

Given('我已經透過 API 建立一個電商系列', async ({ request, state }) => {
  const created = await createSeriesViaApi(request, { scenarioPack: 'ecommerce', direction: '新品上市' });
  state.seriesId = created.id;
  state.seriesName = created.name;
});

When('我打開這個系列的設定頁', async ({ page, state }) => {
  await page.goto(`/series/${requireSeriesId(state)}/settings`);
});

Then(/^系列設定頁的情境包是「(.+)」$/, async ({ page }, name: string) => {
  await expect(page.getByText(`情境包：${name}`, { exact: true })).toBeVisible();
});

Then('系列設定頁沒有可以更改情境包的選項', async ({ page }) => {
  await expect(page.getByLabel('系列名稱', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '情境包' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '電商', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '廟埕', exact: true })).toHaveCount(0);
});

Then(/^設定頁的說明提到「(.+)」$/, async ({ page }, text: string) => {
  await expect(page.getByText(text).first()).toBeVisible();
});

// ── API ──

When(/^我透過 API 建立系列，情境包是(.+)$/, async ({ request, state }, pack: string) => {
  const data: Record<string, unknown> = {
    name: `情境包系列-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    visualStyle: '寫實電影感、清晨暖光',
    direction: '歷史故事',
    defaultImageModel: 'nano-banana-pro',
    defaultVideoModel: 'gemini-omni-1.1-flash',
  };
  if (pack === '不存在的代號') data.scenarioPack = 'no-such-pack';
  else if (pack !== '省略') data.scenarioPack = pack;
  state.lastResponse = await request.post('/api/series', { data });
});

Then(/^API 回應 (\d+)，系列的情境包是「(.+)」$/, async ({ state }, status: string, pack: string) => {
  // 另外啟動的後端有自己的回應
  if (state.backendResponse) {
    expect(state.backendResponse.status).toBe(Number(status));
    expect((state.backendResponse.body as { series: { scenarioPack?: string } }).series.scenarioPack).toBe(pack);
    return;
  }
  if (!state.lastResponse) throw new Error('還沒有送出請求');
  expect(state.lastResponse.status()).toBe(Number(status));
  // 讀原始內容，不經過 schema 的預設值
  expect(((await state.lastResponse.json()) as { series: { scenarioPack?: string } }).series.scenarioPack).toBe(pack);
});

When(/^我透過 API 修改這個系列的「(.+)」$/, async ({ request, state }, field: string) => {
  state.lastResponse = await request.patch(`/api/series/${requireSeriesId(state)}`, { data: { [field]: 'temple' } });
});

Then(/^這個系列的情境包仍是「(.+)」$/, async ({ request, state }, pack: string) => {
  const response = await request.get('/api/series');
  const found = scenarioSeriesListResponseSchema.parse(await response.json()).series.find((s) => s.id === state.seriesId);
  expect(found?.scenarioPack).toBe(pack);
});

When('我透過 API 讀取情境包清單', async ({ request, state }) => {
  const response = await request.get('/api/scenario-packs');
  expect(response.status()).toBe(200);
  state.scenarioPacks = scenarioPacksResponseSchema.parse(await response.json()).scenarioPacks;
});

function packOf(state: { scenarioPacks?: { id: string }[] }, id: string) {
  const pack = state.scenarioPacks?.find((p) => p.id === id);
  if (!pack) throw new Error(`情境包清單沒有「${id}」`);
  return pack;
}

Then(
  /^情境包「(.+)」的名稱是「(.+)」、主體是「(.+)」、預設比例「(.+)」、預設長度 (\d+) 秒$/,
  async ({ state }, id: string, name: string, subject: string, ratio: string, seconds: string) => {
    const pack = packOf(state, id) as ReturnType<typeof scenarioPacksResponseSchema.parse>['scenarioPacks'][number];
    expect({ name: pack.name, subjectType: pack.subjectType, ratio: pack.defaultAspectRatio, seconds: pack.defaultDurationSec }).toEqual({
      name,
      subjectType: subject,
      ratio,
      seconds: Number(seconds),
    });
  },
);

Then(
  /^情境包「(.+)」的功能開關：腳本企劃「(開|關)」、風格題「(開|關)」、商品主鏡頭「(開|關)」$/,
  async ({ state }, id: string, scripts: string, style: string, hero: string) => {
    const pack = packOf(state, id) as ReturnType<typeof scenarioPacksResponseSchema.parse>['scenarioPacks'][number];
    const on = (text: string) => text === '開';
    expect(pack.features).toEqual({ scriptProposals: on(scripts), styleQuestion: on(style), productHero: on(hero) });
  },
);

Then(/^這支影片的主體是「(.+)」、畫面比例是「(.+)」$/, async ({ request, state }, subject: string, ratio: string) => {
  const videoId = state.videoIds?.at(-1);
  if (!videoId) throw new Error('這個場景還沒有建立影片');
  const response = await request.get(`/api/videos/${videoId}`);
  const body = (await response.json()) as { video: { subjectType?: string; aspectRatio?: string } };
  expect({ subjectType: body.video.subjectType, aspectRatio: body.video.aspectRatio }).toEqual({ subjectType: subject, aspectRatio: ratio });
});

// ── F23：另外啟動後端，用不同的情境包設定 ──

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (typeof address === 'object' && address ? resolve(address.port) : reject(new Error('找不到可用的連接埠'))));
    });
  });
}

/** 另外啟動一個後端（獨立資料夾、獨立連接埠、不連任何外部服務） */
function startBackend(extraEnv: Record<string, string>, port: number) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extraEnv };
  for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'COMFY_CLOUD_API_KEY', 'COMFY_MCP_URL']) delete env[name];
  env.TEMPLEYARD_NO_ENV_FILE = '1';
  env.API_PORT = String(port);
  env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'templeyard-e2e-'));
  const child = spawn('pnpm', ['--filter', '@templeyard/server', 'exec', 'tsx', 'src/index.ts'], {
    cwd: repoRoot,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { process: child, baseUrl: `http://127.0.0.1:${port}`, output: () => output, exited };
}

When('我用有錯誤的情境包設定啟動後端', async ({ state }) => {
  const backend = startBackend({ SCENARIO_PACKS_DIR: brokenPacksDir }, await freePort());
  state.backend = backend;
  const exitCode = await Promise.race([
    backend.exited,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 60_000)),
  ]);
  if (exitCode === 'timeout') throw new Error('後端沒有在 60 秒內結束，情境包設定錯誤時應該啟動失敗');
  state.backendStart = { exitCode, output: backend.output() };
});

Then(/^後端啟動失敗，訊息指出檔案「(.+)」與欄位「(.+)」$/, async ({ state }, file: string, field: string) => {
  if (!state.backendStart) throw new Error('還沒有啟動後端');
  expect(state.backendStart.exitCode).not.toBe(0);
  expect(state.backendStart.output).toContain(file);
  expect(state.backendStart.output).toContain(field);
});

Given(/^我用多一個「(.+)」情境包的設定啟動後端$/, async ({ state }, _pack: string) => {
  const backend = startBackend({ SCENARIO_PACKS_EXTRA_DIRS: extraPacksDir }, await freePort());
  state.backend = backend;
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(`${backend.baseUrl}/api/health`)).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe(200);
});

When(/^我在這個後端透過 API 建立情境包為「(.+)」的系列$/, async ({ state }, pack: string) => {
  if (!state.backend) throw new Error('還沒有啟動後端');
  const response = await fetch(`${state.backend.baseUrl}/api/series`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `工坊系列-${Date.now().toString(36)}`,
      visualStyle: '手作質感、暖色燈光',
      direction: '職人故事',
      defaultImageModel: 'nano-banana-pro',
      defaultVideoModel: 'gemini-omni-1.1-flash',
      scenarioPack: pack,
    }),
  });
  state.backendResponse = { status: response.status, body: await response.json() };
});

Then(/^這個後端的情境包清單有「(.+)」$/, async ({ state }, id: string) => {
  if (!state.backend) throw new Error('還沒有啟動後端');
  const response = await fetch(`${state.backend.baseUrl}/api/scenario-packs`);
  const packs = scenarioPacksResponseSchema.parse(await response.json()).scenarioPacks;
  expect(packs.map((pack) => pack.id)).toContain(id);
});
