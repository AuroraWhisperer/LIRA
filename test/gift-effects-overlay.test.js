'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('./helpers/admin-html');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readOverlayModules() {
  return [
    read('public/js/overlays/gift-effects.js'),
    read('public/js/overlays/gift-effects-frame.js'),
  ].join('\n');
}

test('server exposes gift effect lookup and broadcasts finalized gift effects', () => {
  const serverSource = read('src/server.js');
  const apiContextSource = read('src/server/api-context.js');
  const giftRoutesSource = read('src/server/routes/gift-routes.js');

  assert.match(serverSource, /giftEffectModule\.createGiftEffectResolver\(/);
  assert.match(
    serverSource,
    /giftFrameModule\.buildGiftFrameEvent\([\s\S]*?item,[\s\S]*?settingsStore\.getSettings\(\)/,
  );
  assert.match(serverSource, /webSocketHub\.broadcast\(frameEvent\)/);
  assert.match(apiContextSource, /resolveEffect/);
  assert.match(apiContextSource, /previewEffect/);
  assert.match(giftRoutesSource, /GET \/api\/gifts\/effects\/resolve/);
  assert.match(giftRoutesSource, /POST \/api\/gifts\/effects\/preview/);
  assert.match(giftRoutesSource, /\^\\d\{1,12\}\$/);
});

test('gift effect preview resolves the gift and broadcasts to the fixed overlay url', async () => {
  const { routes } = require('../src/server/routes/gift-routes');
  const handler = routes['POST /api/gifts/effects/preview'];
  const broadcasts = [];
  const context = {
    gifts: {
      async resolveEffect(giftId) {
        return giftId === 33909
          ? {
              effectId: 1466,
              mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
            }
          : null;
      },
      previewEffect(payload) {
        broadcasts.push(payload);
      },
    },
  };

  const found = await invokeBodyRoute(handler, context, { giftId: '33909' });
  assert.equal(found.status, 200);
  assert.deepEqual(broadcasts, [
    {
      type: 'gift:effect',
      eventId: 0,
      giftId: 33909,
      effect: {
        effectId: 1466,
        mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
      },
      preview: true,
    },
  ]);

  const invalid = await invokeBodyRoute(handler, context, { giftId: 'abc' });
  assert.equal(invalid.status, 400);
  assert.equal(broadcasts.length, 1);
});

test('gift effect lookup validates ids and returns only resolved effect data', async () => {
  const { routes } = require('../src/server/routes/gift-routes');
  const handler = routes['GET /api/gifts/effects/resolve'];
  const calls = [];
  const context = {
    gifts: {
      async resolveEffect(giftId) {
        calls.push(giftId);
        return giftId === 31645
          ? {
              effectId: 584,
              mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
            }
          : null;
      },
    },
  };

  const invalid = await invokeRoute(handler, context, 'abc');
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, []);

  const found = await invokeRoute(handler, context, '31645');
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.data, {
    giftId: 31645,
    effect: {
      effectId: 584,
      mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4',
    },
  });

  const missing = await invokeRoute(handler, context, '31643');
  assert.equal(missing.status, 404);
});

