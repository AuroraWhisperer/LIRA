'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode } = require('../helpers/fake-dom');

const ROOT_DIR = path.resolve(__dirname, '../..');

async function createLiveRenderer({ advanced = false, layer, reducedMotion = false } = {}) {
  const animations = [];
  const frames = new Map();
  let frameId = 0;
  let visibilityCallback;
  let now = 1000;
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
    element.insertBefore = (child, sibling) => {
      child.detach();
      child.parent = element;
      element.children.splice(element.children.indexOf(sibling), 0, child);
    };
    Object.defineProperty(element, 'nextElementSibling', {
      get: () => element.parent?.children[element.parent.children.indexOf(element) + 1] || null,
    });
    element.classList.toggle = (name, force = !element.classList.contains(name)) => {
      if (force) element.classList.add(name);
      else element.classList.remove(name);
    };
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
  elements.set('desktopLyricSurface', createElement());
  if (advanced) elements.set('advancedLyricPreviewStage', createElement());
  elements.get('desktopLyricPreviewViewport').clientHeight = 0;
  const { desktopLyricRenderer } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/lyrics/desktop-lyric-renderer.js'), {
    performance: { now: () => now },
    IntersectionObserver: class {
      constructor(callback) { visibilityCallback = callback; }
      observe() {}
      disconnect() {}
    },
    Element: { prototype: { animate() {} } },
    window: { addEventListener() {}, matchMedia: () => ({ matches: reducedMotion }) },
    document: { createElement, createDocumentFragment: () => Object.assign(createElement(), { isFragment: true }),
      defaultView: { matchMedia: () => ({ matches: reducedMotion }) },
      getElementById: (id) => elements.get(id), addEventListener() {} },
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id) => frames.delete(id), clearTimeout() {},
  });
  desktopLyricRenderer.init({ layer });
  desktopLyricRenderer.updateLyricTimeline({ status: 'ready', lines: [
    { startMs: 0, text: '第一句' }, { startMs: 5000, text: '第二句' },
  ] });
  const advance = (elapsed) => {
    now += elapsed;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  };
  return { renderer: desktopLyricRenderer, animations, elements, advance, frames,
    setVisible: isIntersecting => visibilityCallback([{ isIntersecting }]), state: {
    currentMs: 1200, durationMs: 10000, playing: true, generation: 1, sequence: 1, status: 'ready',
    lineText: '第一句', words: [{ text: '第一句', startMs: 0, endMs: 5000 }],
  } };
}

test('joining scripts and combining marks remain intact during karaoke', async () => {
  for (const mode of ['continuous', 'discrete']) {
    for (const text of ['أُحِبُّكَ', 'אַהֲבָה', 'तुमसे प्यार', 'ฉันรักเธอ', 'Cafe\u0301', '\u1109\u1161\u1105\u1161\u11BC']) {
      const { renderer, elements, state } = await createLiveRenderer();
      const words = Array.from(text, (character, index) => ({ text: character, startMs: index * 100, endMs: (index + 1) * 100 }));
      renderer.applySettings({ desktopLyricKaraokeMode: mode });
      renderer.updateLyricTimeline({ status: 'ready', lines: [{ startMs: 0, text, words }] });
      renderer.updateLyricState({ ...state, lineText: text, words });
      const line = elements.get('desktopLyricPreviewTimeline').children[0].querySelector('.desktop-lyric-preview-row-text');
      assert.equal(line.textContent, text);
      assert.equal(line.children.length, 0, 'Separate inline blocks must not break text shaping.');
      assert.equal(line.getAttribute('dir'), 'auto');
    }
  }
});

test('identical timeline snapshots retain rows and word animations', async () => {
  const { renderer, elements, animations, state } = await createLiveRenderer();
  const timeline = { status: 'ready', lines: [
    { startMs: 0, text: '第一句', words: state.words }, { startMs: 5000, text: '第二句' },
  ] };
  renderer.updateLyricTimeline(timeline);
  renderer.updateLyricState(state);
  const row = elements.get('desktopLyricPreviewTimeline').children[0];
  const animation = animations.at(-1);
  renderer.updateLyricTimeline(JSON.parse(JSON.stringify(timeline)));
  assert.equal(elements.get('desktopLyricPreviewTimeline').children[0], row);
  assert.equal(animation.cancelled, false);
  renderer.updateLyricTimeline({ ...timeline, lines: [{ ...timeline.lines[0], translation: 'Translation' }] });
  assert.notEqual(elements.get('desktopLyricPreviewTimeline').children[0], row, 'real text changes still render');
  assert.equal(animation.cancelled, true);
});

