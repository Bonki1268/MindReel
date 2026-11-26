import { z } from 'zod';

// 情境包（docs/05-Backend-Schema.md「情境包設定檔」）：scenario-packs/<id>/pack.json

export type ScenarioSubjectType = 'temple' | 'product';
export type PackAspectRatio = '16:9' | '9:16';

export type ScenarioPack = {
  id: string;
  name: string;
  subject_type: ScenarioSubjectType;
  labels: { subject: string; board: string; subjectPhotos: string } & Record<string, string>;
  directions: string[];
  categories: string[];
  view_keys: { key: string; name: string }[];
  features: { scriptProposals: boolean; styleQuestion: boolean; productHero: boolean };
  script_structure: { key: string; name: string; purpose: string }[];
  style_options: { key: string; name: string; prompt_fragment: string }[];
  default_aspect_ratio: PackAspectRatio;
  default_duration_sec: number;
  subtitle_safe_area: Partial<Record<PackAspectRatio, { top: number; bottom: number }>>;
  compliance: { blocked_terms: Record<string, string[]>; warn_terms: Record<string, string[]>; replacements: Record<string, string> };
  prompts: Record<string, string>;
};

/** GET /api/scenario-packs 的一列 */
export const scenarioPackSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  subjectType: z.enum(['temple', 'product']),
  labels: z.record(z.string(), z.string()),
  directions: z.array(z.string()),
  categories: z.array(z.string()),
  defaultAspectRatio: z.enum(['16:9', '9:16']),
  defaultDurationSec: z.number(),
  features: z.object({ scriptProposals: z.boolean(), styleQuestion: z.boolean(), productHero: z.boolean() }),
});
export type ScenarioPackSummary = z.infer<typeof scenarioPackSummarySchema>;

export const scenarioPacksResponseSchema = z.object({ scenarioPacks: z.array(scenarioPackSummarySchema) });

export type ScenarioPackRegistry = {
  list: () => ScenarioPack[];
  get: (id: string) => ScenarioPack | undefined;
  has: (id: string) => boolean;
};

/** 驗證 pack.json 的內容；失敗時丟出的訊息指出檔案（source）與欄位 */
export function parseScenarioPack(_input: unknown, _source: string): ScenarioPack {
  throw new Error('尚未實作');
}

/** 把已驗證的情境包放進登記表；代號重複時丟出錯誤 */
export function createScenarioPackRegistry(_packs: readonly ScenarioPack[]): ScenarioPackRegistry {
  throw new Error('尚未實作');
}

export function toScenarioPackSummary(_pack: ScenarioPack): ScenarioPackSummary {
  throw new Error('尚未實作');
}

export type ScenarioLabels = { subject: string; board: string; subjectPhotos: string } & Record<string, string>;

/** 介面用詞：沒有情境包資料時（讀取中、舊資料）用廟埕包的用詞 */
export function scenarioLabels(_pack: { labels: Record<string, string> } | undefined): ScenarioLabels {
  throw new Error('尚未實作');
}