test('gift effects overlay uses official frame metadata without cropping or inverting packed alpha', () => {
  const serverSource = read('src/server/http-utils.js');
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = readOverlayModules();

  assert.match(
    serverSource,
    /\[["']\/gift-effects["'], ["']pages\/overlays\/gift-effects\.html["']\]/,
  );
  assert.match(html, /meta name="referrer" content="no-referrer"/);
  assert.match(html, /id="giftEffectStage"/);
  assert.match(
    css,
    /\.gift-effects-overlay-body\s*\{[^}]*background:\s*transparent/,
  );
  assert.match(overlayJs, /payload\.type === ["']gift:effect["']/);
  assert.match(overlayJs, /referrerPolicy\s*=\s*["']no-referrer["']/);
  assert.match(overlayJs, /crossOrigin\s*=\s*["']anonymous["']/);
  assert.match(overlayJs, /keyOutBlack/);
  assert.match(overlayJs, /applyAlphaMask/);
  assert.match(overlayJs, /frame\.data\[i \+ 3\] = mask\[i\]/);
  assert.match(overlayJs, /layout\.rgbFrame/);
  assert.match(overlayJs, /layout\.alphaFrame/);
  assert.match(
    overlayJs,
    /source\.colorX,[\s\S]*?source\.colorY,[\s\S]*?source\.colorWidth,[\s\S]*?source\.colorHeight/,
  );
  assert.match(
    overlayJs,
    /source\.maskX,[\s\S]*?source\.maskY,[\s\S]*?source\.maskWidth,[\s\S]*?source\.maskHeight/,
  );
  assert.match(
    overlayJs,
    /videoWidth !== width \|\|[\s\S]*?layout\.videoHeight !== height/,
  );
  assert.match(overlayJs, /containRect/);
  assert.match(
    overlayJs,
    /Math\.max\(data\[i\], data\[i \+ 1\], data\[i \+ 2\]\)/,
  );
  assert.doesNotMatch(
    overlayJs,
    /height \* 9 \/ 16|activeHeight|horizontalPadding/,
  );
  assert.doesNotMatch(overlayJs, /255 - Math\.max\(mask/);
  assert.match(overlayJs, /MAX_PLAYING/);
  assert.match(overlayJs, /const MAX_PLAYING = 1/);
  assert.match(overlayJs, /const MAX_PENDING = 10/);
  assert.match(overlayJs, /PREVIEW_MODE/);
  assert.match(overlayJs, /visibilitychange/);
  assert.match(overlayJs, /if \(pending\.length >= MAX_PENDING\) return/);
  assert.match(overlayJs, /playNextEffect\(\)/);
  assert.doesNotMatch(overlayJs, /innerHTML/);
  assert.doesNotMatch(css, /mix-blend-mode/);
});

test('gift frame overlay uses one full-perimeter artwork and bounded perimeter fireflies', () => {
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = readOverlayModules();
  const assetDir = path.join(
    ROOT_DIR,
    'public',
    'img',
    'overlays',
    'gift-frame',
    'woodland-bloom',
  );

  assert.equal(
    fs.statSync(path.join(assetDir, 'frame-composite.webp')).isFile(),
    true,
  );
  assert.match(
    html,
    /id="giftFrameArtworkImage"[^>]+data-frame-part="composite"[^>]+frame-composite\.webp/,
  );
  assert.doesNotMatch(html, /data-frame-part="(?:top|right|bottom|left)"/);
  assert.doesNotMatch(html, /id="giftFrameSvg"/);
  assert.match(css, /\.gift-frame-composite\s*\{[^}]*object-fit:\s*fill/s);
  assert.match(overlayJs, /const FIREFLY_LIMIT = 6/);
  assert.match(overlayJs, /const FRAME_PERIMETER_ANCHORS/);
  assert.match(overlayJs, /motionMode !== ["']reduced["']/);
  assert.match(overlayJs, /getElementById\(["']giftFrameArtworkImage["']\)/);
  assert.doesNotMatch(overlayJs, /use-composite-fallback/);
  assert.doesNotMatch(overlayJs, /innerHTML/);
});

test('gift frame caption stays anchored inside the responsive bottom plate', () => {
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = readOverlayModules();

  assert.match(
    css,
    /\.gift-info\s*\{[^}]*top:\s*89\.7%[^}]*width:\s*31vw[^}]*height:\s*7\.6vh/s,
  );
  assert.match(
    css,
    /\.gift-info-primary\s*\{[^}]*font-size:\s*min\(1\.34vw, 2\.38vh\)/s,
  );
  assert.match(
    css,
    /\.gift-info-secondary\s*\{[^}]*font-size:\s*min\(0?\.75vw, 1\.33vh\)/s,
  );
  assert.doesNotMatch(css, /\.gift-info\s*\{[^}]*min-width/s);
  assert.doesNotMatch(
    overlayJs,
    /translate\(-50%, calc\(-50% \+ (?:10|12)px\)\)/,
  );
});

test('gift frame accents remain separate, bounded, and reduced-motion safe', () => {
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = readOverlayModules();
  const assetDir = path.join(
    ROOT_DIR,
    'public',
    'img',
    'overlays',
    'gift-frame',
    'woodland-bloom',
  );
  const accents = {
    branch: 'accent-branch-sprig.webp',
    crystal: 'accent-crystal-charm.webp',
    floral: 'accent-floral-knot.webp',
  };

  for (const [accent, fileName] of Object.entries(accents)) {
    const assetPath = path.join(assetDir, fileName);
    assert.equal(fs.statSync(assetPath).isFile(), true);
    const header = fs.readFileSync(assetPath);
    assert.equal(header.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(header.subarray(8, 12).toString('ascii'), 'WEBP');
    assert.equal(header.subarray(12, 16).toString('ascii'), 'VP8L');
    assert.ok(header.readUInt32LE(21) & (1 << 28), `${fileName} must retain alpha`);
    assert.match(
      html,
      new RegExp(
        `data-frame-accent="${accent}"[^>]+${fileName.replace('.', '\\.')}`,
      ),
    );
  }

  assert.match(css, /\.gift-frame-accents/);
  assert.match(css, /\.gift-frame-accent-branch/);
  assert.match(css, /\.gift-frame-accent-crystal/);
  assert.match(css, /\.gift-frame-accent-floral/);
  assert.match(overlayJs, /playHoldingAccents\(session, motionMode\)/);
  assert.match(
    overlayJs,
    /playHoldingAccents[\s\S]{0,500}motionMode === ["']reduced["']/,
  );
  assert.doesNotMatch(overlayJs, /iterations:\s*Infinity/);
  assert.doesNotMatch(css, /\.gift-frame-accent[^}]*animation[^;]*infinite/s);
  assert.doesNotMatch(overlayJs, /innerHTML/);
});

test('toolbox includes a gift effect tab with lookup and preview controls', () => {
  const html = readAdminHtml();
  const indexSource = read('public/js/admin/index.js');
  const toolSource = read('public/js/admin/gift-effects.js');
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(
    html,
    /data-other-feature="otherGiftEffectsFeature"[\s\S]*?<strong>礼物特效<\/strong>/,
  );
  assert.match(
    html,
    /id="otherGiftEffectsFeature"[^>]+data-other-feature-panel/,
  );
  assert.match(html, /id="giftEffectGiftId"[^>]+inputmode="numeric"/);
  assert.match(html, /id="giftEffectOverlayUrl"/);
  assert.match(html, /id="giftEffectLookupBtn"/);
  assert.match(html, /id="giftEffectOpenBtn"/);
  assert.match(html, />测试播放</);
  assert.match(html, />直播投屏</);
  assert.doesNotMatch(
    html,
    /BILIBILI FULL-SCREEN EFFECT|id="giftEffectLiveUrl"/,
  );
  assert.match(indexSource, /import ["']\.\/gift-effects\.js["'];/);
  assert.match(toolSource, /\/api\/gifts\/effects\/preview/);
  assert.doesNotMatch(toolSource, /\?giftId=/);
  assert.doesNotMatch(toolSource, /debug/);
  assert.match(
    toolSource,
    /window\.open\(`\$\{liveUrl\}\?preview=1`, ["']liraGiftEffectPreview["']\)/,
  );
  assert.match(toolSource, /navigator\.clipboard\.writeText\(liveUrl\)/);
  assert.match(styles, /\.gift-effect-tool-panel/);
  assert.match(
    styles,
    /\.gift-effect-url-block code\s*\{[^}]*min-height:\s*36px[^}]*padding:\s*7px 10px/,
  );
});

test('gift effect API docs describe lookup, CDN rules and transparent composition', () => {
  const doc = read('docs/bilibili-live-api/gift-effect-config.md');

  assert.match(doc, /GetEffectConfListV2/);
  assert.match(doc, /bind_gift_ids/);
  assert.match(doc, /web_mp4/);
  assert.match(doc, /web_mp4_json/);
  assert.match(doc, /rgbFrame/);
  assert.match(doc, /aFrame/);
  assert.match(doc, /白色不透明、黑色透明/);
  assert.match(doc, /no-referrer/);
  assert.match(doc, /alpha = max\(r, g, b\)/);
});

async function invokeRoute(handler, context, giftId) {
  let status = 0;
  let body = null;
  const response = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(content) {
      body = JSON.parse(content);
    },
  };
  await handler(context, { query: new URLSearchParams({ giftId }) }, response);
  return { status, body };
}

async function invokeBodyRoute(handler, context, body) {
  let status = 0;
  let responseBody = null;
  const response = {
    writeHead(nextStatus) {
      status = nextStatus;
    },
    end(content) {
      responseBody = JSON.parse(content);
    },
  };
  await handler(context, { body: async () => body }, response);
  return { status, body: responseBody };
}
