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

test('server exposes gift effect lookup and broadcasts finalized gift effects', () => {
  const serverSource = read('src/server.js');
  const apiContextSource = read('src/server/api-context.js');
  const giftRoutesSource = read('src/server/routes/gift-routes.js');

  assert.match(serverSource, /createGiftEffectResolver\(/);
  assert.match(serverSource, /buildGiftEffectEvent\(item, giftEffectResolver\)/);
  assert.match(serverSource, /webSocketHub\.broadcast\(effectEvent\)/);
  assert.match(apiContextSource, /resolveEffect/);
  assert.match(giftRoutesSource, /GET \/api\/gifts\/effects\/resolve/);
  assert.match(giftRoutesSource, /\^\\d\{1,12\}\$/);
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
          ? { effectId: 584, mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4' }
          : null;
      }
    }
  };

  const invalid = await invokeRoute(handler, context, 'abc');
  assert.equal(invalid.status, 400);
  assert.deepEqual(calls, []);

  const found = await invokeRoute(handler, context, '31645');
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.data, {
    giftId: 31645,
    effect: { effectId: 584, mp4Url: 'https://i0.hdslb.com/bfs/live/effect.mp4' }
  });

  const missing = await invokeRoute(handler, context, '31643');
  assert.equal(missing.status, 404);
});

test('gift effects overlay is routed, referrer-safe and luma-keys MP4 frames', () => {
  const serverSource = read('src/server/http-utils.js');
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = read('public/js/overlays/gift-effects.js');

  assert.match(serverSource, /\['\/gift-effects', 'pages\/overlays\/gift-effects\.html'\]/);
  assert.match(html, /meta name="referrer" content="no-referrer"/);
  assert.match(html, /id="giftEffectStage"/);
  assert.match(css, /\.gift-effects-overlay-body\s*\{[^}]*background:\s*transparent/);
  assert.match(overlayJs, /payload\.type === 'gift:effect'/);
  assert.match(overlayJs, /\/api\/gifts\/effects\/resolve\?giftId=/);
  assert.match(overlayJs, /referrerPolicy\s*=\s*'no-referrer'/);
  assert.match(overlayJs, /crossOrigin\s*=\s*'anonymous'/);
  assert.match(overlayJs, /keyOutBlack/);
  assert.match(overlayJs, /Math\.max\(data\[i\], data\[i \+ 1\], data\[i \+ 2\]\)/);
  assert.match(overlayJs, /MAX_PLAYING/);
  assert.doesNotMatch(overlayJs, /innerHTML/);
  assert.doesNotMatch(css, /mix-blend-mode/);
});

test('toolbox includes a gift effect tab with lookup and preview controls', () => {
  const html = readAdminHtml();
  const indexSource = read('public/js/admin/index.js');
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(html, /data-other-feature="otherGiftEffectsFeature"[\s\S]*?<strong>礼物特效<\/strong>/);
  assert.match(html, /id="otherGiftEffectsFeature"[^>]+data-other-feature-panel/);
  assert.match(html, /id="giftEffectGiftId"[^>]+inputmode="numeric"/);
  assert.match(html, /id="giftEffectOverlayUrl"/);
  assert.match(html, /id="giftEffectLookupBtn"/);
  assert.match(html, /id="giftEffectOpenBtn"/);
  assert.match(indexSource, /import '\.\/gift-effects\.js';/);
  assert.match(styles, /\.gift-effect-tool-panel/);
});

test('gift effect API docs describe lookup, CDN rules and transparent composition', () => {
  const doc = read('docs/bilibili-live-api/gift-effect-config.md');

  assert.match(doc, /GetEffectConfListV2/);
  assert.match(doc, /bind_gift_ids/);
  assert.match(doc, /web_mp4/);
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
    }
  };
  await handler(context, { query: new URLSearchParams({ giftId }) }, response);
  return { status, body };
}