test('live preview rejects older and unversioned updates after a current song arrives', async () => {
  const { renderer, elements, frames, state } = await createLiveRenderer({ advanced: true });
  renderer.applySettings({ advancedLyricEnabled: 'true' });
  renderer.updateLyricState(state);
  const current = { ...state, trackTitle: '实时歌曲', sequence: 4, currentMs: 6000,
    lineText: '第二句', words: [{ text: '第二句', startMs: 5000, endMs: 10000 }] };
  assert.equal(renderer.updateLyricState(current), true);
  const playback = elements.get('desktopLyricPreviewPlayback');
  assert.equal(playback.textContent, '第二句');
  assert.equal(renderer.updateLyricState({ ...state, sequence: 3 }), false);
  assert.equal(renderer.updateLyricState({ lineText: '无版本旧状态' }), false);
  assert.equal(playback.textContent, '第二句');
  assert.equal(renderer.updateLyricState({ ...current, sequence: 5, playing: false }), true);
  assert.equal(frames.size, 0);
  renderer.dispose();
});

test('settings updates cannot restart spring scrolling on a hidden lyric surface', async () => {
  const { renderer, elements, frames, setVisible } = await createLiveRenderer();
  const viewport = elements.get('desktopLyricPreviewViewport');
  viewport.clientHeight = 500;
  viewport.scrollHeight = 2000;
  viewport.scrollTop = 0;
  renderer.applySettings({ desktopLyricSpringAnimation: 'true' });
  assert.equal(frames.size, 1);
  setVisible(false);
  assert.equal(frames.size, 0);
  renderer.applySettings({ desktopLyricSpringAnimation: 'true', desktopLyricFontSize: '60' });
  assert.equal(frames.size, 0, 'an invisible but laid-out surface must not restart its spring');
  setVisible(true);
  assert.equal(frames.size, 1, 'revealing the surface restores following');
});

test('display switches release inactive rows and stop frame work without changing playback', async () => {
  const { renderer, elements, animations, frames, advance, state } = await createLiveRenderer();
  renderer.updateLyricState(state);
  const highlight = animations.at(-1);
  const viewport = elements.get('desktopLyricPreviewViewport');
  const timeline = elements.get('desktopLyricPreviewTimeline');
  assert.equal(frames.size, 1);
  renderer.applySettings({ desktopLyricEnabled: 'false' });
  assert.equal(viewport.hidden, true);
  assert.equal(timeline.children.length, 0, 'a disabled layer must not retain the full lyric DOM');
  assert.equal(highlight.cancelled, true);
  assert.equal(frames.size, 0, 'both outputs disabled means no animation frame loop');

  advance(4200);
  renderer.setPreviewLayer('basic');
  assert.equal(viewport.hidden, false, 'editing can preview a disabled output');
  assert.equal(timeline.children[1].classList.contains('is-active'), true,
    'the shared clock keeps its position while rendering is stopped');
  assert.equal(frames.size, 1);
  renderer.setPreviewLayer('both');
  assert.equal(viewport.hidden, true, 'combined preview returns to the saved output switches');
  assert.equal(frames.size, 0);
  renderer.applySettings({ desktopLyricEnabled: 'true' });
  assert.equal(viewport.hidden, false);
  assert.equal(timeline.children[1].classList.contains('is-active'), true);
  renderer.dispose();
  assert.equal(frames.size, 0);
});

test('paused output can still be edited and hidden intersection never restarts its clock', async () => {
  const { renderer, elements, frames, setVisible, state } = await createLiveRenderer();
  renderer.applySettings({ desktopLyricHideOnPause: 'true' });
  renderer.updateLyricState({ ...state, playing: false });
  assert.equal(elements.get('desktopLyricPreviewViewport').hidden, true);
  renderer.setPreviewLayer('basic');
  assert.equal(elements.get('desktopLyricPreviewViewport').hidden, false);
  assert.equal(elements.get('desktopLyricSurface').classList.contains('is-paused-hidden'), false);
  renderer.applySettings({ desktopLyricEnabled: 'false' });
  renderer.setPreviewLayer('both');
  renderer.updateLyricState({ ...state, sequence: 2 });
  setVisible(false);
  setVisible(true);
  assert.equal(frames.size, 0, 'intersection visibility must not override a disabled output');
  renderer.dispose();
});

