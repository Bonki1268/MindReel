import { z } from 'zod';
import { deidBoxSchema, deidBoxesSchema, imageUploadSchema } from './photos.js';

// 商品主體（docs/05-Backend-Schema.md「products」、F25）

/** 每件商品最多幾張商品照（規格：1～5 張） */
export const MAX_PRODUCT_PHOTOS = 5;
/** 賣點最多幾條 */
export const MAX_SELLING_POINTS = 5;

export const PRODUCT_NAME_REQUIRED_MESSAGE = '請填寫品名';
export const PRODUCT_CATEGORY_REQUIRED_MESSAGE = '請選擇商品類別';
export const PRODUCT_CATEGORY_UNKNOWN_MESSAGE = '這個類別不在電商包的清單裡';
export const SELLING_POINT_REQUIRED_MESSAGE = '至少填寫 1 條賣點';
export const PRICE_INVALID_MESSAGE = '價格要是 0 以上的整數';
export const PRODUCT_PHOTO_LIMIT_MESSAGE = `每件商品最多 ${MAX_PRODUCT_PHOTOS} 張照片`;
export const PRODUCT_NOT_FOUND_MESSAGE = '找不到這件商品';
export const NOT_PRODUCT_SERIES_MESSAGE = '只有電商系列可以建立商品';

const optionalText = (max: number, what: string) =>
  z.string({ error: `${what}要是文字` }).trim().max(max, { error: `${what}最多 ${max} 字` }).nullish();

/** 商品欄位；建立與修改共用（修改時每個欄位都可以省略） */
const productFieldsSchema = z.object({
  name: z
    .string({ error: PRODUCT_NAME_REQUIRED_MESSAGE })
    .trim()
    .min(1, { error: PRODUCT_NAME_REQUIRED_MESSAGE })
    .max(80, { error: '品名最多 80 字' }),
  brand: optionalText(60, '品牌'),
  category: z.string({ error: PRODUCT_CATEGORY_REQUIRED_MESSAGE }).trim().min(1, { error: PRODUCT_CATEGORY_REQUIRED_MESSAGE }),
  sellingPoints: z
    .array(
      z.string({ error: '賣點要是文字' }).trim().min(1, { error: '賣點不能是空白' }).max(100, { error: '每條賣點最多 100 字' }),
      { error: SELLING_POINT_REQUIRED_MESSAGE },
    )
    .min(1, { error: SELLING_POINT_REQUIRED_MESSAGE })
    .max(MAX_SELLING_POINTS, { error: `賣點最多 ${MAX_SELLING_POINTS} 條` }),
  price: z
    .number({ error: PRICE_INVALID_MESSAGE })
    .int({ error: PRICE_INVALID_MESSAGE })
    .min(0, { error: PRICE_INVALID_MESSAGE })
    .nullish(),
  priceNote: optionalText(100, '價格說明'),
  specs: optionalText(1000, '規格'),
  notes: optionalText(1000, '注意事項'),
});

/** 空白字串與省略都當成沒有填 */
const orNull = (value: string | null | undefined): string | null => (value ? value : null);

/** POST /api/series/:id/products：品名、類別、至少 1 條賣點為必填；其他沒填的欄位補成 null */
export const createProductSchema = productFieldsSchema.transform((fields) => ({
  name: fields.name,
  brand: orNull(fields.brand),
  category: fields.category,
  sellingPoints: fields.sellingPoints,
  price: fields.price ?? null,
  priceNote: orNull(fields.priceNote),
  specs: orNull(fields.specs),
  notes: orNull(fields.notes),
}));
export type CreateProductInput = z.input<typeof createProductSchema>;

/** PATCH /api/products/:pid：只改有送的欄位（修改只影響之後新增的影片） */
export const updateProductSchema = productFieldsSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: '沒有要修改的欄位' });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productSchema = z.object({
  id: z.string(),
  seriesId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string(),
  sellingPoints: z.array(z.string()),
  price: z.number().int().nullable(),
  priceNote: z.string().nullable(),
  specs: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Product = z.infer<typeof productSchema>;

/** 商品清單的一列：加上照片張數，以及這件商品在這個系列有沒有確認過的商品定裝版 */
export const productSummarySchema = productSchema.extend({
  photoCount: z.number().int().nonnegative(),
  boardConfirmed: z.boolean(),
});
export type ProductSummary = z.infer<typeof productSummarySchema>;

export const productResponseSchema = z.object({ product: productSchema });
export const productListResponseSchema = z.object({ products: z.array(productSummarySchema) });

/** 建立影片時保存的商品資料（05 videos.product_snapshot）：之後腳本、字幕、指令都讀這份，不讀商品的即時值 */
export const productSnapshotSchema = z.object({
  productId: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
  category: z.string(),
  sellingPoints: z.array(z.string()),
  price: z.number().int().nullable(),
  priceNote: z.string().nullable(),
  specs: z.string().nullable(),
  notes: z.string().nullable(),
});
export type ProductSnapshot = z.infer<typeof productSnapshotSchema>;

/** 影片建立時，從商品目前的資料做一份快照（賣點陣列是複本） */
export function makeProductSnapshot(product: Omit<Product, 'seriesId' | 'createdAt' | 'updatedAt' | 'id'> & { id: string }): ProductSnapshot {
  return {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    category: product.category,
    sellingPoints: [...product.sellingPoints],
    price: product.price,
    priceNote: product.priceNote,
    specs: product.specs,
    notes: product.notes,
  };
}

// ── 商品照（沿用 F4 的去識別流程；原圖只存本機） ──

/** POST /api/products/:pid/photos：去識別後的商品照；視角是否在情境包的清單裡由後端檢查 */
export const createProductPhotoSchema = z.object({
  originalAssetId: z.string({ error: '請提供原圖編號' }).min(1, { error: '請提供原圖編號' }),
  deidentified: imageUploadSchema,
  deidBoxes: deidBoxesSchema,
  viewKey: z.string().min(1).nullable().optional(),
});
export type CreateProductPhotoInput = z.infer<typeof createProductPhotoSchema>;

/** PATCH /api/products/:pid/photos/:photoId：改視角，或重新遮蔽（去識別圖與遮蔽框一起換） */
export const updateProductPhotoSchema = z
  .object({
    viewKey: z.string().min(1).nullable(),
    deidentified: imageUploadSchema,
    deidBoxes: deidBoxesSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { error: '沒有要修改的欄位' })
  .refine((value) => (value.deidentified === undefined) === (value.deidBoxes === undefined), {
    error: '重新遮蔽時，去識別後的照片與遮蔽框要一起送出',
  });
export type UpdateProductPhotoInput = z.infer<typeof updateProductPhotoSchema>;

export const productPhotoSchema = z.object({
  id: z.string(),
  seriesId: z.string(),
  productId: z.string(),
  /** 有值代表只屬於某支影片的補充照片；商品照為 null */
  videoId: z.string().nullable(),
  originalAssetId: z.string(),
  deidentifiedAssetId: z.string(),
  viewKey: z.string().nullable(),
  deidBoxes: z.array(deidBoxSchema),
  createdAt: z.string(),
});
export type ProductPhoto = z.infer<typeof productPhotoSchema>;

export const productPhotoResponseSchema = z.object({ photo: productPhotoSchema });
export const productDetailResponseSchema = z.object({ product: productSchema, photos: z.array(productPhotoSchema) });
export type ProductDetail = z.infer<typeof productDetailResponseSchema>;
