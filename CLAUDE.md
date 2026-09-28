# 專案說明（給 Claude Code）

調音器＋人聲音高檢測 PWA。完整需求見 `docs/SPEC.md`，動手前務必先讀。開發與部署細節見 `docs/開發說明.md`，給使用者的說明見 `docs/使用說明.md`。

## 使用者

- 專案負責人是國小校長，熟悉 Google Apps Script，但不是專業工程師。
- 請用繁體中文溝通。說明要白話，每一階段結束時告訴他：做了什麼、怎麼在手機上測試、下一步是什麼。

## 開發規則

- 原生 HTML / CSS / JS，不使用框架、不需建置步驟。不要自行加入 npm 套件（測試只用 Node 內建的 `node --test`）。
- 無後端，不上傳任何聲音或個人資料。
- `js/pitch.js` 必須是純函式、不碰 DOM，才能在 Node 中測試。
- sampleRate 一律從 AudioContext 取得，不可寫死 44100 或 48000。
- 啟動音訊與麥克風必須在使用者點擊的 handler 內完成（iOS Safari 限制）。
- 每次修改偵測引擎後都要執行 `node --test`（會自動找到 tests/ 裡的測試檔），全部通過才能 commit。
- 一次只做一個階段（見 docs/SPEC.md 第 11 節），不要跳階段。
- 每個階段完成後 git commit，訊息用中文描述。
- 不確定的需求先問，不要自行假設。
- 功能、操作或網址有變動時，同步更新 `docs/使用說明.md`（含 LINE 分享文字）；開發流程、檔案結構或測試有變動時，同步更新 `docs/開發說明.md`。
- 每次發布（推上 GitHub）前，把 `js/app.js` 的 `APP_VERSION` 改成當天日期（例如 `2026.09.29`；同一天第二次發布加 `-2`），讓使用者能在設定頁確認手機上的版本。
- 新增任何要給 App 使用的檔案（JS、CSS、圖示、頁面等）時，必須加進 `sw.js` 的 `FILES` 清單，並把 `CACHE` 版本號加一（例如 `tuner-v1` → `tuner-v2`），否則離線時無法使用。只修改既有檔案則不需要。

## 測試

- 本機：`python3 -m http.server 8000`，Mac 瀏覽器開 http://localhost:8000（localhost 可使用麥克風）。
- 手機測試：推送到 GitHub 後透過 GitHub Pages 的 HTTPS 網址開啟。
- `tools/test-tone.html` 可在另一台裝置播放指定頻率，用來驗證偵測準確度。
