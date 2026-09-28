// 偵測引擎自動測試：node --test tests/
// 全部使用合成訊號、固定亂數種子，每次執行結果相同。

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, analyze, freqToNote, PRESETS } from '../js/pitch.js';

const SAMPLE_RATES = [44100, 48000];
const N = 4096;

// ---------- 工具 ----------

// 固定種子的亂數（mulberry32）
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rng) {
  const u = Math.max(rng(), 1e-12), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 緩慢變化的隨機曲線（每約 20 ms 一個隨機點，中間線性內插），標準差約 1
function smoothNoise(rng, n, sr) {
  const step = Math.max(1, Math.round(sr * 0.02));
  const pts = [];
  for (let i = 0; i <= Math.ceil(n / step) + 1; i++) pts.push(gauss(rng));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.floor(i / step), fr = (i % step) / step;
    out[i] = pts[k] * (1 - fr) + pts[k + 1] * fr;
  }
  return out;
}

const centsBetween = (f, ref) => 1200 * Math.log2(f / ref);
const midiToFreq = (m, a4 = 440) => a4 * 2 ** ((m - 69) / 12);

// 合成訊號。amps[k] 為第 k+1 泛音的振幅。
// 回傳 { buf, trueFreq }，trueFreq 為這段時間內瞬時頻率的（對數）平均。
function synth({ sr, f0, amps = [1], phases, vibCents = 0, vibRate = 0, vibPhase = 0,
  jitter = 0, shimmer = 0, snr = Infinity, rng = makeRng(1), peak = 0.5 }) {
  const jit = jitter ? smoothNoise(rng, N, sr) : null;
  const shim = shimmer ? smoothNoise(rng, N, sr) : null;
  const ph0 = phases ?? amps.map(() => rng() * 2 * Math.PI);
  const buf = new Float32Array(N);
  let phase = 0, logSum = 0;
  const raw = new Float64Array(N);
  const logF = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    let f = f0 * 2 ** ((vibCents * Math.sin(2 * Math.PI * vibRate * t + vibPhase)) / 1200);
    if (jit) f *= 1 + jitter * jit[i];
    logSum += Math.log2(f);
    logF[i] = Math.log2(f);
    const a = shim ? 1 + shimmer * shim[i] : 1;
    let s = 0;
    for (let k = 0; k < amps.length; k++) {
      if (f0 * (k + 1) >= sr * 0.45) break; // 不超過 Nyquist
      s += amps[k] * Math.sin((k + 1) * phase + ph0[k]);
    }
    raw[i] = s * a;
    phase += (2 * Math.PI * f) / sr;
  }
  let sigRms = 0, max = 0;
  for (let i = 0; i < N; i++) { sigRms += raw[i] * raw[i]; max = Math.max(max, Math.abs(raw[i])); }
  sigRms = Math.sqrt(sigRms / N);
  const noiseRms = isFinite(snr) ? sigRms / 10 ** (snr / 20) : 0;
  const scale = peak / (max + 3 * noiseRms);
  for (let i = 0; i < N; i++) buf[i] = (raw[i] + (noiseRms ? noiseRms * gauss(rng) : 0)) * scale;
  return { buf, trueFreq: 2 ** (logSum / N), logF };
}

// YIN 實際比對的是緩衝區前段（長度 N − τmax + 週期），顫音的「正確答案」取這段的平均音高
function analyzedFreq(logF, sr, minFreq, f0) {
  const len = Math.min(N, N - Math.ceil(sr / minFreq) + Math.round(sr / f0));
  let s = 0;
  for (let i = 0; i < len; i++) s += logF[i];
  return 2 ** (s / len);
}

// 共振峰（男聲母音），單位 Hz：[F1, F2, F3]
const VOWELS = {
  a: [730, 1090, 2440], i: [270, 2290, 3010], u: [300, 870, 2240],
  e: [530, 1840, 2480], o: [570, 840, 2410],
};
const BANDWIDTHS = [80, 90, 120];

