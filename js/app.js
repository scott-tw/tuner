// 畫面切換、設定、樂器調音 UI

import { detectPitch, freqToNote, PRESETS } from './pitch.js';
import { noteLabels } from './notation.js';
import {
  startAudio, stopAudio, getSampleRate, readBuffer, needsResume, resumeAudio, onStateChange,
} from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------- 設定（localStorage，讀寫都要 try/catch） ----------

const SETTINGS_KEY = 'tuner-settings';
const settings = { a4: 440, naming: 'both' };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isFinite(saved.a4)) settings.a4 = clampA4(saved.a4);
    if (['letter', 'solfege', 'both'].includes(saved.naming)) settings.naming = saved.naming;
  } catch { /* 讀不到就用預設值 */ }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* 無痕模式等情況無法儲存，不影響使用 */ }
}

const clampA4 = (v) => Math.min(446, Math.max(430, Math.round(v)));

function renderSettings() {
  $('a4-value').textContent = settings.a4;
  $('inst-a4').textContent = settings.a4;
  document.querySelectorAll('[data-a4]').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.a4) === settings.a4);
  });
  document.querySelectorAll('[data-naming]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.naming === settings.naming);
  });
}

document.querySelectorAll('[data-a4]').forEach((b) => b.addEventListener('click', () => {
  settings.a4 = Number(b.dataset.a4);
  saveSettings(); renderSettings();
}));
document.querySelectorAll('[data-a4-step]').forEach((b) => b.addEventListener('click', () => {
  settings.a4 = clampA4(settings.a4 + Number(b.dataset.a4Step));
  saveSettings(); renderSettings();
}));
document.querySelectorAll('[data-naming]').forEach((b) => b.addEventListener('click', () => {
  settings.naming = b.dataset.naming;
  saveSettings(); renderSettings();
}));

// ---------- 畫面切換（支援 Android 返回鍵） ----------

let current = 'home';

function showScreen(name) {
  if (current === 'instrument' && name !== 'instrument') stopListening();
  document.querySelectorAll('.screen').forEach((s) => { s.hidden = s.id !== name; });
  current = name;
  window.scrollTo(0, 0);
}

function go(name) {
  history.pushState({ screen: name }, '');
  showScreen(name);
}

window.addEventListener('popstate', (e) => {
  showScreen((e.state && e.state.screen) || 'home');
});

document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => history.back()));

$('btn-settings').addEventListener('click', () => go('settings'));

$('btn-voice').addEventListener('click', () => {
  const t = $('toast');
  t.textContent = '人聲音高模式正在製作中，下一版就能用囉！';
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 3000);
});

// ---------- 樂器調音 ----------

const ANALYSIS_INTERVAL = 40; // 毫秒，約 25 次／秒
const MEDIAN_SIZE = 7;        // 最近 7 格取中位數
const HOLD_MS = 1500;         // 無聲後保留最後一個音的時間
const RESET_GAP_MS = 300;     // 靜默超過這麼久，下一個音重新計算中位數
const IN_TUNE_CENTS = 5;

let listening = false;
let rafId = 0;
let lastAnalysis = 0;
let lastHeard = 0;
let recent = [];           // 最近偵測到的頻率
let targetCents = 0;
let shownCents = 0;
let hasNote = false;
let wakeLock = null;

$('btn-instrument').addEventListener('click', () => {
  go('instrument');
  beginListening(); // 在 click handler 內直接啟動音訊（iOS 限制）
});

$('btn-retry').addEventListener('click', () => beginListening());

function beginListening() {
  $('mic-error').hidden = true;
  $('tuner').hidden = false;
  resetDisplay();
  startAudio().then(() => {
    if (current !== 'instrument') { stopAudio(); return; } // 等權限時已離開
    listening = true;
    onStateChange(checkResume);
    requestWakeLock();
    lastAnalysis = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }, showMicError);
}

function stopListening() {
  listening = false;
  cancelAnimationFrame(rafId);
  stopAudio();
  releaseWakeLock();
  $('resume-overlay').hidden = true;
  document.body.classList.remove('in-tune');
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (now - lastAnalysis >= ANALYSIS_INTERVAL) {
    lastAnalysis = now;
    analyzeFrame(now);
  }
  // 指針緩動
  shownCents += (targetCents - shownCents) * 0.25;
  const pos = Math.max(-50, Math.min(50, shownCents));
  $('needle').style.transform = `translateX(${(pos / 50) * ($('needle').parentElement.clientWidth / 2)}px)`;
}

