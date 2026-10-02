// 畫面切換、設定、樂器調音與人聲音高 UI

import { detectPitch, PRESETS, createOctaveGuard, createNoiseGate, rms } from './pitch.js';
import { noteLabels, staffSVG } from './notation.js';
import { createPitchGraph } from './graph.js';
import { METER_PRESETS, tempoTerm, clampBpm, accentPattern, createTapTempo } from './metronome.js';
import {
  startAudio, stopAudio, getSampleRate, readBuffer, needsResume, resumeAudio, onStateChange,
  playReference, stopReference, isShortReferencePlaying, isReferencePlaying,
  micPermission, getDiagnostics, isUsingRaw,
  startMetronome, updateMetronome, stopMetronome, popDueTicks,
} from './audio.js';

const $ = (id) => document.getElementById(id);

// 每次發布新版時更新（顯示在設定頁與麥克風檢查，用來確認手機上跑的是哪一版）
const APP_VERSION = '2026.10.02';

// ---------- 設定（localStorage，讀寫都要 try/catch） ----------

const SETTINGS_KEY = 'tuner-settings';
const settings = {
  a4: 440, naming: 'both', voiceType: 'child', maleClef: 'bass',
  metro: { bpm: 96, meter: '4/4', customBeats: 5, subdivision: 1, sound: 'beep', volume: 0.8 },
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (Number.isFinite(saved.a4)) settings.a4 = clampA4(saved.a4);
    if (['letter', 'solfege', 'both'].includes(saved.naming)) settings.naming = saved.naming;
    if (['child', 'female', 'male'].includes(saved.voiceType)) settings.voiceType = saved.voiceType;
    if (['bass', 'treble8vb'].includes(saved.maleClef)) settings.maleClef = saved.maleClef;
    const m = saved.metro || {};
    const t = settings.metro;
    if (Number.isFinite(m.bpm)) t.bpm = clampBpm(m.bpm);
    if ([...METER_PRESETS, 'custom'].includes(m.meter)) t.meter = m.meter;
    if (Number.isInteger(m.customBeats) && m.customBeats >= 1 && m.customBeats <= 12) t.customBeats = m.customBeats;
    if ([1, 2, 3, 4].includes(m.subdivision)) t.subdivision = m.subdivision;
    if (['beep', 'wood', 'click'].includes(m.sound)) t.sound = m.sound;
    if (Number.isFinite(m.volume)) t.volume = Math.min(1, Math.max(0.05, m.volume));
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
  renderTargetOptions();
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
  target = null;
  stopRef();
  $('voice-change-hint').hidden = true;
  checkVoiceChange.dismissed = false;
  saveSettings(); renderSettings();
  if (mode === MODES.voice) resetDetection();
}));
document.querySelectorAll('[data-clef]').forEach((b) => b.addEventListener('click', () => {
  settings.maleClef = b.dataset.clef;
  saveSettings(); renderSettings();
  renderStaff(lastMidi, lastState);
}));

// ---------- 目標音與參考音 ----------

// 各聲音類型的常用音域（目標音選單）
const TARGET_RANGES = { child: [57, 77], female: [55, 81], male: [40, 64] }; // A3–F5、G3–A5、E2–E4

let target = null; // 指定的目標音（midi 整數）；null = 自動（最接近的音）

function renderTargetOptions() {
  const sel = $('target-select');
  const [lo, hi] = TARGET_RANGES[settings.voiceType];
  sel.innerHTML = '';
  sel.add(new Option('自動（最接近的音）', 'auto'));
  for (let m = hi; m >= lo; m--) {
    const l = noteLabels(m);
    const text = settings.naming === 'letter' ? `${l.letter}${l.octave}`
      : settings.naming === 'solfege' ? `${l.solfege}${l.octave}`
        : `${l.letter}${l.octave}　${l.solfege}${l.octave}`;
    sel.add(new Option(text, m));
  }
  if (target != null && (target < lo || target > hi)) target = null;
  sel.value = target == null ? 'auto' : String(target);
}

