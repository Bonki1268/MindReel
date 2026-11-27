# 第 16 階段：商品主體、商品定裝版（F25、F26）

測試提交：`a78ae03`（原紅燈 commit 為 `82f22e0`；82f22e0 之後經使用者同意修正兩個情境，新測試提交基準為 a78ae03）；實作：`258a19d`

## 1. 對應的 F 與完成條件

- [x] F25 商品主體：`products`、`photos.product_id`、`product_snapshot`、商品資料頁 `/series/:sid/products/:pid`、電商系列的建立影片頁（品名、品牌、類別、賣點、價格、規格、注意事項、1～5 張照片，沿用 F4 去識別）
- [x] F26 商品定裝版：`product_boards`、`product_board_versions`、`product_views`；依電商包 `view_keys` 產生、單張重生、修改、確認、沿用、另存新版本；標示「依照片」或「AI 推測」；費用同意比照寺廟定裝版；新增 `product-view` prompt 節點；鎖定圖片與影片模型
- [x] 完成條件：必填檢查（品名、類別、至少 1 條賣點、至少 1 張照片，場景大綱）
- [x] 完成條件：同系列第二支影片可沿用商品與商品定裝版；不同系列不能沿用
- [x] 完成條件：修改商品後既有影片 `product_snapshot` 不變，新影片帶入新值
- [x] 完成條件：AI 推測的視角未確認時，「確認商品定裝版」不能按
- [x] 完成條件：送往假 Comfy 的檔案全是 `cloud_ok = 1`；沒有同意憑證時產生定裝版回 409

## 2. 測試

- 情境：2 個 feature（`product.feature`、`product-board.feature`），共 22 個場景／場景大綱（含例子展開更多）。
- 紅燈（82f22e0）：新測試全部以「尚未實作」失敗。
- 測試修正（a78ae03，使用者同意）：刪除 `features/stage-15-scenario-packs` 中過時的「電商系列建立影片頁顯示『商品功能在下一階段加入』」情境（與第 16 階段情境互相矛盾）；在 `tests/e2e/steps/temple-board.steps.ts` 的「網址是這支影片的」step 補上從網址記下影片編號。
- 綠燈：`pnpm test` 133 檔、1621 項全過（第 15 階段結束時 1497，約新增 124 項單元測試）；`pnpm test:e2e` 451 項（第 15 階段結束時 423）；`pnpm typecheck`、`pnpm lint` 通過。
- 不穩定情境（如實記錄）：首次 `pnpm test` 有 1 項失敗（既有已知的並行逾時問題），再跑全過；`pnpm test:e2e` 整套跑時 stage-12「用對話修改成品…」失敗 1 項（合成等待逾時），單獨重跑通過；其餘 450 項通過。
- `verify-tests-untouched.mjs a78ae03` 通過。

## 3. 新增套件與命名

- 沒有新增套件。
- 自己取的名稱：`CreateProductVideoPage`、`ProductPage`（路由 `/series/:sid/products/:pid`）、`ProductBoardPage`（路由 `/videos/:vid/product-board`）、`ProductPicker`、`ViewCoverage`、`ReuseProductBoard`；shared 的 products／productBoards／productVideos；drizzle 遷移 `0014`。
- `planProductViews` 排序：依照片的視角排前面、AI 推測的排後面。
- `ModelSection` 改成收 `video`／`onUpdated`／`boardLabel`（讓寺廟與商品定裝版共用）。

## 4. 對齊檢查 5 問

1. 對應 F25、F26；只做 06 第 16 階段條列，沒提前做直式輸出、商品保真、腳本企劃、登入。
2. 沒有做到 01「這一版不做的東西」。
3. 資料表（products、product_boards、product_board_versions、product_views、photos.product_id、videos.product_snapshot）與路由依 05、03；元件名稱見上，自取的已列出。
4. 沒有金鑰或原圖被送出或寫進紀錄：送往 Comfy 的函式只收 `cloud_ok` 資產；測試檢查假 Comfy 收到的檔案全為 `cloud_ok = 1`。
5. 產生商品定裝版需同意憑證，沒有憑證回 409；沒有不經同意可觸發的付費生成。

## 5. 等你處理

- 「商品定裝版」的實拍照片怎麼交給 Comfy MCP 仍是 07 待測項目（沿用既有介面加假實作）。
- `scheduleRegeneration.test.ts` 與 stage-12、plan-edit、stage-03 選寺廟等情境整套並行偶發逾時，單獨跑通過；建議調高逾時或降低並行（舊階段測試，需你同意才改）。
- 介面用詞（`labels`）已套到商品相關新畫面；問卷等畫面等第 18 階段有差異時再接。
- `product-view` prompt 已建立並驗證格式；真實生成效果需你用 `pnpm test:live` 實測。

## 6. 稽核結果

（由稽核者填寫）
