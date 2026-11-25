'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { FakeNode, createFakeDocument } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('animated gradient retains snapshots and new messages without timed expiration', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const timers = new Map();
  let nextTimer = 0;
  let clock = 20000;
  const feed = module.createDanmakuFeed(root, { style: 'animated-gradient', autoScroll: false, now: () => clock,
    scheduleTimeout(callback, delay) { timers.set(++nextTimer, { callback, at: clock + delay }); return nextTimer; },
    cancelTimeout(id) { timers.delete(id); } });
  feed.render([{ id: 'old', timestamp: 1000, name: '观众', message: '历史消息' }]);
  assert.equal(root.children.length, 1, 'old snapshots remain visible regardless of event age');
  const old = root.children[0];
  feed.append({ id: 'new', timestamp: clock, name: '新观众', message: '新消息' });
  const latest = root.children[1];
  clock += 60000;
  for (const [id, timer] of [...timers]) {
    if (timer.at > clock) continue;
    timers.delete(id);
    timer.callback();
  }
  assert.deepEqual(root.children, [old, latest], 'idle time does not remove fixed messages');
  assert.equal(timers.size, 0);
  feed.destroy();
});

test('random feeds release retracted SC timers and expire retained messages at their own deadlines', async () => {
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), { document: createFakeDocument() });
  for (const [style, scDelay] of [['mist', 6000], ['glass-bubble', 9000]]) {
    const root = new FakeNode('div');
    const timers = new Map();
    let nextTimer = 0;
    const feed = module.createDanmakuFeed(root, {
      style, layout: 'fullscreen-random', itemLifetimeMs: 6000, now: () => 1000, autoScroll: false,
      scheduleTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback() { timers.delete(id); callback(); }, delay });
        return id;
      },
      cancelTimeout(id) { timers.delete(id); },
    });
    const sc = { id: 'sc', kind: 'superchat', price: 30, message: '留言', timestamp: 1000 };
    feed.render([{ id: 'chat', name: '观众', message: '弹幕', timestamp: 1000 }, sc]);
    const [chat, retracted] = root.children;
    assert.equal(root.children.length, 2, style);
    feed.append({ ...sc, id: 'second' });
    assert.equal(root.children.length, 3, style);
    const kept = root.children[2];
    feed.remove(['sc']);
    assert.deepEqual(root.children, [chat, kept], style);
    assert.equal(retracted.parent, null);
    assert.deepEqual([...timers.values()].map(timer => timer.delay), [6000, scDelay], style);
    for (const timer of [...timers.values()]) if (timer.delay <= 6000) timer.callback();
    assert.deepEqual(root.children, scDelay > 6000 ? [kept] : [], style);
    for (const timer of [...timers.values()]) timer.callback();
    assert.equal(root.children.length, 0, style);
    feed.destroy();
    assert.equal(timers.size, 0);
  }
});

test('unsupported SC cannot displace chat in a full snapshot or on append', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), { document: createFakeDocument() });
  const feed = module.createDanmakuFeed(root, { style: 'outline', layout: 'fullscreen-random', maxItems: 1, expireItems: false });
  const sc = { id: 'sc', kind: 'superchat', message: '留言', price: 30 };
  feed.render([{ id: 'chat', message: '保留' }, sc]);
  const [chat] = root.children;
  feed.append(sc);
  assert.deepEqual(root.children, [chat]);
  feed.remove(['chat']);
  assert.equal(root.children.length, 0);
  feed.destroy();
});

test('stardust gift and membership anchors place cards at opposite centered edges and can swap', async () => {
  const root = Object.assign(new FakeNode('div'), { clientWidth: 1000, clientHeight: 800 });
  const document = createFakeDocument();
  document.body = { dataset: {} };
  document.createElement = tag => Object.assign(new FakeNode(tag), {
    offsetWidth: tag === 'article' ? 120 : 0,
    offsetHeight: tag === 'article' ? 42 : 0,
  });
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), { document });
  const feed = module.createDanmakuFeed(root, {
    style: 'stardust', layout: 'fullscreen-random', expireItems: false, autoScroll: false,
  });
  for (const swapped of [false, true]) {
    document.body.dataset.stardustSwapAnchors = swapped ? 'on' : 'off';
    feed.render([
      { id: 'gift', kind: 'gift', name: '赠送者', giftName: '花', giftCount: 1, giftTotalPrice: 10 },
      { id: 'member', kind: 'gift', name: '守护者', giftGuardLevel: 3, giftCount: 1 },
    ]);
    assert.equal(root.children.length, 2);
    const [gift, member] = root.children;
    for (const card of root.children) {
      assert.ok(Math.abs(Number.parseFloat(card.style.left) + card.offsetWidth / 2 - root.clientWidth / 2) < 1,
        'highlighted events remain horizontally centered');
    }
    assert.equal(Number.parseFloat(gift.style.top) < root.clientHeight / 2, !swapped);
    assert.equal(Number.parseFloat(member.style.top) < root.clientHeight / 2, swapped);
  }
  feed.destroy();
});

