'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { FakeNode, createFakeDocument } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('mist random SC supports snapshots, increments, removal and timed expiry while old random styles omit SC', async () => {
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public/js/overlays/danmaku-feed.js'), { document: createFakeDocument() });
  for (const style of ['mist', 'outline']) {
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
    const chat = root.children[0];
    assert.equal(root.children.length, style === 'mist' ? 2 : 1);
    feed.append({ ...sc, id: 'second' });
    assert.equal(root.children.length, style === 'mist' ? 3 : 1);
    feed.remove(['sc']);
    assert.equal(root.children.length, style === 'mist' ? 2 : 1);
    assert.equal(root.children[0], chat);
    assert.ok([...timers.values()].every(timer => timer.delay === 6000));
    for (const { callback } of [...timers.values()]) callback();
    assert.equal(root.children.length, 0);
    feed.destroy();
    assert.equal(timers.size, 0);
  }
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

test('shared danmaku renderer proxies emotes, keeps viewer text literal and shows settled gift totals', async () => {
  const root = new FakeNode('div');
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'), {
    document: createFakeDocument(),
  });
  const feed = module.createDanmakuFeed(root, {
    maxItems: 2,
    autoScroll: false,
    resolveEmoteUrl: (url) => `/proxy?url=${encodeURIComponent(url)}`,
  });

  feed.render([
    {
      name: '观众',
      message: '你好[妙][打call]',
      emotes: [
        {
          text: '[妙]',
          url: 'https://i0.hdslb.com/bfs/emote/miao.png',
          width: 64,
          height: 64,
        },
        {
          text: '[打call]',
          url: 'https://i0.hdslb.com/bfs/emote/call.gif',
          width: 180,
          height: 90,
        },
      ],
    },
  ]);

  const message = root.children[0].children[1].children[1];
  assert.equal(message.children[0].textContent, '你好');
  assert.equal(message.children[1].tagName, 'IMG');
  assert.equal(message.children[1].alt, '[妙]');
  assert.match(message.children[1].src, /^\/proxy\?url=/);
  assert.equal(message.children[2].tagName, 'IMG');
  assert.equal(message.children[2].alt, '[打call]');

  const firstBubble = root.children[0];
  feed.append({ name: '第二位', message: '第二条' });
  assert.equal(root.children.length, 2);
  assert.equal(root.children[0], firstBubble, 'incremental append must preserve existing message nodes');
  feed.append({ name: '第三位', message: '第三条' });
  assert.equal(root.children.length, 2);
  assert.notEqual(root.children[0], firstBubble, 'incremental append must trim only the oldest node');

  feed.render([
    {
      message: '[打call]',
      emotes: [{ text: '[打call]', url: 'https://i0.hdslb.com/bfs/emote/call.gif' }],
    },
  ]);
  const emoteMessage = root.children[0].children[1].children[1];
  assert.equal(emoteMessage.children.length, 1);
  const emoteImage = emoteMessage.children[0];
  assert.equal(emoteImage.tagName, 'IMG');
  assert.equal(emoteImage.alt, '[打call]');
  emoteImage.listeners.error();
  assert.notEqual(emoteMessage.children[0], emoteImage);
  assert.equal(emoteMessage.children[0].textContent, '[打call]');

  feed.render([
    {
      kind: 'gift',
      name: '<img src=x onerror=alert(1)>',
      message: '送出 小花花 × 10',
      giftName: '<b>小花花</b>',
      giftCount: 10,
    },
  ]);
  const giftBody = root.children[0].children[1];
  assert.equal(giftBody.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  const giftMessage = giftBody.children[1];
  assert.equal(giftMessage.children[1].children[1].textContent, '<b>小花花</b>');
  assert.equal(giftMessage.children[1].children[1].children.length, 0);
  const transparentRoot = new FakeNode('div');
  const transparentFeed = module.createDanmakuFeed(transparentRoot, { autoScroll: false, showGiftTotal: true });
  for (const [giftTotalPrice, expected] of [
    [12.5, '¥12.5'],
    [0, '¥0'],
    [undefined, '—'],
  ]) {
    transparentFeed.render([
      {
        kind: 'gift',
        name: '观众',
        message: '送出 小花花 × 10',
        giftName: '<b>小花花</b>',
        giftCount: 10,
        giftTotalPrice,
      },
    ]);
    const content = transparentRoot.children[0].children[1].children[1];
    assert.equal(content.children[2].textContent, expected);
  }
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