$('target-select').addEventListener('change', (e) => {
  target = e.target.value === 'auto' ? null : Number(e.target.value);
  if (isReferencePlaying()) startRef(); // 換目標時，正在播的參考音跟著換
  renderStaff(lastMidi, lastState);
});

const midiToFreq = (m) => settings.a4 * 2 ** ((m - 69) / 12);
const sustainOn = () => $('btn-sustain').getAttribute('aria-pressed') === 'true';

function refMidi() {
  if (target != null) return target;
  return lastMidi; // 自動模式：播最近唱的那個音
}

function startRef() {
  const m = refMidi();
  if (m == null) {
    ui.hint.textContent = '請先選目標音，或先唱一個音';
    return;
  }
  playReference(midiToFreq(m), { sustain: sustainOn(), onEnd: renderRefButton });
  renderRefButton();
}

function stopRef() {
  stopReference();
  renderRefButton();
}

function renderRefButton() {
  const playing = isReferencePlaying();
  const b = $('btn-ref');
  b.classList.toggle('playing', playing && sustainOn());
  b.textContent = playing && sustainOn() ? '■ 停止參考音' : '🔊 參考音';
}

$('btn-ref').addEventListener('click', () => {
  if (isReferencePlaying() && sustainOn()) stopRef();
  else startRef();
});

$('btn-sustain').addEventListener('click', () => {
  const on = !sustainOn();
  $('btn-sustain').setAttribute('aria-pressed', String(on));
  if (isReferencePlaying()) stopRef();
});

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
  if (checking && name !== 'settings') stopMicCheck();
  if (metroRunning && name !== 'metronome') stopMetro();
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
const gate = createNoiseGate(); // 自動音量門檻（依背景噪音調整）
let targetCents = 0;
let shownCents = 0;
let hasNote = false;
let lastMidi = null;
let lastState = 'idle';
let wakeLock = null;
const graph = createPitchGraph($('pitch-graph'));
let lowFrames = [];       // 童聲模式：最近 2 秒內是否唱得比 E3 低
let lastSignal = 0;       // 最後一次收到「非完全無聲」的時間
let fallbackTried = false;
const SILENT_MS = 2500;   // 麥克風連續送出完全無聲這麼久，視為沒收到聲音

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

