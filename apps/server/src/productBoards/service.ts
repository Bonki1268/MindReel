import { UploadNotConfiguredError, type CloudAssetRef } from '@templeyard/comfy-client';
import { CallBuildError, attachReferenceImages, buildMcpCall, composeFinalPrompt, renderPrompt, type PromptWriter } from '@templeyard/prompts';
import {
  BOARD_CONFIRMED_MESSAGE,
  DEFAULT_PRODUCT_LIGHTING,
  NOT_PRODUCT_VIDEO_MESSAGE,
  NO_PHOTO_MESSAGE,
  NO_VIEW_MESSAGE,
  PRODUCT_BOARD_ALREADY_MESSAGE,
  PRODUCT_BOARD_EXISTS_MESSAGE,
  PRODUCT_BOARD_NOT_FOUND_MESSAGE,
  PRODUCT_BOARD_NOT_REUSABLE_MESSAGE,
  boardPendingItems,
  generateProductBoardSchema,
  planProductViews,
  regenerateProductViewSchema,
  updateProductBoardSchema,
  type CloudOkAsset,
  type CostCheck,
  type CostItem,
  type GenerateProductBoardInput,
  type McpCall,
  type ProductBoard,
  type ProductPhoto,
  type ProductView,
  type PromptFile,
  type RegenerateProductViewInput,
  type ReusableProductBoard,
  type ScenarioPackRegistry,
  type ScenarioVideo,
  type UpdateProductBoardInput,
  type Video,
  type WorkflowConfig,
  type WorkflowModel,
} from '@templeyard/shared';
import { eq } from 'drizzle-orm';
import { getCloudOkAsset } from '../assets/repository.js';
import type { AssetStore } from '../assets/store.js';
import type { AppDatabase } from '../db/client.js';
import { productBoards, productBoardVersions, productViews, videos, type ProductBoardVersionRow, type ProductViewRow, type VideoRow } from '../db/schema.js';
import type { GenerationRequest, GenerationService, SucceededHandler } from '../generations/service.js';
import { findProduct, listProductPhotos } from '../products/repository.js';
import { findSeries, type Clock } from '../series/repository.js';
import { seriesSettingsForVideo } from '../series/settings.js';
import { findVideo } from '../videos/repository.js';
import {
  findBoard,
  findBoardById,
  findVersion,
  findView,
  hasBoardConfirmation,
  insertBoard,
  insertConfirmation,
  insertVersion,
  insertViews,
  latestViewGeneration,
  listViews,
  nextVersionNumber,
  setCurrentVersion,
  updateVersion,
  updateView,
} from './repository.js';
import { productViewVariables } from './viewPrompt.js';

// 商品定裝版（03「/videos/:vid/product-board」、05「product_boards」、F26）：流程比照寺廟定裝版，
// 視角清單來自系列情境包的 view_keys

export const PRODUCT_VIEW_NODE = 'product-view';

/** 商品定裝版的操作錯誤；status 對應 HTTP 狀態碼 */
export class ProductBoardError extends Error {
  override name = 'ProductBoardError';
  constructor(
    readonly status: 400 | 404 | 409 | 502 | 503,
    message: string,
  ) {
    super(message);
  }
}

export type ProductBoardGeneration = {
  service: GenerationService;
  writer: PromptWriter;
  /** 把去識別後的商品照送到雲端；型別上只收 cloud_ok 的資產 */
  sendAsset: (asset: CloudOkAsset) => Promise<CloudAssetRef>;
};

export type ProductBoardServiceDeps = {
  db: AppDatabase;
  clock: Clock;
  workflows: WorkflowConfig;
  /** 要有 product-view（scenario-packs/ecommerce/prompts） */
  prompts: ReadonlyMap<string, PromptFile>;
  store: AssetStore;
  packs: ScenarioPackRegistry;
  /** 沒有設定 Comfy Cloud 或 Claude 時為 null：生成相關的操作回 503，說明 unavailableMessage */
  generation: ProductBoardGeneration | null;
  unavailableMessage?: string;
};

export type ProductGenerateOutcome = { status: 'consent_required'; check: CostCheck } | { status: 'accepted'; board: ProductBoard };

