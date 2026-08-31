'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('fixed danmaku overlay consumes snapshot and incremental feed events safely', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'danmaku.html'),
    'utf8',
  );
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'),
    'utf8',
  );
  const feedScript = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'),
    'utf8',
  );
  const styles = fs
    .readFileSync(
      path.join(ROOT_DIR, 'public', 'css', 'overlays', 'danmaku.css'),
      'utf8',
    )
    .replace(/\s+/g, ' ');
  const server = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'server.js'),
    'utf8',
  );

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
  assert.match(script, /'outline'/);
  assert.match(script, /guardLevel:\s*1/);
  assert.match(script, /guardLevel:\s*2/);
  assert.match(script, /guardLevel:\s*3/);
  assert.equal([...script.matchAll(/\bid:\s*'preview-\d+'/g)].length, 4);
  assert.equal([...script.matchAll(/guardLevel:\s*[123]/g)].length, 3);
  assert.match(script, /payload\.state\.settings\.danmakuOverlayStyle/);
  assert.match(script, /danmakuFullscreenDurationSeconds/);
  assert.match(script, /options\.layout\s*=\s*'fullscreen-random'/);
  assert.match(script, /itemLifetimeMs/);
  assert.match(script, /options\.expireItems\s*=\s*!previewMode/);
  assert.match(script, /payload\.state\.liveStatus/);
  assert.match(script, /topic=danmaku/);
  assert.match(script, /feed\.append/);
  assert.match(script, /requestAnimationFrame\(flushPendingItems\)/);
  assert.match(script, /autoScroll:\s*false/);
  assert.match(
    server,
    /webSocketHub\.broadcast\(\s*\{\s*type:\s*'danmaku:message',\s*item\s*\},\s*\{\s*topic:\s*'danmaku'\s*\},?\s*\)/,
  );
  assert.match(script, /document\.body\.dataset\.style/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(styles, /clip-path:/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /background:\s*transparent/);
  assert.match(styles, /body\[data-style='signal'\]/);
  assert.match(styles, /body\[data-style='bubble'\]/);
  assert.match(styles, /body\[data-style='minimal'\]/);
  assert.match(styles, /body\[data-style='ranked'\]/);
  assert.match(styles, /body\[data-style='outline'\]/);
  assert.match(
    styles,
    /body\[data-style='signal'\] \.danmaku-signal-header \{ display: none; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.danmaku-signal-header \{[^}]*display:\s*none;/s,
  );
  assert.match(
    styles,
    /body\.is-preview \{[^}]*rgba\(248, 251, 255, 0?\.96\)[^}]*rgba\(229, 239, 248, 0?\.9\)/s,
  );
  assert.match(
    styles,
    /body\.is-preview\[data-style='bubble'\] \{[^}]*rgba\(255, 252, 247, 0?\.96\)[^}]*rgba\(237, 246, 243, 0?\.9\)/s,
  );
  assert.match(
    styles,
    /body\.is-preview\[data-style='minimal'\] \{[^}]*rgba\(244, 247, 252, 0?\.94\)[^}]*rgba\(223, 231, 242, 0?\.88\)/s,
  );
  assert.match(
    styles,
    /body\.is-preview\[data-style='ranked'\] \{[^}]*rgba\(232, 237, 244, 0?\.96\)[^}]*rgba\(207, 216, 228, 0?\.9\)/s,
  );
  assert.match(
    styles,
    /\.draw-danmaku-feed \{[^}]*align-items:\s*flex-start;/s,
  );
  assert.match(
    styles,
    /\.draw-danmaku-item \{[^}]*width:\s*max-content;[^}]*min-width:\s*0;[^}]*max-width:\s*min\(100%, 660px\);/s,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item \{[^}]*min-width:/s,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='viewer'\] \{ --signal-accent: #7d91a8;/,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='fan'\] \{ --signal-accent: #7d91a8;/,
  );
  assert.match(styles, /--guard-captain:\s*#2f9bff;/);
  assert.match(styles, /--guard-admiral:\s*#a45cff;/);
  assert.match(styles, /--guard-governor:\s*#f0445a;/);
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='captain'\] \{ --signal-accent: var\(--guard-captain\);/,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='admiral'\] \{ --signal-accent: var\(--guard-admiral\);/,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --signal-accent: var\(--guard-governor\);/,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-identity \{ padding-right: 68px; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-guard \{ display: none; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-medal-level \{[^}]*right:\s*9px;[^}]*bottom:\s*0;/s,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='viewer'\] \{ --bubble-accent: #70ddc6;/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='fan'\] \{ --bubble-accent: #70ddc6;/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='captain'\] \{ --bubble-accent: var\(--guard-captain\);[^}]*bubble-captain-frame\.png/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='admiral'\] \{ --bubble-accent: var\(--guard-admiral\);[^}]*bubble-admiral-frame\.png/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --bubble-accent: var\(--guard-governor\);[^}]*bubble-governor-frame\.png/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-guard \{ display: none; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-medal-level \{ font-size: 14px; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-feed \{[^}]*height:\s*calc\(100vh - clamp/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-body \{[^}]*display:\s*grid;/s,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='captain'\] \{[^}]*nameplate-captain-divider\.png/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='admiral'\] \{[^}]*nameplate-admiral-divider\.png/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item\[data-identity='governor'\] \{[^}]*nameplate-governor-divider\.png/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item:is\([^}]*\) \.draw-danmaku-identity::after \{[^}]*background:\s*var\(--nameplate-divider\)/s,
  );
  assert.match(feedScript, /draw-danmaku-medal-level/);
  assert.match(feedScript, /draw-danmaku-medal-name/);
  assert.match(feedScript, /FULLSCREEN_LAYOUT\s*=\s*'fullscreen-random'/);
  assert.match(feedScript, /scheduleTimeout/);
  assert.match(feedScript, /cancelTimeout/);
  assert.match(styles, /--ranked-stage-width:\s*624px/);
  assert.match(styles, /--ranked-stage-height:\s*640px/);
  assert.match(styles, /--ranked-bubble-max-width:\s*600px/);
  assert.match(styles, /--ranked-avatar-size:\s*68px/);
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.danmaku-signal-stage \{[^}]*transform:\s*scale\(var\(--ranked-scale\)\)[^}]*transform-origin:\s*left bottom/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item \{[^}]*--ranked-accent:\s*#6ed6dc;[^}]*grid-template-columns:\s*var\(--ranked-avatar-size\) minmax\(0, 1fr\)[^}]*width:\s*max-content;[^}]*min-width:\s*0;[^}]*max-width:\s*var\(--ranked-bubble-max-width\)[^}]*background:\s*transparent;[^}]*clip-path:\s*none;/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-avatar \{[^}]*align-self:\s*start;[^}]*width:\s*var\(--ranked-avatar-size\);[^}]*height:\s*var\(--ranked-avatar-size\);[^}]*border-radius:\s*50%;[^}]*background:\s*var\(--danmaku-avatar-art\)[^}]*clip-path:\s*none;/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-body \{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*gap:\s*5px;[^}]*min-width:\s*0;[^}]*max-width:\s*calc\( var\(--ranked-bubble-max-width\) - var\(--ranked-avatar-size\) - 9px \);/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-identity \{[^}]*display:\s*flex;[^}]*width:\s*max-content;[^}]*max-width:\s*100%;[^}]*border-radius:\s*999px;[^}]*background:\s*color-mix\(in srgb, var\(--ranked-accent\) 82%, white\)/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-guard,\s*body\[data-style='ranked'\] \.draw-danmaku-medal-name \{ display:\s*none;/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-body p \{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;[^}]*border-radius:\s*5px 18px 18px 18px;[^}]*color:\s*#fff[^}]*font-size:\s*38px[^}]*background:\s*var\(--ranked-accent\)[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;[^}]*text-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0?\.34\)/s,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='ranked'\][\s\S]*grid-template-areas:\s*'content avatar'/,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-avatar \{[^}]*mask-image:/s,
  );
  assert.match(styles, /url\('\/img\/overlays\/danmaku-ranked\/viewer\.png'\)/);
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/captain\.png'\)/,
  );
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/admiral\.png'\)/,
  );
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/governor\.png'\)/,
  );
  assert.match(
    styles,
    /\.draw-danmaku-avatar \{[^}]*color:\s*transparent;[^}]*background:\s*var\(--danmaku-avatar-art\)[^}]*font-size:\s*0;/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-medal \{[^}]*display:\s*inline-flex;[^}]*margin-left:\s*auto;[^}]*border-radius:\s*999px;/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='viewer'\],\s*body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='fan'\] \{ --ranked-accent: #6ed6dc;/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='captain'\] \{ --ranked-accent: var\(--guard-captain\);/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='admiral'\] \{ --ranked-accent: var\(--guard-admiral\);/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --ranked-accent: var\(--guard-governor\);/,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-item \{[^}]*position:\s*absolute;[^}]*--outline-accent:\s*#fff;[^}]*border:\s*1px solid var\(--outline-accent\);[^}]*background:\s*rgba\(9, 15, 27, 0?\.72\)/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.danmaku-signal-stage \{[^}]*width:\s*100vw;[^}]*height:\s*100vh;/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-feed \{[^}]*position:\s*relative;[^}]*width:\s*100vw;[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-item::after,[^}]*body\[data-style='outline'\] \.draw-danmaku-avatar,[^}]*body\[data-style='outline'\] \.draw-danmaku-guard,[^}]*body\[data-style='outline'\] \.draw-danmaku-medal \{ display:\s*none; \}/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-identity \{[^}]*position:\s*absolute;[^}]*top:\s*-0\.72em;[^}]*left:\s*50%;[^}]*transform:\s*translateX\(-50%\)/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-body p \{[^}]*color:\s*#fff;[^}]*font-size:\s*clamp\(16px, 2\.2vw, 18px\);[^}]*font-weight:\s*700;[^}]*text-align:\s*center;/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='viewer'\],[^}]*body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='fan'\],[^}]*body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='captain'\],[^}]*body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='admiral'\],[^}]*body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --outline-accent:\s*#fff; \}/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='captain'\],[^}]*body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='admiral'\],[^}]*body\[data-style='outline'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --outline-accent:\s*#fff; \}/s,
  );
  assert.doesNotMatch(styles, /body\[data-style='outline'\][\s\S]*var\(--guard-/);
  assert.match(
    styles,
    /body\.is-preview\[data-style='outline'\] \{[^}]*#101628[^}]*#070b17/s,
  );
  for (const asset of [
    'bubble-captain-frame.png',
    'bubble-admiral-frame.png',
    'bubble-governor-frame.png',
    'nameplate-captain-divider.png',
    'nameplate-admiral-divider.png',
    'nameplate-governor-divider.png',
  ]) {
    assert.ok(
      fs.existsSync(
        path.join(
          ROOT_DIR,
          'public',
          'img',
          'overlays',
          'danmaku-guard',
          asset,
        ),
      ),
    );
  }
  for (const identity of ['captain', 'admiral', 'governor']) {
    assert.match(
      styles,
      new RegExp(
        `body\\[data-style='ranked'\\] \\.draw-danmaku-item\\[data-identity='${identity}'\\]`,
      ),
    );
  }
  for (const style of ['signal', 'bubble', 'minimal', 'ranked', 'outline']) {
    for (const identity of [
      'viewer',
      'fan',
      'captain',
      'admiral',
      'governor',
    ]) {
      assert.match(
        styles,
        new RegExp(
          `body\\[data-style='${style}'\\] \\.draw-danmaku-item\\[data-identity='${identity}'\\]`,
        ),
      );
    }
  }
});

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
});

