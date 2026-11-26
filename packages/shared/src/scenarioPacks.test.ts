import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createScenarioPackRegistry,
  parseScenarioPack,
  scenarioLabels,
  scenarioPacksResponseSchema,
  toScenarioPackSummary,
  type ScenarioPack,
} from './scenarioPacks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packsDir = path.resolve(here, '..', '..', '..', 'scenario-packs');

function readPack(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(packsDir, id, 'pack.json'), 'utf8')) as Record<string, unknown>;
}

function templePack(): ScenarioPack {
  return parseScenarioPack(readPack('temple'), 'temple/pack.json');
}

function ecommercePack(): ScenarioPack {
  return parseScenarioPack(readPack('ecommerce'), 'ecommerce/pack.json');
}

/** 取一份正確的設定，改掉一個欄位後驗證 */
function parseWith(change: (pack: Record<string, unknown>) => void): () => ScenarioPack {
  const pack = readPack('ecommerce');
  change(pack);
  return () => parseScenarioPack(pack, 'ecommerce/pack.json');
}

describe('情境包設定檔驗證', () => {
  it('廟埕包與電商包的設定都通過驗證', () => {
    expect(templePack().id).toBe('temple');
    expect(ecommercePack().id).toBe('ecommerce');
  });

  it('廟埕包：主體是寺廟、16:9、30 秒，三個功能開關全關', () => {
    const pack = templePack();
    expect(pack.subject_type).toBe('temple');
    expect(pack.default_aspect_ratio).toBe('16:9');
    expect(pack.default_duration_sec).toBe(30);
    expect(pack.features).toEqual({ scriptProposals: false, styleQuestion: false, productHero: false });
    expect(pack.categories).toEqual([]);
    expect(pack.labels).toMatchObject({ subject: '寺廟', board: '寺廟定裝版', subjectPhotos: '寺廟照片' });
  });

  it('電商包：主體是商品、9:16、15 秒，三個功能開關全開', () => {
    const pack = ecommercePack();
    expect(pack.subject_type).toBe('product');
    expect(pack.default_aspect_ratio).toBe('9:16');
    expect(pack.default_duration_sec).toBe(15);
    expect(pack.features).toEqual({ scriptProposals: true, styleQuestion: true, productHero: true });
    expect(pack.labels).toMatchObject({ subject: '商品', board: '商品定裝版', subjectPhotos: '商品照' });
  });

  it('電商包的視角、腳本段落、風格與類別依 05 的清單', () => {
    const pack = ecommercePack();
    expect(pack.view_keys.map((view) => view.key)).toEqual(['front', 'angle_45', 'back_side', 'detail', 'package', 'in_use']);
    expect(pack.script_structure.map((part) => part.key)).toEqual(['hook', 'pain', 'demo', 'benefit', 'cta']);
    expect(pack.style_options.map((style) => style.key)).toEqual(['humor', 'exaggerated', 'realistic', 'warm', 'premium']);
    expect(pack.categories).toEqual(['服飾配件', '3C 家電', '居家生活', '美妝保養', '食品飲料', '保健', '其他']);
    expect(pack.directions).toEqual(['新品上市', '促銷活動', '品牌故事', '使用教學']);
    expect(Object.keys(pack.prompts)).toEqual(expect.arrayContaining(['product-view', 'script-proposal']));
  });

  it('缺少欄位時，訊息指出檔案與欄位名稱', () => {
    const parse = parseWith((pack) => {
      delete pack.labels;
    });
    expect(parse).toThrow(/ecommerce\/pack\.json/);
    expect(parse).toThrow(/labels/);
  });

  it('features 的型別錯誤時，訊息指出 features.scriptProposals', () => {
    const parse = parseWith((pack) => {
      pack.features = { scriptProposals: 'yes', styleQuestion: true, productHero: true };
    });
    expect(parse).toThrow(/features\.scriptProposals/);
  });

  it('view_keys 有重複的 key 時，訊息指出重複的 key', () => {
    const parse = parseWith((pack) => {
      pack.view_keys = [
        { key: 'front', name: '正面' },
        { key: 'front', name: '正面（再一次）' },
      ];
    });
    expect(parse).toThrow(/view_keys/);
    expect(parse).toThrow(/front/);
    expect(parse).toThrow(/重複/);
  });

  it('view_keys 的 key 格式錯誤（大寫、空白、中文）時不通過', () => {
    for (const key of ['Front', 'front view', '正面', '']) {
      const parse = parseWith((pack) => {
        pack.view_keys = [{ key, name: '正面' }];
      });
      expect(parse, `key = "${key}"`).toThrow(/view_keys/);
    }
  });

  it('view_keys 不能是空的', () => {
    const parse = parseWith((pack) => {
      pack.view_keys = [];
    });
    expect(parse).toThrow(/view_keys/);
  });

  it('subject_type 不是 temple 或 product 時不通過', () => {
    const parse = parseWith((pack) => {
      pack.subject_type = 'restaurant';
    });
    expect(parse).toThrow(/subject_type/);
  });

  it('預設比例只接受 16:9 與 9:16', () => {
    const parse = parseWith((pack) => {
      pack.default_aspect_ratio = '4:3';
    });
    expect(parse).toThrow(/default_aspect_ratio/);
  });

  it('prompts 只驗證格式：節點代號對應的指令 id 要是小寫英數與連字號', () => {
    const bad = parseWith((pack) => {
      pack.prompts = { 'product-view': 'Product View!' };
    });
    expect(bad).toThrow(/prompts/);
    const unknownButWellFormed = parseWith((pack) => {
      pack.prompts = { 'product-view': 'not-yet-created' };
    });
    expect(unknownButWellFormed).not.toThrow();
  });

  it('同時有多個錯誤時，全部列出來', () => {
    const parse = parseWith((pack) => {
      delete pack.labels;
      pack.default_duration_sec = 'long';
    });
    expect(parse).toThrow(/labels/);
    expect(parse).toThrow(/default_duration_sec/);
  });

  it('不是物件的內容（例如 null）也會說明錯誤', () => {
    expect(() => parseScenarioPack(null, 'x/pack.json')).toThrow(/x\/pack\.json/);
  });
});

