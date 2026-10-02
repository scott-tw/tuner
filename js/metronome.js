// 節拍器的計算邏輯（純函式，不碰畫面與聲音，可在 Node 測試）

export const BPM_MIN = 30;
export const BPM_MAX = 250;

export const clampBpm = (bpm) => Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(bpm)));

// 速度術語（各家範圍略有不同，取常見的對照）
const TEMPO_TERMS = [
  [40, 'Grave', '莊板'],
  [60, 'Largo', '廣板'],
  [66, 'Larghetto', '小廣板'],
  [76, 'Adagio', '慢板'],
  [108, 'Andante', '行板'],
  [120, 'Moderato', '中板'],
  [156, 'Allegro', '快板'],
  [176, 'Vivace', '甚快板'],
  [200, 'Presto', '急板'],
  [Infinity, 'Prestissimo', '最急板'],
];

// 120 → { it: 'Allegro', zh: '快板' }
export function tempoTerm(bpm) {
  const [, it, zh] = TEMPO_TERMS.find(([upper]) => bpm < upper);
  return { it, zh };
}

// 拍號：'2/4'、'3/4'、'4/4'、'6/8'，或自訂拍數（以四分音符為一拍）
export const METER_PRESETS = ['2/4', '3/4', '4/4', '6/8'];

// 每小節各拍的重音：'strong'（第一拍）、'medium'（次重音）、'normal'
// 6/8 以八分音符為一拍：第 1 拍重音、第 4 拍次重音
export function accentPattern(meter) {
  if (meter === '6/8') return ['strong', 'normal', 'normal', 'medium', 'normal', 'normal'];
  const beats = typeof meter === 'number' ? meter : Number(String(meter).split('/')[0]);
  return Array.from({ length: beats }, (_, i) => (i === 0 ? 'strong' : 'normal'));
}

// 每一下之間的秒數（subdivision：每拍敲幾下，1／2／3／4）
export const tickSeconds = (bpm, subdivision = 1) => 60 / bpm / subdivision;

// 依序產生每一下：{ beat（0 起算）, sub（0 起算，0 = 正拍）, level }
// level：'strong' | 'medium' | 'normal' | 'sub'（細分拍）
export function createSequencer(meter, subdivision = 1) {
  const pattern = accentPattern(meter);
  let beat = 0;
  let sub = 0;
  return {
    beats: pattern.length,
    next() {
      const tick = { beat, sub, level: sub === 0 ? pattern[beat] : 'sub' };
      sub++;
      if (sub >= subdivision) {
        sub = 0;
        beat = (beat + 1) % pattern.length;
      }
      return tick;
    },
  };
}

// 點拍測速：跟著音樂點，取最近幾次間隔的中位數換算速度
// 停頓超過 2 秒視為重新開始；至少點 2 下才有結果
export function createTapTempo({ maxTaps = 8, resetMs = 2000 } = {}) {
  let taps = [];
  return {
    tap(now) {
      if (taps.length && now - taps[taps.length - 1] > resetMs) taps = [];
      taps.push(now);
      if (taps.length > maxTaps) taps.shift();
      if (taps.length < 2) return null;
      const gaps = taps.slice(1).map((t, i) => t - taps[i]).sort((a, b) => a - b);
      const mid = gaps.length >> 1;
      const gap = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
      return clampBpm(60000 / gap);
    },
    reset() {
      taps = [];
    },
  };
}
