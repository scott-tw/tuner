// 音訊：AudioContext、麥克風、讀取波形
//
// iOS Safari 規定：建立／resume AudioContext 與 getUserMedia 必須在使用者點擊的 handler 內「同步」呼叫，
// 所以 startAudio() 在第一個 await 之前就把兩者都啟動。

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
