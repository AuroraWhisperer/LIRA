'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

const DEFAULT_WORDS = [
  { text: '月', startMs: 1000, endMs: 2000 },
  { text: '光', startMs: 2400, endMs: 2500 },
];

async function createAnimator(mode = 'discrete', { words = DEFAULT_WORDS, motionEnabled = true } = {}) {
  const created = [];
  const { LyricWordAnimator } = await loadModuleExports(
    path.join(__dirname, '../../public/js/shared/lyric-word-animator.js'),
    { document: { createElement: () => ({
      style: {}, dataset: {}, classList: { toggle() {} }, append() {}, setAttribute() {},
      animate(keyframes, timing) {
        let currentTime = null;
        const animation = { keyframes, timing, timeWrites: 0, playCount: 0, pauseCount: 0,
          get currentTime() { return currentTime; },
          set currentTime(value) { this.timeWrites += 1; currentTime = value; },
          playState: 'running', cancelled: false, cancelCount: 0,
          play() { this.playCount += 1; this.playState = 'running'; },
          pause() { this.pauseCount += 1; this.playState = 'paused'; },
          cancel() { this.cancelled = true; this.cancelCount += 1; this.playState = 'idle'; } };
        created.push(animation);
        return animation;
      },
    }) } },
  );
  const animator = new LyricWordAnimator({ mode, motionEnabled });
  animator.mount({ appendChild() {}, replaceChildren() {} }, words, { mode });
  return { animator, created };
}

test('word highlights and motion follow playback speed without recreating their animations', async t => {
  const { animator, created } = await createAnimator('waapi');
  t.after(() => animator.dispose());
  animator.sync({ currentMs: 1200 }, { playing: true, playbackRate: 2 });
  assert.equal(animator.animations[0].playbackRate, 2);
  assert.equal(animator.elements[0].motion.playbackRate, 2);
  const count = created.length;
  animator.sync({ currentMs: 1300 }, { playing: true, playbackRate: 0.5 });
  assert.equal(animator.animations[0].playbackRate, 0.5);
  assert.equal(animator.elements[0].motion.playbackRate, 0.5);
  assert.equal(created.length, count);
});

test('continuous highlights restore partial fill on backward seeks and release completed effects', async t => {
  const { animator, created } = await createAnimator('waapi', { motionEnabled: false });
  t.after(() => animator.dispose());
  animator.sync({ currentMs: 2100 }, { playing: true });
  assert.equal(created.length, 0, 'words outside their sung interval need no animation objects');
  animator.sync({ currentMs: 1100 }, { playing: true, force: true });
  assert.equal(animator.animations[0].currentTime, 100, 'backward seeks restore partial fill');
  animator.sync({ currentMs: 1133 }, { playing: true });
  assert.equal(animator.animations[0].playCount, 1, 'a running highlight is not restarted each frame');
  animator.sync({ currentMs: 2100 }, { playing: true });
  assert.equal(created[0].cancelled, true, 'completed effects are released');
  assert.equal(animator.animations[0], null);
  assert.equal(animator.elements[0].highlight.style.clipPath, 'inset(0 0% 0 0)', 'released effects keep their fill');
  animator.sync({ currentMs: 1200 }, { playing: false });
  assert.equal(created.length, 2, 'backward seeks recreate only the current word');
  assert.equal(animator.animations[0].currentTime, 200);
  assert.equal(animator.animations[0].playState, 'paused');
});

test('overlapping words retain independent fills and release only completed effects', async t => {
  const { animator, created } = await createAnimator('waapi', { motionEnabled: false, words: [
    { text: '和', startMs: 0, endMs: 1000 }, { text: '声', startMs: 500, endMs: 1500 },
  ] });
  t.after(() => animator.dispose());
  animator.sync({ currentMs: 750 }, { playing: true });
  assert.equal(animator.animations[0].currentTime, 750);
  assert.equal(animator.animations[1].currentTime, 250);
  animator.sync({ currentMs: 1100 }, { playing: true });
  assert.equal(created[0].cancelled, true);
  assert.equal(created[1].cancelled, false);
  assert.equal(created[1].playState, 'running');
});

test('word motion follows sung tokens and seeks without animating upcoming words', async t => {
  const { animator, created } = await createAnimator();
  t.after(() => animator.dispose());
  animator.sync({ currentMs: 900 }, { playing: true });
  assert.equal(created.length, 0);
  animator.sync({ currentMs: 1150 }, { playing: true });
  assert.equal(created.length, 1);
  animator.sync({ currentMs: 2200 }, { playing: true });
  assert.equal(created[0].cancelled, true);
  assert.equal(animator.elements[0].motion, null);
  animator.sync({ currentMs: 2450 }, { playing: true });
  assert.equal(created.length, 2);
  animator.sync({ currentMs: 1100 }, { playing: false });
  assert.equal(created[1].cancelled, true);
  assert.equal(animator.elements[1].motion, null);
  animator.clear();
  assert.ok(created.every(animation => animation.cancelled));
});

