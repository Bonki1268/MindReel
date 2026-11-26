import type { CostItem, ProductBoard } from '@templeyard/shared';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findAsset } from '../assets/repository.js';
import { confirmations, generations, productBoards, productBoardVersions, videos } from '../db/schema.js';
import { findVideo } from '../videos/repository.js';
import { addProductPhoto, addProductVideo, createProductWorld, type ProductWorld } from './__fixtures__/productWorld.js';
import { PRODUCT_VIEW_NODE, ProductBoardError, createProductBoardService, type ProductBoardService } from './service.js';

// 商品定裝版（F26）：比照寺廟定裝版，視角來自情境包的 view_keys

let world: ProductWorld;
let boards: ProductBoardService;
let sentAssets: { id: string; kind: string; cloudOk: boolean }[];

function service(overrides: Partial<Parameters<typeof createProductBoardService>[0]> = {}): ProductBoardService {
  const created = createProductBoardService({
    db: world.db,
    clock: world.clock,
    workflows: world.workflows,
    prompts: world.prompts,
    store: world.store,
    packs: world.packs,
    generation: {
      service: world.generation,
      writer: world.writer,
      // 記下每一個送往雲端的資產
      sendAsset: async (asset) => {
        sentAssets.push({ id: asset.id, kind: asset.kind, cloudOk: asset.cloudOk });
        return world.sendAsset(asset);
      },
    },
    ...overrides,
  });
  world.handlers[PRODUCT_VIEW_NODE] = created.handleGenerated;
  return created;
}

function consent(videoId: string, units: number, model = 'nano-banana-pro'): string {
  const items: CostItem[] = [{ model, units }];
  return world.consents.issue(videoId, items).token;
}

async function settleAll(): Promise<void> {
  const rows = world.db.select().from(generations).all();
  await Promise.all(rows.map((row) => world.generation.whenSettled(row.id)));
}

function view(board: ProductBoard | null, key: string) {
  const found = board?.views.find((v) => v.viewKey === key);
  if (!found) throw new Error(`商品定裝版沒有這個視角：${key}`);
  return found;
}

async function expectError(promise: Promise<unknown> | (() => unknown), status: number, message: string) {
  const run = typeof promise === 'function' ? Promise.resolve().then(promise) : promise;
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProductBoardError);
  expect(error).toMatchObject({ status, message });
}

/** 產生一份定裝版並等到完成 */
async function generated(videoId = 'v1', inferred: string[] = []) {
  const outcome = await boards.generate(videoId, { inferredViewKeys: inferred, consentToken: consent(videoId, 1 + inferred.length) });
  expect(outcome.status).toBe('accepted');
  await settleAll();
  return boards.detail(videoId);
}

beforeEach(async () => {
  world = await createProductWorld();
  sentAssets = [];
  addProductVideo(world, { id: 'v1' });
  boards = service();
});

afterEach(async () => {
  await world.close();
});

