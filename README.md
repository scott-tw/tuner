# 調音器＋人聲音高檢測

給合唱團與樂器使用的手機網頁 App（PWA）。所有分析都在裝置上完成，不上傳任何聲音。完整需求見 [SPEC.md](SPEC.md)。

**App 網址：https://scott-tw.github.io/tuner/**

---

## 🎵 給合唱團團員：安裝說明

這個調音器可以像一般 App 一樣放在手機主畫面，**不用到商店下載、完全免費**，裝好之後沒有網路也能用。

### Android 手機／平板（Chrome）

1. 用 Chrome 打開 **https://scott-tw.github.io/tuner/**
2. 點右上角的「⋮」
3. 選「**安裝應用程式**」（有些手機寫「加到主畫面」）→ 按「安裝」

### 三星手機／平板（Samsung Internet 三星瀏覽器）

1. 用三星瀏覽器打開上面的網址
2. 點右下角的「≡」選單
3. 選「**新增頁面至**」→「**主畫面**」

### iPhone／iPad（Safari）

1. 用 **Safari** 打開上面的網址（其他瀏覽器不行）
2. 點下方（iPad 在上方）的「分享」按鈕（方框加向上箭頭）
3. 往下找「**加入主畫面**」→ 按「新增」

### 第一次使用

- 從主畫面點「調音器」圖示打開。
- 選「🎤 人聲音高」或「🎸 樂器調音」後，會問能不能使用麥克風，請按「**允許**」。
  聲音只在你的手機裡分析，不會錄音、也不會上傳。
- 練唱時選自己的聲音類型：**童聲、女聲或男聲**。
- 安裝好、開過一次之後，**沒有網路也能使用**。

### 小提醒

- 練唱時手機放在離嘴巴 30–50 公分的地方，在安靜的地方效果最好。
- 使用「持續長音」跟著唱時，把音量調小或戴耳機，App 比較不會把喇叭的聲音當成你的歌聲。
- App 有新版本時會自動在背景更新，**把 App 關掉再打開一次**就是新版。

---

## 進度

- [x] 階段 1：偵測引擎（`js/pitch.js`）＋自動測試（`tests/pitch.test.js`）
- [x] 階段 2：樂器調音器畫面（含 `tools/test-tone.html` 測試音產生器）
- [x] 階段 3：人聲模式基本版（童聲／女聲／男聲、三層八度防護、五線譜）
- [x] 階段 4：音高軌跡＋目標音＋參考音＋變聲期提示
- [x] 階段 5：PWA＋部署（manifest、Service Worker 離線快取、App 圖示）

## 網址

- App：https://scott-tw.github.io/tuner/
- 測試音產生器：https://scott-tw.github.io/tuner/tools/test-tone.html

## 開發說明

### 執行測試

```bash
node --test
```

（Node 25 起，`node --test tests/` 這種寫法會把資料夾當成檔案而失敗；不加參數時會自動找到 `tests/` 裡的測試檔。）

### 本機預覽

```bash
python3 -m http.server 8000
```

再用瀏覽器開 http://localhost:8000。

### 離線快取（sw.js）

- 採「先用快取、背景更新」：修改既有檔案後推上 GitHub 即可，使用者下次開啟 App 時就會拿到新版。
- **新增檔案時**，要把它加進 `sw.js` 的 `FILES` 清單，並把 `CACHE` 的版本號加一（例如 `tuner-v1` → `tuner-v2`），離線時才能使用新檔案。

## 授權說明

五線譜上的譜號與 App 圖示的外形取自 [Bravura](https://github.com/steinbergmedia/bravura) 樂譜字型（© Steinberg Media Technologies GmbH，SIL Open Font License 1.1）。
