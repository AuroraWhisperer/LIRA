const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FakeNode } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { findFloatingDanmakuTop } = require('../../public/js/overlays/danmaku-floating-position.js');
const { floatingSpeedToPixelsPerSecond: toSpeed, floatingSpeedFromPixelsPerSecond: toLevel,
  editStyleOption, resetStyleOptions, floatingSpeedLabel } = require('../../public/js/shared/danmaku-appearance-draft.js');

test('floating speed has exact endpoints and midpoint, with legacy values retained until edited', () => {
  assert.deepEqual([1, 50, 100].map(toSpeed), [40, 120, 360]);
  let previous = 0;
  for (let level = 1; level <= 100; level += 1) {
    assert.ok(toSpeed(level) > previous);
    assert.equal(toLevel(toSpeed(level)), level);
    previous = toSpeed(level);
  }
  for (const speed of [20, 240, 600]) {
    const draft = { style: 'floating', styleOptions: { floating: { speedPixelsPerSecond: speed } } };
    assert.equal(editStyleOption(draft, 'floatingDispersion', 100).styleOptions.floating.speedPixelsPerSecond, speed);
    assert.equal(editStyleOption(draft, 'floatingSpeed', 50).styleOptions.floating.speedPixelsPerSecond, 120);
    assert.deepEqual(resetStyleOptions(draft).styleOptions.floating, {});
  }
  assert.match(floatingSpeedLabel(600), /5×（旧值）/);
});

test('maximum dispersion reaches opposite edges and the widest remaining gap across the whole height', () => {
  const item = { left: 1000, width: 300, height: 80 };
  const box = { left: 900, width: 300, height: 80, top: 0 };
  const place = occupied => findFloatingDanmakuTop(item, 1080, occupied, 100, () => 0.37);
  assert.ok(Math.abs(place([box]) - 1000) < 0.001);
  assert.ok(place([{ ...box, top: 1000 }]) < 0.001);
  assert.ok(Math.abs(place([box, { ...box, top: 1000 }]) - 500) < 0.001);
  assert.equal(findFloatingDanmakuTop(item, 1080, [], 100, () => 0.37), 370);
});

test('dispersion increases separation, includes rectangle sizes and uses current horizontal separation', () => {
  const item = { left: 1000, width: 300, height: 100 };
  const occupied = [{ left: 800, width: 400, top: 0, height: 200 }];
  const positions = [1, 50, 100].map(value => findFloatingDanmakuTop(item, 800, occupied, value, () => 0.4));
  assert.ok(positions[0] >= 208);
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
  assert.equal(findFloatingDanmakuTop(item, 800, [{ ...occupied[0], left: 0 }], 1, () => 0), 0);
  assert.equal(findFloatingDanmakuTop(item, 100, [{ ...occupied[0], height: 100 }]), undefined);
  const unequal = [{ left: 620, width: 250, top: 0, height: 180 }, { left: 960, width: 200, top: 560, height: 240 }];
  const distance = top => Math.min(...unequal.map(box => Math.hypot(
    Math.max(0, item.left - box.left - box.width, box.left - item.left - item.width),
    Math.max(0, top - box.top - box.height, box.top - top - item.height))));
  const selected = findFloatingDanmakuTop(item, 800, unequal, 100, () => 0.2);
  const sampledBest = Math.max(...Array.from({ length: 701 }, (_, top) => distance(top)));
  assert.ok(distance(selected) >= sampledBest - 0.001, 'continuous search beats an exhaustive pixel grid');
});

