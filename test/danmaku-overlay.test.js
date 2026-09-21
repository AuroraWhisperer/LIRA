'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');
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
  const styles = readCssBundle(
    'public',
    'css',
    'overlays',
    'danmaku.css',
  ).replace(/\s+/g, ' ');
  const server = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'server', 'runtime-transport.js'),
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
    /getWebSocketHub\(\)\?\.broadcast\(\s*\{\s*type:\s*'danmaku:message',\s*item\s*\},\s*\{\s*topic:\s*'danmaku'\s*\},?\s*\)/,
  );
  assert.match(script, /document\.body\.dataset\.style/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(styles, /clip-path:/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /background:\s*transparent/);
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
    /body\.is-preview \{[^}]*repeating-conic-gradient\([^}]*rgba\(248, 251, 255, 0?\.84\)[^}]*rgba\(229, 239, 248, 0?\.72\)/s,
  );
  assert.match(
    styles,
    /html:has\(body\.is-preview\) \{ color-scheme: light; \}/,
  );
  assert.doesNotMatch(
    styles,
    /body\.is-preview\[data-style='[^']+'\] \{[^}]*background:/,
  );
  assert.match(
    styles,
    /\.draw-danmaku-feed \{[^}]*align-items:\s*flex-start;/s,
  );
  assert.match(
    styles,
    /\.draw-danmaku-item \{[^}]*width:\s*max-content;[^}]*min-width:\s*0;[^}]*max-width:\s*min\(100%, 660px\);/s,
  );
  assert.match(
    styles,
    /\.draw-danmaku-item \{ --signal-accent:[^}]*flex-shrink:\s*0;/,
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
  assert.doesNotMatch(
    styles,
    /body\[data-style='signal'\] \.draw-danmaku-medal-level \{[^}]*position:\s*absolute;/s,
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
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='captain'\] \{ --bubble-accent: var\(--guard-captain\);[^}]*bubble-captain-frame\.webp/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='admiral'\] \{ --bubble-accent: var\(--guard-admiral\);[^}]*bubble-admiral-frame\.webp/,
  );
  assert.match(
    styles,
    /body\[data-style='bubble'\] \.draw-danmaku-item\[data-identity='governor'\] \{ --bubble-accent: var\(--guard-governor\);[^}]*bubble-governor-frame\.webp/,
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
    /body\[data-style='minimal'\] \.draw-danmaku-feed \{\s*gap:\s*24px;\s*\}/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-body \{[^}]*display:\s*grid;[^}]*justify-self:\s*start;[^}]*gap:\s*0;[^}]*width:\s*min\(270px, 100%\);[^}]*text-align:\s*center;/s,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item \{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*flex-shrink:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item::after, body\[data-style='minimal'\] \.draw-danmaku-avatar, body\[data-style='minimal'\] \.draw-danmaku-badge \{ display:\s*none; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-identity \{[^}]*display:\s*grid;[^}]*justify-items:\s*center;[^}]*gap:\s*0;/s,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-identity::after \{[^}]*width:\s*100%;[^}]*margin:\s*-20px 0 -19px;[^}]*aspect-ratio:\s*3 \/ 1;[^}]*background:\s*url\('\/img\/overlays\/danmaku-guard\/bow-divider\.webp'\) center \/ contain no-repeat;/s,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-body p \{[^}]*justify-self:\s*center;[^}]*width:\s*90%;/s,
  );
  assert.match(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-identity strong \{[^}]*overflow-wrap:\s*anywhere;[^}]*white-space:\s*normal;/s,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='minimal'\] \.draw-danmaku-item(?:\[data-(?:identity|tone)|:is\()/,
  );
  assert.doesNotMatch(styles, /nameplate-(?:captain|admiral|governor)-divider/);
  assert.match(styles, /\.danmaku-signal-stage \{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*padding:\s*12px;/);
  assert.match(styles, /--ranked-bubble-max-width:\s*600px/);
  assert.match(styles, /--ranked-avatar-size:\s*68px/);
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-feed \{[^}]*zoom:\s*var\(--ranked-scale\);/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item \{[^}]*grid-template-columns:\s*var\(--ranked-avatar-size\) minmax\(0, 1fr\)[^}]*width:\s*max-content;[^}]*min-width:\s*0;[^}]*max-width:\s*var\(--ranked-bubble-max-width\)[^}]*background:\s*transparent;[^}]*clip-path:\s*none;/s,
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
    /body\[data-style='ranked'\] \.draw-danmaku-identity \{[^}]*display:\s*flex;[^}]*width:\s*max-content;[^}]*max-width:\s*100%;[^}]*border-radius:\s*999px 999px 999px 0;[^}]*background:\s*color-mix\(in srgb, var\(--ranked-accent\) 55%, black\)/s,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-guard,\s*body\[data-style='ranked'\] \.draw-danmaku-medal-name \{ display:\s*none;/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-body p \{[^}]*width:\s*max-content;[^}]*max-width:\s*100%;[^}]*border-radius:\s*5px 18px 18px 18px;[^}]*color:\s*#fff[^}]*font-size:\s*var\(--danmaku-font-size\)[^}]*background:[^;]*var\(--ranked-accent\)[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;[^}]*text-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0?\.34\)/s,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item \{[^}]*grid-template-areas:\s*'content avatar'/,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-avatar \{[^}]*mask-image:/s,
  );
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/viewer\.webp'\)/,
  );
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/captain\.webp'\)/,
  );
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/admiral\.webp'\)/,
  );
  assert.match(
    styles,
    /url\('\/img\/overlays\/danmaku-ranked\/governor\.webp'\)/,
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
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='captain'\],[^{]*\{ --ranked-accent: var\(--guard-captain\);/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='admiral'\],[^{]*\{ --ranked-accent: var\(--guard-admiral\);/,
  );
  assert.match(
    styles,
    /body\[data-style='ranked'\] \.draw-danmaku-item\[data-identity='governor'\],[^{]*\{ --ranked-accent: var\(--guard-governor\);/,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.danmaku-signal-header \{ display:\s*none; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-item \{[^}]*grid-template-columns:\s*58px minmax\(0, 1fr\);[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*clip-path:\s*none;/s,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-item\[data-identity='viewer'\],[^}]*body\[data-style='transparent'\] \.draw-danmaku-item\[data-identity='fan'\],[^}]*body\[data-style='transparent'\] \.draw-danmaku-item\[data-identity='captain'\],[^}]*body\[data-style='transparent'\] \.draw-danmaku-item\[data-identity='admiral'\],[^}]*body\[data-style='transparent'\] \.draw-danmaku-item\[data-identity='governor'\] \{[^}]*--danmaku-avatar-art:\s*url\('\/img\/overlays\/danmaku-ranked\/viewer\.webp'\);/s,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-identity \{ display:\s*contents; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-identity strong \{[^}]*grid-row:\s*1;/s,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-body p \{[^}]*grid-row:\s*2;/s,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-avatar\[data-medal-level\]::after \{[^}]*bottom:\s*-7px;[^}]*content:\s*'LV' attr\(data-medal-level\);/s,
  );
  assert.match(
    styles,
    /body\[data-style='transparent'\] \.draw-danmaku-guard, body\[data-style='transparent'\] \.draw-danmaku-medal \{ display:\s*none; \}/,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-item \{[^}]*position:\s*absolute;[^}]*border:\s*1px solid rgba\(99, 99, 102, 0?\.26\);[^}]*background:\s*rgba\(255, 255, 255, 0?\.94\)/s,
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
    /body\[data-style='outline'\] \.draw-danmaku-identity \{[^}]*justify-content:\s*flex-start;[^}]*max-width:/s,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-identity \{[^}]*position:\s*absolute;/s,
  );
  assert.match(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-body p \{[^}]*color:\s*#1d1d1f;[^}]*font-size:\s*var\(--danmaku-font-size\);[^}]*font-weight:\s*400;[^}]*text-align:\s*left;/s,
  );
  assert.doesNotMatch(
    styles,
    /body\[data-style='outline'\] \.draw-danmaku-item\[data-tone=/,
  );
  for (const identity of ['captain', 'admiral', 'governor']) {
    assert.ok(styles.includes(`body[data-style='outline'] .draw-danmaku-item[data-identity='${identity}']`));
  }
  assert.doesNotMatch(
    styles,
    /body\[data-style='outline'\][\s\S]*var\(--guard-/,
  );
  for (const asset of [
    'bubble-captain-frame.webp',
    'bubble-admiral-frame.webp',
    'bubble-governor-frame.webp',
    'bow-divider.webp',
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
});

test('identity cards preserve their sizing and guard colors beneath ordinary avatar backdrops', () => {
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public/css/overlays/danmaku/identity.css'),
    'utf8',
  );
  assert.match(styles, /--identity-card-width:\s*600px/);
  assert.match(styles, /--identity-card-min-height:\s*92px/);
  assert.match(styles, /grid-template-areas:\s*'content avatar'/);
  assert.match(styles, /zoom:\s*var\(--ranked-scale\)/);
  for (const [identity, color] of [
    ['viewer', 'rgba(52, 59, 69, 0.84)'],
    ['fan', 'rgba(52, 59, 69, 0.84)'],
    ['captain', 'rgba(24, 105, 171, 0.9)'],
    ['admiral', 'rgba(104, 48, 156, 0.9)'],
    ['governor', 'rgba(171, 37, 61, 0.92)'],
  ]) {
    const rule = styles.split(`[data-identity='${identity}']`)[1].split('}')[0];
    assert.ok(rule.includes(`--identity-surface: ${color}`));
  }
  assert.doesNotMatch(styles, /body\[data-style='ranked'\]/);
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
