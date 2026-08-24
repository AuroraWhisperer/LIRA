'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('fixed danmaku overlay consumes snapshot and incremental feed events safely', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'danmaku.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'), 'utf8');
  const styles = fs.readFileSync(path.join(ROOT_DIR, 'public', 'css', 'overlays', 'danmaku.css'), 'utf8');
  const server = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8');

  assert.match(html, /id="danmakuFeed"/);
  assert.match(html, /body class="danmaku-overlay-body" data-style="signal"/);
  assert.match(html, /type="module" src="\/js\/overlays\/danmaku\.js/);
  assert.match(script, /createDanmakuFeed/);
  assert.match(script, /const MAX_ITEMS = 50;/);
  assert.match(script, /payload\.state\.danmakuFeed/);
  assert.match(script, /payload\.type === 'danmaku:message'/);
  assert.match(script, /window\.__API_TOKEN__/);
  assert.match(script, /encodeURIComponent\(token\)/);
  assert.match(script, /api\/bilibili\/avatar\?url=/);
  assert.match(script, /&token=\$\{encodeURIComponent\(token\)\}/);
  assert.match(script, /params\.get\('preview'\) === '1'/);
  assert.match(script, /params\.get\('style'\)/);
  assert.match(script, /guardLevel:\s*1/);
  assert.match(script, /guardLevel:\s*2/);
  assert.match(script, /guardLevel:\s*3/);
  assert.equal([...script.matchAll(/\{ id: 'preview-\d+'/g)].length, 4);
  assert.equal([...script.matchAll(/guardLevel:\s*[123]/g)].length, 3);
  assert.match(script, /payload\.state\.settings\.danmakuOverlayStyle/);
  assert.match(script, /payload\.state\.liveStatus/);
  assert.match(script, /topic=danmaku/);
  assert.match(script, /feed\.append/);
  assert.match(script, /requestAnimationFrame\(flushPendingItems\)/);
  assert.match(script, /autoScroll:\s*false/);
  assert.match(server, /webSocketHub\.broadcast\(\{ type: 'danmaku:message', item \}, \{ topic: 'danmaku' \}\)/);
  assert.match(script, /document\.body\.dataset\.style/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(styles, /clip-path:/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /background:\s*transparent/);
  assert.match(styles, /body\[data-style='signal'\]/);
  assert.match(styles, /body\[data-style='bubble'\]/);
  assert.match(styles, /body\[data-style='minimal'\]/);
  assert.match(styles, /body\[data-style='ranked'\]/);
  assert.match(styles, /body\[data-style='signal'\] \.danmaku-signal-header \{ display: none; \}/);
  assert.match(styles, /body\[data-style='bubble'\] \.danmaku-signal-header \{[^}]*display:\s*none;/s);
  assert.match(styles, /body\.is-preview \{[^}]*rgba\(248, 251, 255, \.96\)[^}]*rgba\(229, 239, 248, \.9\)/s);
  assert.match(styles, /body\.is-preview\[data-style='bubble'\] \{[^}]*rgba\(255, 252, 247, \.96\)[^}]*rgba\(237, 246, 243, \.9\)/s);
  assert.match(styles, /body\.is-preview\[data-style='minimal'\] \{[^}]*rgba\(244, 247, 252, \.94\)[^}]*rgba\(223, 231, 242, \.88\)/s);
  assert.match(styles, /body\.is-preview\[data-style='ranked'\] \{[^}]*rgba\(232, 237, 244, \.96\)[^}]*rgba\(207, 216, 228, \.9\)/s);
  assert.match(styles, /\.draw-danmaku-feed \{[^}]*align-items:\s*flex-start;/s);
  assert.match(styles, /\.draw-danmaku-item \{[^}]*width:\s*max-content;[^}]*min-width:\s*0;[^}]*max-width:\s*min\(100%, 660px\);/s);
  assert.doesNotMatch(styles, /body\[data-style='bubble'\] \.draw-danmaku-item \{[^}]*min-width:/s);
  assert.match(styles, /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='viewer'\] \{ --signal-accent: #7d91a8;/);
  assert.match(styles, /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='fan'\] \{ --signal-accent: #7d91a8;/);
  assert.match(styles, /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='captain'\] \{ --signal-accent: #3ec7ff;/);
  assert.match(styles, /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='admiral'\] \{ --signal-accent: #d45cff;/);
  assert.match(styles, /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --signal-accent: #ffb627;/);
  assert.match(styles, /body\[data-style='signal'\] \.draw-danmaku-identity \{ padding-right: 68px; \}/);
  assert.match(styles, /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='viewer'\] \{ --bubble-accent: #70ddc6;/);
  assert.match(styles, /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='fan'\] \{ --bubble-accent: #70ddc6;/);
  assert.match(styles, /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='captain'\] \{ --bubble-accent: #55b9ff;/);
  assert.match(styles, /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='admiral'\] \{ --bubble-accent: #dc78ff;/);
  assert.match(styles, /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --bubble-accent: #ffc34f;/);
  assert.match(styles, /body\[data-style='minimal'\] \.draw-danmaku-feed \{[^}]*height:\s*calc\(100vh - clamp/);
  assert.doesNotMatch(styles, /body\[data-style='minimal'\] \.draw-danmaku-item \{[^}]*border-left:/);
  assert.doesNotMatch(styles, /body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='viewer'\] \{[^}]*--minimal-role:\s*'普'/);
  assert.doesNotMatch(styles, /body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='fan'\] \{[^}]*--minimal-role:\s*'粉'/);
  assert.match(styles, /body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='viewer'\]::after,\s*body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='fan'\]::after \{\s*display:\s*none;\s*\}/);
  assert.match(styles, /--ranked-stage-width:\s*384px/);
  assert.match(styles, /--ranked-stage-height:\s*640px/);
  assert.match(styles, /--ranked-card-width:\s*360px/);
  assert.match(styles, /--ranked-card-min-height:\s*72px/);
  assert.match(styles, /--ranked-avatar-width:\s*72px/);
  assert.match(styles, /body\[data-style='ranked'\] \.danmaku-signal-stage \{[^}]*transform:\s*scale\(var\(--ranked-scale\)\)[^}]*transform-origin:\s*left bottom/s);
  assert.match(styles, /body\[data-style='ranked'\] \.draw-danmaku-item \{[^}]*grid-template-areas:\s*'content avatar'[^}]*width:\s*var\(--ranked-card-width\)[^}]*min-height:\s*var\(--ranked-card-min-height\)[^}]*overflow:\s*hidden[^}]*border-radius:\s*2px[^}]*background:\s*var\(--ranked-surface\)/s);
  assert.match(styles, /body\[data-style='ranked'\] \.draw-danmaku-avatar \{[^}]*grid-area:\s*avatar[^}]*align-self:\s*center[^}]*width:\s*var\(--ranked-avatar-width\)[^}]*height:\s*var\(--ranked-avatar-width\)[^}]*border-radius:\s*0[^}]*background:\s*var\(--danmaku-avatar-art\)/s);
  assert.match(styles, /body\[data-style='ranked'\] \.draw-danmaku-body \{[^}]*grid-area:\s*content[^}]*min-height:\s*var\(--ranked-card-min-height\)/s);
  assert.match(styles, /body\[data-style='ranked'\] \.draw-danmaku-body p \{[^}]*color:\s*#fff[^}]*font-size:\s*30px[^}]*text-shadow:\s*0 1px 3px rgba\(0, 0, 0, \.34\)/s);
  assert.doesNotMatch(styles, /body\[data-style='ranked'\] \.draw-danmaku-body p \{[^}]*-webkit-line-clamp/s);
  assert.match(styles, /url\('\/img\/overlays\/danmaku-ranked\/viewer\.png'\)/);
  assert.match(styles, /url\('\/img\/overlays\/danmaku-ranked\/captain\.png'\)/);
  assert.match(styles, /url\('\/img\/overlays\/danmaku-ranked\/admiral\.png'\)/);
  assert.match(styles, /url\('\/img\/overlays\/danmaku-ranked\/governor\.png'\)/);
  assert.match(styles, /\.draw-danmaku-avatar \{[^}]*color:\s*transparent;[^}]*background:\s*var\(--danmaku-avatar-art\)[^}]*font-size:\s*0;/s);
  assert.match(styles, /body\[data-style='ranked'\] \.draw-danmaku-badge \{\s*display:\s*none;/);
  assert.match(styles, /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='viewer'\],\s*body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='fan'\] \{ --ranked-surface: rgba\(52, 59, 69, \.84\);/);
  for (const identity of ['captain', 'admiral', 'governor']) {
    assert.match(styles, new RegExp(`body\\[data-style='ranked'\\] \\.draw-danmaku-item\\[data-identity='${identity}'\\]`));
  }
  for (const style of ['signal', 'bubble', 'minimal', 'ranked']) {
    for (const identity of ['viewer', 'fan', 'captain', 'admiral', 'governor']) {
      assert.match(
        styles,
        new RegExp(`body\\[data-style='${style}'\\] \\.draw-danmaku-item\\[data-identity='${identity}'\\]`)
      );
    }
  }
});

