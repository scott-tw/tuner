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

// 譜號外形取自 Bravura 樂譜字型（© Steinberg Media Technologies GmbH，SIL Open Font License 1.1）。
// 依 SMuFL 標準：1 線距 = 250 單位；G 譜號原點在第二線（G），F 譜號原點在第四線（F）；y 軸向上。
const G_CLEF = 'M376 415C374 427 376 428 382 434C398 449 419 470 438 491C522 583 572 702 572 815C572 902 548 988 507 1048C492 1070 466 1098 455 1098C441 1098 410 1072 390 1050C316 968 292 843 292 739C292 681 299 616 306 575C308 563 309 561 297 551C233 498 164 437 112 373C43 287 0 194 0 87C0 -87 119 -252 364 -252C387 -252 413 -250 433 -246C444 -244 446 -243 448 -255C460 -322 475 -409 475 -456C475 -604 375 -622 316 -622C262 -622 236 -606 236 -593C236 -586 245 -583 268 -576C299 -567 335 -540 335 -482C335 -427 300 -380 239 -380C172 -380 132 -433 132 -495C132 -560 171 -658 322 -658C389 -658 519 -628 519 -458C519 -401 501 -306 490 -244C488 -232 489 -233 503 -227C604 -187 671 -102 671 11C671 139 577 252 430 252C404 252 404 252 401 270ZM470 943C503 943 530 916 530 861C530 792 497 728 419 650C403 634 379 611 356 591C349 585 345 586 343 599C339 625 337 659 337 691C337 847 409 943 470 943ZM361 262C364 243 364 244 346 238C258 208 201 129 201 44C201 -46 248 -110 316 -133C324 -136 336 -139 343 -139C351 -139 355 -134 355 -128C355 -121 347 -118 340 -115C298 -97 268 -54 268 -8C268 49 307 92 368 109C384 113 386 112 388 101L438 -197C440 -208 439 -208 424 -211C408 -214 388 -216 368 -216C193 -216 80 -119 80 20C80 79 90 158 173 252C233 319 279 356 326 394C336 402 338 401 340 390ZM430 103C428 115 429 118 441 117C522 110 589 42 589 -46C589 -109 551 -160 495 -188C483 -194 481 -194 479 -182Z';
const F_CLEF = 'M252 262C78 262 0 135 0 39C0 -41 42 -110 123 -110C186 -110 229 -66 229 -4C229 60 182 100 133 100C106 100 96 93 83 93C70 93 67 101 67 111C67 151 127 224 229 224C335 224 381 120 381 -37C381 -140 359 -260 297 -356C237 -449 134 -534 10 -605C1 -610 -5 -615 -5 -623C-5 -629 -1 -635 8 -635C13 -635 19 -633 25 -630C158 -565 286 -489 392 -375C479 -281 531 -159 531 -28C531 146 425 262 252 262ZM629 180C598 180 574 156 574 125C574 94 598 70 629 70C660 70 684 94 684 125C684 156 660 180 629 180ZM630 -71C599 -71 576 -94 576 -125C576 -156 599 -179 630 -179C661 -179 684 -156 684 -125C684 -94 661 -71 630 -71Z';
const GLYPH_SCALE = (HALF * 2) / 250;

function glyph(d, x, lineY) {
  return `<path class="clef" transform="translate(${x} ${lineY}) scale(${GLYPH_SCALE} ${-GLYPH_SCALE})" d="${d}"/>`;
}

// 回傳整張五線譜的 SVG 字串。midi 為 null 時只畫譜。
// options.state：'good'（準）/ 'off'（不準）/ 'idle'（淡出）
// options.target：目標音（空心灰色音符，畫在唱出的音左邊），null 表示不畫
export function staffSVG(midi, clef = 'treble', { state = 'off', target = null } = {}) {
  const [lo, hi] = POS_RANGE[clef];
  const H = (hi - lo) * HALF + PAD * 2;
  const y = (pos) => PAD + (hi - pos) * HALF;
  const parts = [];
  for (let p = 0; p <= 8; p += 2) {
    parts.push(`<line class="staff-line" x1="8" x2="${W - 8}" y1="${y(p)}" y2="${y(p)}"/>`);
  }
  // 譜號：用向量外形畫，不依賴手機字型，各裝置顯示一致
  parts.push(clef === 'bass' ? glyph(F_CLEF, 14, y(6)) : glyph(G_CLEF, 12, y(2)));
  if (clef === 'treble8vb') parts.push(`<text class="clef-8" x="33" y="${y(-5) + 5}" text-anchor="middle">8</text>`);

  const note = (m, cx, cls) => {
    const { pos, sharp } = staffPosition(m, clef);
    for (const p of ledgerLines(pos)) {
      parts.push(`<line class="ledger" x1="${cx - 17}" x2="${cx + 17}" y1="${y(p)}" y2="${y(p)}"/>`);
    }
    const cy = y(Math.max(lo, Math.min(hi, pos)));
    parts.push(`<g class="${cls}">`);
    if (sharp) parts.push(`<text class="sharp" x="${cx - 32}" y="${cy + 8}">♯</text>`);
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="9.5" ry="6.8" transform="rotate(-20 ${cx} ${cy})"/>`);
    parts.push('</g>');
  };

  if (target != null) note(target, 120, 'target');
  if (midi != null) note(midi, target != null ? 195 : 170, `note ${state}`);

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">${parts.join('')}</svg>`;
}