test('basic and advanced lyrics share one frame loop and preserve their independent settings', async () => {
  const { renderer, elements, animations, frames, state } = await createLiveRenderer({ advanced: true });
  renderer.applySettings({ advancedLyricEnabled: 'true', advancedLyricLayout: 'corners' });
  renderer.updateLyricState(state);
  const advanced = elements.get('advancedLyricPreviewStage');
  const stage = elements.get('desktopLyricPreviewStage');
  const artwork = advanced.querySelector('.advanced-lyric-art');
  assert.equal(stage.dataset.lyricLayers, 'both');
  assert.equal(advanced.dataset.layout, 'corners');
  assert.equal(frames.size, 1, 'a second visual layer must not create a second lyric clock loop');
  const firstGroup = artwork.children[0];
  renderer.applySettings({ desktopLyricFontSize: '60' });
  assert.equal(advanced.dataset.layout, 'corners');
  assert.equal(artwork.children[0], firstGroup, 'basic settings do not rebuild the advanced composition');
  renderer.applySettings({ desktopLyricEnabled: 'false' });
  assert.equal(elements.get('desktopLyricPreviewTimeline').children.length, 0);
  assert.equal(advanced.hidden, false);
  assert.equal(frames.size, 1);
  renderer.applySettings({ advancedLyricEnabled: 'false' });
  assert.equal(stage.dataset.lyricLayers, 'none');
  assert.equal(frames.size, 0);
  assert.ok(animations.every(animation => animation.cancelled), 'disabled layers release their active word animations');
  renderer.setPreviewLayer('advanced');
  assert.equal(stage.dataset.lyricLayers, 'advanced');
  assert.equal(frames.size, 1);
  renderer.setPreviewLayer('both');
  assert.equal(stage.dataset.lyricLayers, 'none');
  assert.equal(frames.size, 0);
  renderer.applySettings({ desktopLyricEnabled: 'true' });
  assert.equal(stage.dataset.lyricLayers, 'basic');
  assert.equal(animations.at(-1).cancelled, false, 'restoring the basic layer remounts its current word highlight');
  assert.equal(animations.at(-1).currentTime, state.currentMs);
  renderer.dispose();
});

test('output layer filters and pause hiding stay independent of the other lyric layer', async () => {
  const { renderer, elements, frames, state } = await createLiveRenderer({ advanced: true, layer: 'advanced' });
  renderer.applySettings({ desktopLyricEnabled: 'false', advancedLyricEnabled: 'false', advancedLyricHideOnPause: 'true' });
  renderer.updateLyricState(state);
  const stage = elements.get('desktopLyricPreviewStage');
  assert.equal(stage.dataset.lyricLayers, 'advanced');
  assert.equal(elements.get('desktopLyricPreviewTimeline').children.length, 0);
  renderer.updateLyricState({ ...state, sequence: 2, playing: false });
  assert.equal(stage.dataset.lyricLayers, 'none');
  assert.equal(frames.size, 0);
  renderer.applySettings({ lyricLayer: 'basic' });
  assert.equal(stage.dataset.lyricLayers, 'basic', 'an explicit basic source ignores the legacy output switch');
  renderer.applySettings({ desktopLyricHideOnPause: 'true' });
  assert.equal(stage.dataset.lyricLayers, 'none', 'an explicit source still honors pause hiding');
  renderer.applySettings({ lyricLayer: 'both', desktopLyricEnabled: 'true', advancedLyricEnabled: 'true', desktopLyricHideOnPause: 'false' });
  assert.equal(stage.dataset.lyricLayers, 'basic', 'advanced pause hiding does not hide the basic layer');
  const seeked = { ...state, currentMs: 6000, lineText: '第二句', words: [] };
  renderer.updateLyricState({ ...seeked, sequence: 3, playing: false, discontinuity: true });
  renderer.updateLyricState({ ...seeked, sequence: 4 });
  assert.equal(stage.dataset.lyricLayers, 'both');
  assert.equal(elements.get('advancedLyricPreviewStage').getAttribute('aria-label'), '第二句',
    'resuming after a hidden seek must reveal the current line immediately');
  assert.equal(frames.size, 1);
  renderer.dispose();
});

