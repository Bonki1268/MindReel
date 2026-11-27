import {
  makeProductSnapshot,
  type DeidBox,
  type Product,
  type ProductPhoto,
  type ProductSnapshot,
} from '@templeyard/shared';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { photos, products, type PhotoRow, type ProductRow } from '../db/schema.js';
import type { Clock } from '../series/repository.js';

// 商品與商品照的資料存取（05「products」「photos」）

export type NewProduct = Omit<Product, 'id' | 'seriesId' | 'createdAt' | 'updatedAt'>;

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    seriesId: row.seriesId,
    name: row.name,
    brand: row.brand,
    category: row.category,
    sellingPoints: row.sellingPoints,
    price: row.price,
    priceNote: row.priceNote,
    specs: row.specs,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 找不到時回傳 null */
export function findProduct(db: AppDatabase, id: string): Product | null {
  const row = db.select().from(products).where(eq(products.id, id)).get();
  return row ? toProduct(row) : null;
}

/** 這個系列的商品，先建立的在前 */
export function listProducts(db: AppDatabase, seriesId: string): Product[] {
  return db
    .select()
    .from(products)
    .where(eq(products.seriesId, seriesId))
    .orderBy(asc(products.createdAt), sql`rowid`)
    .all()
    .map(toProduct);
}

export function insertProduct(db: AppDatabase, seriesId: string, input: NewProduct, clock: Clock): Product {
  const now = clock.now().toISOString();
  const row = db.insert(products).values({ id: clock.newId(), seriesId, ...input, createdAt: now, updatedAt: now }).returning().get();
  return toProduct(row);
}

/** 只改有傳的欄位；找不到時回傳 null */
export function updateProduct(db: AppDatabase, id: string, patch: Partial<NewProduct>, clock: Clock): Product | null {
  const row = db
    .update(products)
    .set({ ...patch, updatedAt: clock.now().toISOString() })
    .where(eq(products.id, id))
    .returning()
    .get();
  return row ? toProduct(row) : null;
}

/** 影片建立時保存的商品資料 */
export function snapshotOf(product: Product): ProductSnapshot {
  return makeProductSnapshot(product);
}

// ── 商品照 ──

export type NewProductPhoto = {
  seriesId: string;
  productId: string;
  originalAssetId: string;
  deidentifiedAssetId: string;
  viewKey: string | null;
  deidBoxes: DeidBox[];
};

function toProductPhoto(row: PhotoRow): ProductPhoto {
  return {
    id: row.id,
    seriesId: row.seriesId,
    // 商品照一定有 product_id（查詢都以它篩選）
    productId: row.productId ?? '',
    videoId: row.videoId,
    originalAssetId: row.originalAssetId,
    deidentifiedAssetId: row.deidentifiedAssetId,
    viewKey: row.viewKey,
    deidBoxes: row.deidBoxes,
    createdAt: row.createdAt,
  };
}

/** 這件商品的商品照，先上傳的在前 */
export function listProductPhotos(db: AppDatabase, productId: string): ProductPhoto[] {
  return db
    .select()
    .from(photos)
    .where(and(eq(photos.productId, productId), isNull(photos.videoId)))
    // 同一毫秒上傳的照片以寫入順序（rowid）排列
    .orderBy(asc(photos.createdAt), sql`rowid`)
    .all()
    .map(toProductPhoto);
}

export function countProductPhotos(db: AppDatabase, productId: string): number {
  const row = db
    .select({ total: count() })
    .from(photos)
    .where(and(eq(photos.productId, productId), isNull(photos.videoId)))
    .get();
  return row?.total ?? 0;
}

export function insertProductPhoto(db: AppDatabase, input: NewProductPhoto, clock: Clock): ProductPhoto {
  const row = db
    .insert(photos)
    .values({ id: clock.newId(), ...input, templeId: null, videoId: null, createdAt: clock.now().toISOString() })
    .returning()
    .get();
  return toProductPhoto(row);
}

export function findProductPhoto(db: AppDatabase, id: string): ProductPhoto | null {
  const row = db.select().from(photos).where(eq(photos.id, id)).get();
  return row && row.productId ? toProductPhoto(row) : null;
}

/** 只改有傳的欄位；找不到時回傳 null */
export function updateProductPhoto(
  db: AppDatabase,
  id: string,
  input: { viewKey?: string | null; deidentifiedAssetId?: string; deidBoxes?: DeidBox[] },
): ProductPhoto | null {
  const row = db.update(photos).set(input).where(eq(photos.id, id)).returning().get();
  return row ? toProductPhoto(row) : null;
}