function analyzeFrame(now) {
  const buf = readBuffer();
  const sr = getSampleRate();
  if (!buf || !sr) return;
  const r = detectPitch(buf, sr, PRESETS.instrument);

  if (r) {
    if (now - lastHeard > RESET_GAP_MS) recent = [];
    lastHeard = now;
    recent.push(r.freq);
    if (recent.length > MEDIAN_SIZE) recent.shift();
    showNote(median(recent));
  } else if (hasNote && now - lastHeard > HOLD_MS) {
    fadeOut();
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function showNote(freq) {
  const n = freqToNote(freq, settings.a4);
  const label = noteLabels(n.midi);
  hasNote = true;

  const main = settings.naming === 'solfege' ? label.solfege : label.letter;
  $('note-name').textContent = main;
  $('note-oct').textContent = label.octave;
  $('note-sub').textContent = settings.naming === 'both' ? `${label.solfege}${label.octave}` : ' ';
  $('note-display').classList.remove('idle');

  const c = Math.round(n.cents);
  $('cents').textContent = `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)} 音分`;
  $('freq').textContent = `${freq.toFixed(1)} Hz`;
  targetCents = n.cents;

  const inTune = Math.abs(n.cents) <= IN_TUNE_CENTS;
  document.body.classList.toggle('in-tune', inTune);
  $('tune-hint').textContent = inTune ? '準了！很棒 👍' : n.cents < 0 ? '偏低，再高一點 ↑' : '偏高，再低一點 ↓';
}

function fadeOut() {
  hasNote = false;
  recent = [];
  $('note-display').classList.add('idle');
  $('cents').textContent = ' ';
  $('freq').textContent = ' ';
  $('tune-hint').textContent = '請彈奏或吹奏一個音';
  targetCents = 0;
  document.body.classList.remove('in-tune');
}

function resetDisplay() {
  fadeOut();
  $('note-name').textContent = '–';
  $('note-oct').textContent = '';
  $('note-sub').textContent = ' ';
  shownCents = 0;
}

// ---------- 麥克風錯誤說明 ----------

function showMicError(err) {
  if (current !== 'instrument') return;
  const kind = (err && err.kind) || 'other';
  $('tuner').hidden = true;
  $('mic-error').hidden = false;
  const title = $('mic-error-title');
  const body = $('mic-error-body');
  if (kind === 'denied') {
    title.textContent = '麥克風被關掉了';
    body.innerHTML = `
      <p>調音器需要「聽」聲音才能工作。聲音只在您的手機裡分析，不會上傳。</p>
      <p><b>Android（Chrome／三星瀏覽器）</b></p>
      <ol>
        <li>點網址列左邊的圖示（鎖頭或「⋮」旁的設定圖示）</li>
        <li>選「權限」或「網站設定」→「麥克風」→ 允許</li>
        <li>回來按下面的「再試一次」</li>
      </ol>
      <p><b>iPhone／iPad（Safari）</b></p>
      <ol>
        <li>點網址列左邊的「大小」圖示（ aA ）</li>
        <li>選「網站設定」→「麥克風」→ 允許</li>
        <li>回來按「再試一次」</li>
      </ol>
      <p>如果還是不行，請到手機的「設定 → 應用程式 → 瀏覽器 → 權限」確認麥克風已開啟。</p>`;
  } else if (kind === 'notfound') {
    title.textContent = '找不到麥克風';
    body.innerHTML = '<p>這台裝置好像沒有可用的麥克風。請確認沒有其他 App 正在使用麥克風，再試一次。</p>';
  } else if (kind === 'insecure') {
    title.textContent = '這個網址無法使用麥克風';
    body.innerHTML = '<p>瀏覽器只允許在 https 網址使用麥克風。請改用正式網址（https:// 開頭）開啟。</p>';
  } else {
    title.textContent = '麥克風暫時無法啟動';
    body.innerHTML = '<p>請關掉其他正在使用麥克風的 App（例如通話、錄音），再按「再試一次」。</p>';
  }
}

// ---------- 回到前景：點一下繼續 ----------

function checkResume() {
  if (!listening || document.visibilityState !== 'visible') return;
  $('resume-overlay').hidden = !needsResume();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && listening) {
    checkResume();
    requestWakeLock(); // 切到背景時 Wake Lock 會被系統釋放，需重新要求
  }
});

$('btn-resume').addEventListener('click', () => {
  resumeAudio().then(() => {
    $('resume-overlay').hidden = true;
    onStateChange(checkResume);
  }, showMicError);
});

// ---------- 螢幕保持亮著（不支援時靜默略過） ----------

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* 不支援或被拒絕，略過 */ }
}

function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* 略過 */ }
  wakeLock = null;
}

// ---------- 啟動 ----------

loadSettings();
renderSettings();
history.replaceState({ screen: 'home' }, '');