test('fullscreen random danmaku positions are stable, bounded, and expire from timers', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.offsetWidth = tagName === 'article' ? 120 : 0;
      this.offsetHeight = tagName === 'article' ? 42 : 0;
      this.clientWidth = 0;
      this.clientHeight = 0;
      const values = new Map();
      this.style = {
        values,
        setProperty(name, value) {
          values.set(name, String(value));
        },
        getPropertyValue(name) {
          return values.get(name) || '';
        },
      };
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

  const root = new FakeNode('section');
  root.clientWidth = 400;
  root.clientHeight = 240;
  const scheduled = [];
  const cancelled = [];
  let now = 1000;
  const resizeObservers = [];
  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback;
      resizeObservers.push(this);
    }
    observe() {}
    disconnect() {}
    trigger() {
      this.callback();
    }
  }
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku-feed.js'),
    {
      document: {
        createElement: (tagName) => new FakeNode(tagName),
        createDocumentFragment: () =>
          Object.assign(new FakeNode(), { isFragment: true }),
      },
      ResizeObserver: FakeResizeObserver,
    },
  );
  const feed = module.createDanmakuFeed(root, {
    layout: 'fullscreen-random',
    maxItems: 5,
    itemLifetimeMs: 500,
    expireItems: true,
    autoScroll: false,
    now: () => now,
    scheduleTimeout(callback, delay) {
      const timer = { callback, delay };
      scheduled.push(timer);
      return timer;
    },
    cancelTimeout(timer) {
      cancelled.push(timer);
    },
  });
  const item = {
    id: 'stable',
    uid: '17',
    timestamp: 700,
    name: '发送者',
    message: '全屏消息',
    guardLevel: 3,
    medalName: '夜航',
  };

  feed.render([item]);
  const firstNode = root.children[0];
  const firstLeft = firstNode.style.getPropertyValue('left');
  const firstTop = firstNode.style.getPropertyValue('top');
  assert.match(firstLeft, /^\d+(?:\.\d+)?px$/);
  assert.match(firstTop, /^\d+(?:\.\d+)?px$/);
  assert.ok(Number.parseFloat(firstLeft) >= 8);
  assert.ok(Number.parseFloat(firstLeft) <= root.clientWidth - firstNode.offsetWidth - 8);
  assert.ok(Number.parseFloat(firstTop) >= 8);
  assert.ok(Number.parseFloat(firstTop) <= root.clientHeight - firstNode.offsetHeight - 8);
  assert.equal(scheduled[0].delay, 200);

  now = 1100;
  feed.render([{ ...item, guardLevel: 1, medalName: '新牌' }]);
  assert.equal(root.children[0].style.getPropertyValue('left'), firstLeft);
  assert.equal(root.children[0].style.getPropertyValue('top'), firstTop);
  assert.equal(scheduled.at(-1).delay, 100);
  assert.ok(cancelled.length >= 1);

  const timer = scheduled.at(-1);
  timer.callback();
  assert.equal(root.children.length, 0);

  feed.render([{ ...item, timestamp: 1100 }]);
  const activeTimer = scheduled.at(-1);
  feed.destroy();
  assert.ok(cancelled.includes(activeTimer));
  assert.equal(root.children.length, 0);
  assert.ok(resizeObservers.length > 0);
});

