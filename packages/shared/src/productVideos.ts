import { z } from 'zod';
import { reusableProductBoardSchema } from './productBoards.js';
import { productPhotoSchema, productSnapshotSchema } from './products.js';
import { scenarioVideoSchema } from './videos.js';

// 電商影片：用同系列的商品建立（F25）

export const NO_PRODUCT_PHOTO_MESSAGE = '至少要有 1 張商品照';
export const PRODUCT_SERIES_MISMATCH_MESSAGE = '這件商品不屬於這個系列';

/** POST /api/videos（電商系列）：用同系列的商品建立影片 */
export const createProductVideoSchema = z.object({
  seriesId: z.string({ error: '請提供系列編號' }).min(1, { error: '請提供系列編號' }),
  productId: z.string({ error: '請選擇商品' }).min(1, { error: '請選擇商品' }),
});
export type CreateProductVideoInput = z.infer<typeof createProductVideoSchema>;

/** GET /api/videos/:id（商品影片）：影片、商品快照、商品照、可以沿用的商品定裝版；沒有寺廟 */
export const productVideoDetailResponseSchema = z.object({
  video: scenarioVideoSchema,
  temple: z.null().default(null),
  product: productSnapshotSchema,
  photos: z.array(productPhotoSchema),
  /** 同系列同一件商品目前確認過的定裝版；這支影片還沒有定裝版時才有值 */
  reusableBoard: reusableProductBoardSchema.nullable().default(null),
});
export type ProductVideoDetail = z.infer<typeof productVideoDetailResponseSchema>;