function beginListening(m, { raw = true } = {}) {
  mode = m;
  if (raw) fallbackTried = false;
  ui = bindUI(m.screen);
  $('mic-error').hidden = true;
  ui.tuner.hidden = false;
  resetDetection();
  startAudio({ raw }).then(() => {
    if (mode !== m) { return; } // 等權限時已離開
    listening = true;
    lastSignal = performance.now();
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
  renderRefButton();
  releaseWakeLock();
  $('resume-overlay').hidden = true;
  document.body.classList.remove('in-tune');
}

function resetDetection() {
  recent = [];
  guard.reset();
  gate.reset();
  graph.clear();
  lowFrames = [];
  if (ui) resetDisplay();
}

function loop(now) {
  rafId = requestAnimationFrame(loop);
  if (now - lastAnalysis >= mode.interval) {
    lastAnalysis = now;
    analyzeFrame(now);
  }
  if (mode === MODES.voice) graph.draw(now, target, settings.naming);
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
  if (!checkSilence(buf, now)) return;
  // 短的參考音播放中先暫停偵測，避免把參考音當成歌聲
  if (mode === MODES.voice && isShortReferencePlaying()) return;
  const r = detectPitch(buf, sr, { ...mode.preset(), rmsThreshold: gate.threshold });
  gate.update(rms(buf), !!r);
  if (mode === MODES.voice && settings.voiceType === 'child') checkVoiceChange(buf, sr, now);

  if (r) {
    let midi = 69 + 12 * Math.log2(r.freq / settings.a4);
    if (mode.guard) midi = guard.update(midi, now);
    if (now - lastHeard > RESET_GAP_MS) recent = [];
    lastHeard = now;
    recent.push(midi);
    if (recent.length > mode.medianSize) recent.shift();
    const m = median(recent);
    if (mode === MODES.voice) graph.push(now, m);
    showNote(m);
  } else if (hasNote && now - lastHeard > HOLD_MS) {
    fadeOut();
  }
}

// 麥克風送來的若是「完全無聲」（連一點雜音都沒有），代表聲音沒進來。
// 先自動改用手機一般的收音方式重試一次，還是不行就顯示說明。回傳 false 表示這格不用分析。
function checkSilence(buf, now) {
  let peak = 0;
  for (let i = 0; i < buf.length; i += 4) peak = Math.max(peak, Math.abs(buf[i]));
  if (peak > 1e-6) { lastSignal = now; return true; }
  if (now - lastSignal < SILENT_MS) return true;
  const m = mode;
  listening = false;
  cancelAnimationFrame(rafId);
  if (!fallbackTried && isUsingRaw()) {
    fallbackTried = true;
    beginListening(m, { raw: false });
  } else {
    stopAudio();
    showMicError({ kind: 'silent' });
  }
  return false;
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

  ui.freq.textContent = `${freq.toFixed(1)} Hz`;
  targetCents = cents;

  // 有指定目標音時，和目標比較；否則和最接近的音比較
  const useTarget = mode === MODES.voice && target != null;
  const diff = useTarget ? (midiFloat - target) * 100 : cents;
  const c = Math.round(diff);
  const sign = c > 0 ? '+' : c < 0 ? '−' : '';
  if (!useTarget) {
    ui.cents.textContent = `${sign}${Math.abs(c)} 音分`;
  } else if (Math.abs(c) < 100) {
    ui.cents.textContent = `比目標${c < 0 ? '低' : c > 0 ? '高' : ''} ${Math.abs(c)} 音分`;
  } else {
    ui.cents.textContent = `比目標${c < 0 ? '低' : '高'} ${Math.round(Math.abs(c) / 100)} 個半音`;
  }

  const inTune = Math.abs(diff) <= mode.inTune;
  document.body.classList.toggle('in-tune', inTune);
  ui.hint.textContent = inTune ? mode.goodHint : diff < 0 ? '偏低，再高一點 ↑' : '偏高，再低一點 ↓';
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

// 只在音、狀態、譜號或目標音改變時重畫五線譜
function renderStaff(midi, state) {
  const clef = clefFor();
  const key = `${midi}|${state}|${clef}|${target}`;
  if (renderStaff.key === key) return;
  renderStaff.key = key;
  lastMidi = midi;
  lastState = state;
  $('staff').innerHTML = staffSVG(midi, clef, { state, target });
}

// ---------- 童聲模式：變聲期提示 ----------

const E3 = 52;
const LOW_WINDOW_MS = 2000;

// 另外用男聲範圍偵測一次（童聲範圍抓不到那麼低的音），最近 2 秒大多低於 E3 就提示
function checkVoiceChange(buf, sr, now) {
  if (!$('voice-change-hint').hidden || checkVoiceChange.dismissed) return;
  const r = detectPitch(buf, sr, { ...PRESETS.male, rmsThreshold: gate.threshold });
  if (r) lowFrames.push({ t: now, low: 69 + 12 * Math.log2(r.freq / settings.a4) < E3 - 0.5 });
  while (lowFrames.length && now - lowFrames[0].t > LOW_WINDOW_MS) lowFrames.shift();
  const low = lowFrames.filter((f) => f.low).length;
  if (lowFrames.length >= 30 && low / lowFrames.length >= 0.7) $('voice-change-hint').hidden = false;
}

$('btn-to-male').addEventListener('click', () => {
  document.querySelector('[data-voice="male"]').click();
});
$('btn-dismiss-hint').addEventListener('click', () => {
  $('voice-change-hint').hidden = true;
  checkVoiceChange.dismissed = true; // 這次使用期間不再提示
});

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
  } else if (kind === 'silent' || kind === 'timeout') {
    title.textContent = kind === 'silent' ? '麥克風沒有收到聲音' : '麥克風沒有回應';
    body.innerHTML = `
      <p>請依序試試看：</p>
      <ol>
        <li>關掉其他正在使用麥克風的 App，以及用瀏覽器開著的「調音器」網頁</li>
        <li>把這個 App 完全關掉（從最近使用的 App 清單滑掉），再重新打開</li>
        <li>到手機的「設定 → 應用程式」，找到安裝時用的瀏覽器（Chrome 或 Samsung Internet），在「權限 → 麥克風」選「允許」</li>
        <li>還是不行的話，到首頁右上角 ⚙️「設定」→「麥克風檢查」，把結果截圖給老師</li>
      </ol>`;
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
  // 切到背景時計時會不準，節拍器先停下來
  if (document.visibilityState === 'hidden' && metroRunning) stopMetro();
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

// ---------- 節拍器 ----------

let metroRunning = false;
let metroRaf = 0;
const tapTempo = createTapTempo();

const metroMeter = () => (settings.metro.meter === 'custom' ? settings.metro.customBeats : settings.metro.meter);
const metroParams = () => ({ ...settings.metro, meter: metroMeter() });

function renderMetro() {
  const t = settings.metro;
  $('bpm').textContent = t.bpm;
  $('bpm-slider').value = t.bpm;
  const term = tempoTerm(t.bpm);
  $('tempo-term').textContent = `${term.it} ${term.zh}`;
  $('metro-volume').value = t.volume;
  document.querySelectorAll('[data-meter]').forEach((b) => b.classList.toggle('selected', b.dataset.meter === t.meter));
  document.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('selected', Number(b.dataset.sub) === t.subdivision));
  document.querySelectorAll('[data-sound]').forEach((b) => b.classList.toggle('selected', b.dataset.sound === t.sound));
  $('custom-row').hidden = t.meter !== 'custom';
  $('custom-beats').textContent = t.customBeats;
  $('meter-hint').hidden = t.meter !== '6/8';

  // 每一拍一個圓點；重音（第一拍）、次重音的圓點加框
  const pattern = accentPattern(metroMeter());
  const dots = $('beat-dots');
  if (dots.children.length !== pattern.length || dots.dataset.meter !== String(metroMeter())) {
    dots.dataset.meter = String(metroMeter());
    dots.innerHTML = pattern.map((lv) => `<span class="beat-dot${lv === 'strong' ? ' first' : ''}"></span>`).join('');
    showBeat(null);
  }
}

// 改了設定：存起來、更新畫面，播放中就立刻套用
function metroChanged() {
  saveSettings();
  renderMetro();
  if (metroRunning) updateMetronome(metroParams());
}

function setBpm(bpm) {
  settings.metro.bpm = clampBpm(bpm);
  metroChanged();
}

document.querySelectorAll('[data-bpm-step]').forEach((b) => b.addEventListener('click', () => {
  setBpm(settings.metro.bpm + Number(b.dataset.bpmStep));
}));
$('bpm-slider').addEventListener('input', (e) => setBpm(Number(e.target.value)));
$('metro-volume').addEventListener('input', (e) => {
  settings.metro.volume = Number(e.target.value);
  metroChanged();
});
document.querySelectorAll('[data-meter]').forEach((b) => b.addEventListener('click', () => {
  settings.metro.meter = b.dataset.meter;
  metroChanged();
}));
document.querySelectorAll('[data-custom-step]').forEach((b) => b.addEventListener('click', () => {
  settings.metro.customBeats = Math.min(12, Math.max(1, settings.metro.customBeats + Number(b.dataset.customStep)));
  metroChanged();
}));
document.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => {
  settings.metro.subdivision = Number(b.dataset.sub);
  metroChanged();
}));
document.querySelectorAll('[data-sound]').forEach((b) => b.addEventListener('click', () => {
  settings.metro.sound = b.dataset.sound;
  metroChanged();
}));

