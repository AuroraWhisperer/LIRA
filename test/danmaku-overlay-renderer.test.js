'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('ranked danmaku overlay preserves its 624 by 640 design viewport', async () => {
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'),
    {
      document: { addEventListener() {} },
      location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
      URL,
      URLSearchParams,
    },
  );

  assert.equal(module.calculateRankedOverlayScale(624, 640), 1);
  assert.equal(module.calculateRankedOverlayScale(312, 640), 0.5);
  assert.equal(module.calculateRankedOverlayScale(1248, 640), 1);
  assert.equal(module.calculateRankedOverlayScale(1248, 1280), 2);
  assert.equal(module.calculateRankedOverlayScale(0, 0), 1);
});

test('shared danmaku renderer replaces whole and inline emote triggers with safe images', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = { setProperty() {} };
      this.listeners = {};
      this.textContent = '';
      this.className = '';
    }

    append(...nodes) {
      for (const node of nodes) {
        if (node.isFragment) {
          node.children.forEach((child) => {
            child.parentNode = this;
          });
          this.children.push(...node.children);
        } else {
          node.parentNode = this;
          this.children.push(node);
        }
      }
    }

    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }

    addEventListener(type, listener) {
      this.listeners[type] = listener;
    }
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
      node.parentNode = null;
    }
    setAttribute() {}
    replaceWith(node) {
      this.replacement = node;
    }
  }

  const root = new FakeNode('div');
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'),
    {
      document: {
        createElement: (tagName) => new FakeNode(tagName),
        createDocumentFragment: () =>
          Object.assign(new FakeNode(), { isFragment: true }),
      },
    },
  );
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
  assert.equal(
    root.children[0],
    firstBubble,
    'incremental append must preserve existing message nodes',
  );
  feed.append({ name: '第三位', message: '第三条' });
  assert.equal(root.children.length, 2);
  assert.notEqual(
    root.children[0],
    firstBubble,
    'incremental append must trim only the oldest node',
  );

  feed.render([
    {
      message: '[打call]',
      emotes: [
        { text: '[打call]', url: 'https://i0.hdslb.com/bfs/emote/call.gif' },
      ],
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
  assert.equal(emoteImage.replacement.textContent, '[打call]');

  const identityRoot = new FakeNode('div');
  identityRoot.clientHeight = 40;
  const emptyState = new FakeNode('div');
  emptyState.className = 'draw-danmaku-empty';
  identityRoot.append(emptyState);
  const identityFeed = module.createDanmakuFeed(identityRoot, {
    maxItems: 5,
    autoScroll: false,
    getGuardLabel: (level) =>
      ({ 1: '总督', 2: '提督', 3: '舰长' })[level] || '',
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
});

test('fixed danmaku feed prunes incremental nodes outside its visible viewport', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = { setProperty() {} };
      this.className = '';
      this.textContent = '';
    }

    append(...nodes) {
      nodes.forEach((node) => {
        if (node.isFragment) {
          node.children.forEach((child) => {
            child.parentNode = this;
          });
          this.children.push(...node.children);
        } else {
          node.parentNode = this;
          this.children.push(node);
        }
      });
    }

    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }

    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
      node.parentNode = null;
    }

    addEventListener() {}
    setAttribute() {}
  }

  const root = new FakeNode('div');
  root.clientHeight = 130;
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'),
    {
      document: {
        createElement: (tagName) => new FakeNode(tagName),
        createDocumentFragment: () =>
          Object.assign(new FakeNode(), { isFragment: true }),
      },
    },
  );
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

  assert.equal(root.children.length, 2);
  assert.notEqual(root.children[0], firstBubble);

  root.children[0].offsetHeight = 100;
  root.children[1].offsetHeight = 80;
  feed.append({ name: '第四位', message: '图片加载后高度变大' });
  assert.equal(
    root.children.length,
    1,
    'pruning must use measured image/name height',
  );
  assert.equal(
    root.children[0].children[1].children[0].children[0].textContent,
    '第四位',
  );
});
