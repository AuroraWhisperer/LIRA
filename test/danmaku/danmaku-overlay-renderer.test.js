'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { FakeNode, createFakeDocument } = require('../helpers/fake-dom');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('ranked danmaku fits the shared horizontal inset without shrinking for height', async () => {
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'), {
    document: { addEventListener() {} },
    location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
    URL,
    URLSearchParams,
  });

  assert.equal(module.calculateRankedOverlayScale(624, 640), 1);
  assert.equal(module.calculateRankedOverlayScale(324, 640), 0.5);
  assert.equal(module.calculateRankedOverlayScale(312, 640), 0.48);
  assert.equal(module.calculateRankedOverlayScale(1248, 640), 1);
  assert.equal(module.calculateRankedOverlayScale(1248, 1280), 1);
  assert.equal(module.calculateRankedOverlayScale(624, 320), 1);
  assert.equal(module.calculateRankedOverlayScale(324, 320), 0.5);
  assert.equal(module.calculateRankedOverlayScale(0, 0), 1);
});

test('shared danmaku renderer replaces whole and inline emote triggers with safe images', async () => {
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
  const emoteBubble = root.children[0];
  const emoteMessage = emoteBubble.children[1].children[1];
  assert.match(emoteBubble.className, /is-emote-only/);
  assert.equal(emoteMessage.children.length, 1);
  const emoteImage = emoteMessage.children[0];
  assert.equal(emoteImage.tagName, 'IMG');
  assert.equal(emoteImage.alt, '[打call]');
  emoteImage.listeners.error();
  assert.notEqual(emoteMessage.children[0], emoteImage);
  assert.equal(emoteMessage.children[0].textContent, '[打call]');

  for (const [kind, text, enlarged] of [
    ['inline', '[喝彩]', false],
    ['inline', '好听[喝彩]', false],
    ['inline', '[喝彩][喝彩]', false],
    ['sticker', '[喝彩]', true],
    [undefined, '[喝彩]', true],
  ]) {
    feed.render([
      {
        message: text,
        emotes: [
          {
            text: '[喝彩]',
            url: 'https://i0.hdslb.com/cheer.png',
            kind,
            width: 192,
            height: 192,
          },
        ],
      },
    ]);
    assert.equal(root.children[0].className.includes('is-emote-only'), enlarged, `${kind}: ${text}`);
  }

  const identityRoot = new FakeNode('div');
  identityRoot.clientHeight = 40;
  const emptyState = new FakeNode('div');
  emptyState.className = 'draw-danmaku-empty';
  identityRoot.append(emptyState);
  const identityFeed = module.createDanmakuFeed(identityRoot, {
    maxItems: 5,
    autoScroll: false,
    getGuardLabel: (level) => ({ 1: '总督', 2: '提督', 3: '舰长' })[level] || '',
  });
  identityFeed.render([
    { message: '普通' },
    { message: '粉丝', medalName: '夜航', medalLevel: 8 },
    { message: '舰长', guardLevel: 3 },
    { message: '提督', guardLevel: 2 },
    { message: '总督', guardLevel: 1, medalName: '夜航' },
  ]);
  assert.deepEqual(
    identityRoot.children.map((item) => item.dataset.identity),
    ['viewer', 'fan', 'captain', 'admiral', 'governor'],
  );
  assert.deepEqual(
    identityRoot.children.map((item) => item.children[0].dataset.medalLevel),
    [undefined, '8', undefined, undefined, undefined],
    'guard ranks and medal names must not supply a made-up fan level',
  );
  for (const isStreamer of [true, false, 'true', 'false', undefined]) {
    feed.render([{ name: '相同昵称', message: '主播身份', guardLevel: 3, isStreamer }]);
    assert.equal(root.children[0].dataset.streamer === 'true', isStreamer === true);
    assert.equal(root.children[0].dataset.identity, 'captain', 'other styles retain their guard identity');
  }
  for (const [medalLevel, expected] of [
    [45, '45'],
    [28, '28'],
    [4, '4'],
    [35, '35'],
    ['12', '12'],
    [0, undefined],
    [undefined, undefined],
    [-1, undefined],
    [3.5, undefined],
    [Infinity, undefined],
    ['unknown', undefined],
  ]) {
    feed.render([{ name: '同一观众', message: '等级来自本条弹幕', medalLevel }]);
    assert.equal(
      root.children[0].children[0].dataset.medalLevel,
      expected,
      'the avatar uses the exact level even without a medal name, and never retains a previous level',
    );
  }

  feed.render([
    {
      kind: 'gift',
      name: '<img src=x onerror=alert(1)>',
      message: '送出 小花花 × 10',
      giftName: '<b>小花花</b>',
      giftCount: 10,
    },
  ]);
  const giftBubble = root.children[0];
  assert.match(giftBubble.className, /\bis-gift\b/);
  const giftBody = giftBubble.children[1];
  assert.equal(giftBody.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  const giftMessage = giftBody.children[1];
  assert.equal(giftMessage.className, 'draw-danmaku-gift');
  assert.equal(giftMessage.children[1].children[0].textContent, '送出');
  assert.equal(giftMessage.children[1].children[1].textContent, '<b>小花花</b>');
  assert.equal(giftMessage.children[2].textContent, '× 10');
  assert.equal(giftMessage.children[1].children[1].children.length, 0);
  assert.equal(giftMessage.children.length, 3, 'gift notifications do not synthesize account replies');
  const transparentRoot = new FakeNode('div');
  const transparentFeed = module.createDanmakuFeed(transparentRoot, { autoScroll: false, showGiftTotal: true });
  for (const [giftTotalPrice, expected] of [
    [12.5, '¥12.5'],
    [0.01, '¥0.01'],
    [0, '¥0'],
    [undefined, '—'],
    [null, '—'],
    [-1, '—'],
    [Infinity, '—'],
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
    assert.equal(content.children[1].children[1].textContent, '<b>小花花</b>');
    assert.equal(content.children[1].children[1].children.length, 0);
    assert.equal(content.children[1].children[2].textContent, '× 10');
    assert.equal(content.children[2].className, 'draw-danmaku-gift-amount');
    assert.equal(content.children[2].textContent, expected);
  }
  feed.render([{ kind: 'gift', message: '送出 小花花 × 10', giftName: '小花花', giftCount: 10, giftTotalPrice: 12.5 }]);
  assert.equal(
    root.children[0].children[1].children[1].children[2].textContent,
    '× 10',
    'other styles retain the quantity in the right column',
  );
  feed.render([{ name: '已登录账号', message: '谢谢星河来客送来的 10 朵小花花！' }]);
  const thanksMessage = root.children[0].children[1].children[1];
  assert.doesNotMatch(root.children[0].className, /\bis-gift\b/);
  assert.equal(thanksMessage.textContent, '谢谢星河来客送来的 10 朵小花花！');
  assert.equal(thanksMessage.children.length, 0, 'account replies use the ordinary text renderer');

  const previewRoot = new FakeNode('div');
  previewRoot.clientHeight = 1;
  const previewFeed = module.createDanmakuFeed(previewRoot, {
    autoScroll: false,
    offscreenViewports: Number.POSITIVE_INFINITY,
  });
  previewFeed.render(Array.from({ length: 6 }, (_, index) => ({ message: `示例 ${index}` })));
  assert.equal(previewRoot.children.length, 6, 'an initially short preview must retain every example');

  feed.render([{ name: '普通观众', message: '继续聊天' }]);
  assert.doesNotMatch(root.children[0].className, /\bis-gift\b/);
  assert.equal(root.children[0].children[1].children[1].textContent, '继续聊天');
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
});