test('a playing song without lyrics stops frame work until lyric content arrives', async () => {
  const { renderer, elements, frames, state } = await createLiveRenderer({ advanced: true });
  renderer.applySettings({ advancedLyricEnabled: 'true' });
  renderer.updateLyricTimeline({ status: 'empty', lines: [] });
  renderer.updateLyricState({ ...state, status: 'empty', lineText: '', words: [] });
  assert.equal(frames.size, 0);
  assert.equal(elements.get('advancedLyricPreviewStage').hidden, true);
  renderer.applySettings({ advancedLyricGlowEnabled: 'true' });
  assert.equal(elements.get('advancedLyricPreviewStage').hidden, true, 'settings must not reveal stale art after lyrics became empty');
  renderer.updateLyricTimeline({ status: 'ready', lines: [{ startMs: 0, text: '第一句' }] });
  assert.equal(frames.size, 0, 'a timeline arriving before its ready state must not restart stale playback');
  renderer.updateLyricState({ ...state, sequence: 2 });
  assert.equal(frames.size, 1);
  renderer.updateLyricTimeline({ status: 'loading', lines: [] });
  assert.equal(frames.size, 0);
  renderer.dispose();
});

test('preview contrast follows the selected lyric layer and its current text color', async () => {
  const { renderer, elements } = await createLiveRenderer({ advanced: true });
  const card = elements.get('desktopLyricSurface');
  renderer.applySettings({ desktopLyricTextColor: '#000000' });
  assert.equal(card.classList.contains('is-light-text'), false);
  renderer.setPreviewLayer('advanced');
  assert.equal(card.classList.contains('is-light-text'), true, 'the default light advanced text needs a dark preview surface');
  renderer.applySettings({ advancedLyricTextColor: '#111111' });
  assert.equal(card.classList.contains('is-light-text'), false);
  renderer.applySettings({ advancedLyricTextColor: '#ffffff' });
  renderer.setPreviewLayer('basic');
  assert.equal(card.classList.contains('is-light-text'), false, 'returning to basic restores its own text contrast');
  renderer.dispose();
});

test('reduced motion keeps timed line changes while inactive output stops its shared clock loop', async () => {
  const { renderer, elements, frames, advance, state } = await createLiveRenderer({ advanced: true, reducedMotion: true });
  renderer.applySettings({ advancedLyricEnabled: 'true' });
  renderer.updateLyricState(state);
  const advanced = elements.get('advancedLyricPreviewStage');
  assert.equal(advanced.getAttribute('aria-label'), '第一句');
  assert.equal(frames.size, 1, 'the shared clock must still drive line changes when motion is reduced');
  advance(4200);
  assert.equal(advanced.getAttribute('aria-label'), '第二句');
  assert.ok(elements.get('desktopLyricPreviewTimeline').children[1].classList.contains('is-active'));
  renderer.applySettings({ desktopLyricEnabled: 'false', advancedLyricEnabled: 'false' });
  assert.equal(frames.size, 0);
  renderer.dispose();
});