async function fixture(height = 500) {
  let time = 10000;
  let sequence = 0;
  const timers = new Map(), animations = [];
  const measurements = { width: 0, height: 0 };
  const document = { defaultView: {
    getComputedStyle: () => ({ getPropertyValue: () => '0' }),
    addEventListener() {}, removeEventListener() {},
  }, createElement(tag) {
    const node = new FakeNode(tag);
    node.ownerDocument = document;
    Object.defineProperties(node, {
      offsetWidth: { get() { measurements.width += 1; return 200; } },
      offsetHeight: { get() { measurements.height += 1; return 100; } },
    });
    node.animate = (frames, timing) => {
      const animation = { frames, timing, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation);
      node.animation = animation;
      return animation;
    };
    return node;
  } };
  const root = document.createElement('div');
  root.clientWidth = 1000; root.clientHeight = height;
  const math = Object.create(Math); math.random = () => 0.1;
  const module = await loadModuleExports(path.resolve(__dirname, '../../public/js/overlays/danmaku-floating.js'), { document, Math: math });
  const feed = module.createFloatingDanmakuFeed(root, {
    now: () => time, floatingDispersion: 100,
    scheduleTimeout(callback, delay) { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    cancelTimeout(id) { timers.delete(id); },
  });
  return { feed, root, animations, timers, measurements, append() { feed.append({ id: String(++sequence), name: '测试观众', message: '测试弹幕', timestamp: time }); },
    advance(duration) {
      const end = time + duration;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        time = next[1].at; timers.delete(next[0]); next[1].callback();
      }
      time = end;
    } };
}

test('live updates keep positions and animations continuous; disposal cancels all work', async () => {
  const f = await fixture();
  f.append(); f.append();
  assert.ok(parseFloat(f.root.children[1].style.top) > 399.99);
  const node = f.root.children[0], top = node.style.top, animation = node.animation;
  f.feed.setFloatingDispersion(1);
  assert.equal(node.style.top, top);
  assert.equal(node.animation, animation);
  f.advance(1000);
  f.feed.setSpeedPixelsPerSecond(360);
  assert.match(node.animation.frames[0].transform, /translateX\(880px\)/);
  assert.ok(Math.abs(node.animation.timing.duration - 3000) < 0.001);
  assert.equal(node.style.top, top);
  f.advance(1000); f.append();
  assert.ok(parseFloat(f.root.children[2].style.top) < 100);
  f.feed.destroy();
  assert.equal(f.timers.size, 0);
  assert.equal(f.root.children.length, 0);
  assert.ok(f.animations.every(animation => animation.cancelled));
});

test('batched arrivals measure the bounded feed once and retain existing animations', async () => {
  const f = await fixture(10000);
  for (let index = 0; index < 50; index += 1) f.append();
  const retained = f.root.children.slice(10);
  const animations = retained.map(node => node.animation);
  f.measurements.width = 0;
  f.measurements.height = 0;
  f.feed.appendBatch(Array.from({ length: 10 }, (_, index) => ({
    id: `batch-${index}`, name: '合成观众', message: `同批消息 ${index}`, timestamp: 10000,
  })));
  assert.equal(f.root.children.length, 50);
  assert.deepEqual(f.root.children.slice(0, 40), retained);
  assert.deepEqual(retained.map(node => node.animation), animations);
  assert.deepEqual(f.measurements, { width: 50, height: 50 });
  assert.ok(f.root.children.every(node => node.style.visibility === 'visible'));
  f.feed.destroy();
  assert.equal(f.timers.size, 0);
});

test('full-height cards wait for space, expire their bounded wait and clear pending timers', async () => {
  const f = await fixture(100);
  f.feed.appendBatch([1, 2].map(id => ({ id: String(id), name: '合成观众', message: '同批等待', timestamp: 10000 })));
  assert.equal(f.root.children[1].style.visibility, 'hidden');
  f.advance(1800);
  assert.equal(f.root.children[1].style.visibility, 'visible');
  f.feed.destroy();
  const slow = await fixture(100);
  slow.feed.setSpeedPixelsPerSecond(40);
  slow.append(); slow.append();
  slow.advance(2100);
  assert.equal(slow.root.children.length, 1);
  slow.append();
  slow.feed.render([]);
  assert.equal(slow.timers.size, 0);
  slow.feed.destroy();
});
