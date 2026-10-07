'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { FakeNode, allNodes } = require('../helpers/fake-dom');

const ROOT_DIR = path.join(__dirname, '../..');

test('fixed danmaku overlay page, styles and guard artwork stay wired', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'danmaku.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'), 'utf8');
  const styles = readCssBundle('public', 'css', 'overlays', 'danmaku.css').replace(/\s+/g, ' ');

  assert.match(html, /id="danmakuFeed"/);
  assert.match(html, /body class="danmaku-overlay-body" data-style="signal"/);
  assert.match(html, /type="module" src="\/js\/overlays\/danmaku\.js/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /background:\s*transparent/);
  assert.match(
    styles,
    /body\[data-style='transparent'\]\s+\.draw-danmaku-item\s*\{[^}]*background\s*:\s*transparent\s*;/,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\]\s+\.draw-danmaku-item\s*\{[^}]*position\s*:\s*absolute\s*;/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\]\s+\.draw-danmaku-body p\s*\{[^}]*font-size\s*:[^;}]*var\(\s*--danmaku-font-size\s*[,)]/,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\]\s+\.draw-danmaku-body p\s*\{[^}]*font-size\s*:[^;}]*var\(\s*--danmaku-font-size\s*[,)]/,
  );
  for (const asset of [
    'bubble-captain-frame.webp',
    'bubble-admiral-frame.webp',
    'bubble-governor-frame.webp',
    'bow-divider.webp',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public', 'img', 'overlays', 'danmaku-guard', asset)));
  }
});

test('fixed danmaku overlay subscribes with the encoded token and renders snapshot emotes through the token proxy', async () => {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, Object.assign(new FakeNode('section'), { clientWidth: 1280, clientHeight: 720 }));
    return elements.get(id);
  };
  const classList = { add() {}, remove() {}, toggle() {} };
  const sockets = [];
  let ready;
  class Socket {
    constructor(url) {
      this.url = url;
      this.listeners = {};
      sockets.push(this);
    }
    addEventListener(name, listener) {
      this.listeners[name] = listener;
    }
  }
  const window = { innerWidth: 1280, __API_TOKEN__: 'synthetic token&1', addEventListener() {}, removeEventListener() {},
    dispatchEvent() {}, Event: class {}, MutationObserver: class { observe() {} disconnect() {} }, getComputedStyle: () => ({}) };
  await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'), {
    document: {
      defaultView: window,
      body: Object.assign(new FakeNode('body'), { classList }),
      documentElement: new FakeNode('html'),
      getElementById: element,
      addEventListener: (_, listener) => { ready = listener; },
      createElement: (tag) => Object.assign(new FakeNode(tag), { classList }),
      createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true }),
      querySelectorAll: () => [],
    },
    window,
    location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
    URL,
    URLSearchParams,
    WebSocket: Socket,
    requestAnimationFrame: (callback) => { callback(); return 1; },
    cancelAnimationFrame() {},
    setTimeout: () => 1,
    clearTimeout() {},
  });
  ready();
  assert.deepEqual(sockets.map((socket) => socket.url), ['ws://127.0.0.1:3000/ws?token=synthetic%20token%261&topic=danmaku']);
  const emoteUrl = 'https://i0.hdslb.com/bfs/live/emote.png';
  sockets[0].listeners.open();
  sockets[0].listeners.message({ data: JSON.stringify({ type: 'snapshot', state: {
    danmakuFeed: [{ id: '1', name: '观众', message: '你好[星]', timestamp: 1, emotes: [{ text: '[星]', url: emoteUrl, kind: 'inline' }] }],
    settings: { danmakuOverlayStyle: 'signal' },
    liveStatus: { enabled: true, roomId: '1', connected: true },
  } }) });
  const images = allNodes(element('danmakuFeed')).filter((node) => node.src);
  assert.deepEqual(images.map((node) => node.src),
    [`/api/bilibili/avatar?url=${encodeURIComponent(emoteUrl)}&token=synthetic%20token%261`]);
});

test('fixed danmaku overlay derives its label from Bilibili live status', async () => {
  const module = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'), {
    document: { addEventListener() {} },
    location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
    URL,
    URLSearchParams,
  });

  assert.equal(
    JSON.stringify(
      module.describeDanmakuConnection(
        {
          connected: true,
          enabled: true,
          roomId: '123',
          message: '已开播',
        },
        true,
      ),
    ),
    JSON.stringify({ text: '已开播', connected: true }),
  );
  assert.equal(
    JSON.stringify(
      module.describeDanmakuConnection(
        {
          connected: false,
          enabled: true,
          roomId: '123',
          message: '弹幕连接出现错误',
        },
        true,
      ),
    ),
    JSON.stringify({ text: '弹幕连接出现错误', connected: false }),
  );
  assert.equal(
    JSON.stringify(
      module.describeDanmakuConnection(
        {
          connected: true,
          enabled: true,
          roomId: '123',
          message: '已开播',
        },
        false,
      ),
    ),
    JSON.stringify({ text: '连接中断 · 重试中', connected: false }),
  );
});
