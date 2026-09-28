// 音名／唱名換算（五線譜繪製於階段 3 加入）

import { NOTE_NAMES } from './pitch.js';

// 固定唱名（台灣慣用 Si）
export const SOLFEGE = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];

// midi 編號 → { letter: 'C♯', solfege: 'Do♯', octave: 4 }；中央 C = C4
export function noteLabels(midi) {
  const i = ((midi % 12) + 12) % 12;
  return { letter: NOTE_NAMES[i], solfege: SOLFEGE[i], octave: Math.floor(midi / 12) - 1 };
}
