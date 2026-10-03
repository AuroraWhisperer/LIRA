'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('fixed danmaku overlay consumes snapshot and incremental feed events safely', () => {
  const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'pages', 'overlays', 'danmaku.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'overlays', 'danmaku.js'), 'utf8');
  const styles = readCssBundle('public', 'css', 'overlays', 'danmaku.css').replace(/\s+/g, ' ');
  const server = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'runtime-transport.js'), 'utf8');

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
  assert.match(script, /payload\.state\.settings\.danmakuOverlayStyle/);
  assert.match(script, /danmakuFullscreenDurationSeconds/);
  assert.match(script, /options\.layout\s*=\s*'fullscreen-random'/);
  assert.match(script, /itemLifetimeMs/);
  assert.match(script, /payload\.state\.liveStatus/);
  assert.match(script, /topic=danmaku/);
  assert.match(script, /feed\.append/);
  assert.match(script, /requestAnimationFrame\(flushPendingItems\)/);
  assert.match(script, /autoScroll:\s*false/);
  assert.match(
    server,
    /getWebSocketHub\(\)\?\.broadcast\(\s*\{\s*type:\s*'danmaku:message',\s*item\s*\},\s*\{\s*topic:\s*'danmaku'\s*\},?\s*\)/,
  );
  assert.match(script, /document\.body\.dataset\.style/);
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
