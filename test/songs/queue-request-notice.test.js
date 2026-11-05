'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function noticeFixture(t, { width = 600, reduced = false } = {}) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const metrics = { width, reduced };
  const motions = [];
  const fontListeners = new Set();
  let observerDisconnected = false;
  const view = { getComputedStyle: () => ({ fontSize: '20px' }),
    matchMedia: () => ({ matches: metrics.reduced }),
    ResizeObserver: class { observe() {} disconnect() { observerDisconnected = true; } } };
  const document = { defaultView: view,
    fonts: { addEventListener: (_name, fn) => fontListeners.add(fn), removeEventListener: (_name, fn) => fontListeners.delete(fn) },
    createTextNode: (textContent) => ({ textContent }), createElement: () => node() };
  function node() {
    let value = '';
    return { ownerDocument: document, hidden: true, dataset: {}, className: '', children: [],
      get textContent() { return this.children.length ? this.children.map((child) => child.textContent).join('') : value; },
      set textContent(text) { value = text; this.children = []; },
      get scrollWidth() { return this.textContent.length * 10; },
      get clientWidth() { return metrics.width; },
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      animate(frames, options) {
        const motion = { node: this, frames, options, cancelled: false, finished: Promise.resolve(),
          cancel() { this.cancelled = true; } };
        motions.push(motion);
        return motion;
      } };
  }
  const element = node();
  const { createQueueRequestNotice } = await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/queue-request-notice.js'), {
    Date, setTimeout, clearTimeout,
  });
  const controller = createQueueRequestNotice(element);
  t.after(() => controller.dispose());
  return { element, controller, motions, metrics, settle: nextTurn,
    released: () => observerDisconnected && fontListeners.size === 0 };
}

const result = (id, overrides = {}) => ({ id, accepted: true, requesterName: id, songName: '歌曲', expiresAt: 60000, ...overrides });

test('each new result gets a full turn without initial replay, replacement or duplicate playback', async (t) => {
  const f = await noticeFixture(t);
  const initial = result('初始结果');
  const first = result('<img src=x>');
  const second = result('第二位观众', { accepted: false, expiresAt: 1010 });
  f.controller.update({ requestResults: [initial] });
  assert.equal(f.element.hidden, true);
  f.controller.update({ requestResults: [initial, first, second] });
  await f.settle();
  assert.ok(f.element.textContent.includes(first.requesterName), 'viewer text stays literal');
  assert.ok(!f.element.textContent.includes(second.requesterName), 'later requests wait their turn');
  const successOutcome = f.element.children[1].textContent;
  f.controller.update({ requestResults: [initial, first, second] });
  t.mock.timers.tick(3599);
  await f.settle();
  assert.ok(f.element.textContent.includes(first.requesterName));
  t.mock.timers.tick(1);
  await f.settle();
  assert.ok(f.element.textContent.includes(second.requesterName), 'an already delivered result remains playable after its delivery deadline');
  assert.notEqual(f.element.children[1].textContent, successOutcome, 'the fixed outcome reflects the current result');
  t.mock.timers.tick(3600);
  await f.settle();
  assert.equal(f.element.hidden, true);
  f.controller.update({ requestResults: [initial, first] });
  await f.settle();
  assert.equal(f.element.hidden, true, 'snapshots cannot replay consumed results');
});

test('overflow finishes reading before the next result and a narrower layout replaces the old reading timer', async (t) => {
  const f = await noticeFixture(t, { width: 120 });
  f.controller.update({});
  f.controller.update({ requestResults: [result('长歌名观众', { songName: '需要完整读完的长歌名'.repeat(8) }), result('下一位')] });
  await f.settle();
  const scroll = f.motions.find((motion) => motion.node !== f.element);
  assert.ok(scroll, 'overflow has its own text movement');
  assert.ok(scroll.options.duration > 3600, 'long content receives more than the short notice minimum');
  assert.equal(scroll.options.duration % 100, 0, 'calculated reading time rounds to tenths of a second');
  f.controller.relayout();
  assert.equal(f.motions.filter((motion) => motion.node !== f.element).length, 1, 'unchanged layout does not restart reading');
  f.metrics.width = 50;
  f.controller.relayout();
  const slower = f.motions.filter((motion) => motion.node !== f.element).at(-1);
  assert.equal(scroll.cancelled, true);
  assert.ok(slower.options.duration > scroll.options.duration, 'very narrow text windows move more slowly');
  const distance = slower.node.scrollWidth - f.metrics.width;
  assert.equal(slower.frames.at(-1).transform, `translateX(-${distance}px)`, 'the complete text tail reaches the viewport');
  t.mock.timers.tick(scroll.options.duration);
  await f.settle();
  assert.ok(f.element.textContent.includes('长歌名观众'), 'the old layout cannot end the new reading period');
  t.mock.timers.tick(slower.options.duration - scroll.options.duration);
  await f.settle();
  assert.ok(f.element.textContent.includes('下一位'));
  f.controller.dispose();
  t.mock.timers.runAll();
  await f.settle();
  assert.equal(f.element.hidden, true);
  assert.equal(slower.cancelled, true);
  assert.equal(f.released(), true, 'resize and font listeners are released');
});

test('reduced motion removes vertical movement while keeping long text readable and disposal cancels pending notices', async (t) => {
  const f = await noticeFixture(t, { width: 100, reduced: true });
  f.controller.update({});
  const text = '需要完整显示的歌曲'.repeat(10);
  f.controller.update({ requestResult: result('兼容旧快照', { songName: text }) });
  await f.settle();
  assert.ok(f.element.textContent.includes(text));
  assert.ok(f.motions.some((motion) => motion.node !== f.element), 'necessary overflow still reveals the complete message');
  assert.ok(f.motions.find((motion) => motion.node === f.element).frames.every((frame) => frame.transform === 'none'),
    'reduced motion removes spatial entrance effects');
  f.controller.update({ requestResult: result('等待中的结果') });
  f.controller.dispose();
  t.mock.timers.runAll();
  await f.settle();
  assert.equal(f.element.hidden, true);
  assert.ok(!f.element.textContent.includes('等待中的结果'));
});