test('lyric row updates stay bounded on sequential playback and follow seeks, settings and new timelines', async () => {
  const { renderer, elements, state } = await createLiveRenderer();
  const lines = Array.from({ length: 100 }, (_, index) => ({ startMs: (index + 1) * 1000, text: `line ${index}` }));
  renderer.applySettings({ desktopLyricVisibleLines: 3, desktopLyricKaraokeMode: 'off' });
  renderer.updateLyricState({ ...state, currentMs: 0, playing: false });
  renderer.updateLyricTimeline({ status: 'ready', lines });
  const rows = elements.get('desktopLyricPreviewTimeline').children.slice(0, lines.length);
  assert.ok(rows.every(row => row.classList.contains('is-line-hidden')), 'the intro has no active visible window');
  let generation = 1;
  const seek = currentMs => renderer.updateLyricState({ ...state, currentMs, durationMs: 101000,
    playing: false, generation: ++generation });
  seek(1000);
  let toggles = 0;
  for (const row of rows) {
    const toggle = row.classList.toggle;
    row.classList.toggle = (...args) => { toggles++; return toggle(...args); };
  }
  seek(2000);
  assert.ok(toggles <= 10, 'advancing one line must not revisit the full lyric list');
  assert.ok(rows[0].classList.contains('is-past'));
  assert.ok(rows[1].classList.contains('is-active'));
  assert.ok(rows[2].classList.contains('is-near'));
  assert.ok(rows[3].classList.contains('is-line-hidden'));
  seek(51000);
  assert.ok(rows[49].classList.contains('is-past') && rows[49].classList.contains('is-near'));
  assert.ok(rows[50].classList.contains('is-active'));
  assert.equal(rows[51].classList.contains('is-line-hidden'), false);
  assert.equal(rows[1].classList.contains('is-active') || rows[1].classList.contains('is-near'), false);
  seek(1000);
  assert.equal(rows[49].classList.contains('is-past') || rows[49].classList.contains('is-near'), false);
  assert.ok(rows[49].classList.contains('is-line-hidden'));
  seek(0);
  assert.ok(rows.every(row => row.classList.contains('is-line-hidden')
    && !['is-past', 'is-near', 'is-active'].some(name => row.classList.contains(name))));
  seek(1000);
  renderer.applySettings({ desktopLyricVisibleLines: 5, desktopLyricKaraokeMode: 'off' });
  assert.equal(rows[2].classList.contains('is-line-hidden'), false);
  assert.ok(rows[3].classList.contains('is-line-hidden'));
  renderer.applySettings({ desktopLyricVisibleLines: 0, desktopLyricKaraokeMode: 'off' });
  assert.ok(rows.every(row => !row.classList.contains('is-line-hidden')));
  renderer.updateLyricTimeline({ status: 'ready', lines: lines.slice(0, 2) });
  const newRows = elements.get('desktopLyricPreviewTimeline').children.slice(0, 2);
  assert.ok(newRows[0].classList.contains('is-active'));
  assert.ok(newRows.every(row => !row.classList.contains('is-line-hidden')));
});

test('desktop karaoke immediately anchors a small explicit seek within the same word', async () => {
  const { renderer, animations, state } = await createLiveRenderer();
  renderer.updateLyricState(state);
  const animation = animations.at(-1);
  assert.equal(animation.currentTime, 1200);
  renderer.updateLyricState({ ...state, currentMs: 1100, generation: 2 });
  assert.equal(animation.currentTime, 1100);
  assert.equal(animation.cancelled, false, 'seeking within a word reuses its animation');
});

test('slow frames reduce decoration without interrupting continuous word fill', async () => {
  const { renderer, animations, advance, state } = await createLiveRenderer();
  renderer.updateLyricState(state);
  const animation = animations.at(-1);
  for (let index = 0; index < 12; index += 1) advance(60);
  assert.equal(animation.cancelled, false, 'continuous fill must survive sustained slow frames');
  assert.equal(animation.playState, 'running');
  renderer.updateLyricState({ ...state, currentMs: 1920, sequence: 2, playing: false });
  assert.equal(animation.playState, 'paused', 'pause must still stop the preserved highlight');
  assert.equal(animation.currentTime, 1920);
});

