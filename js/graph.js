// 音高軌跡圖：最近 10 秒，橫軸時間、縱軸音高（半音格線），畫出目標音參考線

import { noteLabels } from './notation.js';

const WINDOW_MS = 10000;
const SPAN = 12;          // 縱軸顯示的半音數
const GAP_MS = 150;       // 兩點相隔超過這麼久就不連線（中間有換氣或無聲）
const GOOD_CENTS = 15;

export function createPitchGraph(canvas) {
  const ctx2d = canvas.getContext('2d');
  let points = [];        // { t, midi }（midi 為小數；無聲時不記錄）
  let center = null;      // 目前縱軸中心（緩動）
  let colors = null;
  let colorsAt = 0;

  function readColors(now) {
    if (colors && now - colorsAt < 1000) return colors;
    const cs = getComputedStyle(canvas);
    const v = (name) => cs.getPropertyValue(name).trim();
    colors = {
      text: v('--muted'), line: v('--line'), accent: v('--accent'),
      good: v('--good'), goodBg: v('--good-bg'), warn: v('--warn'),
    };
    colorsAt = now;
    return colors;
  }

  function fit() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { w, h, dpr };
  }

  return {
    push(t, midi) {
      points.push({ t, midi });
      while (points.length && t - points[0].t > WINDOW_MS) points.shift();
    },

    clear() {
      points = [];
      center = null;
    },

    // target：目標音（整數 midi）或 null；naming：音名顯示方式
    draw(now, target, naming) {
      const { w, h, dpr } = fit();
      if (!w || !h) return;
      const c = readColors(now);
      const last = points.length ? points[points.length - 1].midi : null;

      // 縱軸中心：有目標音時對準目標，否則跟著最近唱的音
      const desired = target ?? (last != null ? Math.round(last) : center ?? 60);
      center = center == null ? desired : center + (desired - center) * 0.08;
      const lo = center - SPAN / 2;
      const yOf = (m) => h - ((m - lo) / SPAN) * h;
      const xOf = (t) => w - ((now - t) / WINDOW_MS) * (w - 44 * dpr);

      ctx2d.clearRect(0, 0, w, h);

      // 半音格線（自然音加標籤）
      ctx2d.font = `${11 * dpr}px -apple-system, "Noto Sans TC", sans-serif`;
      ctx2d.textBaseline = 'middle';
      for (let m = Math.ceil(lo); m <= lo + SPAN; m++) {
        const y = yOf(m);
        const label = noteLabels(m);
        const natural = !label.letter.includes('♯');
        ctx2d.strokeStyle = c.line;
        ctx2d.globalAlpha = natural ? 0.9 : 0.4;
        ctx2d.lineWidth = dpr;
        ctx2d.beginPath();
        ctx2d.moveTo(40 * dpr, y);
        ctx2d.lineTo(w, y);
        ctx2d.stroke();
        if (natural) {
          ctx2d.fillStyle = c.text;
          ctx2d.fillText(`${naming === 'solfege' ? label.solfege : label.letter}${label.octave}`, 2 * dpr, y);
        }
      }
      ctx2d.globalAlpha = 1;

      // 目標音參考線與 ±15 音分綠色帶
      const ref = target ?? (last != null ? Math.round(last) : null);
      if (ref != null) {
        const band = (GOOD_CENTS / 100) * (h / SPAN);
        ctx2d.fillStyle = c.goodBg;
        ctx2d.fillRect(40 * dpr, yOf(ref) - band, w, band * 2);
        ctx2d.strokeStyle = c.accent;
        ctx2d.lineWidth = 2 * dpr;
        ctx2d.setLineDash(target != null ? [] : [6 * dpr, 5 * dpr]);
        ctx2d.beginPath();
        ctx2d.moveTo(40 * dpr, yOf(ref));
        ctx2d.lineTo(w, yOf(ref));
        ctx2d.stroke();
        ctx2d.setLineDash([]);
      }

      // 音高軌跡：準的段落綠色，其他橘色
      ctx2d.lineWidth = 3 * dpr;
      ctx2d.lineCap = 'round';
      ctx2d.lineJoin = 'round';
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        if (b.t - a.t > GAP_MS) continue;
        const goal = target ?? Math.round(b.midi);
        ctx2d.strokeStyle = Math.abs(b.midi - goal) * 100 <= GOOD_CENTS ? c.good : c.warn;
        ctx2d.beginPath();
        ctx2d.moveTo(xOf(a.t), yOf(a.midi));
        ctx2d.lineTo(xOf(b.t), yOf(b.midi));
        ctx2d.stroke();
      }
      // 最新一點畫圓點
      const tail = points[points.length - 1];
      if (tail && now - tail.t < GAP_MS) {
        const goal = target ?? Math.round(tail.midi);
        ctx2d.fillStyle = Math.abs(tail.midi - goal) * 100 <= GOOD_CENTS ? c.good : c.warn;
        ctx2d.beginPath();
        ctx2d.arc(xOf(tail.t), yOf(tail.midi), 5 * dpr, 0, Math.PI * 2);
        ctx2d.fill();
      }
    },
  };
}