describe('產生商品定裝版', () => {
  it('依照片與 AI 推測，每個視角各送出一筆生成，完成後接上視角圖（資產種類 product_view）', async () => {
    addProductPhoto(world, { viewKey: 'front' });

    const board = await generated('v1', ['angle_45']);

    expect(board?.views.map((v) => [v.viewKey, v.viewName, v.source, v.state])).toEqual([
      ['front', '正面', 'photo', 'ready'],
      ['angle_45', '45 度角', 'ai_inferred', 'ready'],
    ]);
    expect(world.db.select().from(generations).where(eq(generations.node, PRODUCT_VIEW_NODE)).all()).toHaveLength(2);
    for (const v of board?.views ?? []) expect(findAsset(world.db, v.assetId ?? '')?.kind).toBe('product_view');
  });

  it('依照片的視角自動確認；AI 推測的視角要使用者確認', async () => {
    addProductPhoto(world, { viewKey: 'front' });

    const board = await generated('v1', ['angle_45']);

    expect(view(board, 'front').confirmed).toBe(true);
    expect(view(board, 'angle_45').confirmed).toBe(false);
    expect(board?.pending).toEqual(['「45 度角」為 AI 推測，請先確認或補傳照片']);
  });

  it('鎖定模型、影片進入定裝版待確認；第 1 版用這支影片的圖片模型與預設光線', async () => {
    addProductPhoto(world, { viewKey: 'front' });

    const board = await generated();

    const video = findVideo(world.db, 'v1');
    expect(video?.modelsLockedAt).toBe('2026-11-03T09:00:00.000Z');
    expect(video?.stage).toBe('board_pending');
    expect(video?.productBoardVersionId).toBe(board?.version.id);
    expect(board?.version).toMatchObject({ version: 1, imageModel: 'nano-banana-pro', appearanceLocks: [], defaultLighting: '攝影棚柔光', confirmedAt: null });
    expect(board).toMatchObject({ productId: 'p1', productName: '玻璃保溫杯', seriesId: 'es1', videoId: 'v1', otherImageModel: false });
  });

  it('最終指令由撰寫者依 product-view 寫成：帶入商品名稱、視角、來源、光線，不帶價格與行銷文字', async () => {
    addProductPhoto(world, { viewKey: 'front' });

    await generated();

    const request = world.writer.calls[0];
    expect(request?.system).toContain('商品定裝版的視角圖');
    expect(request?.system).toContain('Nano Banana Pro 寫法');
    expect(request?.content).toContain('商品：玻璃保溫杯');
    expect(request?.content).toContain('視角：正面（front）');
    expect(request?.content).toContain('這個視角的來源：依照片');
    expect(request?.content).toContain('光線與時段：攝影棚柔光');
    expect(request?.content).not.toContain('990');
    expect(request?.content).not.toContain('限時');
    expect(world.fake.calls.some((c) => c.tool === 'partner_generate' && JSON.stringify(c.args).includes('990'))).toBe(false);
    const row = world.db.select().from(generations).get();
    expect(row).toMatchObject({ promptIdRef: 'product-view', videoId: 'v1', target: { viewKey: 'front' } });
  });

  it('送往雲端的檔案全部是 cloud_ok：只上傳去識別後的商品照，原圖一次都不送出', async () => {
    const front = addProductPhoto(world, { viewKey: 'front' });
    const detail = addProductPhoto(world, { viewKey: 'detail' });

    const outcome = await boards.generate('v1', { inferredViewKeys: [], consentToken: consent('v1', 2) });
    expect(outcome.status).toBe('accepted');
    await settleAll();

    expect(sentAssets.length).toBeGreaterThan(0);
    for (const asset of sentAssets) expect(asset).toMatchObject({ kind: 'deid_photo', cloudOk: true });
    expect(new Set(sentAssets.map((asset) => asset.id))).toEqual(new Set([front.deidAssetId, detail.deidAssetId]));
    const uploaded = world.fake.uploads.map((u) => u.sha256);
    expect(uploaded).toContain(front.deidSha256);
    expect(uploaded).not.toContain(front.originalSha256);
    expect(uploaded).not.toContain(detail.originalSha256);
  });

  it('參考照片依視角編號：這個視角自己的照片負責這個視角的外觀，其他照片負責商品外觀', async () => {
    addProductPhoto(world, { viewKey: 'package' });
    addProductPhoto(world, { viewKey: 'front' });

    const outcome = await boards.generate('v1', { inferredViewKeys: [], consentToken: consent('v1', 2) });
    expect(outcome.status).toBe('accepted');
    await settleAll();

    const front = world.writer.calls.find((c) => c.content.includes('視角：正面'));
    expect(front?.content).toContain('Image 1（這個視角的外觀）：正面');
    expect(front?.content).toContain('Image 2（商品外觀）：包裝');
  });

  it('需要同意卻沒有同意憑證時：不呼叫撰寫者、不上傳、不送出、不鎖定模型', async () => {
    addProductPhoto(world, { viewKey: 'front' });

    const outcome = await boards.generate('v1', { inferredViewKeys: ['angle_45'] });

    expect(outcome.status).toBe('consent_required');
    if (outcome.status !== 'consent_required') return;
    expect(outcome.check.estimate.lines).toEqual([{ model: 'nano-banana-pro', units: 2, unitCredits: null, credits: null }]);
    expect(world.writer.calls).toEqual([]);
    expect(world.fake.uploads).toEqual([]);
    expect(world.db.select().from(generations).all()).toEqual([]);
    expect(world.db.select().from(productBoards).all()).toEqual([]);
    expect(findVideo(world.db, 'v1')?.modelsLockedAt).toBeNull();
  });

  it('同意憑證的張數和這次要產生的視角數不同時，視為沒有同意', async () => {
    addProductPhoto(world, { viewKey: 'front' });
    const outcome = await boards.generate('v1', { inferredViewKeys: ['angle_45'], consentToken: consent('v1', 1) });
    expect(outcome.status).toBe('consent_required');
  });

  it('AI 推測的視角不在電商包的視角清單裡：400', async () => {
    addProductPhoto(world, { viewKey: 'front' });
    await expectError(boards.generate('v1', { inferredViewKeys: ['courtyard'], consentToken: consent('v1', 2) }), 400, '請從清單選擇視角');
    expect(findVideo(world.db, 'v1')?.modelsLockedAt).toBeNull();
  });

  it('已經產生過定裝版的影片不能再產生一次', async () => {
    addProductPhoto(world, { viewKey: 'front' });
    await generated();
    await expectError(boards.generate('v1', { consentToken: consent('v1', 1) }), 409, '這支影片已經產生商品定裝版，要修改請在定裝版頁重生單張');
    expect(world.db.select().from(productBoardVersions).all()).toHaveLength(1);
  });

  it('還沒有商品照、沒有任何可以產生的視角時拒絕', async () => {
    await expectError(boards.generate('v1', { consentToken: consent('v1', 1) }), 409, '至少要有 1 張去識別後的照片');

    addProductPhoto(world, { viewKey: null });
    await expectError(
      boards.generate('v1', { consentToken: consent('v1', 1) }),
      409,
      '沒有可以產生的視角：請在照片指定拍到的視角，或讓 AI 推測缺少的視角',
    );
    expect(findVideo(world.db, 'v1')?.modelsLockedAt).toBeNull();
  });

  it('只有商品影片能產生商品定裝版：寺廟影片 409、找不到影片 404', async () => {
    world.db
      .insert(videos)
      .values({ id: 'tv', seriesId: 's1', templeId: 't1', stage: 'creating', imageModel: 'nano-banana-pro', videoModel: 'gemini-omni-1.1-flash', createdAt: 'x', updatedAt: 'x' })
      .run();
    await expectError(boards.generate('tv', {}), 409, '這支影片不是商品影片');
    await expectError(boards.generate('nope', {}), 404, '找不到這支影片');
  });

  it('沒有設定生成服務時回 503，說明缺少的設定', async () => {
    addProductPhoto(world, { viewKey: 'front' });
    const unavailable = service({ generation: null, unavailableMessage: '還沒設定生成服務：缺少 COMFY_MCP_URL' });
    await expectError(unavailable.generate('v1', {}), 503, '還沒設定生成服務：缺少 COMFY_MCP_URL');
  });
});

