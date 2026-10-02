// 節拍器計算邏輯測試：node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tempoTerm, accentPattern, createSequencer, createTapTempo, tickSeconds, clampBpm,
} from '../js/metronome.js';

test('速度術語（義大利文＋中文）', () => {
  assert.deepEqual(tempoTerm(30), { it: 'Grave', zh: '莊板' });
  assert.deepEqual(tempoTerm(50), { it: 'Largo', zh: '廣板' });
  assert.deepEqual(tempoTerm(72), { it: 'Adagio', zh: '慢板' });
  assert.deepEqual(tempoTerm(88), { it: 'Andante', zh: '行板' });
  assert.deepEqual(tempoTerm(112), { it: 'Moderato', zh: '中板' });
  assert.deepEqual(tempoTerm(120), { it: 'Allegro', zh: '快板' });
  assert.deepEqual(tempoTerm(180), { it: 'Presto', zh: '急板' });
  assert.deepEqual(tempoTerm(250), { it: 'Prestissimo', zh: '最急板' });
  for (let b = 30; b <= 250; b++) assert.ok(tempoTerm(b).it); // 每個速度都有術語
});

test('拍號重音：第一拍重音，6/8 第 4 拍次重音', () => {
  assert.deepEqual(accentPattern('2/4'), ['strong', 'normal']);
  assert.deepEqual(accentPattern('3/4'), ['strong', 'normal', 'normal']);
  assert.deepEqual(accentPattern('4/4'), ['strong', 'normal', 'normal', 'normal']);
  assert.deepEqual(accentPattern('6/8'), ['strong', 'normal', 'normal', 'medium', 'normal', 'normal']);
  assert.equal(accentPattern(7).length, 7);   // 自訂拍數
  assert.deepEqual(accentPattern(1), ['strong']);
});

test('拍子順序：3/4 加八分音符細分', () => {
  const seq = createSequencer('3/4', 2);
  const got = Array.from({ length: 8 }, () => seq.next());
  assert.deepEqual(got.map((t) => `${t.beat}.${t.sub}:${t.level}`), [
    '0.0:strong', '0.1:sub', '1.0:normal', '1.1:sub', '2.0:normal', '2.1:sub',
    '0.0:strong', '0.1:sub', // 下一小節又從重音開始
  ]);
});

test('拍子順序：6/8 不細分', () => {
  const seq = createSequencer('6/8', 1);
  const levels = Array.from({ length: 7 }, () => seq.next().level);
  assert.deepEqual(levels, ['strong', 'normal', 'normal', 'medium', 'normal', 'normal', 'strong']);
});

test('每一下的間隔', () => {
  assert.equal(tickSeconds(60), 1);
  assert.equal(tickSeconds(120), 0.5);
  assert.equal(tickSeconds(90, 3), 60 / 90 / 3); // 三連音
  assert.equal(clampBpm(10), 30);
  assert.equal(clampBpm(300), 250);
  assert.equal(clampBpm(96.4), 96);
});

test('點拍測速：穩定點 100 BPM，偶爾點歪也不影響', () => {
  const tap = createTapTempo();
  assert.equal(tap.tap(0), null);           // 只點一下還不能算
  let bpm;
  const gaps = [600, 600, 640, 600, 560, 600, 600]; // 100 BPM = 600 ms，夾雜點歪的
  let t = 0;
  for (const g of gaps) { t += g; bpm = tap.tap(t); }
  assert.equal(bpm, 100);
});

test('點拍測速：停頓超過 2 秒重新計算', () => {
  const tap = createTapTempo();
  tap.tap(0); tap.tap(500); tap.tap(1000);   // 120 BPM
  assert.equal(tap.tap(4000), null);          // 停很久：重來
  assert.equal(tap.tap(5000), 60);
});