test('fullscreen random preview keeps rendered items without expiration timers', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.style = { setProperty() {} };
    }
    append(...nodes) {
      nodes.forEach((node) => {
        if (node.isFragment) this.children.push(...node.children);
        else this.children.push(node);
      });
    }
    replaceChildren(...nodes) {
      this.children = [];
      this.append(...nodes);
    }
    removeChild(node) {
      this.children = this.children.filter((child) => child !== node);
    }
    addEventListener() {}
    setAttribute() {}
  }
  const root = new FakeNode('section');
  const scheduled = [];
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
    layout: 'fullscreen-random',
    itemLifetimeMs: 500,
    expireItems: false,
    scheduleTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });
  feed.render([{ id: 'preview', timestamp: 1, message: '预览' }]);
  assert.equal(root.children.length, 1);
  assert.equal(scheduled.length, 0);
});

test('fullscreen random live items without a timestamp still expire from arrival time', async () => {
  class FakeNode {
    constructor(tagName = '') {
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.textContent = '';
      this.clientWidth = 0;
      this.clientHeight = 0;
      this.style = { setProperty() {} };
      this.tagName = tagName.toUpperCase();
    }
    append(...nodes) {
      nodes.forEach((node) => {
        if (node.isFragment) this.children.push(...node.children);
        else {
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
    }
    addEventListener() {}
    setAttribute() {}
  }
  const root = new FakeNode('section');
  const scheduled = [];
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
    layout: 'fullscreen-random',
    itemLifetimeMs: 500,
    now: () => 1000,
    scheduleTimeout(callback, delay) {
      scheduled.push({ callback, delay });
    },
  });

  feed.append({ id: 'arrival-only', message: '没有时间戳' });
  assert.equal(root.children.length, 1);
  assert.equal(scheduled[0].delay, 500);
});

test('fixed danmaku overlay derives its label from Bilibili live status', async () => {
  const module = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'),
    {
      document: { addEventListener() {} },
      location: { search: '', protocol: 'http:', host: '127.0.0.1:3000' },
      URL,
      URLSearchParams,
    },
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
