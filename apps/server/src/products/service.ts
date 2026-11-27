import {
  NOT_PRODUCT_SERIES_MESSAGE,
  PRODUCT_CATEGORY_UNKNOWN_MESSAGE,
  PRODUCT_NOT_FOUND_MESSAGE,
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type Product,
  type ProductSummary,
  type ScenarioPackRegistry,
  type UpdateProductInput,
} from '@templeyard/shared';
import type { AppDatabase } from '../db/client.js';
import { findBoard, findVersion } from '../productBoards/repository.js';
import { findSeries, type Clock } from '../series/repository.js';
import { countProductPhotos, findProduct, insertProduct, listProducts, updateProduct } from './repository.js';

// 商品主體（F25）：新增、修改、清單。類別要在系列情境包的 categories 裡。

/** 商品操作的錯誤；status 對應 HTTP 狀態碼，fieldErrors 對應表單欄位 */
export class ProductError extends Error {
  override name = 'ProductError';
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

export type ProductService = {
  /** 這個系列的商品與照片張數、有沒有確認過的商品定裝版；找不到系列時丟出 404 */
  list(seriesId: string): ProductSummary[];
  /** 確認這個系列存在、而且是電商系列；否則丟出 404／409 */
  ensureSeries(seriesId: string): void;
  /** 建立商品：系列要是電商系列（情境包的主體是商品），類別要在情境包的清單裡 */
  create(seriesId: string, input: CreateProductInput): Product;
  /** 修改商品：只影響之後新增的影片（既有影片保存自己的商品快照） */
  update(productId: string, input: UpdateProductInput): Product;
  get(productId: string): Product;
};

export function createProductService(deps: { db: AppDatabase; clock: Clock; packs: ScenarioPackRegistry }): ProductService {
  const { db, clock, packs } = deps;

  function requireProductSeries(seriesId: string) {
    const series = findSeries(db, seriesId);
    if (!series) throw new ProductError(404, '找不到這個系列');
    const pack = packs.get(series.scenarioPack);
    if (!pack || pack.subject_type !== 'product') throw new ProductError(409, NOT_PRODUCT_SERIES_MESSAGE);
    return { series, pack };
  }

  function checkCategory(categories: readonly string[], category: string | undefined) {
    if (category !== undefined && !categories.includes(category)) {
      throw new ProductError(400, '商品資料不正確', { category: PRODUCT_CATEGORY_UNKNOWN_MESSAGE });
    }
  }

  return {
    ensureSeries(seriesId) {
      requireProductSeries(seriesId);
    },

    list(seriesId) {
      requireProductSeries(seriesId);
      return listProducts(db, seriesId).map((product) => {
        const board = findBoard(db, seriesId, product.id);
        const version = board?.currentVersionId ? findVersion(db, board.currentVersionId) : null;
        return { ...product, photoCount: countProductPhotos(db, product.id), boardConfirmed: Boolean(version?.confirmedAt) };
      });
    },

    create(seriesId, rawInput) {
      const { pack } = requireProductSeries(seriesId);
      const input = createProductSchema.parse(rawInput);
      checkCategory(pack.categories, input.category);
      return insertProduct(db, seriesId, input, clock);
    },

    update(productId, rawInput) {
      const existing = findProduct(db, productId);
      if (!existing) throw new ProductError(404, PRODUCT_NOT_FOUND_MESSAGE);
      const { pack } = requireProductSeries(existing.seriesId);
      const input = updateProductSchema.parse(rawInput);
      checkCategory(pack.categories, input.category);
      const patch = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.brand !== undefined ? { brand: input.brand || null } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.sellingPoints !== undefined ? { sellingPoints: input.sellingPoints } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.priceNote !== undefined ? { priceNote: input.priceNote || null } : {}),
        ...(input.specs !== undefined ? { specs: input.specs || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      };
      const updated = updateProduct(db, productId, patch, clock);
      if (!updated) throw new ProductError(404, PRODUCT_NOT_FOUND_MESSAGE);
      return updated;
    },

    get(productId) {
      const product = findProduct(db, productId);
      if (!product) throw new ProductError(404, PRODUCT_NOT_FOUND_MESSAGE);
      return product;
    },
  };
}