// 產生人聲泛音振幅：聲源 −12 dB/八度 × 共振峰包絡，再把基頻壓弱
function voiceAmps(f0, vowel, weakRatio, oddWeak, rng) {
  const amps = [];
  for (let k = 1; k * f0 < 5000; k++) {
    const f = k * f0;
    let env = 0.05;
    VOWELS[vowel].forEach((F, i) => { env += 1 / Math.sqrt(1 + ((f - F) / BANDWIDTHS[i]) ** 2); });
    amps.push((env / k) * (0.8 + 0.4 * rng()));
  }
  amps[0] = weakRatio * amps[1];       // 基頻只剩第二泛音的一小部分
  if (oddWeak && amps.length > 2) amps[2] *= 0.3; // 更難：第三泛音也偏弱
  return amps;
}

// ---------- 結果表 ----------
const report = [];
function addRow(name, errs, octaveOk, total, extra = '') {
  const abs = errs.map(Math.abs);
  const mean = abs.reduce((a, b) => a + b, 0) / (abs.length || 1);
  const max = abs.length ? Math.max(...abs) : NaN;
  report.push({
    情況: name,
    次數: total,
    '平均誤差(音分)': mean.toFixed(3),
    '最大誤差(音分)': max.toFixed(3),
    八度正確率: total ? ((100 * octaveOk) / total).toFixed(2) + '%' : '-',
    備註: extra,
  });
}
after(() => {
  console.log('\n===== 偵測引擎測試結果 =====');
  console.table(report);
});

// ---------- 測試 ----------

test('freqToNote：音名、八度、音分（A4 = 438 / 440 / 442）', () => {
  for (const a4 of [438, 440, 442]) {
    const r = freqToNote(a4, a4);
    assert.equal(r.note, 'A'); assert.equal(r.octave, 4); assert.ok(Math.abs(r.cents) < 1e-9);
    const c4 = freqToNote(midiToFreq(60, a4), a4);
    assert.equal(c4.note, 'C'); assert.equal(c4.octave, 4); assert.equal(c4.midi, 60);
  }
  // 440 Hz 在 A4=442 下應偏低約 −7.85 音分
  assert.ok(Math.abs(freqToNote(440, 442).cents - centsBetween(440, 442)) < 1e-9);
  assert.equal(freqToNote(midiToFreq(61)).note, 'C♯');
  assert.equal(freqToNote(midiToFreq(24)).octave, 1); // C1
});

test('純音：41–2093 Hz，A4 = 438/440/442，誤差 ≤ 2 音分', () => {
  const errs = []; let ok = 0, total = 0;
  for (const sr of SAMPLE_RATES) {
    for (const a4 of [438, 440, 442]) {
      for (let m = 28; m <= 96; m++) { // E1(41 Hz) … C7(2093 Hz)
        const f = midiToFreq(m, a4);
        const { buf } = synth({ sr, f0: f, amps: [1], phases: [0.3] });
        const r = analyze(buf, sr, { ...PRESETS.instrument, a4 });
        total++;
        assert.ok(r, `${f.toFixed(2)} Hz @${sr} 沒有偵測到`);
        const e = centsBetween(r.freq, f);
        errs.push(e);
        if (Math.abs(e) < 100) ok++;
        assert.ok(Math.abs(e) <= 2, `${f.toFixed(2)} Hz @${sr}：誤差 ${e.toFixed(3)} 音分`);
        assert.equal(r.midi, m); assert.equal(r.octave, Math.floor(m / 12) - 1);
      }
    }
  }
  addRow('純音 41–2093 Hz', errs, ok, total);
});

test('含泛音（第二泛音強於基頻）：誤差 ≤ 2 音分、八度正確', () => {
  const rng = makeRng(2);
  const errs = []; let ok = 0, total = 0;
  for (const sr of SAMPLE_RATES) {
    for (let m = 28; m <= 96; m++) {
      const f = midiToFreq(m);
      const { buf } = synth({ sr, f0: f, amps: [0.4, 1, 0.6, 0.4, 0.3, 0.2], rng });
      const r = analyze(buf, sr, PRESETS.instrument);
      total++;
      assert.ok(r, `${f.toFixed(2)} Hz 沒有偵測到`);
      const e = centsBetween(r.freq, f);
      errs.push(e);
      if (Math.abs(e) < 100) ok++;
      assert.ok(Math.abs(e) <= 2, `${f.toFixed(2)} Hz @${sr}：誤差 ${e.toFixed(3)} 音分`);
    }
  }
  addRow('含泛音（H2 > H1）', errs, ok, total);
});

