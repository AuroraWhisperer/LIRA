'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeLyricState } = require('../../src/music/lyric-state');
const { normalizeLyricTimeline } = require('../../src/music/lyric-timeline');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('lyric lines share bounds while word spacing remains significant', () => {
  const input = { text: ' \u0000word\t ', startMs: '12.5', endMs: Infinity };
  const state = normalizeLyricState({ lineText: input.text, words: [input] });
  const timeline = normalizeLyricTimeline({ lines: [input] });
  assert.equal(state.lineText, 'word');
  assert.equal(timeline.lines[0].text, 'word');
  assert.equal(state.words[0].text, '  word  ');
  for (const item of [state.words[0], timeline.lines[0]]) {
    assert.equal(item.startMs, 12.5);
    assert.equal(item.endMs, 12.5);
  }
});

test('lyric playback rate defaults to one and accepts only finite positive bounded speeds', () => {
  for (const rate of [undefined, null, 0, -1, NaN, Infinity, '2']) {
    assert.equal(normalizeLyricState({ playbackRate: rate }).playbackRate, 1);
  }
  for (const [input, expected] of [[0.2, 0.5], [0.5, 0.5], [1.5, 1.5], [2, 2], [5, 2]]) {
    assert.equal(normalizeLyricState({ playbackRate: input }).playbackRate, expected);
  }
});

test('lyric state normalization limits browser-source payloads', () => {
  const state = normalizeLyricState({
    trackTitle: ` Song\u0000${'x'.repeat(200)} `,
    artists: ['Artist', '', ...Array.from({ length: 10 }, (_, index) => `Guest ${index}`)],
    lineText: '<b>lyric</b>',
    words: [
      { text: 'first ', startMs: -20, endMs: 100 },
      { text: 'second', startMs: 500, endMs: 200 },
    ],
    currentMs: -1,
    durationMs: 240000,
    progress: 4,
    playing: true,
    status: 'ready',
  });

  assert.equal(state.trackTitle.length, 120);
  assert.equal(state.trackTitle.includes('\u0000'), false);
  assert.equal(state.artists.length, 8);
  assert.equal(state.lineText, '<b>lyric</b>');
  assert.deepEqual(state.words[0], { text: 'first ', startMs: 0, endMs: 100 });
  assert.deepEqual(state.words[1], {
    text: 'second',
    startMs: 500,
    endMs: 500,
  });
  assert.equal(state.currentMs, 0);
  assert.equal(state.durationMs, 240000);
  assert.equal(state.progress, 1);
  assert.equal(state.playing, true);
});

test('lyric text keeps complete Unicode characters within its existing UTF-16 budgets', () => {
  for (const spare of [0, 1, 2]) {
    const input = (limit) => `${'a'.repeat(limit - spare)}😀后续`;
    const expected = (limit) => `${'a'.repeat(limit - spare)}${spare === 2 ? '😀' : ''}`;
    const state = normalizeLyricState({
      trackTitle: input(120),
      artists: [input(80)],
      lineText: input(240),
      translation: input(240),
      words: [{ text: input(40), startMs: 0, endMs: 100 }],
    });
    assert.equal(state.trackTitle, expected(120));
    assert.equal(state.artists[0], expected(80));
    assert.equal(state.lineText, expected(240));
    assert.equal(state.translation, expected(240));
    assert.equal(state.words[0].text, expected(40));
    const timeline = normalizeLyricTimeline({
      lines: [{ text: input(240), translation: input(240), roma: input(240) }],
    });
    assert.equal(timeline.lines[0].text, expected(240));
    assert.equal(timeline.lines[0].translation, expected(240));
    assert.equal(timeline.lines[0].roma, expected(240));
  }
});

test('lyric states carry monotonic generation and sequence discontinuity markers', () => {
  const first = normalizeLyricState({
    lineText: 'first',
    generation: 3,
    sequence: 7,
  });
  const legacy = normalizeLyricState({ lineText: 'legacy' });
  assert.equal(first.generation, 3);
  assert.equal(first.sequence, 7);
  assert.equal(legacy.generation, 0);
  assert.equal(legacy.sequence, 0);
});

