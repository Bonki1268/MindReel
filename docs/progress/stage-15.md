# 第 15 階段：情境包框架、選擇情境包（F23、F24）

測試提交：`8bf4038`；實作：`0ce1792`

## 1. 對應的 F 與完成條件

- [x] F23 情境包框架：`scenario-packs/<id>/pack.json`＋shared Zod schema，啟動時載入驗證；新增情境包只放設定檔
- [x] F24 選擇情境包：建立系列選情境包、首頁卡片標籤、設定頁顯示但不可改、方向選項依情境包、用詞依 labels
- [x] 遷移：`series.scenario_pack`、`videos.subject_type`、`videos.aspect_ratio`（`0013_scenario_packs.sql`），既有資料一律 temple／16:9（有遷移測試）
- [x] `GET /api/scenario-packs`
- [x] 完成條件：設定錯誤時啟動失敗並指出檔案與欄位（缺欄位、features 型別錯、view_key 重複／格式錯；依使用者決定，「未知的 view_key」改為重複與格式檢查）
- [x] 完成條件：建立電商與廟埕系列、首頁標籤正確；`PATCH` 改情境包回 400（`scenarioPack`、`scenario_pack` 兩種寫法）
- [x] 完成條件：第三個情境包（只在 fixtures）不改流程程式即可建立系列（單元整合測試與 e2e 各一）
- [x] 完成條件：第 0～14 階段測試全過且未改動（`verify-tests-untouched` 通過）
- [x] 建立影片讀系列情境包：廟埕影片 temple／16:9；電商系列回 409「商品功能在下一階段加入」，建立影片頁顯示同句

## 2. 測試

- 情境：1 個 feature、21 個場景（含大綱例子），紅燈 21 失敗、綠燈 21 通過
- 單元測試：新增 52（shared 22、server 25、web 5）；紅燈 51 失敗＋viewsFromPack 檔案層級失敗，綠燈全通過
- 全套：單元 1497（既有 1445）、e2e 423（既有 402）；typecheck、lint 通過
- 備註：`apps/server/src/studio/scheduleRegeneration.test.ts` 在整套並行時 beforeEach 逾時 10 秒（FFmpeg 合成慢）；單獨跑通過，在尚未實作的紅燈 commit 上也同樣失敗，與本階段無關。

## 3. 新增套件與命名

- 沒有新增套件。
- 自己取的名稱：`scenarioSeriesSchema`／`ScenarioSeries`（系列多 `scenarioPack`）、`scenarioVideoSchema`／`ScenarioVideo`（影片多 `subjectType`、`aspectRatio`）、`scenarioPackSummarySchema`、`parseScenarioPack`、`createScenarioPackRegistry`、`scenarioLabels`、`TEMPLE_PACK`、`loadScenarioPacks`、`registerScenarioPackRoutes`、環境變數 `SCENARIO_PACKS_DIR`、`SCENARIO_PACKS_EXTRA_DIRS`、web 的 `useScenarioPacks`／`useScenarioPack`／`useScenarioLabels`、`scenarioPackForm.ts`。
- 為了不改動既有測試（它們用 `toEqual` 比對 `seriesSchema`、`videoSchema` 的輸出），既有的 `seriesSchema`、`videoSchema` 沒動，新欄位放在擴充的 schema；後端一律回傳擴充後的形狀。
- API JSON 沿用專案的 camelCase（`scenarioPack`）；資料表欄位是 `scenario_pack`。PATCH 兩種寫法都拒絕。
- 新元件：沒有新增元件，沿用 `OptionGroup`、`Tag`；設定頁多一行「情境包：<標籤>」。

## 4. 對齊檢查 5 問

1. 範圍：只做 06 第 15 階段條列，沒提前做商品、直式、腳本、登入、改名。
2. 廟埕包畫面與流程不變：既有 1445＋402 全過；用詞與方向選項與原本相同。
3. 沒有花錢、沒碰金鑰、沒 push。
4. `views.ts`、`SERIES_DIRECTIONS` 改讀 pack.json（單一來源）；`StandardViewKey` 型別仍手寫，由 `viewsFromPack.test.ts` 保證一致。
5. 規格文件未修改。

## 5. 等你處理

- 05 電商 directions 列有「自訂」：實作為既有的「或自己寫」，pack 只放四個選項，請確認。
- 介面用詞只套在建立影片頁與系列設定頁；其餘畫面（定裝版頁、問卷等）在第 16 階段電商畫面出現時一起改讀 labels。問卷與指令組裝在廟埕包下沒有差異，尚未讀情境包（無可驗證行為），第 16～18 階段才有差異時再接。
- 電商包 `compliance` 詞表先留空，等第 18 階段決定最終版本。
- `product-view`、`script-proposal` 兩個 prompts 項目只驗證格式，指令第 16、18 階段才建立。
- `scheduleRegeneration.test.ts` 整套並行偶發 hook 逾時（見上）。

## 6. 稽核結果

2026-11-26 稽核（test-auditor）：**通過**。

1. 測試沒被動過：`verify-tests-untouched.mjs 8bf4038` 通過；測試提交只新增測試檔，另外只修改 `tests/e2e/steps/fixtures.ts`（掛載第三個測試用情境包 fixture）；實作提交沒有動任何測試檔。
2. 全部通過：`pnpm typecheck`、`pnpm lint` 通過；`pnpm test:e2e` 423 全過；`pnpm test` 1496 通過、1 失敗，失敗的是 `apps/server/src/studio/scheduleRegeneration.test.ts` 的 beforeEach 逾時（整套並行時 FFmpeg 慢），單獨跑 2 項全過。稽核者沒有自行驗證「紅燈 commit 也會失敗」這一點。
3. 範圍：F23、F24 有 1 個 feature、17 個場景或大綱（e2e 展開約 21 個）；06 完成條件都有對應測試。稽核者沒有逐條核對 `load.test` 是否涵蓋「features 型別錯」「view_key 重複或格式錯」，只確認 shared 的 `scenarioPacks.test.ts`（195 行）有對應。
4. 測試不空洞：沒有 `.skip`、`.only`、`expect(true)`；steps 有 26 處斷言（稽核者沒有逐一檢查斷言內容）。
5. 不花錢、不洩漏：沒有金鑰字串、沒有讀 `.env`、新增套件 0。
6. 原圖不上雲：本階段沒有碰送往 Comfy Cloud 的路徑，不適用。
7. 沒有越界：沒有改名、登入、商品功能；使用者的決定都已反映。

輕微問題（不影響通過）：`scheduleRegeneration.test.ts` 整套並行時逾時，建議之後調高逾時或序列執行，否則稽核跑整套會反覆失敗。