test('顫音（±30 音分、5.5 Hz）：與視窗內平均音高相差 ≤ 10 音分', () => {
  const rng = makeRng(3);
  const errs = []; let ok = 0, total = 0;
  for (const sr of SAMPLE_RATES) {
    for (let m = 28; m <= 96; m += 2) {
      for (const vibPhase of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
        const { buf, logF } = synth({
          sr, f0: midiToFreq(m), amps: [1, 0.5, 0.3], vibCents: 30, vibRate: 5.5, vibPhase, rng,
        });
        const trueFreq = analyzedFreq(logF, sr, PRESETS.instrument.minFreq, midiToFreq(m));
        const r = analyze(buf, sr, PRESETS.instrument);
        total++;
        assert.ok(r, `${midiToFreq(m).toFixed(1)} Hz 顫音沒有偵測到`);
        const e = centsBetween(r.freq, trueFreq);
        errs.push(e);
        if (Math.abs(e) < 100) ok++;
        assert.ok(Math.abs(e) <= 10, `${midiToFreq(m).toFixed(1)} Hz 顫音：誤差 ${e.toFixed(2)} 音分`);
      }
    }
  }
  addRow('顫音 ±30 音分 5.5 Hz', errs, ok, total, '與視窗平均音高比較');
});

test('白雜訊：不應回報音高', () => {
  const rng = makeRng(4);
  let nulls = 0, total = 0;
  for (const sr of SAMPLE_RATES) {
    for (let i = 0; i < 100; i++) {
      const buf = new Float32Array(N);
      for (let j = 0; j < N; j++) buf[j] = 0.1 * gauss(rng);
      for (const preset of Object.values(PRESETS)) {
        total++;
        if (detectPitch(buf, sr, preset) === null) nulls++;
      }
    }
  }
  report.push({ 情況: '白雜訊', 次數: total, '平均誤差(音分)': '-', '最大誤差(音分)': '-',
    八度正確率: '-', 備註: `正確判為無音高 ${((100 * nulls) / total).toFixed(2)}%` });
  assert.ok(nulls / total >= 0.99, `白雜訊誤判比例過高：${total - nulls}/${total}`);
});

// 低音區 4096 點只含 2–5 個週期，受雜訊影響較大（實際使用時會再取多格中位數平滑）
test('音＋雜訊（SNR 20 dB）：誤差 ≤ 5 音分（130 Hz 以下 ≤ 12、65 Hz 以下 ≤ 20）', () => {
  const rng = makeRng(5);
  const errs = []; let ok = 0, total = 0;
  for (const sr of SAMPLE_RATES) {
    for (let m = 28; m <= 96; m += 3) {
      const f = midiToFreq(m);
      const { buf } = synth({ sr, f0: f, amps: [1, 0.5, 0.3], snr: 20, rng });
      const r = analyze(buf, sr, PRESETS.instrument);
      total++;
      assert.ok(r, `${f.toFixed(1)} Hz 加雜訊後沒有偵測到`);
      const e = centsBetween(r.freq, f);
      errs.push(e);
      if (Math.abs(e) < 100) ok++;
      const tol = f < 65 ? 20 : f < 130 ? 12 : 5;
      assert.ok(Math.abs(e) <= tol, `${f.toFixed(1)} Hz 加雜訊：誤差 ${e.toFixed(2)} 音分`);
    }
  }
  addRow('音＋雜訊 SNR 20 dB', errs, ok, total, '單格、未平滑；低音誤差較大');
});

test('靜音與極小聲：回傳 null', () => {
  const rng = makeRng(6);
  for (const sr of SAMPLE_RATES) {
    assert.equal(detectPitch(new Float32Array(N), sr, PRESETS.instrument), null);
    const tiny = new Float32Array(N);
    for (let i = 0; i < N; i++) tiny[i] = 0.001 * gauss(rng);
    assert.equal(detectPitch(tiny, sr, PRESETS.instrument), null);
  }
});

