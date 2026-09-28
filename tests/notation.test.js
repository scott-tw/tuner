// 五線譜位置測試：node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteLabels, staffPosition, ledgerLines, staffSVG, POS_RANGE } from '../js/notation.js';

test('音名與唱名', () => {
  assert.deepEqual(noteLabels(60), { letter: 'C', solfege: 'Do', octave: 4 });
  assert.deepEqual(noteLabels(55), { letter: 'G', solfege: 'Sol', octave: 3 });
  assert.deepEqual(noteLabels(70), { letter: 'A♯', solfege: 'La♯', octave: 4 });
  assert.deepEqual(noteLabels(71), { letter: 'B', solfege: 'Si', octave: 4 });
});

test('高音譜號：E4 在第一線、F5 在第五線、中央 C 在下加一線', () => {
  assert.equal(staffPosition(64, 'treble').pos, 0);
  assert.equal(staffPosition(77, 'treble').pos, 8);
  assert.equal(staffPosition(67, 'treble').pos, 2);  // G4 在第二線
  assert.equal(staffPosition(60, 'treble').pos, -2);
  assert.deepEqual(ledgerLines(-2), [-2]);
  assert.deepEqual(staffPosition(61, 'treble'), { pos: -2, sharp: true }); // C♯4
});

test('低音譜號：G2 在第一線、A3 在第五線、中央 C 在上加一線', () => {
  assert.equal(staffPosition(43, 'bass').pos, 0);
  assert.equal(staffPosition(57, 'bass').pos, 8);
  assert.equal(staffPosition(53, 'bass').pos, 6);   // F3 在第四線
  assert.equal(staffPosition(60, 'bass').pos, 10);
  assert.deepEqual(ledgerLines(10), [10]);
  assert.equal(staffPosition(38, 'bass').pos, -3);  // D2：下加一線之下
  assert.deepEqual(ledgerLines(-3), [-2]);
});

test('下加 8 高音譜號：記譜比實際高一個八度（E3 在第一線）', () => {
  assert.equal(staffPosition(52, 'treble8vb').pos, 0);
  assert.equal(staffPosition(48, 'treble8vb').pos, -2); // C3 寫在中央 C 的位置
  for (let m = 36; m <= 84; m++) {
    assert.equal(staffPosition(m, 'treble8vb').pos, staffPosition(m + 12, 'treble').pos);
  }
});

test('各聲部音域都畫得進譜內', () => {
  const ranges = { treble: [52, 84], bass: [38, 72], treble8vb: [38, 72] }; // 童女聲 E3–C6、男聲 D2–C5
  for (const [clef, [lo, hi]] of Object.entries(ranges)) {
    for (let m = lo; m <= hi; m++) {
      const { pos } = staffPosition(m, clef);
      assert.ok(pos >= POS_RANGE[clef][0] && pos <= POS_RANGE[clef][1], `${clef} midi ${m} pos ${pos}`);
      assert.ok(ledgerLines(pos).length <= 6);
    }
  }
});

test('staffSVG 產生合法的 SVG 字串', () => {
  const s = staffSVG(61, 'treble', { state: 'good' });
  assert.match(s, /^<svg [^>]*viewBox/);
  assert.match(s, /♯/);
  assert.equal((s.match(/class="staff-line"/g) || []).length, 5);
  assert.doesNotMatch(staffSVG(null, 'bass'), /ellipse/);
});
