import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadPromptFiles } from '@templeyard/prompts';
import type { PromptFile } from '@templeyard/shared';

/**
 * 讀各資料夾底下每個情境包自己的指令：<資料夾>/<情境包>/prompts/*.json（格式與 prompt-studio/prompts 相同）。
 * 沒有 prompts 資料夾的情境包略過；指令檔不合法時指出是哪個情境包的哪個檔案；不同情境包的指令 id 重複也算錯。
 */
export function loadPackPrompts(dirs: readonly string[]): Map<string, PromptFile> {
  const all = new Map<string, PromptFile>();
  const owner = new Map<string, string>();
  for (const dir of dirs) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const promptsDir = path.join(dir, entry.name, 'prompts');
      if (!existsSync(promptsDir) || !statSync(promptsDir).isDirectory()) continue;
      let loaded: Map<string, PromptFile>;
      try {
        loaded = loadPromptFiles(promptsDir);
      } catch (error: unknown) {
        throw new Error(`情境包「${entry.name}」的指令錯誤：${error instanceof Error ? error.message : String(error)}`);
      }
      for (const [id, prompt] of loaded) {
        const previous = owner.get(id);
        if (previous) throw new Error(`指令 id 重複：${id}（情境包「${previous}」與「${entry.name}」）`);
        owner.set(id, entry.name);
        all.set(id, prompt);
      }
    }
  }
  return all;
}
