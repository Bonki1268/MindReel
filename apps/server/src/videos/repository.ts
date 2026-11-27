import { makeSeriesSnapshot, productSnapshotSchema, seriesSnapshotSchema, type ProductSnapshot, type ScenarioVideo, type UpdateVideoInput } from '@templeyard/shared';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/client.js';
import { getSettings } from '../costs/repository.js';
import { videos, type VideoRow } from '../db/schema.js';
import { findSeries, type Clock } from '../series/repository.js';

export type NewVideo = {
  seriesId: string;
  /** 商品影片沒有寺廟：存成 null（領域型別的 templeId 是空字串，只有廟埕流程會用到） */
  templeId: string | null;
  imageModel: string;
  videoModel: string;
  /** 由系列的情境包決定；省略就是廟埕影片（寺廟、16:9） */
  subjectType?: ScenarioVideo['subjectType'];
  aspectRatio?: ScenarioVideo['aspectRatio'];
  /** 電商影片：商品與建立當下的商品資料（之後腳本、字幕、指令讀這份） */
  productId?: string;
  productSnapshot?: ProductSnapshot;
};

function toVideo(row: VideoRow): ScenarioVideo {
  return {
    id: row.id,
    seriesId: row.seriesId,
    // 商品影片的 temple_id 是 null；領域型別維持 string（空字串），邊界用 subjectType／productId 區分
    templeId: row.templeId ?? '',
    stage: row.stage,
    imageModel: row.imageModel,
    videoModel: row.videoModel,
    modelsLockedAt: row.modelsLockedAt,
    templeBoardVersionId: row.templeBoardVersionId,
    userTempleNotes: row.userTempleNotes,
    creativeInput: row.creativeInput,
    costLimit: row.costLimit,
    copiedFromVideoId: row.copiedFromVideoId,
    // 格式不正確的快照（壞掉的舊資料）當成沒有，改讀系列目前的設定
    seriesSnapshot: seriesSnapshotSchema.nullable().catch(null).parse(row.seriesSnapshot ?? null),
    subjectType: row.subjectType,
    aspectRatio: row.aspectRatio,
    productId: row.productId,
    // 格式不正確的快照（壞掉的舊資料）當成沒有
    productSnapshot: productSnapshotSchema.nullable().catch(null).parse(row.productSnapshot ?? null),
    productBoardVersionId: row.productBoardVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 建立影片草稿：階段為 creating，模型還沒鎖定。
 * 同時保存當下的系列設定（之後修改系列只影響之後新增的影片），並帶入「新影片的費用上限」（系列設定的費用區塊）
 */
export function createVideo(db: AppDatabase, input: NewVideo, clock: Clock): ScenarioVideo {
  const now = clock.now().toISOString();
  const seriesRow = findSeries(db, input.seriesId);
  const row = db
    .insert(videos)
    .values({
      id: clock.newId(),
      ...input,
      stage: 'creating',
      costLimit: getSettings(db).defaultVideoCostLimitCredits,
      seriesSnapshot: seriesRow ? makeSeriesSnapshot(seriesRow) : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toVideo(row);
}

/** 找不到時回傳 null */
export function findVideo(db: AppDatabase, id: string): ScenarioVideo | null {
  const row = db.select().from(videos).where(eq(videos.id, id)).get();
  return row ? toVideo(row) : null;
}

/** 找不到時回傳 null */
export function updateVideo(db: AppDatabase, id: string, input: UpdateVideoInput, clock: Clock): ScenarioVideo | null {
  const row = db
    .update(videos)
    .set({ ...input, updatedAt: clock.now().toISOString() })
    .where(eq(videos.id, id))
    .returning()
    .get();
  return row ? toVideo(row) : null;
}