export type ProductBoardService = {
  /** 這支影片使用的商品定裝版；還沒有時為 null */
  detail(videoId: string): ProductBoard | null;
  /** 同系列同一件商品目前確認過的版本 */
  reusableFor(seriesId: string, productId: string): ReusableProductBoard | null;
  /**
   * 產生商品定裝版：檢查照片與視角 → 檢查同意（不作廢）→ 每個視角請撰寫者寫最終指令、上傳參考圖、組出 MCP 呼叫
   * → 一次送出（作廢同意憑證）→ 建立定裝版與視角列、鎖定模型、影片進入 board_pending。
   * 任何一步失敗都不留下定裝版、不鎖定模型。
   */
  generate(videoId: string, input: GenerateProductBoardInput): Promise<ProductGenerateOutcome>;
  /** 單張重生（可帶修改指令）；有這個視角的照片時改為依照片；完成後替換該張並標示需重新確認 */
  regenerateView(videoId: string, viewKey: string, input: RegenerateProductViewInput): Promise<ProductGenerateOutcome>;
  confirmView(videoId: string, viewKey: string): ProductBoard;
  update(videoId: string, input: UpdateProductBoardInput): ProductBoard;
  /** 確認定裝版：所有視角都產生且確認後才可以；影片進入 chat，記下確認紀錄 */
  confirm(videoId: string): { board: ProductBoard; video: Video };
  /** 沿用同系列同一件商品確認過的版本；鎖定模型 */
  reuse(videoId: string): ProductBoard;
  /** 以這支影片目前（已確認）的版本另存新版本：複製視角圖與外觀規範，新版本尚未確認 */
  saveAsNewVersion(videoId: string): ProductBoard;
  /** 生成服務的 product-view 完成處理：把視角圖接到視角列 */
  handleGenerated: SucceededHandler;
};

const PROMPT_ID = 'product-view';
const OUTPUT_KIND = 'product_view';
const VIEW_NOT_FOUND = '這個定裝版沒有這個視角';
const UNAVAILABLE_DEFAULT = '還沒設定生成服務，不能生成';
const INVALID_VIEW_MESSAGE = '請從清單選擇視角';

type ViewTarget = { viewId: string; viewKey: string; boardVersionId: string; autoConfirm: boolean };

function isViewTarget(value: Record<string, unknown>): value is ViewTarget {
  return typeof value.viewId === 'string' && typeof value.autoConfirm === 'boolean';
}

/** 商品影片：有商品編號（領域型別的 templeId 在商品影片是空字串，不使用） */
type ProductVideo = ScenarioVideo & { productId: string };

function never(): never {
  throw new ProductBoardError(404, PRODUCT_BOARD_NOT_FOUND_MESSAGE);
}

