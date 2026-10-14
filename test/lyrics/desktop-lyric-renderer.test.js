'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode } = require('../helpers/fake-dom');

const ROOT_DIR = path.resolve(__dirname, '../..');

async function createLiveRenderer() {
  const animations = [];
  const createElement = () => {
    const element = new FakeNode();
    let textContent = '';
    const replaceChildren = element.replaceChildren.bind(element);
    element.replaceChildren = (...children) => {
      textContent = '';
      replaceChildren(...children);
    };
    Object.defineProperty(element, 'textContent', {
      get: () => textContent + element.children.map(child => child.textContent).join(''),
      set(value) { element.replaceChildren(); textContent = String(value); },
    });
    element.appendChild = (child) => element.append(child);
    element.classList = { add() {}, remove() {}, toggle() {} };
    element.animate = (frames) => {
      const animation = { currentTime: null, playState: 'paused', cancelled: false,
        play() { this.playState = 'running'; }, pause() { this.playState = 'paused'; },
        cancel() { this.cancelled = true; } };
      if (frames[0].clipPath) animations.push(animation);
      return animation;
    };
    return element;
  };
  const elements = new Map(['Stage', 'Playback', 'Timeline', 'Viewport'].map((name) => [
    `desktopLyricPreview${name}`, createElement(),
  ]));
  elements.get('desktopLyricPreviewViewport').clientHeight = 0;
  const { desktopLyricRenderer } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/lyrics/desktop-lyric-renderer.js'), {
    performance: { now: () => 1000 },
    Element: { prototype: { animate() {} } },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    document: { createElement, createDocumentFragment: () => Object.assign(createElement(), { isFragment: true }),
      getElementById: (id) => elements.get(id), addEventListener() {} },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, clearTimeout() {},
  });
  desktopLyricRenderer.init();
  desktopLyricRenderer.updateLyricTimeline({ status: 'ready', lines: [
    { startMs: 0, text: '第一句' }, { startMs: 5000, text: '第二句' },
  ] });
  return { renderer: desktopLyricRenderer, animations, elements, state: {
    currentMs: 1200, durationMs: 10000, playing: true, generation: 1, sequence: 1, status: 'ready',
    lineText: '第一句', words: [{ text: '第一句', startMs: 0, endMs: 5000 }],
  } };
}

test('desktop karaoke immediately anchors a small explicit seek within the same word', async () => {
  const { renderer, animations, state } = await createLiveRenderer();
  renderer.updateLyricState(state);
  const animation = animations.at(-1);
  assert.equal(animation.currentTime, 1200);
  renderer.updateLyricState({ ...state, currentMs: 1100, generation: 2 });
  assert.equal(animation.currentTime, 1100);
  assert.equal(animation.cancelled, false, 'seeking within a word reuses its animation');
});

test('desktop karaoke retains the visible line when a sample is already on the next line', async () => {
  const { renderer, animations, state } = await createLiveRenderer();
  renderer.updateLyricState({ ...state, currentMs: 4900 });
  const animation = animations.at(-1);
  renderer.updateLyricState({ ...state, currentMs: 5050, sequence: 2,
    lineText: '第二句', words: [{ text: '第二句', startMs: 5000, endMs: 10000 }],
  });
  assert.equal(animation.cancelled, false, 'a tolerated timing difference must not erase the current highlight');
  renderer.updateLyricState({ ...state, currentMs: 5050, generation: 2,
    lineText: '第二句', words: [{ text: '第二句', startMs: 5000, endMs: 10000 }],
  });
  assert.equal(animation.cancelled, true, 'a real line change still releases the previous animation');
  assert.equal(animations.at(-1).currentTime, 50);
});

test('continuous karaoke line changes preserve every past lyric as plain text', async () => {
  const { renderer, elements, state } = await createLiveRenderer();
  const lines = Array.from({ length: 8 }, (_, index) => ({ startMs: index * 5000, text: `第 ${index + 1} 句` }));
  renderer.updateLyricTimeline({ status: 'ready', lines });
  for (const [index, line] of lines.entries()) {
    renderer.updateLyricState({ ...state, sequence: index + 1, currentMs: line.startMs + 1000, durationMs: lines.length * 5000,
      lineText: line.text, words: [{ text: line.text, startMs: line.startMs, endMs: line.startMs + 5000 }],
    });
    const rows = elements.get('desktopLyricPreviewTimeline').children;
    for (let previous = 0; previous < index; previous += 1) {
      const text = rows[previous].querySelector('.desktop-lyric-preview-row-text');
      assert.equal(text.textContent, lines[previous].text);
      assert.equal(text.children.length, 0, 'past rows retain text without duplicate word layers');
    }
  }
});

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
