import {
  MAX_PRODUCT_PHOTOS,
  PRODUCT_PHOTO_LIMIT_MESSAGE,
  createProductPhotoSchema,
  createProductSchema,
  updateProductPhotoSchema,
  updateProductSchema,
  uploadOriginalSchema,
  type ApiError,
  type AssetKind,
  type ImageUpload,
  type ScenarioPackRegistry,
} from '@templeyard/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { findAsset, insertAsset } from '../assets/repository.js';
import { sniffImageMime } from '../assets/sniff.js';
import type { AssetStore } from '../assets/store.js';
import type { AppDatabase } from '../db/client.js';
import { errorBody } from '../http/errorBody.js';
import { toValidationError } from '../http/errors.js';
import { countProductPhotos, findProduct, findProductPhoto, insertProductPhoto, listProductPhotos, updateProductPhoto } from '../products/repository.js';
import { ProductError, type ProductService } from '../products/service.js';
import { findSeries, type Clock } from '../series/repository.js';

const INVALID_MESSAGE = '商品資料不正確';
const INVALID_PHOTO_MESSAGE = '照片資料不正確';
const VIEW_KEY_MESSAGE = '請從清單選擇視角';

/** 照片以 base64 放在 JSON 裡，最大約 30MB；請求本身放寬到 50MB */
const PHOTO_BODY_LIMIT = 50 * 1024 * 1024;

type SeriesParams = { Params: { id: string } };
type ProductParams = { Params: { pid: string } };
type PhotoParams = { Params: { pid: string; photoId: string } };

/** 商品服務的錯誤轉成 HTTP 回應；其他錯誤往上丟（500） */
async function handle<T>(reply: FastifyReply, run: () => T | Promise<T>): Promise<T | FastifyReply> {
  try {
    return await run();
  } catch (error: unknown) {
    if (error instanceof ProductError) {
      const body: ApiError = { message: error.message, ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) };
      return reply.status(error.status).send(body);
    }
    throw error;
  }
}

/**
 * GET/POST /api/series/:id/products                       商品清單、新增
 * GET/PATCH /api/products/:pid                            商品與商品照、修改
 * POST /api/products/:pid/photos/originals                原圖，只存本機（cloud_ok = 0）
 * POST /api/products/:pid/photos                          去識別後的照片
 * PATCH /api/products/:pid/photos/:photoId                改視角或重新遮蔽
 */
