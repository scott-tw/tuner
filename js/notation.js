// 音名／唱名換算與五線譜 SVG（純函式，回傳字串，可在 Node 測試）

import { NOTE_NAMES } from './pitch.js';

// 固定唱名（台灣慣用 Si）
export const SOLFEGE = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

// midi 編號 → { letter: 'C♯', solfege: 'Do♯', octave: 4 }；中央 C = C4
export function noteLabels(midi) {
  const i = ((midi % 12) + 12) % 12;
  return { letter: NOTE_NAMES[i], solfege: SOLFEGE[i], octave: Math.floor(midi / 12) - 1 };
}

// ---------- 五線譜 ----------

export const CLEFS = {
  treble: '高音譜號',
  bass: '低音譜號',
  treble8vb: '高音譜號（低八度）', // 下加 8：記譜比實際聲音高一個八度
};

const LETTER_STEP = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6]; // C C♯ D D♯ E F F♯ G G♯ A A♯ B
const IS_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
// 各譜號最下面一線的音（以「八度×7＋音級」表示）：高音 E4、低音 G2、下加 8 高音 E3
const BOTTOM_LINE = { treble: 4 * 7 + 2, bass: 2 * 7 + 4, treble8vb: 3 * 7 + 2 };

// 音在譜上的位置：pos 0 = 第一線，每 +1 往上一格（線、間交替），8 = 第五線
export function staffPosition(midi, clef = 'treble') {
  const pc = ((midi % 12) + 12) % 12;
  const step = (Math.floor(midi / 12) - 1) * 7 + LETTER_STEP[pc];
  return { pos: step - BOTTOM_LINE[clef], sharp: IS_SHARP[pc] === 1 };
}

// 需要的加線位置（譜外的偶數 pos）
export function ledgerLines(pos) {
  const out = [];
  for (let p = -2; p >= pos; p -= 2) out.push(p);
  for (let p = 10; p <= pos; p += 2) out.push(p);
  return out;
}

const W = 260;
const HALF = 7; // 相鄰線與間的距離（線距 14）
const PAD = 8;
// 各譜號要容納的範圍（pos），涵蓋對應聲部的音域再多留一格
export const POS_RANGE = { treble: [-9, 14], bass: [-5, 19], treble8vb: [-12, 12] };

// 高音譜號：以第二線（G）為中心的漩渦
function trebleClef(g) {
  const x = 32;
  const d = [
    `M ${x + 3} ${g + 3}`,
    `C ${x + 4} ${g - 7} ${x - 10} ${g - 8} ${x - 10} ${g + 3}`,
    `C ${x - 10} ${g + 16} ${x + 15} ${g + 16} ${x + 15} ${g + 1}`,
    `C ${x + 15} ${g - 12} ${x - 13} ${g - 17} ${x - 8} ${g - 34}`,
    `C ${x - 4} ${g - 46} ${x + 9} ${g - 55} ${x + 7} ${g - 64}`,
    `C ${x + 5} ${g - 72} ${x - 7} ${g - 64} ${x - 4} ${g - 46}`,
    `L ${x + 5} ${g + 30}`,
    `C ${x + 7} ${g + 40} ${x - 4} ${g + 44} ${x - 8} ${g + 36}`,
  ].join(' ');
  return `<path class="clef" d="${d}"/><circle class="clef-dot" cx="${x - 6}" cy="${g + 34}" r="4.5"/>`;
}

// 低音譜號：兩點夾住第四線（F）
function bassClef(f) {
  const x = 16;
  const d = [
    `M ${x + 3} ${f}`,
    `C ${x + 1} ${f - 16} ${x + 33} ${f - 20} ${x + 33} ${f + 1}`,
    `C ${x + 33} ${f + 20} ${x + 16} ${f + 33} ${x - 2} ${f + 40}`,
  ].join(' ');
  return `<path class="clef" d="${d}"/><circle class="clef-dot" cx="${x + 5}" cy="${f}" r="5"/>`
    + `<circle class="clef-dot" cx="${x + 42}" cy="${f - 6}" r="3"/>`
    + `<circle class="clef-dot" cx="${x + 42}" cy="${f + 6}" r="3"/>`;
}

// 回傳整張五線譜的 SVG 字串。midi 為 null 時只畫譜。
// options.state：'good'（準）/ 'off'（不準）/ 'idle'（淡出）
export function staffSVG(midi, clef = 'treble', { state = 'off' } = {}) {
  const [lo, hi] = POS_RANGE[clef];
  const H = (hi - lo) * HALF + PAD * 2;
  const y = (pos) => PAD + (hi - pos) * HALF;
  const parts = [];
  for (let p = 0; p <= 8; p += 2) {
    parts.push(`<line class="staff-line" x1="8" x2="${W - 8}" y1="${y(p)}" y2="${y(p)}"/>`);
  }
  // 譜號：用向量線條自己畫，避免各手機字型大小不一
  parts.push(clef === 'bass' ? bassClef(y(6)) : trebleClef(y(2)));
  if (clef === 'treble8vb') parts.push(`<text class="clef-8" x="21" y="${y(-7) + 3}">8</text>`);

  if (midi != null) {
    const { pos, sharp } = staffPosition(midi, clef);
    const cx = 170;
    for (const p of ledgerLines(pos)) {
      parts.push(`<line class="ledger" x1="${cx - 17}" x2="${cx + 17}" y1="${y(p)}" y2="${y(p)}"/>`);
    }
    const cy = y(Math.max(lo, Math.min(hi, pos)));
    parts.push(`<g class="note ${state}">`);
    if (sharp) parts.push(`<text class="sharp" x="${cx - 32}" y="${cy + 8}">♯</text>`);
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="9.5" ry="6.8" transform="rotate(-20 ${cx} ${cy})"/>`);
    parts.push('</g>');
  }

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${parts.join('')}</svg>`;
}
