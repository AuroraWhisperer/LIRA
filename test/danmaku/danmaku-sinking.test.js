const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFakeDocument, findAllByClass } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function fixture({ width = 1920, height = 1080, density = 50 } = {}) {
  let time = 10000, sequence = 0;
  const frames = new Map(), listeners = new Map(), observed = new Set();
  const preference = { matches: false,
    addEventListener(_name, callback) { this.callback = callback; },
    removeEventListener() { this.callback = null; } };
  const document = createFakeDocument();
  const createElement = document.createElement;
  document.createElement = tag => {
    const node = createElement(tag);
    node.ownerDocument = document;
    node.offsetWidth = 480;
    node.offsetHeight = 240;
    return node;
  };
  document.defaultView = {
    matchMedia: () => preference,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    requestAnimationFrame(callback) { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const root = document.createElement('div');
  root.clientWidth = width; root.clientHeight = height;
  let onResize;
  class ResizeObserver {
    constructor(callback) { onResize = callback; }
    observe(node) { observed.add(node); }
    unobserve(node) { observed.delete(node); }
    disconnect() { observed.clear(); }
  }
  const module = await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/danmaku-sinking-feed.js'), { document, ResizeObserver });
  const feed = module.createSinkingDanmakuFeed(root, { style: 'sinking', now: () => time,
    sinkingOptions: { sinkingBubbleDensity: density } });
  return { feed, root, frames, listeners, observed, preference,
    cards: () => findAllByClass(root, 'sinking-item'),
    bubbles: () => findAllByClass(root, 'sinking-bubble'),
    resize(width, height) { root.clientWidth = width; root.clientHeight = height; onResize(); },
    append: id => feed.append({ id, name: '合成观众', message: '像把晚安留在海里', timestamp: time }),
    advance(ms) {
      const end = time + ms;
      do {
        time = Math.min(end, time + 50);
        const scheduled = [...frames.values()]; frames.clear();
        scheduled.forEach(callback => callback(time));
      } while (time < end);
    },
  };
}

test('density 100 triples the old particle pool while edits preserve the card and its deadline', async () => {
  const f = await fixture();
  f.append('reading');
  f.advance(4000);
  const node = f.cards()[0], transform = node.style.transform;
  assert.equal(f.bubbles().length, 28, 'the approved middle setting stays moderate');
  f.feed.setSinkingOptions({ sinkingBubbleDensity: 100, sinkingDurationSeconds: 30, sinkingTravel: 40, sinkingSway: 36 });
  assert.equal(f.cards()[0], node);
  assert.equal(node.style.transform, transform, 'changing density does not restart or move the current card');
  assert.equal(f.bubbles().length, 130 * 3, '100 is three times the approved 130-slot pool');
  f.advance(1000);
  assert.ok(f.bubbles().filter(node => Number(node.style.opacity) > 0.01).length > 75);
  f.advance(5000);
  assert.equal(f.cards().length, 0, 'the original ten-second deadline remains in force');
  assert.equal(f.bubbles().length, 0);
  assert.equal(f.frames.size, 0);
  f.feed.destroy();
});

test('snapshot playback resumes at its original age and expired messages do not reappear', async () => {
  const f = await fixture();
  f.feed.render([{ id: 'old', message: '过期', timestamp: -3000 }, { id: 'current', message: '正在阅读', timestamp: 5000 }]);
  assert.equal(f.cards().length, 1);
  assert.equal(f.cards()[0].dataset.progress, '0.500');
  assert.equal(f.cards()[0].style.opacity, '1.0000');
  f.advance(5000);
  assert.equal(f.cards().length, 0);
  f.feed.destroy();
});

test('existing bubbles follow a resized card without restarting its lifetime', async () => {
  const f = await fixture();
  f.append('resize');
  f.advance(4000);
  const node = f.cards()[0];
  const bubbles = f.bubbles();
  f.resize(640, 400);
  f.advance(50);
  const visible = bubbles.filter(bubble => Number(bubble.style.opacity) > 0.01);
  assert.ok(visible.length > 0);
  assert.ok(visible.every(bubble => {
    const x = Number(bubble.style.transform.match(/translate\(([^,]+)px,/)[1]);
    return x >= -10 && x <= 650;
  }), 'particles keep their drift beside the resized card instead of their old birth position');
  assert.equal(f.cards()[0], node);
  assert.equal(f.bubbles()[0], bubbles[0], 'resizing preserves the particle cycle');
  f.advance(5950);
  assert.equal(f.cards().length, 0, 'resizing preserves the original expiry');
  f.feed.destroy();
});

test('crowded arrivals wait within a bound and receive a full reading lifetime after placement', async () => {
  const f = await fixture({ width: 640, height: 400 });
  f.append('first'); f.append('waiting'); f.append('overflow');
  f.advance(500);
  assert.equal(f.cards().filter(node => node.style.visibility === 'visible').length, 1);
  f.feed.remove(['first']);
  f.advance(200);
  assert.equal(f.cards().filter(node => node.style.visibility === 'visible').length, 1);
  f.advance(1600);
  assert.equal(f.cards().length, 1, 'unplaced messages stop waiting after two seconds');
  f.advance(7700);
  assert.equal(f.cards().length, 1, 'queued time is not deducted from the admitted message');
  f.advance(700);
  assert.equal(f.cards().length, 0);
  f.feed.destroy();
});

test('reduced motion and destruction release particles, observers and scheduled frames', async () => {
  const f = await fixture({ density: 100 });
  f.append('a'); f.append('b');
  f.advance(3000);
  assert.ok(f.bubbles().length >= 390);
  f.preference.matches = true; f.preference.callback();
  assert.equal(f.bubbles().length, 0);
  const node = f.cards()[0], transform = node.style.transform;
  f.advance(500);
  assert.equal(node.style.transform, transform);
  f.feed.remove(['a']);
  assert.ok(!f.cards().includes(node));
  f.feed.destroy();
  assert.equal(f.root.children.length, 0);
  assert.equal(f.frames.size, 0);
  assert.equal(f.observed.size, 0);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.preference.callback, null);
});
