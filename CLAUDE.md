# 專案說明（給 Claude Code）

調音器＋人聲音高檢測 PWA。完整需求見 `SPEC.md`，動手前務必先讀。

## 使用者

- 專案負責人是國小校長，熟悉 Google Apps Script，但不是專業工程師。
- 請用繁體中文溝通。說明要白話，每一階段結束時告訴他：做了什麼、怎麼在手機上測試、下一步是什麼。

## 開發規則

- 原生 HTML / CSS / JS，不使用框架、不需建置步驟。不要自行加入 npm 套件（測試只用 Node 內建的 `node --test`）。
- 無後端，不上傳任何聲音或個人資料。
- `js/pitch.js` 必須是純函式、不碰 DOM，才能在 Node 中測試。
- sampleRate 一律從 AudioContext 取得，不可寫死 44100 或 48000。
- 啟動音訊與麥克風必須在使用者點擊的 handler 內完成（iOS Safari 限制）。
- 每次修改偵測引擎後都要執行 `node --test tests/`，全部通過才能 commit。
- 一次只做一個階段（見 SPEC.md 第 11 節），不要跳階段。
- 每個階段完成後 git commit，訊息用中文描述。
- 不確定的需求先問，不要自行假設。

## 測試

- 本機：`python3 -m http.server 8000`，Mac 瀏覽器開 http://localhost:8000（localhost 可使用麥克風）。
- 手機測試：推送到 GitHub 後透過 GitHub Pages 的 HTTPS 網址開啟。
- `tools/test-tone.html` 可在另一台裝置播放指定頻率，用來驗證偵測準確度。
