import { and, desc, eq, isNull, max, sql } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import {
  confirmations,
  generations,
  productBoards,
  productBoardVersions,
  productViews,
  type GenerationRow,
  type ProductBoardRow,
  type ProductBoardVersionRow,
  type ProductViewRow,
} from '../db/schema.js';

// 商品定裝版的資料存取（05「product_boards、product_board_versions、product_views」、「confirmations」）

export function findBoard(db: AppDatabase, seriesId: string, productId: string): ProductBoardRow | null {
  return db
    .select()
    .from(productBoards)
    .where(and(eq(productBoards.seriesId, seriesId), eq(productBoards.productId, productId)))
    .get() ?? null;
}

export function findBoardById(db: AppDatabase, id: string): ProductBoardRow | null {
  return db.select().from(productBoards).where(eq(productBoards.id, id)).get() ?? null;
}

export function insertBoard(db: AppDatabase, row: ProductBoardRow): void {
  db.insert(productBoards).values(row).run();
}

export function setCurrentVersion(db: AppDatabase, boardId: string, versionId: string): void {
  db.update(productBoards).set({ currentVersionId: versionId }).where(eq(productBoards.id, boardId)).run();
}

export function findVersion(db: AppDatabase, id: string): ProductBoardVersionRow | null {
  return db.select().from(productBoardVersions).where(eq(productBoardVersions.id, id)).get() ?? null;
}

/** 這份定裝版下一個版本號 */
export function nextVersionNumber(db: AppDatabase, boardId: string): number {
  const row = db
    .select({ latest: max(productBoardVersions.version) })
    .from(productBoardVersions)
    .where(eq(productBoardVersions.boardId, boardId))
    .get();
  return (row?.latest ?? 0) + 1;
}

export function insertVersion(db: AppDatabase, row: ProductBoardVersionRow): void {
  db.insert(productBoardVersions).values(row).run();
}

export function updateVersion(db: AppDatabase, id: string, patch: Partial<Omit<ProductBoardVersionRow, 'id' | 'boardId'>>): void {
  db.update(productBoardVersions).set(patch).where(eq(productBoardVersions.id, id)).run();
}

/** 某一版的視角，依建立順序（產生時已依標準清單排序） */
export function listViews(db: AppDatabase, versionId: string): ProductViewRow[] {
  return db.select().from(productViews).where(eq(productViews.boardVersionId, versionId)).orderBy(sql`rowid`).all();
}

export function findView(db: AppDatabase, id: string): ProductViewRow | null {
  return db.select().from(productViews).where(eq(productViews.id, id)).get() ?? null;
}

export function insertViews(db: AppDatabase, rows: ProductViewRow[]): void {
  if (rows.length > 0) db.insert(productViews).values(rows).run();
}

export function updateView(db: AppDatabase, id: string, patch: Partial<Omit<ProductViewRow, 'id' | 'boardVersionId'>>): void {
  db.update(productViews).set(patch).where(eq(productViews.id, id)).run();
}

/** 這個視角最近一次的生成紀錄（product-view 節點，target.viewId） */
export function latestViewGeneration(db: AppDatabase, node: string, viewId: string): GenerationRow | null {
  return (
    db
      .select()
      .from(generations)
      .where(and(eq(generations.node, node), sql`json_extract(${generations.target}, '$.viewId') = ${viewId}`))
      .orderBy(desc(generations.createdAt), desc(sql`rowid`))
      .get() ?? null
  );
}

/** 這支影片對這個版本還沒失效的確認紀錄 */
export function hasBoardConfirmation(db: AppDatabase, videoId: string, versionId: string): boolean {
  const row = db
    .select({ id: confirmations.id })
    .from(confirmations)
    .where(
      and(
        eq(confirmations.videoId, videoId),
        eq(confirmations.point, 'product_board'),
        isNull(confirmations.invalidatedAt),
        sql`json_extract(${confirmations.contentRef}, '$.boardVersionId') = ${versionId}`,
      ),
    )
    .get();
  return row !== undefined;
}

export function insertConfirmation(db: AppDatabase, row: { id: string; videoId: string; versionId: string; confirmedAt: string }): void {
  db.insert(confirmations)
    .values({
      id: row.id,
      videoId: row.videoId,
      point: 'product_board',
      contentRef: { boardVersionId: row.versionId },
      confirmedAt: row.confirmedAt,
      invalidatedAt: null,
    })
    .run();
}
