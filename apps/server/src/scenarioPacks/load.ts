import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createScenarioPackRegistry, parseScenarioPack, type ScenarioPack, type ScenarioPackRegistry } from '@templeyard/shared';

/** 讀一個資料夾裡每個子資料夾的 pack.json 並驗證 */
function loadDir(dir: string): ScenarioPack[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`找不到情境包資料夾：${dir}`);
  const packs: ScenarioPack[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'pack.json');
    if (!existsSync(file)) throw new Error(`情境包設定錯誤（${entry.name}）：找不到 ${path.join(entry.name, 'pack.json')}`);

    let json: unknown;
    try {
      json = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      throw new Error(`情境包設定錯誤（${path.join(entry.name, 'pack.json')}）：不是正確的 JSON`);
    }
    const pack = parseScenarioPack(json, path.join(entry.name, 'pack.json'));
    // 資料夾名稱就是情境包代號，兩者不同時很容易放錯地方
    if (pack.id !== entry.name) {
      throw new Error(`情境包設定錯誤（${path.join(entry.name, 'pack.json')}）：資料夾名稱「${entry.name}」與設定檔的 id「${pack.id}」不同`);
    }
    packs.push(pack);
  }
  return packs;
}

/** 讀取各資料夾底下的 <id>/pack.json 並驗證；任何一個有錯就丟出錯誤（啟動失敗）；代號重複也算錯 */
export function loadScenarioPacks(dirs: readonly string[]): ScenarioPackRegistry {
  return createScenarioPackRegistry(dirs.flatMap(loadDir));
}
