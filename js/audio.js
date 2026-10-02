// 音訊：AudioContext、麥克風、讀取波形
//
// iOS Safari 規定：建立／resume AudioContext 與 getUserMedia 必須在使用者點擊的 handler 內「同步」呼叫，
// 所以 startAudio() 在第一個 await 之前就把兩者都啟動。

import { createSequencer, tickSeconds } from './metronome.js';

const BUFFER_SIZE = 4096;

let ctx = null;
let stream = null;
let source = null;
let analyser = null;
let buffer = null;
let usingRaw = true;      // 目前是否用「原始聲音」（關閉降噪等處理）收音

export class MicError extends Error {
  constructor(kind, cause) {
    super(kind);
    this.kind = kind; // 'insecure' | 'denied' | 'notfound' | 'timeout' | 'silent' | 'other'
    this.cause = cause;
  }
}

function classify(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'notfound';
  return 'other';
}

const RAW_AUDIO = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
const START_TIMEOUT_MS = 5000;

// 查詢麥克風權限：'granted' | 'prompt' | 'denied' | 'unknown'
export async function micPermission() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    return p.state;
  } catch {
    return 'unknown';
  }
}

// 必須在 click handler 內直接呼叫（不可先 await 別的東西）
// raw = true：原始聲音（最準）；false：手機一般收音方式（部分裝置原始聲音收不到時的備案）
export function startAudio({ raw = true } = {}) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new MicError('insecure'));
  }
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  const resumed = ctx.resume();
  const mic = navigator.mediaDevices.getUserMedia({ audio: raw ? RAW_AUDIO : true });
  let timedOut = false;
  const started = Promise.all([resumed, mic]).then(([, s]) => {
    if (timedOut) { s.getTracks().forEach((t) => t.stop()); return; } // 太晚才回應，已經顯示錯誤了
    stopMic();
    stream = s;
    usingRaw = raw;
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = BUFFER_SIZE;
    buffer = new Float32Array(analyser.fftSize);
    source.connect(analyser);
  }, (err) => {
    throw err instanceof MicError ? err : new MicError(classify(err), err);
  });

  // 已經允許權限卻遲遲沒有回應，就當成失敗（正在詢問權限時不計時）
  const timeout = new Promise((_, reject) => {
    micPermission().then((state) => {
      if (state === 'prompt') return;
      setTimeout(() => { timedOut = true; reject(new MicError('timeout')); }, START_TIMEOUT_MS);
    });
  });
  return Promise.race([started, timeout]);
}

// 麥克風檢查用的狀態
export function getDiagnostics() {
  const track = stream && stream.getAudioTracks()[0];
  let settings = {};
  try { settings = track ? track.getSettings() : {}; } catch { /* 不支援 */ }
  return {
    ctxState: ctx ? ctx.state : 'none',
    sampleRate: ctx ? ctx.sampleRate : 0,
    trackState: track ? track.readyState : 'none',
    trackMuted: track ? track.muted : false,
    trackLabel: track ? track.label : '',
    raw: usingRaw,
    settings,
  };
}

export function isUsingRaw() {
  return usingRaw;
}

function stopMic() {
  if (source) source.disconnect();
  if (stream) stream.getTracks().forEach((t) => t.stop());
  source = null;
  stream = null;
  analyser = null;
}

// 離開偵測畫面：關掉麥克風，並暫停 AudioContext 省電
export function stopAudio() {
  stopReference();
  stopMetronome();
  stopMic();
  if (ctx && ctx.state === 'running') ctx.suspend();
}

export function getSampleRate() {
  return ctx ? ctx.sampleRate : 0;
}

// 取得最新 4096 點波形；尚未啟動時回傳 null
export function readBuffer() {
  if (!analyser) return null;
  analyser.getFloatTimeDomainData(buffer);
  return buffer;
}