test('harbor gift minimum filters snapshots and increments by total and never filters SC', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { style: 'harbor', minGiftAmount: 10, autoScroll: false });
  const small = { id: 'small', kind: 'gift', giftName: '花', giftCount: 100, giftTotalPrice: 9.99 };
  const boundary = { ...small, id: 'boundary', giftCount: 1, giftTotalPrice: 10 };
  feed.render([small, boundary, { id: 'sc', kind: 'superchat', price: 2, message: '保留' }]);
  assert.equal(root.children.length, 2);
  feed.append(small);
  feed.append({ ...small, giftTotalPrice: undefined });
  assert.equal(root.children.length, 2);
  feed.append({ ...boundary, id: 'guard', giftGuardLevel: 3, giftTotalPrice: 168 });
  assert.equal(root.children.length, 3);
  feed.destroy();
  const unfiltered = module.createDanmakuFeed(root, { style: 'harbor', minGiftAmount: 0, autoScroll: false });
  unfiltered.render([small, { ...small, giftTotalPrice: undefined }]);
  assert.equal(root.children.length, 2);
  unfiltered.destroy();
});

test('fixed feed removes selected SC nodes without rebuilding retained messages', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { autoScroll: false });
  feed.render([
    { id: 'chat', message: '聊天' },
    { id: 'sc', kind: 'superchat', message: '撤下', price: 30 },
    { id: 'kept-sc', kind: 'superchat', message: '保留', price: 50 },
  ]);
  const [chat, deleted, kept] = root.children;
  feed.remove(['sc', 'unknown']);
  assert.deepEqual(root.children, [chat, kept]);
  assert.equal(deleted.parent, null);
  feed.remove(['sc']);
  assert.deepEqual(root.children, [chat, kept]);
  feed.append({ id: 'next', message: '后续消息' });
  assert.equal(root.children[0], chat);
  assert.equal(root.children[1], kept);
  feed.destroy();
});

test('appending at capacity evicts only the oldest message node', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, { maxItems: 2, autoScroll: false });
  feed.render([{ message: '第一条' }]);
  const first = root.children[0];
  feed.append({ message: '第二条' });
  const second = root.children[1];
  assert.deepEqual(root.children, [first, second]);
  feed.append({ message: '第三条' });
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0], second);
  assert.equal(first.parent, null);
  feed.destroy();
});

test('fixed danmaku feed retains partially visible messages and prunes only fully clipped nodes', async () => {
  const root = new FakeNode('div');
  root.clientHeight = 130;
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
    getComputedStyle: (node) => ({ zoom: String(node.zoom || 1) }),
  });
  const feed = module.createDanmakuFeed(root, {
    maxItems: 50,
    offscreenViewports: 0,
    autoScroll: false,
  });

  feed.render([
    { name: '第一位', message: '第一条' },
    { name: '第二位', message: '第二条' },
  ]);
  const firstBubble = root.children[0];
  feed.append({ name: '第三位', message: '第三条' });

  assert.equal(root.children.length, 3, 'the first bubble still has four visible pixels');
  assert.equal(root.children[0], firstBubble);

  root.children[0].offsetHeight = 100;
  root.children[1].offsetHeight = 80;
  feed.append({ name: '第四位', message: '图片加载后高度变大' });
  assert.equal(root.children.length, 3, 'only the fully clipped first bubble is removed after image growth');
  assert.equal(root.children[0].children[1].children[0].children[0].textContent, '第二位');

  root.clientHeight = 150;
  root.children[2].offsetHeight = 80;
  root.children[2].zoom = 1.5;
  feed.append({ name: '第五位', message: '放大卡片占用实际高度' });
  assert.equal(root.children.length, 2, 'the scaled fourth card remains partially visible');
  assert.equal(root.children[0].children[1].children[0].children[0].textContent, '第四位');
  const scaledBubble = root.children[0];
  feed.append({ name: '第六位', message: '仍然保留剩余部分' });
  assert.equal(root.children[0], scaledBubble);
  feed.append({ name: '第七位', message: '完全越界后移除' });
  assert.equal(root.children.length, 3);
  assert.notEqual(root.children[0], scaledBubble);
  feed.destroy();

  const defaultRoot = new FakeNode('div');
  defaultRoot.clientHeight = 100;
  Object.defineProperty(defaultRoot, 'scrollHeight', { get: () => defaultRoot.children.reduce(
    (height, node) => height + (Number.parseFloat(node.style['--danmaku-height']) || 0),
    22 + Math.max(0, defaultRoot.children.length - 1) * 11,
  ) });
  const defaultFeed = module.createDanmakuFeed(defaultRoot);
  defaultFeed.render(Array.from({ length: 30 }, (_, index) => ({ message: `消息 ${index}` })));
  assert.ok(defaultRoot.children.length <= 10, 'the default feed bounds a burst to its visible window');
  assert.equal(defaultRoot.scrollTop, defaultRoot.scrollHeight);
  defaultFeed.destroy();
});
