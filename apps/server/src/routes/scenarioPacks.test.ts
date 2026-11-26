import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import {
  PRODUCT_VIDEO_NOT_READY_MESSAGE,
  SCENARIO_PACK_LOCKED_MESSAGE,
  SCENARIO_PACK_NOT_FOUND_MESSAGE,
  apiErrorSchema,
  scenarioPacksResponseSchema,
  scenarioSeriesListResponseSchema,
  scenarioSeriesResponseSchema,
  scenarioVideoResponseSchema,
} from '@templeyard/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/client.js';
import { scenarioPacksDir } from '../paths.js';
import type { Clock } from '../series/repository.js';
import { loadScenarioPacks } from '../scenarioPacks/load.js';
import { importTemples } from '../temples/import.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sampleCsv = readFileSync(path.join(here, '..', 'temples', '__fixtures__', 'temples-sample.csv'), 'utf8');
const extraPacksDir = path.join(here, '..', 'scenarioPacks', '__fixtures__', 'extra-packs');
const TEMPLE_A = 'A0000000-0000-0000-0000-000000000001';

function fixedClock(): Clock {
  let minutes = 0;
  let id = 0;
  return {
    now: () => new Date(Date.UTC(2026, 10, 26, 9, minutes++)),
    newId: () => `id-${++id}`,
  };
}

const baseInput = {
  name: '新北廟宇故事',
  visualStyle: '寫實電影感、清晨暖光、淺景深',
  direction: '歷史故事',
  defaultImageModel: 'nano-banana-pro',
  defaultVideoModel: 'seedance-2.0',
};

let app: FastifyInstance | undefined;

function currentApp(): FastifyInstance {
  if (!app) throw new Error('app 沒有建立');
  return app;
}

function start(dirs: string[] = [scenarioPacksDir]) {
  const db = openDatabase(':memory:');
  importTemples(db, sampleCsv);
  app = buildApp({ db, clock: fixedClock(), scenarioPacks: loadScenarioPacks(dirs) });
}

beforeEach(() => start());

afterEach(async () => {
  await app?.close();
  app = undefined;
});

function postSeries(payload: Record<string, unknown>) {
  return currentApp().inject({ method: 'POST', url: '/api/series', payload: { ...baseInput, ...payload } });
}

describe('GET /api/scenario-packs', () => {
  it('列出廟埕與電商：名稱、用詞、方向、預設比例與長度、功能開關', async () => {
    const response = await currentApp().inject({ method: 'GET', url: '/api/scenario-packs' });

    expect(response.statusCode).toBe(200);
    const { scenarioPacks } = scenarioPacksResponseSchema.parse(response.json());
    const byId = Object.fromEntries(scenarioPacks.map((pack) => [pack.id, pack]));
    expect(Object.keys(byId).sort()).toEqual(['ecommerce', 'temple']);
    expect(byId.temple).toMatchObject({
      name: '廟埕',
      subjectType: 'temple',
      defaultAspectRatio: '16:9',
      defaultDurationSec: 30,
      features: { scriptProposals: false, styleQuestion: false, productHero: false },
    });
    expect(byId.temple?.directions).toEqual(['歷史故事', '節慶宣傳', '景點導覽', '人物代言']);
    expect(byId.ecommerce).toMatchObject({
      name: '電商',
      subjectType: 'product',
      defaultAspectRatio: '9:16',
      defaultDurationSec: 15,
      features: { scriptProposals: true, styleQuestion: true, productHero: true },
    });
    expect(byId.ecommerce?.labels.board).toBe('商品定裝版');
  });
});

describe('建立系列時選情境包（F24）', () => {
  it('省略情境包就是廟埕包', async () => {
    const response = await postSeries({});

    expect(response.statusCode).toBe(201);
    expect(scenarioSeriesResponseSchema.parse(response.json()).series.scenarioPack).toBe('temple');
  });

  it('選電商包，回應與列表都帶情境包', async () => {
    const response = await postSeries({ scenarioPack: 'ecommerce', direction: '新品上市' });

    expect(response.statusCode).toBe(201);
    expect(scenarioSeriesResponseSchema.parse(response.json()).series.scenarioPack).toBe('ecommerce');
    const list = await currentApp().inject({ method: 'GET', url: '/api/series' });
    expect(scenarioSeriesListResponseSchema.parse(list.json()).series.map((s) => s.scenarioPack)).toEqual(['ecommerce']);
  });

  it('情境包不存在時回應 400，說明在 scenarioPack 欄位', async () => {
    const response = await postSeries({ scenarioPack: 'no-such-pack' });

    expect(response.statusCode).toBe(400);
    const body = apiErrorSchema.parse(response.json());
    expect(body.fieldErrors?.scenarioPack).toBe(SCENARIO_PACK_NOT_FOUND_MESSAGE);
  });

  it('情境包不是字串時回應 400', async () => {
    const response = await postSeries({ scenarioPack: 5 });

    expect(response.statusCode).toBe(400);
  });
});