for (const mode of ['continuous', 'discrete']) {
  test(`${mode} karaoke starts the next line before its sampled state arrives`, async () => {
    const { renderer, elements, animations, advance, state } = await createLiveRenderer();
    const nextWords = [
      { text: '第', startMs: 5000, endMs: 5100 },
      { text: '二', startMs: 5100, endMs: 5200 },
      { text: '句', startMs: 5200, endMs: 5500 },
    ];
    renderer.applySettings({ desktopLyricKaraokeMode: mode });
    renderer.updateLyricTimeline({ status: 'ready', lines: [
      { startMs: 0, text: '第一句', words: state.words },
      { startMs: 5000, text: '第二句', words: nextWords },
    ] });
    renderer.updateLyricState({ ...state, currentMs: 4900 });
    advance(150);
    const row = elements.get('desktopLyricPreviewTimeline').children[1];
    const wordNodes = row.querySelector('.desktop-lyric-preview-row-text').children;
    assert.equal(wordNodes.length, 3, 'the first word must exist 50 ms into the new line, before the next 500 ms sample');
    if (mode === 'continuous') {
      assert.equal(animations.at(-1).currentTime, 50);
      assert.equal(animations.at(-1).playState, 'running');
    } else {
      assert.equal(wordNodes[0].dataset.wordState, 'complete');
      assert.equal(wordNodes[1].dataset.wordState, 'upcoming');
    }
    const firstNode = wordNodes[0];
    renderer.updateLyricState({ ...state, currentMs: 5050, sequence: 2, lineText: '第二句', words: nextWords });
    assert.equal(row.querySelector('.desktop-lyric-preview-row-text').children[0], firstNode,
      'the later current-line sample must not rebuild the preloaded words');
    renderer.updateLyricState({ ...state, currentMs: 5050, sequence: 3, playing: false,
      lineText: '第二句', words: nextWords });
    advance(1000);
    if (mode === 'continuous') {
      assert.equal(animations.at(-1).currentTime, 50);
      assert.equal(animations.at(-1).playState, 'paused');
    } else assert.equal(wordNodes[1].dataset.wordState, 'upcoming');
    renderer.updateLyricState({ ...state, currentMs: 4900, generation: 2, playing: false });
    assert.equal(row.querySelector('.desktop-lyric-preview-row-text').children.length, 0,
      'seeking backwards releases the next line and restores its plain text');
  });
}

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

test('preloaded words wait for the matching track state during a timeline handoff', async () => {
  const { renderer, elements, state } = await createLiveRenderer();
  renderer.updateLyricState({ ...state, trackTitle: 'Previous', currentMs: 5200 });
  renderer.updateLyricTimeline({ trackTitle: 'Next', status: 'ready', lines: [
    { startMs: 0, text: '新歌', words: [{ text: '新歌', startMs: 0, endMs: 6000 }] },
  ] });
  const text = elements.get('desktopLyricPreviewTimeline').children[0].querySelector('.desktop-lyric-preview-row-text');
  assert.equal(text.children.length, 0, 'the previous song clock must not fill the new song');
  renderer.updateLyricState({ ...state, trackTitle: 'Next', currentMs: 50, generation: 2, lineText: '新歌', words: [] });
  assert.equal(text.children.length, 1);
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
    { startMs: 0, endMs: 2000, text: '出品：骁Studio' },
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

test('countdown measures silence after the final sung word, not time spent singing', async () => {
  const { getLyricCountdown } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/lyrics/desktop-lyric-timeline.js'));
  const next = { startMs: 12000, text: '啊' };
  for (const line of [
    { startMs: 0, endMs: 11800, text: '长句仍在唱' },
    { startMs: 0, endMs: 3000, text: '拖长的尾音', words: [{ text: '音', startMs: 3000, endMs: 11800 }] },
    { startMs: 0, endMs: 6500, text: '短暂换气' },
    { startMs: 0, text: '只有开始时间' },
    { startMs: 0, endMs: 0, text: '没有有效的结束时间' },
    { startMs: 0, endMs: 12000, text: '普通歌词按下一句推算结束时间' },
  ]) {
    assert.equal(getLyricCountdown([line, next], 0, 9500), null, line.text);
  }
  const line = { startMs: 0, endMs: 12000, text: '已经唱完',
    words: [{ text: '已经', startMs: 0, endMs: 2500 }, { text: '唱完', startMs: 2500, endMs: 6000 }] };
  assert.deepEqual({ ...getLyricCountdown([line, next], 0, 9000) }, { nextIndex: 1, seconds: 3 });
  assert.equal(getLyricCountdown([line, next], 0, 8999), null);
  assert.equal(getLyricCountdown([line, next], 0, 12000), null);
});

test('countdown preserves the final three seconds of a long intro', async () => {
  const { getLyricCountdown } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/lyrics/desktop-lyric-timeline.js'));
  const lines = [{ startMs: 10000, text: '第一句' }];
  assert.equal(getLyricCountdown(lines, -1, 6000), null);
  assert.deepEqual({ ...getLyricCountdown(lines, -1, 7000) }, { nextIndex: 0, seconds: 3 });
  assert.deepEqual({ ...getLyricCountdown(lines, -1, 9500) }, { nextIndex: 0, seconds: 1 });
  assert.equal(getLyricCountdown([{ startMs: 2000, text: '短前奏' }], -1, 1000), null);
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
