# 調音器＋人聲音高檢測

給合唱團練習音準、也能幫樂器調音的手機 App（PWA）。免費、不用註冊，聲音只在手機裡分析、不會上傳，安裝後沒有網路也能使用。

**👉 App 網址：https://scott-tw.github.io/tuner/**

---

## 📘 文件目錄

| 文件 | 給誰看 | 內容 |
|---|---|---|
| [使用說明](docs/使用說明.md) | 團員、家長、老師 | 安裝到主畫面、功能介紹、常見問題、**可直接貼到 LINE 群組的分享文字**（團員版、家長版） |
| [開發說明](docs/開發說明.md) | 維護程式的人 | 資料夾結構、本機預覽、自動測試、部署發布、偵測引擎重點、用 Claude Code 修改的方式 |
| [需求規格書](docs/SPEC.md) | 維護程式的人 | 原始需求與各階段驗收標準 |
| [CLAUDE.md](CLAUDE.md) | Claude Code | 開發規則（每次對話自動讀取） |

---

## 🔗 網址

- App：https://scott-tw.github.io/tuner/
- 測試音產生器：https://scott-tw.github.io/tuner/tools/test-tone.html
- 程式碼：https://github.com/scott-tw/tuner

## ⚡ 快速指令

```bash
# 本機預覽（再開 http://localhost:8000）
python3 -m http.server 8000

# 執行自動測試
node --test

# 發布新版（推上 GitHub 約 1 分鐘後網站自動更新）
git push
```

## ✅ 開發進度

- [x] 階段 1：偵測引擎＋自動測試
- [x] 階段 2：樂器調音器畫面＋測試音產生器
- [x] 階段 3：人聲模式（童聲／女聲／男聲、三層八度防護、五線譜）
- [x] 階段 4：音高軌跡、目標音、參考音、變聲期提示
- [x] 階段 5：PWA（可安裝、可離線）與部署

## 授權說明

五線譜上的譜號與 App 圖示的外形取自 [Bravura](https://github.com/steinbergmedia/bravura) 樂譜字型（© Steinberg Media Technologies GmbH，SIL Open Font License 1.1）。
