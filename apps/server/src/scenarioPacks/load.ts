import type { ScenarioPackRegistry } from '@templeyard/shared';

/** 讀取各資料夾底下的 <id>/pack.json 並驗證；任何一個有錯就丟出錯誤（啟動失敗） */
export function loadScenarioPacks(_dirs: readonly string[]): ScenarioPackRegistry {
  throw new Error('尚未實作');
}