describe('單張重生與修改', () => {
  beforeEach(() => {
    addProductPhoto(world, { viewKey: 'front' });
  });

  it('帶修改指令重生：指令寫進撰寫者的內容，完成後替換視角圖並標示需重新確認', async () => {
    const before = await generated();
    const oldAsset = view(before, 'front').assetId;

    const outcome = await boards.regenerateView('v1', 'front', { instruction: '光線再亮一點', consentToken: consent('v1', 1) });
    expect(outcome.status).toBe('accepted');
    await settleAll();

    const after = boards.detail('v1');
    expect(world.writer.calls.at(-1)?.content).toContain('使用者調整指令：光線再亮一點');
    expect(view(after, 'front').assetId).not.toBe(oldAsset);
    expect(view(after, 'front')).toMatchObject({ confirmed: false, lastInstruction: '光線再亮一點' });
    expect(after?.pending).toEqual(['「正面」重新產生了，請確認這張']);
  });

  it('重生需要同意；沒有憑證時不送出、視角維持原樣', async () => {
    const before = await generated();

    const outcome = await boards.regenerateView('v1', 'front', {});

    expect(outcome.status).toBe('consent_required');
    expect(view(boards.detail('v1'), 'front')).toMatchObject({ assetId: view(before, 'front').assetId, confirmed: true });
  });

  it('找不到的視角回 404', async () => {
    await generated();
    await expectError(boards.regenerateView('v1', 'in_use', { consentToken: consent('v1', 1) }), 404, '這個定裝版沒有這個視角');
  });

  it('確認單一視角；外觀規範與光線可以修改', async () => {
    await generated('v1', ['angle_45']);

    expect(view(boards.confirmView('v1', 'angle_45'), 'angle_45').confirmed).toBe(true);
    const updated = boards.update('v1', { appearanceLocks: ['matte black body'], defaultLighting: '自然窗光' });

    expect(updated.version).toMatchObject({ appearanceLocks: ['matte black body'], defaultLighting: '自然窗光' });
  });

  it('外觀規範帶進之後的指令：逐字寫進撰寫者的內容', async () => {
    await generated();
    boards.update('v1', { appearanceLocks: ['matte black body'] });

    await boards.regenerateView('v1', 'front', { consentToken: consent('v1', 1) });
    await settleAll();

    expect(world.writer.calls.at(-1)?.content).toContain('外觀規範（逐字帶入）：matte black body');
  });
});