describe('情境包登記表', () => {
  it('依代號取得，也能列出全部', () => {
    const registry = createScenarioPackRegistry([templePack(), ecommercePack()]);
    expect(registry.list().map((pack) => pack.id)).toEqual(['temple', 'ecommerce']);
    expect(registry.get('ecommerce')?.name).toBe('電商');
    expect(registry.has('temple')).toBe(true);
    expect(registry.has('nope')).toBe(false);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('代號重複時丟出錯誤', () => {
    expect(() => createScenarioPackRegistry([templePack(), templePack()])).toThrow(/temple.*重複|重複.*temple/);
  });
});

describe('情境包摘要（GET /api/scenario-packs）', () => {
  it('只帶畫面需要的欄位，並用 camelCase', () => {
    const summary = toScenarioPackSummary(ecommercePack());
    expect(summary).toMatchObject({
      id: 'ecommerce',
      name: '電商',
      subjectType: 'product',
      defaultAspectRatio: '9:16',
      defaultDurationSec: 15,
      features: { scriptProposals: true, styleQuestion: true, productHero: true },
    });
    expect(summary.directions).toContain('新品上市');
    expect(scenarioPacksResponseSchema.safeParse({ scenarioPacks: [summary] }).success).toBe(true);
    expect(summary).not.toHaveProperty('compliance');
    expect(summary).not.toHaveProperty('prompts');
  });
});

describe('介面用詞', () => {
  it('依情境包的 labels', () => {
    const labels = scenarioLabels(toScenarioPackSummary(ecommercePack()));
    expect(labels.board).toBe('商品定裝版');
  });

  it('沒有情境包資料時，用廟埕包的用詞', () => {
    expect(scenarioLabels(undefined)).toMatchObject({ subject: '寺廟', board: '寺廟定裝版', subjectPhotos: '寺廟照片' });
  });
});
