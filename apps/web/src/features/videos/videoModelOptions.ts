import { VIDEO_MODELS, type ModelInfo, type VideoModelKey } from '@templeyard/shared';

/** 介面上的影片模型選項；unavailable 表示後端尚未支援，只顯示、不能選 */
export type VideoModelOption = ModelInfo & { key: string; unavailable?: boolean };

/** 影片模型清單與 `VIDEO_MODELS` 一致（Gemini、Seedance 2.0、Wan 2.2）。
 * 是否加入 Higgsfield 是 01 PRD「待決定」，決定前不放進介面。 */
export const VIDEO_MODEL_OPTIONS: readonly VideoModelOption[] = VIDEO_MODELS;

export function isVideoModelKey(key: string): key is VideoModelKey {
  return VIDEO_MODELS.some((model) => model.key === key);
}