describe('系列建立後情境包不能更改', () => {
  async function createEcommerce(): Promise<string> {
    const response = await postSeries({ scenarioPack: 'ecommerce', direction: '新品上市' });
    return scenarioSeriesResponseSchema.parse(response.json()).series.id;
  }

  it.each(['scenarioPack', 'scenario_pack'])('PATCH 帶 %s 回應 400，系列不變', async (field) => {
    const id = await createEcommerce();

    const response = await currentApp().inject({ method: 'PATCH', url: `/api/series/${id}`, payload: { [field]: 'temple' } });

    expect(response.statusCode).toBe(400);
    expect(apiErrorSchema.parse(response.json()).message).toBe(SCENARIO_PACK_LOCKED_MESSAGE);
    const list = await currentApp().inject({ method: 'GET', url: '/api/series' });
    expect(scenarioSeriesListResponseSchema.parse(list.json()).series[0]?.scenarioPack).toBe('ecommerce');
  });

  it('同一次請求還帶了其他欄位時，也整個拒絕，其他欄位不會被改', async () => {
    const id = await createEcommerce();

    const response = await currentApp().inject({
      method: 'PATCH',
      url: `/api/series/${id}`,
      payload: { name: '改名了', scenarioPack: 'temple' },
    });

    expect(response.statusCode).toBe(400);
    const list = await currentApp().inject({ method: 'GET', url: '/api/series' });
    expect(scenarioSeriesListResponseSchema.parse(list.json()).series[0]?.name).toBe(baseInput.name);
  });

  it('只改其他欄位時照常成功，情境包不變', async () => {
    const id = await createEcommerce();

    const response = await currentApp().inject({ method: 'PATCH', url: `/api/series/${id}`, payload: { name: '改名了' } });

    expect(response.statusCode).toBe(200);
    const { series } = scenarioSeriesResponseSchema.parse(response.json());
    expect(series).toMatchObject({ name: '改名了', scenarioPack: 'ecommerce' });
  });
});

describe('新增第三個情境包不改流程程式（F23）', () => {
  it('fixtures 裡的第三個情境包可以直接建立系列，也列在情境包清單', async () => {
    await app?.close();
    start([scenarioPacksDir, extraPacksDir]);

    const response = await postSeries({ scenarioPack: 'workshop', direction: '職人故事' });

    expect(response.statusCode).toBe(201);
    expect(scenarioSeriesResponseSchema.parse(response.json()).series.scenarioPack).toBe('workshop');
    const packs = await currentApp().inject({ method: 'GET', url: '/api/scenario-packs' });
    expect(scenarioPacksResponseSchema.parse(packs.json()).scenarioPacks.map((p) => p.id)).toContain('workshop');
  });

  it('沒載入第三個情境包時，同樣的請求回應 400', async () => {
    const response = await postSeries({ scenarioPack: 'workshop' });

    expect(response.statusCode).toBe(400);
  });
});

describe('建立影片讀系列的情境包', () => {
  async function seriesIdOf(payload: Record<string, unknown>): Promise<string> {
    return scenarioSeriesResponseSchema.parse((await postSeries(payload)).json()).series.id;
  }

  it('廟埕系列的影片：主體是寺廟、畫面比例 16:9', async () => {
    const seriesId = await seriesIdOf({});

    const response = await currentApp().inject({ method: 'POST', url: '/api/videos', payload: { seriesId, templeId: TEMPLE_A } });

    expect(response.statusCode).toBe(201);
    expect(scenarioVideoResponseSchema.parse(response.json()).video).toMatchObject({ subjectType: 'temple', aspectRatio: '16:9' });
  });

  it('電商系列用寺廟建立影片回應 409：商品功能在下一階段加入，不會建立影片', async () => {
    const seriesId = await seriesIdOf({ scenarioPack: 'ecommerce', direction: '新品上市' });

    const response = await currentApp().inject({ method: 'POST', url: '/api/videos', payload: { seriesId, templeId: TEMPLE_A } });

    expect(response.statusCode).toBe(409);
    expect(apiErrorSchema.parse(response.json()).message).toBe(PRODUCT_VIDEO_NOT_READY_MESSAGE);
    const list = await currentApp().inject({ method: 'GET', url: `/api/series/${seriesId}/videos` });
    expect((list.json() as { videos: unknown[] }).videos).toEqual([]);
  });

  it('GET /api/videos/:id 的影片也帶主體與畫面比例', async () => {
    const seriesId = await seriesIdOf({});
    const created = scenarioVideoResponseSchema.parse(
      (await currentApp().inject({ method: 'POST', url: '/api/videos', payload: { seriesId, templeId: TEMPLE_A } })).json(),
    ).video;

    const detail = await currentApp().inject({ method: 'GET', url: `/api/videos/${created.id}` });

    expect((detail.json() as { video: Record<string, unknown> }).video).toMatchObject({ subjectType: 'temple', aspectRatio: '16:9' });
  });
});