// 是否需要使用者點一下才能繼續（AudioContext 被暫停，或麥克風被系統關掉）
export function needsResume() {
  if (!ctx || !stream) return false;
  const trackEnded = stream.getAudioTracks().every((t) => t.readyState === 'ended');
  return ctx.state !== 'running' || trackEnded;
}

// 「點一下繼續」：在 click handler 內呼叫
export function resumeAudio() {
  const trackEnded = stream && stream.getAudioTracks().every((t) => t.readyState === 'ended');
  if (trackEnded) return startAudio();
  return ctx.resume();
}

export function onStateChange(fn) {
  if (ctx) ctx.onstatechange = fn;
}

// ---------- 參考音 ----------
// 短音：柔和鋼琴音色（自然衰減約 2 秒）；持續長音：管風琴音色（按停止才結束）

let ref = null; // { oscs, master, sustain, endTime, onEnd }

export function playReference(freq, { sustain = false, onEnd } = {}) {
  if (!ctx) return;
  stopReference();
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const partials = sustain
    ? [[1, 1], [2, 0.5], [3, 0.22], [4, 0.12]]                           // 管風琴
    : [[1, 1], [2, 0.55], [3, 0.3], [4, 0.16], [5, 0.1], [6, 0.06]];     // 鋼琴
  const oscs = partials.filter(([k]) => freq * k < ctx.sampleRate / 2).map(([k, a]) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq * k;
    g.gain.value = a;
    if (!sustain) g.gain.setTargetAtTime(0, now + 0.01, 0.9 / k); // 高次泛音衰減較快
    o.connect(g).connect(master);
    o.start(now);
    return o;
  });

  master.gain.setValueAtTime(0, now);
  let endTime = Infinity;
  if (sustain) {
    master.gain.linearRampToValueAtTime(0.22, now + 0.08);
  } else {
    master.gain.linearRampToValueAtTime(0.3, now + 0.006);
    master.gain.setTargetAtTime(0, now + 0.05, 0.6);
    endTime = now + 2.2;
    oscs.forEach((o) => o.stop(endTime));
  }
  const current = { oscs, master, sustain, endTime, onEnd };
  ref = current;
  if (!sustain) {
    oscs[0].onended = () => {
      if (ref === current) ref = null;
      if (onEnd) onEnd();
    };
  }
}

export function stopReference() {
  if (!ref || !ctx) return;
  const { oscs, master, onEnd } = ref;
  ref = null;
  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(0, now, 0.04);
  oscs.forEach((o) => { o.onended = null; try { o.stop(now + 0.2); } catch { /* 已停止 */ } });
  if (onEnd) onEnd();
}

// 短音播放中（此時暫停偵測，避免麥克風把參考音當成歌聲）
export function isShortReferencePlaying() {
  return !!ref && !ref.sustain && ctx.currentTime < ref.endTime;
}

export function isReferencePlaying() {
  return !!ref;
}

// ---------- 節拍器 ----------
// 精準計時：每 25 毫秒檢查一次，把接下來 0.12 秒內要響的拍子，用音訊時鐘預先排好。
// 畫面再依「聲音實際播出的時間」亮燈（popDueTicks），聲音與畫面才會同步。

const LOOKAHEAD = 0.12;   // 秒
const TIMER_MS = 25;
const LEVEL_GAIN = { strong: 1, medium: 0.82, normal: 0.68, sub: 0.36 };

let metro = null; // { params, seq, nextTime, queue, timer }
let noise = null;

function ensureContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  return ctx.resume();
}

// 必須在 click handler 內呼叫（iOS 限制）
// params：{ bpm, meter, subdivision, sound, volume }
export function startMetronome(params) {
  const resumed = ensureContext();
  stopMetronome();
  metro = {
    params: { ...params },
    seq: createSequencer(params.meter, params.subdivision),
    nextTime: ctx.currentTime + 0.08,
    queue: [],
    timer: setInterval(scheduleTicks, TIMER_MS),
  };
  scheduleTicks();
  return resumed;
}