export function createProductBoardService(deps: ProductBoardServiceDeps): ProductBoardService {
  const { db, clock } = deps;
  const nowIso = () => clock.now().toISOString();

  function requireVideo(videoId: string): ProductVideo {
    const video = findVideo(db, videoId);
    if (!video) throw new ProductBoardError(404, '找不到這支影片');
    if (video.subjectType !== 'product' || !video.productId) throw new ProductBoardError(409, NOT_PRODUCT_VIDEO_MESSAGE);
    return { ...video, productId: video.productId };
  }

  /** 這個系列情境包的視角清單 */
  function packViews(seriesId: string): readonly { key: string; name: string }[] {
    const series = findSeries(db, seriesId);
    return (series && deps.packs.get(series.scenarioPack)?.view_keys) || [];
  }

  function requireGeneration(): ProductBoardGeneration {
    if (!deps.generation) throw new ProductBoardError(503, deps.unavailableMessage ?? UNAVAILABLE_DEFAULT);
    return deps.generation;
  }

  function prompt(): PromptFile {
    const found = deps.prompts.get(PROMPT_ID);
    if (!found) throw new ProductBoardError(503, '找不到 product-view 的生成指令');
    return found;
  }

  function modelOf(key: string): WorkflowModel {
    const model = deps.workflows.models[key];
    if (!model) throw new ProductBoardError(503, `沒有這個模型的呼叫設定：${key}`);
    return model;
  }

  /** 視角目前的狀態：依最近一次的生成紀錄 */
  function toView(row: ProductViewRow): ProductView {
    const latest = latestViewGeneration(db, PRODUCT_VIEW_NODE, row.id);
    let state: ProductView['state'] = 'ready';
    let error: string | null = null;
    if (latest && ['awaiting_confirm', 'submitted', 'running'].includes(latest.status)) state = 'generating';
    else if (latest && (latest.status === 'failed' || latest.status === 'timeout')) {
      state = 'failed';
      error = latest.error;
    } else if (!row.assetId) state = 'generating';
    return {
      id: row.id,
      viewKey: row.viewKey,
      viewName: row.viewName,
      source: row.source,
      photoId: row.photoId,
      assetId: row.assetId,
      confirmed: row.confirmed,
      state,
      error,
      lastInstruction: latest?.userInstruction ?? null,
      createdFromVideoId: row.createdFromVideoId,
    };
  }

  function toBoard(video: ProductVideo, version: ProductBoardVersionRow): ProductBoard {
    const board = findBoardById(db, version.boardId);
    if (!board) return never();
    const views = listViews(db, version.id).map(toView);
    return {
      boardId: board.id,
      seriesId: board.seriesId,
      productId: board.productId,
      productName: video.productSnapshot?.name ?? findProduct(db, board.productId)?.name ?? '',
      videoId: video.id,
      version: {
        id: version.id,
        boardId: version.boardId,
        version: version.version,
        imageModel: version.imageModel,
        appearanceLocks: version.appearanceLocks,
        defaultLighting: version.defaultLighting,
        confirmedAt: version.confirmedAt,
      },
      views,
      otherImageModel: version.imageModel !== video.imageModel,
      pending: boardPendingItems(views),
    };
  }

  /** 這支影片的定裝版版本；沒有時丟出 404 */
  function current(videoId: string): { video: ProductVideo; version: ProductBoardVersionRow } {
    const video = requireVideo(videoId);
    const version = video.productBoardVersionId ? findVersion(db, video.productBoardVersionId) : null;
    if (!version) return never();
    return { video, version };
  }

  function editable(videoId: string) {
    const found = current(videoId);
    if (found.version.confirmedAt) throw new ProductBoardError(409, BOARD_CONFIRMED_MESSAGE);
    return found;
  }

  function setVideo(id: string, patch: Partial<Pick<VideoRow, 'stage' | 'modelsLockedAt' | 'productBoardVersionId'>>) {
    db.update(videos).set({ ...patch, updatedAt: nowIso() }).where(eq(videos.id, id)).run();
  }

  /** 參考照片：這個視角自己的照片排前面，其他照片接在後面，最多 max 張 */
  function referencePhotos(all: readonly ProductPhoto[], ownIds: readonly string[], max: number): ProductPhoto[] {
    const own = all.filter((photo) => ownIds.includes(photo.id));
    const others = all.filter((photo) => !ownIds.includes(photo.id));
    return [...own, ...others].slice(0, max);
  }

  /** 送出前先確定這個模型能用參考圖、也知道怎麼上傳；不能時不呼叫撰寫者、不上傳 */
  function preflight(model: WorkflowModel) {
    if (!model.references) {
      throw new ProductBoardError(503, `${model.label} 的參考圖輸入方式還沒實測（07「下一輪測試」），不能用照片生成`);
    }
    if (!deps.workflows.upload) throw new ProductBoardError(503, new UploadNotConfiguredError().message);
    return model.references.max;
  }

  type BuildInput = {
    video: ProductVideo;
    view: { id: string; key: string; name: string; source: ProductView['source'] };
    ownPhotoIds: readonly string[];
    photos: readonly ProductPhoto[];
    versionId: string;
    locks: readonly string[];
    lighting: string;
    instruction: string | null;
    autoConfirm: boolean;
    uploaded: Map<string, string>;
  };

  /** 一個視角的生成請求：撰寫最終指令（檢查連續性鎖）→ 上傳參考圖 → 組出 MCP 呼叫 */
  async function buildRequest(generation: ProductBoardGeneration, input: BuildInput): Promise<Omit<GenerationRequest, 'consentToken'>> {
    const model = modelOf(input.video.imageModel);
    const max = preflight(model);
    const references = referencePhotos(input.photos, input.ownPhotoIds, max);
    const snapshot = input.video.productSnapshot;
    const live = findProduct(db, input.video.productId);
    const series = seriesSettingsForVideo(db, input.video);
    const file = prompt();
    const names = new Map(packViews(input.video.seriesId).map((view) => [view.key, view.name]));
    const variables = productViewVariables({
      product: {
        name: snapshot?.name ?? live?.name ?? '',
        brand: snapshot?.brand ?? live?.brand ?? null,
        category: snapshot?.category ?? live?.category ?? '',
      },
      series: { visualStyle: series?.visualStyle ?? '' },
      view: { key: input.view.key, name: input.view.name, source: input.view.source },
      references: references.map((photo) => ({ viewName: (photo.viewKey && names.get(photo.viewKey)) || null })),
      appearanceLocks: input.locks,
      lighting: input.lighting,
      instruction: input.instruction,
    });
    const { request } = renderPrompt(file, variables, { model: input.video.imageModel });

    let composed;
    try {
      composed = await composeFinalPrompt({ request, locks: input.locks, writer: generation.writer });
    } catch (error: unknown) {
      throw new ProductBoardError(502, error instanceof Error ? error.message : '撰寫最終指令失敗');
    }

    const refs: string[] = [];
    try {
      for (const photo of references) {
        let ref = input.uploaded.get(photo.deidentifiedAssetId);
        if (!ref) {
          // 只有去識別後的照片能送往雲端：getCloudOkAsset 遇到原圖或 cloud_ok = 0 會丟出錯誤
          ref = (await generation.sendAsset(getCloudOkAsset(db, photo.deidentifiedAssetId))).remoteRef;
          input.uploaded.set(photo.deidentifiedAssetId, ref);
        }
        refs.push(ref);
      }
    } catch (error: unknown) {
      if (error instanceof UploadNotConfiguredError) throw new ProductBoardError(503, error.message);
      throw new ProductBoardError(502, error instanceof Error ? error.message : '上傳參考圖失敗');
    }

    let call: McpCall;
    try {
      const values = { output: { prompt: composed.prompt }, target: { aspectRatio: file.target.aspectRatio ?? '1:1' } };
      call = buildMcpCall({ modelKey: input.video.imageModel, config: deps.workflows, bindings: file.bindings ?? {}, values, seed: 0 });
      call = attachReferenceImages(call, model, refs);
    } catch (error: unknown) {
      if (error instanceof CallBuildError) throw new ProductBoardError(503, error.message);
      throw error;
    }

    const target: ViewTarget = { viewId: input.view.id, viewKey: input.view.key, boardVersionId: input.versionId, autoConfirm: input.autoConfirm };
    return {
      videoId: input.video.id,
      node: PRODUCT_VIEW_NODE,
      target,
      promptRef: { id: file.id, version: file.version },
      modelKey: input.video.imageModel,
      call,
      costItems: [{ model: input.video.imageModel, units: 1 }],
      input: { prompt: composed.prompt, notes: composed.notes ?? null, references: refs },
      userInstruction: input.instruction,
      outputKind: OUTPUT_KIND,
    };
  }

  function costItemsFor(video: Video, count: number): CostItem[] {
    return [{ model: video.imageModel, units: count }];
  }

  return {
    detail(videoId) {
      const video = findVideo(db, videoId);
      if (!video || video.subjectType !== 'product' || !video.productId) return null;
      const version = video.productBoardVersionId ? findVersion(db, video.productBoardVersionId) : null;
      return version ? toBoard({ ...video, productId: video.productId }, version) : null;
    },

    reusableFor(seriesId, productId) {
      const board = findBoard(db, seriesId, productId);
      const version = board?.currentVersionId ? findVersion(db, board.currentVersionId) : null;
      if (!version?.confirmedAt) return null;
      return { versionId: version.id, version: version.version, imageModel: version.imageModel, confirmedAt: version.confirmedAt };
    },

    async generate(videoId, rawInput) {
      const video = requireVideo(videoId);
      if (video.productBoardVersionId) throw new ProductBoardError(409, PRODUCT_BOARD_EXISTS_MESSAGE);
      const generation = requireGeneration();
      const input = generateProductBoardSchema.parse(rawInput);
      const views = packViews(video.seriesId);
      if (input.inferredViewKeys.some((key) => !views.some((view) => view.key === key))) {
        throw new ProductBoardError(400, INVALID_VIEW_MESSAGE);
      }
      const photos = listProductPhotos(db, video.productId);
      if (photos.length === 0) throw new ProductBoardError(409, NO_PHOTO_MESSAGE);
      const planned = planProductViews(photos, input.inferredViewKeys, views);
      if (planned.length === 0) throw new ProductBoardError(409, NO_VIEW_MESSAGE);

      const items = costItemsFor(video, planned.length);
      const precheck = generation.service.precheck(video.id, items, input.consentToken, planned.map(() => costItemsFor(video, 1)));
      if (!precheck.ok) return { status: 'consent_required', check: precheck.check };
      preflight(modelOf(video.imageModel));

      const existing = findBoard(db, video.seriesId, video.productId);
      const boardId = existing?.id ?? clock.newId();
      const versionId = clock.newId();
      const lighting = DEFAULT_PRODUCT_LIGHTING;
      const uploaded = new Map<string, string>();
      const plannedViews = planned.map((view) => ({ ...view, id: clock.newId() }));
      const requests = [];
      for (const view of plannedViews) {
        requests.push(
          await buildRequest(generation, {
            video,
            view: { id: view.id, key: view.key, name: view.name, source: view.source },
            ownPhotoIds: view.photoIds,
            photos,
            versionId,
            locks: [],
            lighting,
            instruction: null,
            autoConfirm: view.source === 'photo',
            uploaded,
          }),
        );
      }

      // 視角列要在送出前建立：完成處理可能在送出回應前就到
      db.transaction((tx) => {
        if (!existing) insertBoard(tx, { id: boardId, seriesId: video.seriesId, productId: video.productId, currentVersionId: null });
        insertVersion(tx, {
          id: versionId,
          boardId,
          version: nextVersionNumber(tx, boardId),
          imageModel: video.imageModel,
          appearanceLocks: [],
          defaultLighting: lighting,
          confirmedAt: null,
        });
        insertViews(
          tx,
          plannedViews.map((view) => ({
            id: view.id,
            boardVersionId: versionId,
            viewKey: view.key,
            viewName: view.name,
            source: view.source,
            photoId: view.photoIds[0] ?? null,
            assetId: null,
            confirmed: false,
            createdFromVideoId: video.id,
          })),
        );
        tx.update(videos)
          .set({ modelsLockedAt: video.modelsLockedAt ?? nowIso(), stage: 'board_pending', productBoardVersionId: versionId, updatedAt: nowIso() })
          .where(eq(videos.id, video.id))
          .run();
      });

      const outcome = await generation.service.submitBatch(requests, input.consentToken);
      if (outcome.status === 'consent_required') {
        // 檢查之後憑證失效（例如同時用了兩次）：收回剛建立的定裝版
        db.transaction((tx) => {
          tx.update(videos).set({ modelsLockedAt: video.modelsLockedAt, stage: video.stage, productBoardVersionId: null }).where(eq(videos.id, video.id)).run();
          tx.delete(productViews).where(eq(productViews.boardVersionId, versionId)).run();
          tx.delete(productBoardVersions).where(eq(productBoardVersions.id, versionId)).run();
          if (!existing) tx.delete(productBoards).where(eq(productBoards.id, boardId)).run();
        });
        return { status: 'consent_required', check: outcome.check };
      }
      return { status: 'accepted', board: toBoard(requireVideo(video.id), findVersion(db, versionId) ?? never()) };
    },

    async regenerateView(videoId, viewKey, rawInput) {
      const { video, version } = editable(videoId);
      const row = listViews(db, version.id).find((view) => view.viewKey === viewKey);
      if (!row) throw new ProductBoardError(404, VIEW_NOT_FOUND);
      if (toView(row).state === 'generating') throw new ProductBoardError(409, `「${row.viewName}」還在生成中`);
      const generation = requireGeneration();
      const input = regenerateProductViewSchema.parse(rawInput);

      const items = costItemsFor(video, 1);
      const precheck = generation.service.precheck(video.id, items, input.consentToken);
      if (!precheck.ok) return { status: 'consent_required', check: precheck.check };

      const photos = listProductPhotos(db, video.productId);
      const own = photos.filter((photo) => photo.viewKey === viewKey).map((photo) => photo.id);
      const source: ProductView['source'] = own.length > 0 ? 'photo' : 'ai_inferred';
      const request = await buildRequest(generation, {
        video,
        view: { id: row.id, key: row.viewKey, name: row.viewName, source },
        ownPhotoIds: own,
        photos,
        versionId: version.id,
        locks: version.appearanceLocks,
        lighting: version.defaultLighting,
        instruction: input.instruction ? input.instruction : null,
        autoConfirm: false,
        uploaded: new Map(),
      });

      const previous = { source: row.source, photoId: row.photoId, confirmed: row.confirmed };
      updateView(db, row.id, { source, photoId: own[0] ?? null, confirmed: false });
      const outcome = await generation.service.submitBatch([request], input.consentToken);
      if (outcome.status === 'consent_required') {
        updateView(db, row.id, previous);
        return { status: 'consent_required', check: outcome.check };
      }
      return { status: 'accepted', board: toBoard(video, version) };
    },

    confirmView(videoId, viewKey) {
      const { video, version } = editable(videoId);
      const row = listViews(db, version.id).find((view) => view.viewKey === viewKey);
      if (!row) throw new ProductBoardError(404, '找不到這個視角');
      const view = toView(row);
      if (view.state === 'generating') throw new ProductBoardError(409, `「${row.viewName}」還在生成中`);
      if (view.state === 'failed') throw new ProductBoardError(409, `「${row.viewName}」生成失敗，請重生`);
      updateView(db, row.id, { confirmed: true });
      return toBoard(video, version);
    },

    update(videoId, rawInput) {
      const { video, version } = editable(videoId);
      const input = updateProductBoardSchema.parse(rawInput);
      updateVersion(db, version.id, input);
      return toBoard(video, findVersion(db, version.id) ?? version);
    },

    confirm(videoId) {
      const { video, version } = current(videoId);
      if (!version.confirmedAt) {
        const pending = boardPendingItems(listViews(db, version.id).map(toView));
        if (pending[0]) throw new ProductBoardError(409, pending[0]);
      }
      const confirmedAt = nowIso();
      db.transaction((tx) => {
        if (!version.confirmedAt) {
          updateVersion(tx, version.id, { confirmedAt });
          setCurrentVersion(tx, version.boardId, version.id);
        }
        if (!hasBoardConfirmation(tx, video.id, version.id)) {
          insertConfirmation(tx, { id: clock.newId(), videoId: video.id, versionId: version.id, confirmedAt });
        }
        if (video.stage === 'creating' || video.stage === 'board_pending') {
          tx.update(videos).set({ stage: 'chat', updatedAt: confirmedAt }).where(eq(videos.id, video.id)).run();
        }
      });
      const updated = requireVideo(video.id);
      return { board: toBoard(updated, findVersion(db, version.id) ?? version), video: updated };
    },

    reuse(videoId) {
      const video = requireVideo(videoId);
      if (video.productBoardVersionId) throw new ProductBoardError(409, PRODUCT_BOARD_ALREADY_MESSAGE);
      const reusable = this.reusableFor(video.seriesId, video.productId);
      if (!reusable) throw new ProductBoardError(409, PRODUCT_BOARD_NOT_REUSABLE_MESSAGE);
      setVideo(video.id, { productBoardVersionId: reusable.versionId, modelsLockedAt: video.modelsLockedAt ?? nowIso(), stage: 'board_pending' });
      return toBoard(requireVideo(video.id), findVersion(db, reusable.versionId) ?? never());
    },

    saveAsNewVersion(videoId) {
      const { video, version } = current(videoId);
      if (!version.confirmedAt) throw new ProductBoardError(409, '這個版本還沒確認，可以直接修改');
      const versionId = clock.newId();
      db.transaction((tx) => {
        insertVersion(tx, {
          id: versionId,
          boardId: version.boardId,
          version: nextVersionNumber(tx, version.boardId),
          imageModel: version.imageModel,
          appearanceLocks: [...version.appearanceLocks],
          defaultLighting: version.defaultLighting,
          confirmedAt: null,
        });
        insertViews(
          tx,
          listViews(tx, version.id).map((view) => ({ ...view, id: clock.newId(), boardVersionId: versionId })),
        );
        tx.update(videos).set({ productBoardVersionId: versionId, updatedAt: nowIso() }).where(eq(videos.id, video.id)).run();
      });
      return toBoard(requireVideo(video.id), findVersion(db, versionId) ?? never());
    },

    handleGenerated(generation, assetIds) {
      if (!isViewTarget(generation.target)) return;
      const view = findView(db, generation.target.viewId);
      const assetId = assetIds[0];
      if (!view || !assetId) return;
      updateView(db, view.id, { assetId, confirmed: generation.target.autoConfirm });
    },
  };
}

