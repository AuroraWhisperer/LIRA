'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createFixture({ reducedMotion = false } = {}) {
  const animations = [];
  const ghosts = [];
  function row(top, opacity = '0.95') {
    const classes = new Set(['is-active']);
    const element = {
      offsetTop: top, offsetHeight: 60, offsetLeft: 20, offsetWidth: 320,
      style: {}, computed: { translate: 'none', opacity },
      words: [], classes,
      classList: { add(name) { classes.add(name); }, remove(name) { classes.delete(name); } },
      setAttribute(name, value) { this[name] = value; },
      removeAttribute(name) { delete this[name]; },
      querySelectorAll() { return this.words; },
      remove() { this.removed = true; },
      cloneNode() {
        const clone = row(this.offsetTop);
        clone.words = this.words.map(() => ({ style: {} }));
        return clone;
      },
      animate(frames, timing) {
        const animation = { frames, timing, element, cancel() { this.cancelled = true; } };
        animations.push(animation);
        return animation;
      },
    };
    return element;
  }
  const viewport = { scrollTop: 0, clientHeight: 500 };
  const timeline = { appendChild(ghost) { ghosts.push(ghost); } };
  const { createLyricLineTransition } = await loadModuleExports(
    path.join(__dirname, '../../public/js/lyrics/desktop-lyric-line-transition.js'), {
      getComputedStyle: element => element.computed,
      window: { matchMedia: () => ({ matches: reducedMotion }) },
    },
  );
  return { transition: createLyricLineTransition(viewport, timeline), row, viewport, animations, ghosts };
}

function replaceSentence(transition, row) {
  const rows = [row(120), row(200)];
  rows[1].offsetHeight = 0;
  const positions = transition.capture(rows, { first: 1, last: 1 });
  rows[0].offsetHeight = 0;
  rows[1].offsetHeight = 60;
  rows[1].offsetTop = 120;
  transition.play(rows, positions);
}

test('an outgoing sentence snapshot is released when its fade finishes', async () => {
  const { transition, row, animations, ghosts } = await createFixture();
  replaceSentence(transition, row);
  assert.equal(ghosts.length, 1);
  animations.forEach(animation => animation.onfinish());
  assert.equal(ghosts[0].removed, true);
  transition.clear();
  assert.ok(animations.every(animation => !animation.cancelled), 'finished work is released');
});

test('a visible next sentence continues from its displayed position, including interrupted motion and scrolling', async () => {
  const { transition, row, viewport, animations } = await createFixture();
  const rows = [row(120), row(220)];
  let positions = transition.capture(rows, { first: 0, last: 1 });
  viewport.scrollTop = 80;
  transition.play(rows, positions);
  assert.equal(animations[1].frames[0].translate, '0 80px');
  assert.equal(animations[1].frames[0].opacity, undefined, 'an already visible sentence must not fade in again');
  rows[1].computed.translate = '0px 25px';
  positions = transition.capture(rows, { first: 0, last: 1 });
  assert.ok(animations.every(animation => animation.cancelled));
  viewport.scrollTop = 110;
  transition.play(rows, positions);
  assert.equal(animations.at(-1).frames[0].translate, '0 55px', 'retarget from the interrupted visual position');
  transition.clear();
  assert.ok(animations.every(animation => animation.cancelled));
});

test('reduced motion does not translate sentences and clearing removes outgoing snapshots', async () => {
  const { transition, row, animations, ghosts } = await createFixture({ reducedMotion: true });
  replaceSentence(transition, row);
  for (const animation of animations) {
    assert.ok(animation.frames.every(frame => frame.translate === '0 0px' || frame.translate === '0 0'));
  }
  transition.clear();
  assert.ok(animations.every(animation => animation.cancelled));
  assert.ok(ghosts.every(ghost => ghost.removed));
  assert.ok(animations.every(animation => animation.onfinish === null));
});
