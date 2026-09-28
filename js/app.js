// 畫面切換、設定、樂器調音與人聲音高 UI

import { detectPitch, PRESETS, createOctaveGuard } from './pitch.js';
import { noteLabels, staffSVG } from './notation.js';
import {
  startAudio, stopAudio, getSampleRate, readBuffer, needsResume, resumeAudio, onStateChange,
} from './audio.js';

const $ = (id) => document.getElementById(id);

// ---------- 設定（localStorage，讀寫都要 try/catch） ----------

const SETTINGS_KEY = 'tuner-settings';
const settings = { a4: 440, naming: 'both', voiceType: 'child', maleClef: 'bass' };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isFinite(saved.a4)) settings.a4 = clampA4(saved.a4);
    if (['letter', 'solfege', 'both'].includes(saved.naming)) settings.naming = saved.naming;
    if (['child', 'female', 'male'].includes(saved.voiceType)) settings.voiceType = saved.voiceType;
    if (['bass', 'treble8vb'].includes(saved.maleClef)) settings.maleClef = saved.maleClef;
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
  document.querySelectorAll('.a4-num').forEach((el) => { el.textContent = settings.a4; });
  document.querySelectorAll('[data-a4]').forEach((b) => {
    b.classList.toggle('selected', Number(b.dataset.a4) === settings.a4);
  });
  document.querySelectorAll('[data-naming]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.naming === settings.naming);
  });
  document.querySelectorAll('[data-voice]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.voice === settings.voiceType);
  });
  document.querySelectorAll('[data-clef]').forEach((b) => {
    b.classList.toggle('selected', b.dataset.clef === settings.maleClef);
  });
  $('clef-switch').hidden = settings.voiceType !== 'male';
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
document.querySelectorAll('[data-voice]').forEach((b) => b.addEventListener('click', () => {
  settings.voiceType = b.dataset.voice;
  saveSettings(); renderSettings();
  if (mode === MODES.voice) resetDetection();
}));
document.querySelectorAll('[data-clef]').forEach((b) => b.addEventListener('click', () => {
  settings.maleClef = b.dataset.clef;
  saveSettings(); renderSettings();
  renderStaff(lastMidi, lastState);
}));

// ---------- 兩種偵測模式 ----------

const MODES = {
  instrument: {
    screen: 'instrument',
    preset: () => PRESETS.instrument,
    interval: 40,    // 毫秒，約 25 次／秒
    medianSize: 7,
    inTune: 5,       // ±5 音分算準
    guard: false,
    idleHint: '請彈奏或吹奏一個音',
    goodHint: '準了！很棒 👍',
  },
  voice: {
    screen: 'voice',
    preset: () => PRESETS[settings.voiceType],
    interval: 33,    // 約 30 次／秒
    medianSize: 5,
    inTune: 15,      // ±15 音分算準
    guard: true,     // 八度防護第 2 層
    idleHint: '請唱一個長音',
    goodHint: '唱準了！好棒 👍',
  },
};

const HOLD_MS = 1500;     // 無聲後保留最後一個音的時間
const RESET_GAP_MS = 300; // 靜默超過這麼久，下一個音重新計算中位數

const clefFor = () => (settings.voiceType === 'male' ? settings.maleClef : 'treble');

// ---------- 畫面切換（支援 Android 返回鍵） ----------

let current = 'home';

