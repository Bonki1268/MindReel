import { VIDEO_MODELS, type ModelInfo, type VideoModelKey } from '@templeyard/shared';

/** 介面上的影片模型選項；unavailable 表示後端尚未支援，只顯示、不能選 */
export type VideoModelOption = ModelInfo & { key: string; unavailable?: boolean };

/** 介面只顯示 Gemini 與 Higgsfield；Higgsfield 還沒接後端與 workflow，先標示尚未開放 */
export const VIDEO_MODEL_OPTIONS: readonly VideoModelOption[] = [
  ...VIDEO_MODELS.filter((model) => model.key === 'gemini-omni-1.1-flash'),
  { key: 'higgsfield', label: 'Higgsfield', features: '尚未開放', referencePrice: null, unavailable: true },
];

export function isVideoModelKey(key: string): key is VideoModelKey {
  return VIDEO_MODELS.some((model) => model.key === key);
}
