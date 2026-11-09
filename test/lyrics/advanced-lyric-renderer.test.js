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

test('phrase partitions preserve dictionary words, punctuation and the entire current sentence', async () => {
  const { createAdvancedLyricText, partitionAdvancedLyricText } = await load('layouts');
  const split = (text, count) => {
    const units = createAdvancedLyricText({ text, startMs: 0, endMs: 6000 });
    return Array.from(partitionAdvancedLyricText(units, count), ({ start, end }) => units.slice(start, end).map(unit => unit.text).join(''));
  };
  assert.deepEqual(split('把此刻唱成一首歌', 3), ['把此刻', '唱成', '一首歌']);
  assert.deepEqual(split('一首歌', 4), ['一首歌']);
  for (const text of ['晚风穿过窗边，带来你的消息', 'We keep moving through the night']) {
    const parts = split(text, 3);
    assert.equal(parts.join(''), text);
    const ends = new Set([...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].map(entry => entry.index + entry.segment.length));
    let offset = 0;
    for (const part of parts) {
      offset += part.length;
      assert.ok(ends.has(offset), 'a phrase cannot break a word');
      assert.ok(!/^[\s，。！？,.!?]/u.test(part), 'punctuation stays with the preceding phrase');
    }
  }
});

test('advanced lyric retires after a sung line before a long interlude and uses the supplied next-line boundary', async () => {
  const { advancedLyricLineWindow } = await load('renderer');
  const line = { text: '唱完这一句', startMs: 1000, endMs: 10000, words: [{ text: '唱完这一句', startMs: 1000, endMs: 4000 }] };
  assert.equal(advancedLyricLineWindow(line, { startMs: 10000 }).endMs, 4800);
  assert.equal(advancedLyricLineWindow({ text: '普通歌词', startMs: 1000 }, { startMs: 5000 }).endMs, 5000);
});

test('adaptive phrases keep natural pauses and merge fast text into readable groups', async () => {
  const { createAdvancedLyricText, buildAdvancedLyricLayout } = await load('layouts');
  const text = '晚风穿过窗边，带来你的消息，照亮了漫长的黑夜，也照亮远方';
  const compose = (value, duration) => {
    const units = createAdvancedLyricText({ text: value, startMs: 0, endMs: duration });
    return Array.from(buildAdvancedLyricLayout('phrase-flow', units), item => ({ ...item,
      text: units.slice(item.start, item.end).map(unit => unit.text).join('') }));
  };
  const slow = compose(text, 12000), fast = compose(text, 1400);
  assert.ok(fast.length < slow.length, 'rapid lines must not spend their time changing composition');
  assert.equal(slow.map(item => item.text).join(''), text);
  assert.ok(slow.slice(0, -1).every(item => item.text.endsWith('，')), 'available punctuation wins over equal-width chopping');
  assert.equal(compose('好', 3000).length, 1, 'a short answer stays intact');
});

test('adaptive emphasis follows supplied sustained timing and incomplete timing uses phrase entrances', async () => {
  const { createAdvancedLyricText, buildAdvancedLyricLayout } = await load('layouts');
  const words = [
    { text: '把此刻', startMs: 0, endMs: 900 },
    { text: '唱成', startMs: 1100, endMs: 4100 },
    { text: '一首歌', startMs: 4300, endMs: 5200 },
  ];
  const line = { text: '把此刻唱成一首歌', startMs: 0, endMs: 6000, words };
  const units = createAdvancedLyricText(line);
  const plan = buildAdvancedLyricLayout('phrase-flow', units);
  const focus = plan.find(item => item.emphasis);
  assert.equal(units.slice(focus.start, focus.end).map(unit => unit.text).join(''), '唱成');
  assert.ok(plan.every(item => !item.phraseReveal));
  const partial = buildAdvancedLyricLayout('phrase-flow', createAdvancedLyricText({ ...line, words: words.slice(1) }));
  assert.ok(partial.every(item => item.phraseReveal && !item.emphasis), 'missing words cannot imply accurate syllable timing or stress');
  assert.equal(partial[0].startMs, 0);
});

test('sustained words retain focus through the supplied vocal interval and release within the line', async () => {
  const { advancedLyricWordAnimation } = await load('motion');
  const timing = { startMs: 1000, endMs: 4000, lineEndMs: 4500, timed: true };
  for (const name of ['sustain', 'rise']) {
    const track = advancedLyricWordAnimation(name, timing);
    const rest = track.frames[0].transform;
    const held = track.frames.at(-2);
    assert.notEqual(held.transform, rest);
    assert.equal(track.startMs + held.offset * (track.endMs - track.startMs), timing.endMs);
    assert.ok(track.endMs > timing.endMs && track.endMs <= timing.lineEndMs);
    assert.equal(track.frames.at(-1).transform, rest);
  }
  const clipped = advancedLyricWordAnimation('sustain', { ...timing, lineEndMs: 2500 });
  assert.equal(clipped.endMs, 2500);
  assert.equal(clipped.frames.at(-2).offset, 1, 'a clipped line must not release before its sung boundary');
  assert.ok(clipped.frames.every((frame, index, frames) => Number.isFinite(frame.offset)
    && frame.offset >= 0 && frame.offset <= 1 && (!index || frame.offset >= frames[index - 1].offset)));
  assert.equal(advancedLyricWordAnimation('sustain', { ...timing, timed: false }), null,
    'estimated timing must not imply a sustained note');
  assert.equal(advancedLyricWordAnimation('sustain', { ...timing, amount: 0 }), null);
  const short = advancedLyricWordAnimation('sustain', { ...timing, endMs: 1001, lineEndMs: 1001 });
  assert.ok(short.frames.every(frame => Number.isFinite(frame.offset) && frame.offset >= 0 && frame.offset <= 1));
});

test('motion follows pause and backward seek, cancels hidden work, and resumes from host time', async () => {
  const { createAdvancedLyricMotion, advancedLyricWordAnimation } = await load('motion');
  const animations = [];
  const element = { style: {}, animate() {
    const animation = { playState: 'running', currentTime: 0, playbackRate: 1, cancelled: false,
      pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; }, cancel() { this.cancelled = true; } };
    animations.push(animation);
    return animation;
  } };
  const motion = createAdvancedLyricMotion();
  const track = advancedLyricWordAnimation('sustain', { startMs: 1000, endMs: 4000, lineEndMs: 4500, timed: true });
  motion.add(element, track.frames, track);
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
  motion.sync({ currentMs: 3500, playing: true });
  assert.equal(animations[0].currentTime, 2500);
  assert.equal(animations.length, 1, 'the same track stays alive throughout the long note');
  motion.suspend();
  assert.equal(animations[0].cancelled, true);
  motion.sync({ currentMs: 3800, playing: true });
  assert.equal(animations[1].currentTime, 2800);
  motion.sync({ currentMs: 4300, playing: true });
  assert.equal(animations[1].cancelled, true);
  assert.equal(element.style.transform, track.frames[0].transform);
  motion.clear();
  motion.sync({ currentMs: 1300, playing: true });
  assert.equal(animations.length, 2);
});