export function registerProductRoutes(
  app: FastifyInstance,
  db: AppDatabase,
  clock: Clock,
  store: AssetStore,
  products: ProductService,
  packs: ScenarioPackRegistry,
): void {
  /** 這件商品的情境包視角清單（電商包的 view_keys） */
  function viewKeysOf(seriesId: string): string[] {
    const series = findSeries(db, seriesId);
    return (series && packs.get(series.scenarioPack)?.view_keys.map((view) => view.key)) || [];
  }

  function viewKeyError(): ApiError {
    return { message: INVALID_PHOTO_MESSAGE, fieldErrors: { viewKey: VIEW_KEY_MESSAGE } };
  }

  /** 解出圖片位元組並寫入資產；內容和宣告的格式不符時回應 400 並回傳 null */
  function saveImage(reply: FastifyReply, kind: AssetKind, image: ImageUpload) {
    const bytes = Buffer.from(image.dataBase64, 'base64');
    if (sniffImageMime(bytes) !== image.mime) {
      void reply.status(400).send(errorBody('照片內容和格式不符'));
      return null;
    }
    const id = clock.newId();
    const saved = store.save({ id, kind, mime: image.mime, bytes });
    return insertAsset(db, { id, kind, mime: image.mime, path: saved.path, sha256: saved.sha256 });
  }

  app.get<SeriesParams>('/api/series/:id/products', async (request, reply) => handle(reply, () => ({ products: products.list(request.params.id) })));

  app.post<SeriesParams>('/api/series/:id/products', async (request, reply) => {
    const parsed = createProductSchema.safeParse(request.body ?? {});
    // 找不到系列、不是電商系列要先回應（不是欄位的問題）
    return handle(reply, () => {
      products.ensureSeries(request.params.id);
      if (!parsed.success) {
        void reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
        return reply;
      }
      return reply.status(201).send({ product: products.create(request.params.id, parsed.data) });
    });
  });

  app.get<ProductParams>('/api/products/:pid', async (request, reply) =>
    handle(reply, () => ({ product: products.get(request.params.pid), photos: listProductPhotos(db, request.params.pid) })),
  );

  app.patch<ProductParams>('/api/products/:pid', async (request, reply) => {
    const parsed = updateProductSchema.safeParse(request.body ?? {});
    return handle(reply, () => {
      products.get(request.params.pid);
      if (!parsed.success) {
        void reply.status(400).send(toValidationError(parsed.error, INVALID_MESSAGE));
        return reply;
      }
      return { product: products.update(request.params.pid, parsed.data) };
    });
  });

  app.post<ProductParams>('/api/products/:pid/photos/originals', { bodyLimit: PHOTO_BODY_LIMIT }, async (request, reply) => {
    if (!findProduct(db, request.params.pid)) return reply.status(404).send(errorBody('找不到這件商品'));
    const parsed = uploadOriginalSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_PHOTO_MESSAGE));
    const asset = saveImage(reply, 'original_photo', parsed.data);
    if (!asset) return reply;
    return reply.status(201).send({ asset });
  });

  app.post<ProductParams>('/api/products/:pid/photos', { bodyLimit: PHOTO_BODY_LIMIT }, async (request, reply) => {
    const product = findProduct(db, request.params.pid);
    if (!product) return reply.status(404).send(errorBody('找不到這件商品'));
    const parsed = createProductPhotoSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_PHOTO_MESSAGE));
    if (parsed.data.viewKey && !viewKeysOf(product.seriesId).includes(parsed.data.viewKey)) return reply.status(400).send(viewKeyError());

    const original = findAsset(db, parsed.data.originalAssetId);
    if (!original) return reply.status(404).send(errorBody('找不到這張照片的原圖'));
    if (original.kind !== 'original_photo') return reply.status(400).send(errorBody('原圖編號指向的不是原圖'));
    if (countProductPhotos(db, product.id) >= MAX_PRODUCT_PHOTOS) return reply.status(409).send(errorBody(PRODUCT_PHOTO_LIMIT_MESSAGE));

    const deid = saveImage(reply, 'deid_photo', parsed.data.deidentified);
    if (!deid) return reply;
    const photo = insertProductPhoto(
      db,
      {
        seriesId: product.seriesId,
        productId: product.id,
        originalAssetId: original.id,
        deidentifiedAssetId: deid.id,
        viewKey: parsed.data.viewKey ?? null,
        deidBoxes: parsed.data.deidBoxes,
      },
      clock,
    );
    return reply.status(201).send({ photo });
  });

  app.patch<PhotoParams>('/api/products/:pid/photos/:photoId', { bodyLimit: PHOTO_BODY_LIMIT }, async (request, reply) => {
    const product = findProduct(db, request.params.pid);
    if (!product) return reply.status(404).send(errorBody('找不到這件商品'));
    const photo = findProductPhoto(db, request.params.photoId);
    if (!photo || photo.productId !== product.id) return reply.status(404).send(errorBody('找不到這張照片'));
    const parsed = updateProductPhotoSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send(toValidationError(parsed.error, INVALID_PHOTO_MESSAGE));
    if (parsed.data.viewKey && !viewKeysOf(product.seriesId).includes(parsed.data.viewKey)) return reply.status(400).send(viewKeyError());

    const changes: { viewKey?: string | null; deidentifiedAssetId?: string; deidBoxes?: typeof photo.deidBoxes } = {};
    if (parsed.data.viewKey !== undefined) changes.viewKey = parsed.data.viewKey;
    if (parsed.data.deidentified && parsed.data.deidBoxes) {
      // 舊的去識別圖不刪除，只是不再被這張照片使用
      const deid = saveImage(reply, 'deid_photo', parsed.data.deidentified);
      if (!deid) return reply;
      changes.deidentifiedAssetId = deid.id;
      changes.deidBoxes = parsed.data.deidBoxes;
    }
    const updated = updateProductPhoto(db, photo.id, changes);
    if (!updated) return reply.status(404).send(errorBody('找不到這張照片'));
    return { photo: updated };
  });
}
