import { SERIES_DIRECTIONS, type ScenarioPackSummary } from '@templeyard/shared';
import type { SeriesFormState } from './seriesForm';

/** 建立系列時預設的情境包 */
export const DEFAULT_SCENARIO_PACK = 'temple';

/** 影片方向的選項：依情境包；還沒讀到情境包清單時用廟埕包的選項 */
export function directionsFor(_pack: Pick<ScenarioPackSummary, 'directions'> | undefined): readonly string[] {
  void SERIES_DIRECTIONS;
  throw new Error('尚未實作');
}

/** 換情境包後，原本選的影片方向不在新選項裡就清掉；自己寫的內容保留 */
export function reconcileDirection(_form: SeriesFormState, _directions: readonly string[]): SeriesFormState {
  throw new Error('尚未實作');
}
