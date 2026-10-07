'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('desktop lyric timeline identifies active lines and countdowns for long gaps', async () => {
  const preview = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'));
  const lines = [
    { startMs: 0, text: '出品：骁Studio' },
    { startMs: 9000, text: '请原谅我的词穷' },
    { startMs: 12000, text: '再见都哽在喉咙' },
  ];

  assert.equal(preview.findActiveLyricIndex(lines, 500), 0);
  assert.equal(preview.findActiveLyricIndex(lines, 9500), 1);
  assert.deepEqual({ ...preview.getLyricCountdown(lines, 0, 6200) }, { nextIndex: 1, seconds: 3 });
  assert.deepEqual({ ...preview.getLyricCountdown(lines, 0, 7200) }, { nextIndex: 1, seconds: 2 });
  assert.equal(preview.getLyricCountdown(lines, 0, 4000), null);
  assert.equal(preview.getLyricCountdown(lines, 1, 9500), null);
});

test('desktop lyric timeline spring converges smoothly on the active-line anchor', async () => {
  const preview = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'));
  let frame = { position: 0, velocity: 0 };

  frame = preview.stepSpringScroll(frame.position, frame.velocity, 500, 16);
  assert.ok(frame.position > 0 && frame.position < 500);

  for (let index = 0; index < 180; index += 1) {
    frame = preview.stepSpringScroll(frame.position, frame.velocity, 500, 16);
  }

  assert.equal(frame.position, 500);
  assert.equal(frame.velocity, 0);
});

test('desktop lyric renderer normalizes timing, empty text, and anchor settings', async () => {
  const preview = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'));
  const settings = preview.resolveDesktopLyricSettings({
    desktopLyricTimeOffsetMs: '350',
    desktopLyricShowTitleWhenNoLyric: 'true',
    desktopLyricNoLyricText: '没有歌词',
    desktopLyricHideOnPause: 'true',
    desktopLyricAlignPosition: '0.25',
    desktopLyricAlignAnchor: 'end',
  });

  assert.equal(settings.timeOffsetMs, 350);
  assert.equal(settings.showTitleWhenNoLyric, true);
  assert.equal(settings.hideOnPause, true);
  assert.equal(settings.alignPosition, 0.25);
  assert.equal(settings.alignAnchor, 'end');
  assert.equal(preview.resolveLyricTime(1000, settings), 1350);
  assert.equal(preview.resolveNoLyricText({ trackTitle: '测试歌曲' }, settings), '测试歌曲');
  assert.equal(preview.calculateFollowTarget(600, 100, 400, 1200, settings.alignPosition, settings.alignAnchor), 600);

  const fallbackSettings = preview.resolveDesktopLyricSettings({
    desktopLyricShowTitleWhenNoLyric: 'false',
    desktopLyricNoLyricText: '纯音乐',
  });
  assert.equal(preview.resolveNoLyricText({ trackTitle: '测试歌曲' }, fallbackSettings), '纯音乐');
});

test('desktop lyric renderer resolves explicit and legacy karaoke modes', async () => {
  const preview = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'));

  assert.equal(preview.resolveDesktopLyricSettings({ desktopLyricKaraokeMode: 'discrete' }).karaokeMode, 'discrete');
  assert.equal(preview.resolveDesktopLyricSettings({ desktopLyricKaraokeMode: 'off' }).karaokeEnabled, false);
  assert.equal(preview.resolveDesktopLyricSettings({ desktopLyricKaraokeEnabled: 'false' }).karaokeMode, 'off');
  assert.equal(preview.resolveDesktopLyricSettings({ desktopLyricKaraokeEnabled: 'true' }).karaokeMode, 'continuous');
});

test('desktop lyric visible-line window keeps full timeline semantics', async () => {
  const preview = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'lyrics', 'desktop-lyric-renderer.js'));

  const range = (activeLine, visibleLines, lineCount) =>
    JSON.parse(JSON.stringify(preview.getVisibleLyricRange(activeLine, visibleLines, lineCount)));
  assert.deepEqual(range(4, 0, 9), { first: 0, last: 8 });
  assert.deepEqual(range(4, 1, 9), { first: 4, last: 4 });
  assert.deepEqual(range(4, 2, 9), { first: 4, last: 5 });
  assert.deepEqual(range(4, 3, 9), { first: 3, last: 5 });
  assert.deepEqual(range(4, 4, 9), { first: 3, last: 6 });
  assert.deepEqual(range(0, 5, 3), { first: 0, last: 2 });
  assert.deepEqual(range(8, 5, 9), { first: 6, last: 8 });

  const settings = preview.resolveDesktopLyricSettings({
    desktopLyricVisibleLines: '-2',
  });
  assert.equal(settings.visibleLines, 0);
});