$('btn-tap').addEventListener('click', () => {
  const bpm = tapTempo.tap(performance.now());
  if (bpm) setBpm(bpm);
});

$('btn-metronome').addEventListener('click', () => {
  go('metronome');
  renderMetro();
});

// 在 click handler 內直接啟動聲音（iOS 限制）
$('btn-metro-play').addEventListener('click', () => {
  if (metroRunning) { stopMetro(); return; }
  startMetronome(metroParams());
  metroRunning = true;
  $('btn-metro-play').textContent = '■ 停止';
  $('btn-metro-play').classList.add('playing');
  requestWakeLock();
  cancelAnimationFrame(metroRaf);
  metroRaf = requestAnimationFrame(metroLoop);
});

function stopMetro() {
  stopMetronome();
  metroRunning = false;
  cancelAnimationFrame(metroRaf);
  $('btn-metro-play').textContent = '▶ 開始';
  $('btn-metro-play').classList.remove('playing');
  if (!listening) releaseWakeLock();
  showBeat(null);
}

// 聲音真正播出時才亮燈
function metroLoop() {
  metroRaf = requestAnimationFrame(metroLoop);
  const ticks = popDueTicks().filter((t) => t.sub === 0); // 細分拍只有聲音，畫面跟著正拍
  if (ticks.length) showBeat(ticks[ticks.length - 1]);
}

