import {
  MODELS_LOCKED_MESSAGE,
  NO_PRODUCT_PHOTO_MESSAGE,
  PRODUCT_MODELS_LOCKED_MESSAGE,
  PRODUCT_NOT_FOUND_MESSAGE,
  PRODUCT_SERIES_MISMATCH_MESSAGE,
  PRODUCT_VIDEO_NOT_READY_MESSAGE,
  TEMPLE_LOCKED_MESSAGE,
  createProductVideoSchema,
  createVideoSchema,
  updateVideoSchema,
  type ProductVideoDetail,
  type ScenarioPackRegistry,
  type VideoDetail,
} from '@templeyard/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppDatabase } from '../db/client.js';
import { toValidationError } from '../http/errors.js';
import { errorBody } from '../http/errorBody.js';
import { listPhotosForVideo } from '../photos/repository.js';
import type { ProductBoardService } from '../productBoards/service.js';
import { countProductPhotos, findProduct, listProductPhotos, snapshotOf } from '../products/repository.js';
import { findSeries, type Clock } from '../series/repository.js';
import { findTemple } from '../temples/repository.js';
import { toTempleSummary } from '../temples/search.js';
import type { TempleBoardService } from '../templeBoards/service.js';
import { createVideo, findVideo, updateVideo } from '../videos/repository.js';

const INVALID_MESSAGE = '影片資料不正確';
const VIDEO_NOT_FOUND = '找不到這支影片';
const SERIES_NOT_FOUND = '找不到這個系列';
const TEMPLE_NOT_FOUND = '找不到這間寺廟';
const SCENARIO_PACK_MISSING_MESSAGE = '這個系列的情境包設定已不存在';

/** POST /api/videos、GET /api/videos/:id、PATCH /api/videos/:id */
export function registerVideoRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  clock: Clock,
  boards: TempleBoardService,
  packs: ScenarioPackRegistry,
  productBoards: ProductBoardService,
): void {
  /** 電商系列：用同系列的商品建立影片（F25）；影片保存建立當下的商品資料 */
  function createProductVideoRoute(request: FastifyRequest, reply: FastifyReply) {
    const parsed = createProductVideoSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
    const series = findSeries(db, parsed.data.seriesId);
    if (!series) return reply.status(404).send(errorBody(SERIES_NOT_FOUND));
    const pack = packs.get(series.scenarioPack);
    if (!pack) return reply.status(409).send(errorBody(SCENARIO_PACK_MISSING_MESSAGE));
    const product = findProduct(db, parsed.data.productId);
    if (!product) return reply.status(404).send(errorBody(PRODUCT_NOT_FOUND_MESSAGE));
    if (product.seriesId !== series.id) return reply.status(409).send(errorBody(PRODUCT_SERIES_MISMATCH_MESSAGE));
    if (countProductPhotos(db, product.id) === 0) return reply.status(409).send(errorBody(NO_PRODUCT_PHOTO_MESSAGE));
    const video = createVideo(
      db,
      {
        seriesId: series.id,
        templeId: null,
        imageModel: series.defaultImageModel,
        videoModel: series.defaultVideoModel,
        subjectType: pack.subject_type,
        aspectRatio: pack.default_aspect_ratio,
        productId: product.id,
        productSnapshot: snapshotOf(product),
      },
      clock,
    );
    return reply.status(201).send({ video });
  }

  app.post('/api/videos', async (request, reply) => {
    // 電商系列用商品建立影片；只帶寺廟的請求維持第 15 階段的回應（下面的 409）
    const body = (request.body ?? {}) as Record<string, unknown>;
    const peek = typeof body.seriesId === 'string' ? findSeries(db, body.seriesId) : null;
    if (peek && packs.get(peek.scenarioPack)?.subject_type === 'product' && body.templeId === undefined) {
      return createProductVideoRoute(request, reply);
    }
    const parsed = createVideoSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
    const series = findSeries(db, parsed.data.seriesId);
    if (!series) return reply.status(404).send(errorBody(SERIES_NOT_FOUND));
    // 影片的主體與畫面比例讀系列的情境包
    const pack = packs.get(series.scenarioPack);
    if (!pack) return reply.status(409).send(errorBody(SCENARIO_PACK_MISSING_MESSAGE));
    if (pack.subject_type !== 'temple') return reply.status(409).send(errorBody(PRODUCT_VIDEO_NOT_READY_MESSAGE));
    if (!findTemple(db, parsed.data.templeId)) return reply.status(404).send(errorBody(TEMPLE_NOT_FOUND));

    // 模型帶入系列「現在」的預設值；之後改系列不會影響這支影片
    const video = createVideo(
      db,
      {
        seriesId: series.id,
        templeId: parsed.data.templeId,
        imageModel: series.defaultImageModel,
        videoModel: series.defaultVideoModel,
        subjectType: pack.subject_type,
        aspectRatio: pack.default_aspect_ratio,
      },
      clock,
    );
    return reply.status(201).send({ video });
  });

  app.get<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
    const video = findVideo(db, request.params.id);
    if (!video) return reply.status(404).send(errorBody(VIDEO_NOT_FOUND));
    if (video.subjectType === 'product' && video.productId) {
      const product = video.productSnapshot ?? (() => {
        const live = findProduct(db, video.productId ?? '');
        return live ? snapshotOf(live) : null;
      })();
      if (!product) return reply.status(404).send(errorBody(PRODUCT_NOT_FOUND_MESSAGE));
      const reusableBoard = video.productBoardVersionId ? null : productBoards.reusableFor(video.seriesId, video.productId);
      const detail: ProductVideoDetail = { video, temple: null, product, photos: listProductPhotos(db, video.productId), reusableBoard };
      return detail;
    }
    const temple = findTemple(db, video.templeId);
    if (!temple) return reply.status(404).send(errorBody(TEMPLE_NOT_FOUND));
    // 這支影片還沒有定裝版時，帶出同系列同一間廟確認過、可以沿用的版本
    const reusableBoard = video.templeBoardVersionId ? null : boards.reusableFor(video.seriesId, video.templeId);
    const body: VideoDetail = { video, temple: toTempleSummary(temple), photos: listPhotosForVideo(db, video), reusableBoard };
    return body;
  });

  app.patch<{ Params: { id: string } }>('/api/videos/:id', async (request, reply) => {
    const parsed = updateVideoSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
    const existing = findVideo(db, request.params.id);
    if (!existing) return reply.status(404).send(errorBody(VIDEO_NOT_FOUND));
    // 產生（或沿用）寺廟定裝版後，模型與寺廟都不能再改（05「後端強制的規則」）
    if (existing.subjectType === 'product' && parsed.data.templeId !== undefined) {
      return reply.status(409).send(errorBody('商品影片沒有寺廟，不能選擇寺廟'));
    }
    if (existing.modelsLockedAt !== null) {
      if (parsed.data.imageModel !== undefined || parsed.data.videoModel !== undefined) {
        return reply.status(409).send(errorBody(existing.subjectType === 'product' ? PRODUCT_MODELS_LOCKED_MESSAGE : MODELS_LOCKED_MESSAGE));
      }
      if (parsed.data.templeId !== undefined) return reply.status(409).send(errorBody(TEMPLE_LOCKED_MESSAGE));
    }
    if (parsed.data.templeId !== undefined && !findTemple(db, parsed.data.templeId)) {
      return reply.status(404).send(errorBody(TEMPLE_NOT_FOUND));
    }
    const video = updateVideo(db, request.params.id, parsed.data, clock);
    if (!video) return reply.status(404).send(errorBody(VIDEO_NOT_FOUND));
    return { video };
  });
}
