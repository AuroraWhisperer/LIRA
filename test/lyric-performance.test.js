'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('./helpers/frontend-modules');

test('sustained long frames degrade WAAPI to manual and then static without repeated changes', async () => {
  const { createLyricPerformanceProfile } = await loadModuleExports(path.join(__dirname, '../public/js/shared/lyric-performance.js'), {
    window: { matchMedia: () => ({ matches: false }) },
  });
  const changes = [];
  const profile = createLyricPerformanceProfile({ onChange: (value) => changes.push(value.wordAnimation) });
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.equal(profile.profile.wordAnimation, 'manual');
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.equal(profile.profile.wordAnimation, 'static');
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.deepEqual(changes, ['manual', 'static']);
});

test('mode changes release WAAPI effects and use current playback progress', async () => {
  const created = [];
  const { LyricWordAnimator } = await loadModuleExports(path.join(__dirname, '../public/js/shared/lyric-word-animator.js'), {
    document: { createElement: () => ({
      style: {}, dataset: {}, classList: { toggle() {} }, append() {}, setAttribute() {},
      animate() {
        const animation = { currentTime: null, cancelled: 0, play() {}, pause() {}, cancel() { this.cancelled += 1; } };
        created.push(animation);
        return animation;
      },
    }) },
  });
  const animator = new LyricWordAnimator({ mode: 'waapi' });
  animator.mount({ appendChild() {}, replaceChildren() {} }, [{ text: '歌', startMs: 0, endMs: 1000 }]);
  try {
    animator.sync({ currentMs: 250 }, { playing: true });
    assert.equal(created[0].currentTime, 250);
    animator.setMode('waapi');
    assert.equal(created[0].cancelled, 0);
    animator.setMode('manual');
    assert.equal(created[0].cancelled, 1);
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
  } finally { animator.dispose(); }
  assert.equal(created[1].cancelled, 1);
});
