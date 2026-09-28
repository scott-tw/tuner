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

export class MicError extends Error {
  constructor(kind, cause) {
    super(kind);
    this.kind = kind; // 'insecure' | 'denied' | 'notfound' | 'other'
    this.cause = cause;
  }
}

function classify(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'notfound';
  return 'other';
}

// 必須在 click handler 內直接呼叫（不可先 await 別的東西）
export function startAudio() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return Promise.reject(new MicError('insecure'));
  }
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
  }
  const resumed = ctx.resume();
  const mic = navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  return Promise.all([resumed, mic]).then(([, s]) => {
    stopMic();
    stream = s;
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = BUFFER_SIZE;
    buffer = new Float32Array(analyser.fftSize);
    source.connect(analyser);
  }, (err) => {
    throw err instanceof MicError ? err : new MicError(classify(err), err);
  });
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