test('clearing and remounting an animator preserves text restored to its previous line', async t => {
  const { animator } = await createAnimator();
  t.after(() => animator.dispose());
  const previousLine = animator.container;
  previousLine.replaceChildren = () => { previousLine.textContent = ''; };
  animator.clear({ commit: true });
  assert.equal(previousLine.textContent, '月光');
  animator.clear({ commit: false });
  assert.equal(previousLine.textContent, '月光', 'repeated cleanup preserves committed text');

  animator.mount(previousLine, DEFAULT_WORDS);
  animator.clear({ commit: false });
  previousLine.textContent = '上一句';
  animator.mount({ appendChild() {}, replaceChildren() {} }, [{ text: '下一句', startMs: 3000, endMs: 4000 }]);
  assert.equal(previousLine.textContent, '上一句', 'mounting the next line preserves restored timeline text');
});

test('pause freezes the word and resume reuses the same animation', async t => {
  const { animator, created } = await createAnimator();
  t.after(() => animator.dispose());
  animator.sync({ currentMs: 1300 }, { playing: true });
  animator.sync({ currentMs: 1400 }, { playing: false });
  assert.equal(created[0].playState, 'paused');
  animator.sync({ currentMs: 1400 }, { playing: false });
  assert.equal(created.length, 1);
  animator.sync({ currentMs: 1400 }, { playing: true });
  assert.equal(created[0].playState, 'running');
  assert.equal(created.length, 1);
});

test('reduced effects cancel motion while preserving discrete karaoke and can recover', async t => {
  const { animator, created } = await createAnimator();
  t.after(() => animator.dispose());
  animator.sync({ currentMs: 1200 }, { playing: true });
  animator.setMotionEnabled(false);
  assert.equal(created[0].cancelled, true);
  animator.sync({ currentMs: 2450 }, { playing: true });
  assert.equal(created.length, 1);
  assert.equal(animator.elements[1].wrapper.dataset.wordState, 'complete');
  animator.setMotionEnabled(true);
  animator.sync({ currentMs: 2450 }, { playing: true });
  assert.equal(created.length, 2);
  animator.setMode('manual');
  assert.equal(created[1].cancelled, true);
  animator.sync({ currentMs: 2450 }, { playing: true });
  assert.equal(created.length, 2);
  assert.equal(animator.elements[1].highlight.style.clipPath, 'inset(0 50% 0 0)');
});

test('discrete karaoke toggles timed words without continuous fill and follows seeks', async t => {
  const { animator } = await createAnimator('discrete', {
    motionEnabled: false,
    words: [
      { text: '你', startMs: 100, endMs: 300 },
      { text: '好', startMs: 300, endMs: 500 },
    ],
  });
  t.after(() => animator.dispose());
  const states = () => Array.from(animator.elements, (element) => element.wrapper.dataset.wordState);
  assert.deepEqual(states(), ['upcoming', 'upcoming']);
  animator.sync({ currentMs: 120 }, { playing: true });
  assert.deepEqual(states(), ['complete', 'upcoming']);
  animator.sync({ currentMs: 350 }, { playing: true });
  assert.equal(states()[1], 'complete');
  animator.sync({ currentMs: 150 }, { playing: false });
  assert.deepEqual(states(), ['complete', 'upcoming']);
});

test('mode changes release WAAPI effects once and resume from current playback progress', async () => {
  const { animator, created } = await createAnimator('waapi', {
    motionEnabled: false,
    words: [{ text: '歌', startMs: 0, endMs: 1000 }],
  });
  try {
    animator.sync({ currentMs: 250 }, { playing: true });
    assert.equal(created[0].currentTime, 250);
    animator.setMode('waapi');
    assert.equal(created[0].cancelCount, 0, 'reapplying the same mode keeps the running effect');
    animator.setMode('manual');
    assert.equal(created[0].cancelCount, 1);
    assert.equal(animator.animations.length, 0);
    animator.sync({ currentMs: 250 }, { playing: true });
    assert.equal(animator.elements[0].highlight.style.clipPath, 'inset(0 75% 0 0)');
    animator.setMode('static');
    animator.sync({ currentMs: 250 });
    assert.equal(animator.elements[0].highlight.style.clipPath, 'inset(0 100% 0 0)');
    animator.sync({ currentMs: 1000 });
    assert.equal(animator.elements[0].highlight.style.clipPath, 'inset(0 0% 0 0)');
    animator.setMode('waapi');
    animator.sync({ currentMs: 600 }, { playing: true });
    assert.equal(created.length, 2);
    assert.equal(created[1].currentTime, 600);
  } finally {
    animator.dispose();
  }
  assert.equal(created[1].cancelCount, 1, 'dispose releases the active effect');
});
