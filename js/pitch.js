// 偵測引擎：YIN 音高偵測（純函式，不碰 DOM，可在瀏覽器與 Node 使用）
//
// 主要函式：
//   detectPitch(buffer, sampleRate, options) → { freq, confidence } 或 null
//   freqToNote(freq, a4)                     → { midi, note, octave, cents }
//   analyze(buffer, sampleRate, options)     → { freq, midi, note, octave, cents, confidence } 或 null
//
// sampleRate 一律由呼叫端（AudioContext.sampleRate）傳入，本檔不寫死任何取樣率。

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// 各模式的預設參數（頻率範圍刻意比 SPEC 略寬，避免截掉邊緣的音）
export const PRESETS = {
  instrument: { minFreq: 40, maxFreq: 2100, subharmonicCheck: false },
  child:      { minFreq: 150, maxFreq: 1200, subharmonicCheck: true }, // 約 E3–C6
  female:     { minFreq: 150, maxFreq: 1200, subharmonicCheck: true }, // 約 E3–C6
  male:       { minFreq: 60,  maxFreq: 600,  subharmonicCheck: true }, // 約 D2–C5
};

const DEFAULTS = {
  minFreq: 40,
  maxFreq: 2100,
  threshold: 0.15,        // YIN 絕對門檻
  fallbackThreshold: 0.3, // 沒有谷低於門檻時，若全域最低點低於此值仍採用（信心較低）
  rmsThreshold: 0.01,     // 小於此音量視為無聲
  subharmonicCheck: false,
  // 次諧波驗證：2τ 處的谷底必須比 τ 處「明顯更低」才降八度
  subharmonicRatio: 0.5,  // d′(2τ) < d′(τ) × ratio
  subharmonicMargin: 0.02, // 且 d′(τ) − d′(2τ) > margin（避免兩者都接近 0 時誤判）
};

// 音高 → 音名。依 SPEC 第 5 節公式；中央 C = C4。
export function freqToNote(freq, a4 = 440) {
  const midiFloat = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiFloat);
  const cents = (midiFloat - midi) * 100;
  const octave = Math.floor(midi / 12) - 1;
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  return { midi, note, octave, cents };
}

// 音量（均方根）
export function rms(buf) {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

// 累積平均正規化差異函數 d′(τ)，τ = 0..tauMax
function cmndf(buf, tauMax) {
  const W = buf.length - tauMax; // 比較視窗長度
  // 平方和前綴，用來快速算 Σ x[j+τ]²
  const sq = new Float64Array(buf.length + 1);
  for (let i = 0; i < buf.length; i++) sq[i + 1] = sq[i] + buf[i] * buf[i];
  const e0 = sq[W];

  const d = new Float64Array(tauMax + 1);
  d[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    // d(τ) = Σ (x[j] − x[j+τ])² = Σx[j]² + Σx[j+τ]² − 2Σx[j]x[j+τ]
    let c = 0;
    for (let j = 0; j < W; j++) c += buf[j] * buf[j + tau];
    const diff = e0 + (sq[tau + W] - sq[tau]) - 2 * c;
    running += diff;
    d[tau] = running > 0 ? (diff * tau) / running : 1;
  }
  return d;
}

// 精算週期時，量到約這麼多個取樣點的整數倍週期
const REFINE_LAG = 300;

// 在 d′ 上從 tau 往右滑到谷底
function slideToMin(d, tau, tauMax) {
  while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
  return tau;
}

// 拋物線內插：回傳小數週期與內插後的谷底值
function parabolic(d, tau, tauMax) {
  if (tau <= 1 || tau >= tauMax) return { period: tau, value: d[tau] };
  const y0 = d[tau - 1], y1 = d[tau], y2 = d[tau + 1];
  const denom = y0 - 2 * y1 + y2;
  if (denom <= 0) return { period: tau, value: y1 };
  const shift = (y0 - y2) / (2 * denom);
  return { period: tau + shift, value: y1 - ((y0 - y2) * shift) / 4 };
}

// 在 center 附近找 d′ 的最低點（次諧波驗證用）
function localMin(d, center, tauMax) {
  const lo = Math.max(2, Math.floor(center * 0.97) - 1);
  const hi = Math.min(tauMax - 1, Math.ceil(center * 1.03) + 1);
  if (lo > hi) return -1;
  let best = lo;
  for (let t = lo + 1; t <= hi; t++) if (d[t] < d[best]) best = t;
  return best;
}

export function detectPitch(buffer, sampleRate, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!buffer || !sampleRate) return null;
  if (rms(buffer) < o.rmsThreshold) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / o.maxFreq));
  const tauMax = Math.min(Math.ceil(sampleRate / o.minFreq), Math.floor(buffer.length / 2));
  if (tauMin >= tauMax) return null;

  const d = cmndf(buffer, tauMax);

  // 絕對門檻：第一個低於門檻的谷，再滑到谷底
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (d[t] < o.threshold) { tau = slideToMin(d, t, tauMax); break; }
  }
  if (tau < 0) {
    // 退而求其次：取範圍內最低的谷（抖動、顫音較大的人聲常落在這裡）
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (d[t] < d[best]) best = t;
    if (d[best] >= o.fallbackThreshold) return null; // 沒有明確週期（例如雜訊）
    tau = best;
  }

  let est = parabolic(d, tau, tauMax);

  // 次諧波驗證：若兩倍週期處有明顯更深的谷，代表真正的基頻是 f/2
  if (o.subharmonicCheck) {
    for (let k = 0; k < 2; k++) {
      const t2 = localMin(d, est.period * 2, tauMax);
      if (t2 < 0) break;
      const cand = parabolic(d, t2, tauMax);
      const freq2 = sampleRate / cand.period;
      if (freq2 < o.minFreq) break;
      const clearlyLower = cand.value < est.value * o.subharmonicRatio &&
        est.value - cand.value > o.subharmonicMargin;
      if (!clearlyLower) break;
      est = cand;
    }
  }

  // 精算：高音的週期只有十幾個取樣點，內插誤差相對較大；
  // 改量「k 個週期」的長度再除以 k，可把誤差縮小約 k 倍。
  const k = Math.min(Math.floor((tauMax - 2) / est.period), Math.round(REFINE_LAG / est.period));
  if (k >= 2) {
    const center = Math.round(est.period * k);
    const reach = Math.max(1, Math.floor(est.period / 3));
    let best = center;
    for (let t = Math.max(2, center - reach); t <= Math.min(tauMax - 1, center + reach); t++) {
      if (d[t] < d[best]) best = t;
    }
    const multi = parabolic(d, best, tauMax);
    if (multi.value < Math.max(o.threshold, 2 * est.value)) {
      est = { period: multi.period / k, value: est.value };
    }
  }

  const freq = sampleRate / est.period;
  if (freq < o.minFreq * 0.97 || freq > o.maxFreq * 1.03) return null;
  const confidence = Math.max(0, Math.min(1, 1 - est.value));
  return { freq, confidence };
}

