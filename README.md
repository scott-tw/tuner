# 調音器＋人聲音高檢測

給合唱團與樂器使用的手機網頁 App（PWA）。所有分析都在裝置上完成，不上傳任何聲音。完整需求見 [SPEC.md](SPEC.md)。

## 進度

- [x] 階段 1：偵測引擎（`js/pitch.js`）＋自動測試（`tests/pitch.test.js`）
- [x] 階段 2：樂器調音器畫面（含 `tools/test-tone.html` 測試音產生器）
- [x] 階段 3：人聲模式基本版（童聲／女聲／男聲、三層八度防護、五線譜）
- [x] 階段 4：音高軌跡＋目標音＋參考音＋變聲期提示 — 待實機驗收
- [ ] 階段 5：PWA＋部署

## 網址

- App：https://scott-tw.github.io/tuner/
- 測試音產生器：https://scott-tw.github.io/tuner/tools/test-tone.html

## 執行測試

```bash
node --test
```

（Node 25 起，`node --test tests/` 這種寫法會把資料夾當成檔案而失敗；不加參數時會自動找到 `tests/pitch.test.js`。）

## 本機預覽

```bash
python3 -m http.server 8000
```

再用瀏覽器開 http://localhost:8000。

## 授權說明

五線譜上的譜號外形取自 [Bravura](https://github.com/steinbergmedia/bravura) 樂譜字型（© Steinberg Media Technologies GmbH，SIL Open Font License 1.1）。