// 弱基頻人聲：每個半音 × 多組隨機變化
function voiceTrial(preset, mLo, mHi, variants, seed) {
  const rng = makeRng(seed);
  const vowels = Object.keys(VOWELS);
  const errs = []; let ok = 0, detected = 0, total = 0;
  const failures = [];
  for (const sr of SAMPLE_RATES) {
    for (let m = mLo; m <= mHi; m++) {
      for (let v = 0; v < variants; v++) {
        const f0 = midiToFreq(m) * 2 ** ((rng() - 0.5) * 0.5 / 12); // ±25 音分隨機偏移
        const amps = voiceAmps(f0, vowels[v % vowels.length], 0.05 + 0.25 * rng(), v % 3 === 2, rng);
        const { buf, logF } = synth({
          sr, f0, amps,
          vibCents: v % 2 ? 20 + 20 * rng() : 0, vibRate: 5 + rng(), vibPhase: rng() * 6.28,
          jitter: 0.003, shimmer: 0.1, snr: 30, rng,
        });
        const trueFreq = analyzedFreq(logF, sr, preset.minFreq, f0);
        const r = analyze(buf, sr, preset);
        total++;
        if (!r) { failures.push(`midi ${m} @${sr} 未偵測`); continue; }
        detected++;
        const e = centsBetween(r.freq, trueFreq);
        if (Math.abs(e) < 100) { ok++; errs.push(e); } else failures.push(`midi ${m} @${sr}：${e.toFixed(0)} 音分`);
      }
    }
  }
  return { errs, ok, detected, total, failures };
}

test('弱基頻男聲 D2–C4（男聲參數）：八度正確率 ≥ 99%', () => {
  const { errs, ok, detected, total, failures } = voiceTrial(PRESETS.male, 38, 60, 40, 7);
  // 對照組：關掉次諧波驗證，看它幫了多少
  const plain = voiceTrial({ ...PRESETS.male, subharmonicCheck: false }, 38, 60, 40, 7);
  addRow('弱基頻男聲 D2–C4', errs, ok, total,
    `偵測率 ${((100 * detected) / total).toFixed(2)}%；關掉次諧波驗證時 ${((100 * plain.ok) / plain.total).toFixed(2)}%`);
  if (failures.length) console.log('男聲失誤：', failures.slice(0, 20).join('; '));
  assert.ok(ok / total >= 0.99, `八度正確率 ${((100 * ok) / total).toFixed(2)}%`);
});

test('弱基頻童聲／女聲 E3–C6（童聲參數）：八度正確率 ≥ 99%', () => {
  const { errs, ok, detected, total, failures } = voiceTrial(PRESETS.child, 52, 84, 12, 8);
  addRow('弱基頻童聲 E3–C6', errs, ok, total, `偵測率 ${((100 * detected) / total).toFixed(2)}%`);
  if (failures.length) console.log('童聲失誤：', failures.slice(0, 20).join('; '));
  assert.ok(ok / total >= 0.99, `八度正確率 ${((100 * ok) / total).toFixed(2)}%`);
});

test('反向檢查：男聲參數偵測純音，不可誤降八度', () => {
  const errs = []; let ok = 0, total = 0;
  for (const sr of SAMPLE_RATES) {
    for (let m = 38; m <= 72; m++) { // D2–C5
      const f = midiToFreq(m);
      const { buf } = synth({ sr, f0: f, amps: [1], phases: [1] });
      const r = analyze(buf, sr, PRESETS.male);
      total++;
      assert.ok(r);
      const e = centsBetween(r.freq, f);
      errs.push(e);
      if (Math.abs(e) < 100) ok++;
      assert.ok(Math.abs(e) <= 2, `${f.toFixed(1)} Hz 被判成 ${r.freq.toFixed(1)} Hz`);
    }
  }
  addRow('男聲參數＋純音 D2–C5', errs, ok, total, '確認不會誤降八度');
});

test('效能：樂器模式 4096 點 @48000 每格耗時', () => {
  const { buf } = synth({ sr: 48000, f0: 110, amps: [1, 0.5] });
  const runs = 50;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) detectPitch(buf, 48000, PRESETS.instrument);
  const ms = (performance.now() - t0) / runs;
  report.push({ 情況: '效能（本機 Mac）', 次數: runs, '平均誤差(音分)': '-', '最大誤差(音分)': '-',
    八度正確率: '-', 備註: `每格 ${ms.toFixed(2)} ms（約 ${Math.floor(1000 / ms)} 次/秒上限）` });
  assert.ok(ms < 25);
});
