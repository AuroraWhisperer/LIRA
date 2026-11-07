'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT = path.resolve(__dirname, '../..');
const load = name => loadModuleExports(path.join(ROOT, `public/js/lyrics/advanced-lyric-${name}.js`));

test('advanced text keeps graphemes and supplied token intervals while sweeping a multi-character token', async () => {
  const { createAdvancedLyricText, advancedLyricUnitProgress } = await load('layouts');
  const text = '你 👨‍👩‍👧‍👦 Cafe\u0301';
  const units = createAdvancedLyricText({ text, startMs: 0, endMs: 5000, words: [
    { text: '你', startMs: 100, endMs: 600 }, { text: '👨‍👩‍👧‍👦', startMs: 800, endMs: 1300 },
    { text: 'Cafe\u0301', startMs: 2000, endMs: 4000 },
  ] });
  assert.equal(units.map(unit => unit.text).join(''), text);
  assert.ok(units.some(unit => unit.text === '👨‍👩‍👧‍👦'));
  assert.ok(units.some(unit => unit.text === 'e\u0301'));
  const cafe = units.filter(unit => unit.startMs === 2000);
  assert.equal(cafe.length, 4);
  assert.ok(cafe.every(unit => unit.endMs === 4000));
  assert.equal(advancedLyricUnitProgress(cafe[0], 2750), 1);
  assert.equal(advancedLyricUnitProgress(cafe[1], 2750), 0.5);
  assert.equal(advancedLyricUnitProgress(cafe[2], 2750), 0);
});

test('long text remains complete while the number of animated units is bounded', async () => {
  const { createAdvancedLyricText, partitionAdvancedLyricText, buildAdvancedLyricLayout } = await load('layouts');
  const text = '长句含有空格 and words 与表情 👩🏽‍🚀 '.repeat(20);
  const units = createAdvancedLyricText({ text, startMs: 1000, endMs: 12000 });
  assert.ok(units.length <= 96);
  assert.equal(units.map(unit => unit.text).join(''), text);
  for (const name of ['center', 'corners', 'vertical', 'tiles', 'orbit']) {
    const plan = buildAdvancedLyricLayout(name, units);
    assert.equal(plan.filter(item => item.source === 'current' && !item.decorative)
      .map(item => units.slice(item.start, item.end).map(unit => unit.text).join('')).join(''), text);
  }
  const english = createAdvancedLyricText({ text: 'words remain together', startMs: 0, endMs: 3000 });
  assert.ok(partitionAdvancedLyricText(english, 2).every(part => !/^[a-z]{1,2}$/i.test(english.slice(part.start, part.end).map(unit => unit.text).join('').trim())));
});

test('joining scripts remain one shaped text run', async () => {
  const { createAdvancedLyricText } = await load('layouts');
  for (const text of ['أُحِبُّكَ', 'तुमसे प्यार', 'ฉันรักเธอ']) {
    const units = createAdvancedLyricText({ text, startMs: 0, endMs: 4000 });
    assert.equal(units.length, 1);
    assert.equal(units[0].text, text);
  }
});

test('advanced lyric retires after a sung line before a long interlude and uses the supplied next-line boundary', async () => {
  const { advancedLyricLineWindow } = await load('renderer');
  const line = { text: '唱完这一句', startMs: 1000, endMs: 10000, words: [{ text: '唱完这一句', startMs: 1000, endMs: 4000 }] };
  assert.equal(advancedLyricLineWindow(line, { startMs: 10000 }).endMs, 4800);
  assert.equal(advancedLyricLineWindow({ text: '普通歌词', startMs: 1000 }, { startMs: 5000 }).endMs, 5000);
});

test('motion follows pause and backward seek, cancels hidden work, and resumes from host time', async () => {
  const { createAdvancedLyricMotion, advancedLyricKeyframes } = await load('motion');
  const animations = [];
  const element = { style: {}, animate() {
    const animation = { playState: 'running', currentTime: 0, playbackRate: 1, cancelled: false,
      pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; }, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  } };
  const motion = createAdvancedLyricMotion();
  motion.add(element, advancedLyricKeyframes('enter', 'rise'), { startMs: 1000, endMs: 2000 });
  motion.sync({ currentMs: 1600, playing: true });
  assert.equal(animations[0].currentTime, 600);
  motion.sync({ currentMs: 1650, playing: true, playbackRate: 2 });
  assert.equal(animations[0].playbackRate, 2);
  assert.equal(animations[0].currentTime, 650);
  motion.sync({ currentMs: 1700, playing: false });
  assert.equal(animations[0].playState, 'paused');
  assert.equal(animations[0].currentTime, 700);
  motion.sync({ currentMs: 1200, playing: false, discontinuity: true });
  assert.equal(animations[0].currentTime, 200);
  motion.suspend();
  assert.equal(animations[0].cancelled, true);
  motion.sync({ currentMs: 1800, playing: true });
  assert.equal(animations[1].currentTime, 800);
  motion.sync({ currentMs: 2100, playing: true });
  assert.equal(animations[1].cancelled, true);
  assert.equal(element.style.opacity, 1);
  motion.clear();
  motion.sync({ currentMs: 1300, playing: true });
  assert.equal(animations.length, 2);
});
