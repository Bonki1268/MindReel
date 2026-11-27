import { z } from 'zod';
import templePackJson from '../../../scenario-packs/temple/pack.json' with { type: 'json' };

// 情境包（docs/05-Backend-Schema.md「情境包設定檔」）：scenario-packs/<id>/pack.json
// 啟動時驗證，格式錯誤就啟動失敗並說明檔案與欄位；新增情境包只要新增資料夾與設定檔。

const keySchema = (what: string) =>
  z.string().regex(/^[a-z][a-z0-9_]*$/, { error: `${what}只能用小寫英文、數字與底線，並以英文字母開頭` });

const packIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, { error: '情境包代號只能用小寫英文、數字與連字號，並以英文字母開頭' });

export const SCENARIO_SUBJECT_TYPES = ['temple', 'product'] as const;
export type ScenarioSubjectType = (typeof SCENARIO_SUBJECT_TYPES)[number];

export const PACK_ASPECT_RATIOS = ['16:9', '9:16'] as const;
export type PackAspectRatio = (typeof PACK_ASPECT_RATIOS)[number];

const nonEmpty = z.string().min(1, { error: '不能是空白' });

/** 字幕安全區：離上下邊緣的比例（0～0.5） */
const safeAreaSchema = z.object({ top: z.number().min(0).max(0.5), bottom: z.number().min(0).max(0.5) });

export const scenarioPackSchema = z.object({
  id: packIdSchema,
  name: nonEmpty,
  subject_type: z.enum(SCENARIO_SUBJECT_TYPES),
  /** 介面用詞；subject、board、subjectPhotos 必填，其他用詞自由增加 */
  labels: z.object({ subject: nonEmpty, board: nonEmpty, subjectPhotos: nonEmpty }).catchall(z.string()),
  directions: z.array(nonEmpty),
  categories: z.array(nonEmpty),
  view_keys: z
    .array(z.object({ key: keySchema('view_key'), name: nonEmpty }))
    .min(1, { error: '至少要有一個視角' })
    .superRefine((views, context) => {
      const seen = new Set<string>();
      for (const view of views) {
        if (seen.has(view.key)) context.addIssue({ code: 'custom', message: `view_key 重複：${view.key}` });
        seen.add(view.key);
      }
    }),
  features: z.object({ scriptProposals: z.boolean(), styleQuestion: z.boolean(), productHero: z.boolean() }),
  script_structure: z.array(z.object({ key: keySchema('段落 key'), name: nonEmpty, purpose: z.string() })),
  style_options: z.array(z.object({ key: keySchema('風格 key'), name: nonEmpty, prompt_fragment: z.string() })),
  default_aspect_ratio: z.enum(PACK_ASPECT_RATIOS),
  default_duration_sec: z.number().int().positive(),
  subtitle_safe_area: z.partialRecord(z.enum(PACK_ASPECT_RATIOS), safeAreaSchema),
  compliance: z.object({
    blocked_terms: z.record(z.string(), z.array(z.string())),
    warn_terms: z.record(z.string(), z.array(z.string())),
    replacements: z.record(z.string(), z.string()),
  }),
  /** 節點代號 → Prompt Studio 的指令 id；只驗證格式，不檢查指令是否已建立 */
  prompts: z.record(
    z.string().regex(/^[a-z][a-z0-9-]*$/, { error: '節點代號格式不正確' }),
    z.string().regex(/^[a-z0-9][a-z0-9-]*$/, { error: '指令 id 只能用小寫英文、數字與連字號' }),
  ),
});
export type ScenarioPack = z.infer<typeof scenarioPackSchema>;

function pathText(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '（整份設定）' : path.map(String).join('.');
}

/** 驗證 pack.json 的內容；失敗時丟出的訊息指出檔案（source）與每個有問題的欄位 */
export function parseScenarioPack(input: unknown, source: string): ScenarioPack {
  const result = scenarioPackSchema.safeParse(input);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => `  欄位 ${pathText(issue.path)}：${issue.message}`);
  throw new Error(`情境包設定錯誤（${source}）\n${lines.join('\n')}`);
}

export type ScenarioPackRegistry = {
  list: () => ScenarioPack[];
  get: (id: string) => ScenarioPack | undefined;
  has: (id: string) => boolean;
};

/** 把已驗證的情境包放進登記表；代號重複時丟出錯誤 */
export function createScenarioPackRegistry(packs: readonly ScenarioPack[]): ScenarioPackRegistry {
  const byId = new Map<string, ScenarioPack>();
  for (const pack of packs) {
    if (byId.has(pack.id)) throw new Error(`情境包代號重複：${pack.id}`);
    byId.set(pack.id, pack);
  }
  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
  };
}

/** GET /api/scenario-packs 的一列：畫面需要的欄位，用 camelCase */
export const scenarioPackSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  subjectType: z.enum(SCENARIO_SUBJECT_TYPES),
  labels: z.record(z.string(), z.string()),
  directions: z.array(z.string()),
  categories: z.array(z.string()),
  /** 定裝版的視角清單（商品照指定視角、讓 AI 推測缺少的視角） */
  viewKeys: z.array(z.object({ key: z.string(), name: z.string() })).default([]),
  defaultAspectRatio: z.enum(PACK_ASPECT_RATIOS),
  defaultDurationSec: z.number(),
  features: z.object({ scriptProposals: z.boolean(), styleQuestion: z.boolean(), productHero: z.boolean() }),
});
export type ScenarioPackSummary = z.infer<typeof scenarioPackSummarySchema>;

export const scenarioPacksResponseSchema = z.object({ scenarioPacks: z.array(scenarioPackSummarySchema) });

export function toScenarioPackSummary(pack: ScenarioPack): ScenarioPackSummary {
  return {
    id: pack.id,
    name: pack.name,
    subjectType: pack.subject_type,
    labels: { ...pack.labels },
    directions: [...pack.directions],
    categories: [...pack.categories],
    viewKeys: pack.view_keys.map((view) => ({ key: view.key, name: view.name })),
    defaultAspectRatio: pack.default_aspect_ratio,
    defaultDurationSec: pack.default_duration_sec,
    features: { ...pack.features },
  };
}

export type ScenarioLabels = ScenarioPack['labels'];

/** 介面用詞：沒有情境包資料時（讀取中、舊資料）用廟埕包的用詞 */
export function scenarioLabels(pack: { labels: Record<string, string> } | undefined): ScenarioLabels {
  return pack ? { ...TEMPLE_PACK.labels, ...pack.labels } : TEMPLE_PACK.labels;
}

/** 廟埕包（內建）：舊流程的視角與影片方向、沒有情境包資料時的用詞都來自它 */
export const TEMPLE_PACK: ScenarioPack = parseScenarioPack(templePackJson, 'scenario-packs/temple/pack.json');