export function analyze(buffer, sampleRate, options = {}) {
  const r = detectPitch(buffer, sampleRate, options);
  if (!r) return null;
  const n = freqToNote(r.freq, options.a4 ?? 440);
  return { freq: r.freq, ...n, confidence: r.confidence };
}

// 八度防護第 2 層：連續性檢查（樂器模式不用）
// 與前一個穩定音高相差約 12（或 24）個半音的突跳，需持續 holdMs 才採信；
// 在那之前先把它移回原本的八度輸出。靜默超過 resetMs 後，下一個音直接採信。
// 輸入與輸出都是小數 midi 值（69 = A4）；now 為毫秒時間。
export function createOctaveGuard({ holdMs = 120, resetMs = 500, tolerance = 0.5 } = {}) {
  let stable = null;
  let lastTime = -Infinity;
  let pending = null; // { k, midi, since }

  return {
    reset() {
      stable = null;
      pending = null;
    },
    update(midi, now) {
      if (midi == null) return null;
      if (stable === null || now - lastTime > resetMs) {
        stable = midi;
        pending = null;
        lastTime = now;
        return midi;
      }
      lastTime = now;
      const diff = midi - stable;
      const k = Math.round(diff / 12);
      if (k !== 0 && Math.abs(diff - 12 * k) <= tolerance) {
        if (pending && pending.k === k && Math.abs(midi - pending.midi) <= 1) {
          if (now - pending.since >= holdMs) {
            stable = midi;
            pending = null;
            return midi;
          }
          pending.midi = midi;
        } else {
          pending = { k, midi, since: now };
        }
        return midi - 12 * k;
      }
      pending = null;
      stable = midi;
      return midi;
    },
  };
}

// 自動音量門檻：依背景噪音調整「多小聲算無聲」
// 不同手機收音音量差很多（例如三星瀏覽器安裝的 App 收音特別小聲），固定門檻會讓小聲的手機要很大聲才偵測得到。
// 背景噪音只從「沒有偵測到音高」的格子估計，唱歌時不會把門檻拉高。
// 門檻 = 背景噪音 × ratio，並限制在 [min, max] 之間。
export function createNoiseGate({ initial = 0.001, ratio = 2.5, min = 0.0015, max = 0.02 } = {}) {
  let floor = initial;
  return {
    get threshold() {
      return Math.min(max, Math.max(min, floor * ratio));
    },
    // level：這一格的音量；voiced：這一格是否偵測到音高
    update(level, voiced) {
      if (voiced) return;
      // 往下快速追（安靜下來時很快變靈敏），往上慢慢追（偶爾的雜音不會讓門檻暴衝）
      floor += (level - floor) * (level < floor ? 0.3 : 0.02);
    },
    reset() {
      floor = initial;
    },
  };
}