function showBeat(tick) {
  const dots = $('beat-dots').children;
  const num = $('beat-num');
  [...dots].forEach((d, i) => d.classList.toggle('on', !!tick && i === tick.beat));
  if (!tick) {
    num.textContent = '1';
    num.classList.remove('on', 'first');
    return;
  }
  num.textContent = tick.beat + 1;
  num.classList.add('on');
  num.classList.toggle('first', tick.level === 'strong');
  // 每拍一個小小的跳動
  if (num.animate) num.animate([{ transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 120 });
}

// iPhone／iPad：靜音模式會讓網頁沒有聲音，提醒一下
$('ios-hint').hidden = !(/iPhone|iPad|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// ---------- 麥克風檢查（設定頁） ----------

let checking = false;
let checkRaf = 0;
let checkInfoAt = 0;
let checkStart = 0;
let checkHeard = false;   // 有收到明顯的聲音
let checkSignal = false;  // 至少有一點點聲音（不是完全無聲）
let checkFallback = false;
let checkPermission = 'unknown';
let checkError = null;
let checkPeakRms = 0;

function browserName() {
  const ua = navigator.userAgent;
  const os = (ua.match(/Android [\d.]+/) || ua.match(/(iPhone|iPad|CPU) OS [\d_]+/) || [''])[0].replace(/_/g, '.');
  const v = (re) => (ua.match(re) || [])[1] || '';
  let b = 'Chrome ' + v(/Chrome\/(\d+)/);
  if (/SamsungBrowser/.test(ua)) b = '三星瀏覽器 ' + v(/SamsungBrowser\/([\d.]+)/);
  else if (/CriOS/.test(ua)) b = 'Chrome（iOS）' + v(/CriOS\/(\d+)/);
  else if (!/Chrome/.test(ua) && /Safari/.test(ua)) b = 'Safari ' + v(/Version\/([\d.]+)/);
  return `${b}／${os || navigator.platform}`;
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

$('btn-mic-check').addEventListener('click', () => {
  if (checking) stopMicCheck();
  else startMicCheck({ raw: true }); // 在 click handler 內直接啟動
});

function startMicCheck({ raw }) {
  checking = true;
  if (raw) { checkFallback = false; checkHeard = false; checkSignal = false; checkPeakRms = 0; }
  checkError = null;
  checkStart = performance.now();
  $('btn-mic-check').textContent = '停止檢查';
  $('mic-check').hidden = false;
  $('mic-result').textContent = '⏳ 啟動麥克風中…';
  micPermission().then((p) => { checkPermission = p; });
  startAudio({ raw }).then(() => {
    if (!checking) { stopAudio(); return; }
    micPermission().then((p) => { checkPermission = p; });
    cancelAnimationFrame(checkRaf);
    checkRaf = requestAnimationFrame(checkLoop);
  }, (err) => {
    checkError = err.kind || 'other';
    renderCheck(performance.now());
  });
}

function stopMicCheck() {
  checking = false;
  cancelAnimationFrame(checkRaf);
  stopAudio();
  $('btn-mic-check').textContent = '開始檢查';
  $('mic-level').style.width = '0';
}

function checkLoop(now) {
  checkRaf = requestAnimationFrame(checkLoop);
  const buf = readBuffer();
  if (!buf) return;
  let sum = 0, peak = 0;
  for (let i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; peak = Math.max(peak, Math.abs(buf[i])); }
  const level = Math.sqrt(sum / buf.length);
  if (peak > 1e-6) checkSignal = true;
  if (level > 0.003) checkHeard = true;
  checkPeakRms = Math.max(checkPeakRms * 0.97, level);
  // 音量條用分貝顯示（−70 dB 到 0 dB），小聲的手機也看得到變化
  const db = level > 0 ? 20 * Math.log10(level) : -100;
  $('mic-level').style.width = `${Math.max(0, Math.min(100, ((db + 70) / 70) * 100))}%`;

  // 原始聲音收不到任何東西，自動改用一般收音方式再試
  if (!checkSignal && !checkFallback && now - checkStart > SILENT_MS) {
    checkFallback = true;
    cancelAnimationFrame(checkRaf);
    startMicCheck({ raw: false });
    return;
  }
  if (now - checkInfoAt > 300) { checkInfoAt = now; renderCheck(now); }
}

function renderCheck(now) {
  const d = getDiagnostics();
  const PERM = { granted: '✅ 已允許', prompt: '尚未詢問', denied: '❌ 已拒絕', unknown: '無法查詢' };
  const CTX = { running: '✅ 運作中', suspended: '⚠️ 暫停', interrupted: '⚠️ 被中斷', closed: '❌ 已關閉', none: '未啟動' };
  const TRACK = { live: '✅ 已開啟', ended: '❌ 已關閉', none: '未開啟' };
  const rows = [
    ['版本', APP_VERSION],
    ['使用方式', isStandalone() ? '已安裝的 App' : '瀏覽器網頁'],
    ['瀏覽器', browserName()],
    ['麥克風權限', PERM[checkPermission] || checkPermission],
    ['音訊引擎', CTX[d.ctxState] || d.ctxState],
    ['麥克風', (TRACK[d.trackState] || d.trackState) + (d.trackMuted ? '（⚠️ 被系統靜音）' : '')],
    ['收音方式', d.raw ? '原始聲音' : '一般（含降噪）'],
    ['取樣率', d.sampleRate ? `${d.sampleRate} Hz` : '–'],
    ['最近音量', checkPeakRms > 0 ? `${(20 * Math.log10(checkPeakRms)).toFixed(0)} dB` : '–'],
    ['裝置', d.trackLabel || '–'],
  ];
  $('mic-info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  let result;
  if (checkError) {
    result = { denied: '❌ 麥克風權限被拒絕', notfound: '❌ 找不到麥克風', timeout: '❌ 麥克風沒有回應', insecure: '❌ 這個網址不能使用麥克風' }[checkError] || '❌ 麥克風無法啟動';
  } else if (checkHeard) {
    result = '✅ 有收到聲音，麥克風正常！';
  } else if (!checkSignal && checkFallback && now - checkStart > SILENT_MS) {
    result = '❌ 麥克風沒有收到任何聲音（完全無聲）';
  } else if (checkSignal && now - checkStart > 4000) {
    result = '⚠️ 聲音很小，請靠近手機說話';
  } else {
    result = '⏳ 請對著手機說話或唱歌…';
  }
  $('mic-result').textContent = result;
}

// ---------- 啟動 ----------

loadSettings();
renderSettings();
$('app-version').textContent = APP_VERSION;
history.replaceState({ screen: 'home' }, '');

// 離線使用：註冊 Service Worker（不支援時略過）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 略過 */ });
  });
  // 背景下載到新版時，在首頁顯示「點這裡更新」
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'updated') $('update-banner').hidden = false;
  });
}
$('update-banner').addEventListener('click', () => location.reload());
