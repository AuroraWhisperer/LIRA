'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { normalizeLyricState } = require('../src/music/lyric-state');
const { normalizeLyricTimeline } = require('../src/music/lyric-timeline');

const ROOT_DIR = path.resolve(__dirname, '..');

test('lyric state normalization limits browser-source payloads', () => {
  const state = normalizeLyricState({
    trackTitle: ` Song\u0000${'x'.repeat(200)} `,
    artists: [
      'Artist',
      '',
      ...Array.from({ length: 10 }, (_, index) => `Guest ${index}`),
    ],
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

test('obsolete Electron lyric window path is removed', () => {
  const mainSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'electron', 'main.js'),
    'utf8',
  );
  const ipcSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'electron', 'ipc', 'music-ipc.js'),
    'utf8',
  );
  const preloadSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'electron', 'preload.js'),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'js',
      'playback',
      'services',
      'lyric-service.js',
    ),
    'utf8',
  );

  assert.equal(
    fs.existsSync(path.join(ROOT_DIR, 'src', 'electron', 'lyric-window.js')),
    false,
  );
  assert.doesNotMatch(
    mainSource,
    /lyricWin|openLyricWindow|closeLyricWindow|updateLyricWindow|setLyricWindowLocked/,
  );
  assert.doesNotMatch(
    ipcSource,
    /music:(?:open|close|update|set)-lyric-window|LyricWindow/,
  );
  assert.doesNotMatch(
    preloadSource,
    /openLyricWindow|closeLyricWindow|updateLyricWindow|setLyricWindowLocked|onLyricState/,
  );
  assert.doesNotMatch(
    serviceSource,
    /windowOpen|windowLocked|musicAPI\.(?:open|close|update|set)LyricWindow/,
  );
  assert.match(serviceSource, /fetch\(["']\/api\/playback\/lyric-state["']/);
  assert.match(serviceSource, /fetch\(["']\/api\/playback\/lyric-timeline["']/);
});

test('lyric timeline normalization bounds complete browser lyric payloads', () => {
  const timeline = normalizeLyricTimeline({
    trackTitle: ` Song\u0000${'x'.repeat(200)} `,
    artists: [
      'Artist',
      '',
      ...Array.from({ length: 10 }, (_, index) => `Guest ${index}`),
    ],
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
  assert.ok(
    timeline.lines.every(
      (line, index) =>
        index === 0 || timeline.lines[index - 1].startMs <= line.startMs,
    ),
  );
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
      text:
        index === 0
          ? '井迪儿 - 失控'
          : index === 63
            ? '多嘲讽'
            : `第 ${index + 1} 行`,
    })),
  });

  assert.equal(timeline.lines.length, 64);
  assert.equal(timeline.lines[0].text, '井迪儿 - 失控');
  assert.equal(timeline.lines.at(-1).text, '多嘲讽');
  assert.equal(timeline.lines.at(-1).startMs, 247519);
});