test('obsolete Electron lyric window path is removed', () => {
  const mainSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  const ipcSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'ipc', 'music-ipc.js'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'preload.js'), 'utf8');
  const serviceSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'services', 'lyric-service.js'),
    'utf8',
  );

  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'src', 'electron', 'lyric-window.js')), false);
  assert.doesNotMatch(mainSource, /lyricWin|openLyricWindow|closeLyricWindow|updateLyricWindow|setLyricWindowLocked/);
  assert.doesNotMatch(ipcSource, /music:(?:open|close|update|set)-lyric-window|LyricWindow/);
  assert.doesNotMatch(
    preloadSource,
    /openLyricWindow|closeLyricWindow|updateLyricWindow|setLyricWindowLocked|onLyricState/,
  );
  assert.doesNotMatch(serviceSource, /windowOpen|windowLocked|musicAPI\.(?:open|close|update|set)LyricWindow/);
});

test('lyric timeline normalization bounds complete browser lyric payloads', () => {
  const timeline = normalizeLyricTimeline({
    trackTitle: ` Song\u0000${'x'.repeat(200)} `,
    artists: ['Artist', '', ...Array.from({ length: 10 }, (_, index) => `Guest ${index}`)],
    status: 'ready',
    lines: Array.from({ length: 600 }, (_, index) => ({
      startMs: 600000 - index * 1000,
      endMs: index % 2 === 0 ? -20 : 700000,
      text: `第 ${index} 行\u0000${'词'.repeat(160)}`,
      translation: '<b>translation</b>',
      roma: 'romanization',
    })),
  });

  assert.equal(timeline.trackTitle.length, 120);
  assert.equal(timeline.trackTitle.includes('\u0000'), false);
  assert.equal(timeline.artists.length, 8);
  assert.equal(timeline.status, 'ready');
  assert.ok(timeline.lines.length > 0);
  assert.ok(timeline.lines.length <= 500);
  assert.ok(timeline.lines.every((line, index) => index === 0 || timeline.lines[index - 1].startMs <= line.startMs));
  assert.ok(timeline.lines.every((line) => !line.text.includes('\u0000')));
  assert.ok(Buffer.byteLength(JSON.stringify(timeline), 'utf8') < 220 * 1024);
});

test('lyric timeline normalization preserves all 64 renderable lines from 失控', () => {
  const timeline = normalizeLyricTimeline({
    trackTitle: '失控',
    artists: ['井迪'],
    status: 'ready',
    lines: Array.from({ length: 64 }, (_, index) => ({
      startMs: index === 63 ? 247519 : index * 3900,
      endMs: index === 63 ? 248500 : index * 3900 + 3000,
      text: index === 0 ? '井迪儿 - 失控' : index === 63 ? '多嘲讽' : `第 ${index + 1} 行`,
    })),
  });

  assert.equal(timeline.lines.length, 64);
  assert.equal(timeline.lines[0].text, '井迪儿 - 失控');
  assert.equal(timeline.lines.at(-1).text, '多嘲讽');
  assert.equal(timeline.lines.at(-1).startMs, 247519);
});

test('whole-song timing preserves the same bounded words as current-line state', () => {
  const words = [
    { text: 'first ', startMs: -20, endMs: 100, extra: 'discard' },
    { text: 'second\u0000', startMs: 500, endMs: 200 },
    { text: '', startMs: 0, endMs: 100 },
    ...Array.from({ length: 130 }, () => ({ text: 'x'.repeat(50), startMs: 600, endMs: Infinity })),
  ];
  const timeline = normalizeLyricTimeline({ lines: [{ text: 'line', words }, { text: 'legacy' }] });
  assert.deepEqual(timeline.lines[0].words, normalizeLyricState({ words }).words);
  assert.equal(timeline.lines[0].words[0].text, 'first ');
  assert.equal(Object.hasOwn(timeline.lines[1], 'words'), false, 'legacy line shape stays valid');
});

test('word timing budget preserves the complete text timeline and bounds socket payload size', () => {
  const timeline = normalizeLyricTimeline({ lines: Array.from({ length: 500 }, (_, index) => ({
    startMs: index * 1000, text: `line ${index}`,
    words: Array.from({ length: 120 }, () => ({ text: '词'.repeat(40), startMs: index * 1000, endMs: index * 1000 + 1000 })),
  })) });
  assert.equal(timeline.lines.length, 500, 'optional timing cannot truncate the lyric text');
  assert.ok(timeline.lines[0].words?.length > 0);
  assert.equal(Object.hasOwn(timeline.lines.at(-1), 'words'), false, 'over-budget lines retain current-state fallback');
  assert.ok(Buffer.byteLength(JSON.stringify(timeline), 'utf8') < 1024 * 1024);
});