function showScreen(name) {
  if (mode && mode.screen !== name) stopListening();
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

// 點按鈕的同一個 handler 內直接啟動音訊（iOS 限制）
$('btn-instrument').addEventListener('click', () => {
  go('instrument');
  beginListening(MODES.instrument);
});
$('btn-voice').addEventListener('click', () => {
  go('voice');
  beginListening(MODES.voice);
});
$('btn-retry').addEventListener('click', () => beginListening(mode || MODES[current]));

// ---------- 偵測迴圈 ----------

let mode = null;          // 目前的模式（null = 沒在偵測）
let ui = null;            // 目前畫面上的元素
let listening = false;
let rafId = 0;
let lastAnalysis = 0;
let lastHeard = 0;
let recent = [];          // 最近幾格的 midi（小數）
let guard = createOctaveGuard();
let targetCents = 0;
let shownCents = 0;
let hasNote = false;
let lastMidi = null;
let lastState = 'idle';
let wakeLock = null;

function bindUI(screenId) {
  const root = $(screenId);
  const q = (sel) => root.querySelector(sel);
  return {
    root,
    tuner: q('.tuner'),
    display: q('.note-display'),
    name: q('.note-name'),
    oct: q('.note-oct'),
    sub: q('.note-sub'),
    cents: q('.cents'),
    needle: q('.needle'),
    hint: q('.tune-hint'),
    freq: q('.freq'),
  };
}

function beginListening(m) {
  mode = m;
  ui = bindUI(m.screen);
  $('mic-error').hidden = true;
  ui.tuner.hidden = false;
  resetDetection();
  startAudio().then(() => {
    if (mode !== m) { return; } // 等權限時已離開
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
  mode = null;
  cancelAnimationFrame(rafId);
  stopAudio();
  releaseWakeLock();
  $('resume-overlay').hidden = true;
  document.body.classList.remove('in-tune');
}

function resetDetection() {
  recent = [];
  guard.reset();
  if (ui) resetDisplay();
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (now - lastAnalysis >= mode.interval) {
    lastAnalysis = now;
    analyzeFrame(now);
  }
  if (ui.needle) {
    // 指針緩動
    shownCents += (targetCents - shownCents) * 0.25;
    const pos = Math.max(-50, Math.min(50, shownCents));
    ui.needle.style.transform = `translateX(${(pos / 50) * (ui.needle.parentElement.clientWidth / 2)}px)`;
  }
}

function analyzeFrame(now) {
  const buf = readBuffer();
  const sr = getSampleRate();
  if (!buf || !sr) return;
  const r = detectPitch(buf, sr, mode.preset());

  if (r) {
    let midi = 69 + 12 * Math.log2(r.freq / settings.a4);
    if (mode.guard) midi = guard.update(midi, now);
    if (now - lastHeard > RESET_GAP_MS) recent = [];
    lastHeard = now;
    recent.push(midi);
    if (recent.length > mode.medianSize) recent.shift();
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

function showNote(midiFloat) {
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  const freq = settings.a4 * 2 ** ((midiFloat - 69) / 12);
  const label = noteLabels(midi);
  hasNote = true;

  ui.name.textContent = settings.naming === 'solfege' ? label.solfege : label.letter;
  ui.oct.textContent = label.octave;
  ui.sub.textContent = settings.naming === 'both' ? `${label.solfege}${label.octave}` : ' ';
  ui.display.classList.remove('idle');

  const c = Math.round(cents);
  ui.cents.textContent = `${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c)} 音分`;
  ui.freq.textContent = `${freq.toFixed(1)} Hz`;
  targetCents = cents;

  const inTune = Math.abs(cents) <= mode.inTune;
  document.body.classList.toggle('in-tune', inTune);
  ui.hint.textContent = inTune ? mode.goodHint : cents < 0 ? '偏低，再高一點 ↑' : '偏高，再低一點 ↓';
  if (mode === MODES.voice) renderStaff(midi, inTune ? 'good' : 'off');
}

function fadeOut() {
  hasNote = false;
  recent = [];
  ui.display.classList.add('idle');
  ui.cents.textContent = ' ';
  ui.freq.textContent = ' ';
  ui.hint.textContent = mode ? mode.idleHint : '';
  targetCents = 0;
  document.body.classList.remove('in-tune');
  if (ui.root.id === 'voice') renderStaff(lastMidi, 'idle');
}

function resetDisplay() {
  fadeOut();
  ui.name.textContent = '–';
  ui.oct.textContent = '';
  ui.sub.textContent = ' ';
  shownCents = 0;
  if (ui.root.id === 'voice') renderStaff(null, 'idle');
}

// 只在音或狀態改變時重畫五線譜
function renderStaff(midi, state) {
  const clef = clefFor();
  const key = `${midi}|${state}|${clef}`;
  if (renderStaff.key === key) return;
  renderStaff.key = key;
  lastMidi = midi;
  lastState = state;
  $('staff').innerHTML = staffSVG(midi, clef, { state });
}

// ---------- 麥克風錯誤說明 ----------

function showMicError(err) {
  if (!mode || current !== mode.screen) return;
  const kind = (err && err.kind) || 'other';
  ui.tuner.hidden = true;
  const box = $('mic-error');
  ui.root.appendChild(box);
  box.hidden = false;
  const title = $('mic-error-title');
  const body = $('mic-error-body');
  const purpose = mode === MODES.voice ? '聽您唱歌' : '「聽」聲音';
  if (kind === 'denied') {
    title.textContent = '麥克風被關掉了';
    body.innerHTML = `
      <p>這個功能需要${purpose}才能工作。聲音只在您的手機裡分析，不會上傳。</p>
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
    guard.reset();
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