test('ranked danmaku overlay preserves its 384 by 640 design viewport', async () => {
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'),
    {
      document: { addEventListener() {} },
      location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
      URL,
      URLSearchParams
    }
  );

  assert.equal(module.calculateRankedOverlayScale(384, 640), 1);
  assert.equal(module.calculateRankedOverlayScale(192, 640), 0.5);
  assert.equal(module.calculateRankedOverlayScale(768, 640), 1);
  assert.equal(module.calculateRankedOverlayScale(768, 1280), 2);
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
          node.children.forEach(child => { child.parentNode = this; });
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

    addEventListener(type, listener) { this.listeners[type] = listener; }
    removeChild(node) {
      this.children = this.children.filter(child => child !== node);
      node.parentNode = null;
    }
    setAttribute() {}
    replaceWith(node) { this.replacement = node; }
  }

  const root = new FakeNode('div');
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'),
    {
      document: {
        createElement: tagName => new FakeNode(tagName),
        createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true })
      }
    }
  );
  const feed = module.createDanmakuFeed(root, {
    maxItems: 2,
    autoScroll: false,
    resolveEmoteUrl: url => `/proxy?url=${encodeURIComponent(url)}`
  });

  feed.render([{
    name: '观众',
    message: '你好[妙][打call]',
    emotes: [
      { text: '[妙]', url: 'https://i0.hdslb.com/bfs/emote/miao.png', width: 64, height: 64 },
      { text: '[打call]', url: 'https://i0.hdslb.com/bfs/emote/call.gif', width: 180, height: 90 }
    ]
  }]);

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

  const identityRoot = new FakeNode('div');
  identityRoot.clientHeight = 40;
  const emptyState = new FakeNode('div');
  emptyState.className = 'draw-danmaku-empty';
  identityRoot.append(emptyState);
  const identityFeed = module.createDanmakuFeed(identityRoot, {
    maxItems: 5,
    autoScroll: false,
    getGuardLabel: level => ({ 1: '总督', 2: '提督', 3: '舰长' })[level] || ''
  });
  identityFeed.render([
    { message: '普通' },
    { message: '粉丝', medalName: '夜航', medalLevel: 8 },
    { message: '舰长', guardLevel: 3 },
    { message: '提督', guardLevel: 2 },
    { message: '总督', guardLevel: 1, medalName: '夜航' }
  ]);
  assert.deepEqual(
    identityRoot.children.map(item => item.dataset.identity),
    ['viewer', 'fan', 'captain', 'admiral', 'governor']
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
      nodes.forEach(node => {
        if (node.isFragment) {
          node.children.forEach(child => { child.parentNode = this; });
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
      this.children = this.children.filter(child => child !== node);
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
        createElement: tagName => new FakeNode(tagName),
        createDocumentFragment: () => Object.assign(new FakeNode(), { isFragment: true })
      }
    }
  );
  const feed = module.createDanmakuFeed(root, {
    maxItems: 50,
    offscreenViewports: 0,
    autoScroll: false
  });

  feed.render([
    { name: '第一位', message: '第一条' },
    { name: '第二位', message: '第二条' }
  ]);
  const firstBubble = root.children[0];
  feed.append({ name: '第三位', message: '第三条' });

  assert.equal(root.children.length, 2);
  assert.notEqual(root.children[0], firstBubble);
});

test('fixed danmaku overlay derives its label from Bilibili live status', async () => {
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'),
    {
      document: { addEventListener() {} },
      location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
      URL,
      URLSearchParams
    }
  );

  assert.equal(JSON.stringify(module.describeDanmakuConnection({
    connected: true,
    enabled: true,
    roomId: '123',
    message: '已开播'
  }, true)), JSON.stringify({ text: '已开播', connected: true }));
  assert.equal(JSON.stringify(module.describeDanmakuConnection({
    connected: false,
    enabled: true,
    roomId: '123',
    message: '弹幕连接出现错误'
  }, true)), JSON.stringify({ text: '弹幕连接出现错误', connected: false }));
  assert.equal(JSON.stringify(module.describeDanmakuConnection({
    connected: true,
    enabled: true,
    roomId: '123',
    message: '已开播'
  }, false)), JSON.stringify({ text: '连接中断 · 重试中', connected: false }));
});
