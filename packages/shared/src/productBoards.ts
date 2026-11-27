import { z } from 'zod';
import {
  MAX_APPEARANCE_LOCKS,
  MAX_APPEARANCE_LOCK_LENGTH,
  regenerateTempleViewSchema,
  reusableTempleBoardSchema,
  templeBoardVersionSchema,
  templeViewSchema,
  type TempleViewSource,
} from './templeBoards.js';

// 商品定裝版（docs/05-Backend-Schema.md「product_boards、product_board_versions、product_views」、F26）
// 結構與規則比照寺廟定裝版；視角清單來自情境包的 view_keys。

/** 光線與時段的選項；預設攝影棚柔光 */
export const PRODUCT_LIGHTING_OPTIONS = ['攝影棚柔光', '自然窗光', '暖色居家光'] as const;
export type ProductLighting = (typeof PRODUCT_LIGHTING_OPTIONS)[number];
export const DEFAULT_PRODUCT_LIGHTING: ProductLighting = '攝影棚柔光';

export const PRODUCT_BOARD_NOT_FOUND_MESSAGE = '這支影片還沒產生商品定裝版';
export const PRODUCT_BOARD_EXISTS_MESSAGE = '這支影片已經產生商品定裝版，要修改請在定裝版頁重生單張';
export const PRODUCT_BOARD_ALREADY_MESSAGE = '這支影片已經有商品定裝版';
export const PRODUCT_BOARD_NOT_REUSABLE_MESSAGE = '這件商品在這個系列還沒有確認過的商品定裝版';
export const NOT_PRODUCT_VIDEO_MESSAGE = '這支影片不是商品影片';
export const PRODUCT_MODELS_LOCKED_MESSAGE = '模型已在產生商品定裝版時鎖定，不能更換';

/** 視角圖與版本的資料形狀和寺廟定裝版相同 */
export const productViewSchema = templeViewSchema;
export type ProductView = z.infer<typeof productViewSchema>;
export const productBoardVersionSchema = templeBoardVersionSchema;

/** GET /api/videos/:id/product-board：這支影片使用的商品定裝版版本 */
export const productBoardSchema = z.object({
  boardId: z.string(),
  seriesId: z.string(),
  productId: z.string(),
  productName: z.string(),
  videoId: z.string(),
  version: productBoardVersionSchema,
  views: z.array(productViewSchema),
  /** 定裝版由不同於這支影片的圖片模型產生（沿用時） */
  otherImageModel: z.boolean(),
  /** 確認前還要處理的事；空陣列表示可以確認 */
  pending: z.array(z.string()),
});
export type ProductBoard = z.infer<typeof productBoardSchema>;
export const productBoardResponseSchema = z.object({ board: productBoardSchema });

/** 建立影片頁顯示的「沿用商品定裝版」：同系列同一件商品目前確認過的版本 */
export const reusableProductBoardSchema = reusableTempleBoardSchema;
export type ReusableProductBoard = z.infer<typeof reusableProductBoardSchema>;

/** POST /api/videos/:id/product-board/generate */
export const generateProductBoardSchema = z.object({
  /** 缺少照片、要讓 AI 推測的視角（是否在情境包的清單裡由後端檢查） */
  inferredViewKeys: z.array(z.string({ error: '請從清單選擇視角' }), { error: '定裝版的資料不正確' }).max(20).default([]),
  consentToken: z.string().min(1).optional(),
});
export type GenerateProductBoardInput = z.input<typeof generateProductBoardSchema>;

/** POST /api/videos/:id/product-board/views/:viewKey/regenerate */
export const regenerateProductViewSchema = regenerateTempleViewSchema;
export type RegenerateProductViewInput = z.input<typeof regenerateProductViewSchema>;

/** PATCH /api/videos/:id/product-board：外觀規範（連續性鎖）與光線 */
export const updateProductBoardSchema = z
  .object({
    appearanceLocks: z
      .array(
        z
          .string({ error: '外觀規範要是文字' })
          .trim()
          .min(1, { error: '外觀規範不能是空白' })
          .max(MAX_APPEARANCE_LOCK_LENGTH, { error: `每條外觀規範最多 ${MAX_APPEARANCE_LOCK_LENGTH} 字` }),
      )
      .max(MAX_APPEARANCE_LOCKS, { error: `外觀規範最多 ${MAX_APPEARANCE_LOCKS} 條` }),
    defaultLighting: z.enum(PRODUCT_LIGHTING_OPTIONS, { error: '請從清單選擇光線與時段' }),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: '沒有要修改的欄位' });
export type UpdateProductBoardInput = z.infer<typeof updateProductBoardSchema>;

/** 要產生的一個視角 */
export type PlannedProductView = { key: string; name: string; source: TempleViewSource; photoIds: string[] };

/**
 * 依商品照與使用者選的 AI 推測，決定要產生哪些視角（依照片的視角在前、AI 推測的在後，各自照情境包的視角清單排序，同寺廟定裝版）：
 * 有照片的視角依照片；缺少照片、使用者選了讓 AI 推測的視角為 AI 推測；其他缺少的視角不產生。
 * 已有照片的視角即使被選了 AI 推測，仍依照片；不在清單裡的視角忽略。
 */
export function planProductViews(
  photos: readonly { id: string; viewKey: string | null }[],
  inferredViewKeys: readonly string[],
  views: readonly { key: string; name: string }[],
): PlannedProductView[] {
  const inferred = new Set(inferredViewKeys);
  const fromPhotos: PlannedProductView[] = [];
  const fromInference: PlannedProductView[] = [];
  for (const view of views) {
    const photoIds = photos.filter((photo) => photo.viewKey === view.key).map((photo) => photo.id);
    if (photoIds.length > 0) fromPhotos.push({ key: view.key, name: view.name, source: 'photo', photoIds });
    else if (inferred.has(view.key)) fromInference.push({ key: view.key, name: view.name, source: 'ai_inferred', photoIds: [] });
  }
  return [...fromPhotos, ...fromInference];
}