// 播放中改速度、拍號、細分或音色。拍號或細分改變時，從下一下重新由第一拍開始
export function updateMetronome(params) {
  if (!metro) return;
  const restart = params.meter !== metro.params.meter || params.subdivision !== metro.params.subdivision;
  metro.params = { ...params };
  if (restart) metro.seq = createSequencer(params.meter, params.subdivision);
}

export function stopMetronome() {
  if (!metro) return;
  clearInterval(metro.timer);
  metro = null;
}

export const isMetronomeRunning = () => !!metro;

// 取出「已經播出」的拍子給畫面亮燈（扣掉手機播放聲音本身的延遲）
export function popDueTicks() {
  if (!metro) return [];
  const heard = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  const due = [];
  while (metro.queue.length && metro.queue[0].time <= heard) due.push(metro.queue.shift());
  return due;
}

function scheduleTicks() {
  const m = metro;
  if (!m) return;
  // 切到背景後計時器會變慢；回來時不要一次補響一堆拍子
  if (m.nextTime < ctx.currentTime - 0.05) m.nextTime = ctx.currentTime + 0.05;
  while (m.nextTime < ctx.currentTime + LOOKAHEAD) {
    const tick = m.seq.next();
    playClick(m.nextTime, tick.level, m.params.sound, m.params.volume);
    m.queue.push({ ...tick, time: m.nextTime });
    m.nextTime += tickSeconds(m.params.bpm, m.params.subdivision);
  }
}

function noiseBuffer() {
  if (!noise) {
    noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noise;
}

// 節拍聲先經過限幅器再輸出：可以開得比較大聲，又不會破音
let metroBus = null;
function metroOutput() {
  if (!metroBus || metroBus.context !== ctx) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.001;
    comp.release.value = 0.08;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.1;
    comp.connect(makeup).connect(ctx.destination);
    metroBus = comp;
  }
  return metroBus;
}

// 合成一下節拍聲。sound：'beep' 電子音／'wood' 木魚／'click' 拍點
// 聲音集中在 2–5 kHz（人耳最敏感、歌聲與多數樂器較少佔用的頻段），邊唱邊彈也聽得清楚
function playClick(t, level, sound, volume) {
  const out = ctx.createGain();
  out.gain.value = (LEVEL_GAIN[level] ?? 0.6) * volume;
  out.connect(metroOutput());
  const env = (node, peak, decay) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.0007); // 起音很快，聽起來清脆
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    node.connect(g).connect(out);
  };
  const noiseBurst = (freq, q, peak, decay) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const hp = ctx.createBiquadFilter(); // 去掉低頻，聲音乾淨不悶
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    src.connect(bp).connect(hp);
    env(hp, peak, decay);
    src.start(t);
    src.stop(t + decay + 0.02);
  };
  const tone = (type, freq, peak, decay, drop = 1) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (drop !== 1) osc.frequency.exponentialRampToValueAtTime(freq * drop, t + decay);
    env(osc, peak, decay);
    osc.start(t);
    osc.stop(t + decay + 0.02);
  };
  // 第一拍高五度（×1.5），次重音高大三度（×1.25）
  const high = level === 'strong' ? 1.5 : level === 'medium' ? 1.25 : 1;

  if (sound === 'click') {
    // 拍點：短促明亮的「喀」
    noiseBurst(2800 * high, 1.8, 2.2, 0.025);
    tone('sine', 2400 * high, 0.5, 0.015);
  } else if (sound === 'wood') {
    // 木魚：高音木塊，帶一點敲擊的雜音
    tone('triangle', 1300 * high, 1, 0.055, 0.88);
    tone('sine', 2600 * high, 0.35, 0.03);
    noiseBurst(3600 * high, 3, 1, 0.015);
  } else {
    // 電子音：明亮的嗶聲（基音＋八度泛音）
    tone('sine', 2000 * high, 1, 0.07);
    tone('sine', 4000 * high, 0.35, 0.04);
    tone('square', 2000 * high, 0.08, 0.02);
  }
}
