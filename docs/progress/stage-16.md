# 第 16 階段：商品主體、商品定裝版（F25、F26）

狀態：停止（未 commit 實作）

## 做到哪

- 測試提交：82f22e0（紅燈）。
- 實作完成並留在工作區（未 commit）：後端 products／productBoards 服務與路由、drizzle 0014、shared 的 products／productBoards／productVideos；前端 `features/products/*`、`pages/CreateProductVideoPage.tsx`（電商系列的建立影片）、`pages/ProductPage.tsx`（商品資料頁）、`pages/ProductBoardPage.tsx`（商品定裝版頁）、路由、`ModelSection` 改成收 `video`／`onUpdated`／`boardLabel`。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`（133 檔、1621 項）通過；`pnpm test:e2e` 剩 2 個場景失敗，都是測試本身的問題（見下）。
- 實作時順手修了 `planProductViews`：依照片的視角排前面、AI 推測的排後面（e2e 例子 #2 要求「正面、細節特寫、45 度角」；單元測試兩種順序都相容）。

## 停止原因（測試本身寫錯，綠燈後不能改）

1. 第 15 階段情境「電商系列的建立影片頁顯示『商品功能在下一階段加入』」與第 16 階段情境要求同一頁「看不到」同一句話，互相矛盾；第 15 階段那一條已過時。
2. 第 16 階段 `product-board.feature` 最後一個場景從畫面建立影片，但沒有 step 記下影片編號，「網址是這支影片的『/videos/:vid/product-board』」必定失敗。

## 等你處理

見 `docs/PROGRESS.md`「第 16 階段（停止）」。需要你同意修改上述兩處測試（綠燈後 hook 會擋，需要先回到紅燈或由你直接改），之後重跑 e2e、commit、收尾。

## 新增的名稱（文件沒寫、自取）

`CreateProductVideoPage`、`ProductPage`（路由 `/series/:sid/products/:pid`）、`ProductBoardPage`（路由 `/videos/:vid/product-board`）、`ProductPicker`、`ViewCoverage`、`ReuseProductBoard`。未新增套件。

## 稽核結果

（由稽核者填寫）