describe('確認商品定裝版', () => {
  beforeEach(() => {
    addProductPhoto(world, { viewKey: 'front' });
  });

  it('AI 推測的視角還沒確認時不能確認定裝版，並說明哪一張', async () => {
    await generated('v1', ['angle_45']);
    await expectError(() => boards.confirm('v1'), 409, '「45 度角」為 AI 推測，請先確認或補傳照片');
    expect(boards.detail('v1')?.version.confirmedAt).toBeNull();
  });

  it('所有視角都確認後可以確認：記下確認時間與確認紀錄，影片進入對話階段，成為目前版本', async () => {
    await generated('v1', ['angle_45']);
    boards.confirmView('v1', 'angle_45');

    const { board, video } = boards.confirm('v1');

    expect(board.version.confirmedAt).not.toBeNull();
    expect(video.stage).toBe('chat');
    const rows = world.db
      .select()
      .from(confirmations)
      .where(and(eq(confirmations.videoId, 'v1'), eq(confirmations.point, 'product_board')))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.contentRef).toEqual({ boardVersionId: board.version.id });
    expect(boards.reusableFor('es1', 'p1')).toMatchObject({ versionId: board.version.id, version: 1 });
  });

  it('已確認的版本不能再改視角與外觀規範，要先另存新版本', async () => {
    await generated();
    boards.confirm('v1');
    await expectError(() => boards.update('v1', { defaultLighting: '自然窗光' }), 409, '這個版本已確認；要修改請先另存新版本');
    await expectError(boards.regenerateView('v1', 'front', { consentToken: consent('v1', 1) }), 409, '這個版本已確認；要修改請先另存新版本');
  });
});

describe('沿用與新版本', () => {
  beforeEach(() => {
    addProductPhoto(world, { viewKey: 'front' });
  });

  it('還沒確認前沒有可以沿用的版本', async () => {
    await generated();
    expect(boards.reusableFor('es1', 'p1')).toBeNull();
  });

  it('同系列同一件商品的第二支影片直接沿用已確認的版本，不重新產生、不花錢', async () => {
    const first = await generated();
    boards.confirm('v1');
    const before = world.db.select().from(generations).all().length;
    addProductVideo(world, { id: 'v2' });

    const reused = boards.reuse('v2');

    expect(reused.version.id).toBe(first?.version.id);
    expect(world.db.select().from(generations).all()).toHaveLength(before);
    const video = findVideo(world.db, 'v2');
    expect(video).toMatchObject({ stage: 'board_pending', productBoardVersionId: first?.version.id });
    expect(video?.modelsLockedAt).not.toBeNull();
    expect(world.db.select().from(productBoards).all()).toHaveLength(1);
  });

  it('沒有確認過的版本時不能沿用：409', async () => {
    addProductVideo(world, { id: 'v2' });
    await expectError(() => boards.reuse('v2'), 409, '這件商品在這個系列還沒有確認過的商品定裝版');
  });

  it('不同系列不能沿用：另一個系列的影片（即使商品編號相同）找不到確認過的版本', async () => {
    await generated();
    boards.confirm('v1');
    addProductVideo(world, { id: 'v3', seriesId: 'es2' });

    expect(boards.reusableFor('es2', 'p1')).toBeNull();
    await expectError(() => boards.reuse('v3'), 409, '這件商品在這個系列還沒有確認過的商品定裝版');
  });

  it('已經有定裝版的影片不能再沿用', async () => {
    await generated();
    boards.confirm('v1');
    await expectError(() => boards.reuse('v1'), 409, '這支影片已經有商品定裝版');
  });

  it('另存新版本：複製視角圖與外觀規範，新版本尚未確認；沿用舊版本的影片不受影響', async () => {
    const first = await generated();
    boards.update('v1', { appearanceLocks: ['matte black body'] });
    boards.confirm('v1');
    addProductVideo(world, { id: 'v2' });
    boards.reuse('v2');

    const next = boards.saveAsNewVersion('v1');

    expect(next.version).toMatchObject({ version: 2, confirmedAt: null, appearanceLocks: ['matte black body'] });
    expect(next.views.map((v) => [v.viewKey, v.assetId])).toEqual(first?.views.map((v) => [v.viewKey, v.assetId]));
    expect(boards.detail('v2')?.version.version).toBe(1);
    expect(boards.reusableFor('es1', 'p1')?.version).toBe(1);
  });

  it('還沒確認的版本不能另存新版本', async () => {
    await generated();
    await expectError(() => boards.saveAsNewVersion('v1'), 409, '這個版本還沒確認，可以直接修改');
  });

  it('新版本確認後成為目前版本，之後新增的影片沿用新版本', async () => {
    await generated();
    boards.confirm('v1');
    boards.saveAsNewVersion('v1');

    boards.confirm('v1');

    expect(boards.reusableFor('es1', 'p1')?.version).toBe(2);
  });
});

describe('讀取', () => {
  it('還沒產生定裝版時 detail 回 null', () => {
    expect(boards.detail('v1')).toBeNull();
  });

  it('定裝版由不同圖片模型產生（沿用時）會標示', async () => {
    addProductPhoto(world, { viewKey: 'front' });
    await generated();
    boards.confirm('v1');
    addProductVideo(world, { id: 'v2', imageModel: 'other-image-model' });
    boards.reuse('v2');

    expect(boards.detail('v2')?.otherImageModel).toBe(true);
  });
});
