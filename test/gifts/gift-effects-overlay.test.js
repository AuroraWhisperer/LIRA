'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readAdminHtml } = require('../helpers/admin-html');

const ROOT_DIR = path.join(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function readOverlayModules() {
  return [read('public/js/overlays/gift-effects.js'), read('public/js/overlays/gift-effects-frame.js')].join('\n');
}

test('server exposes gift effect lookup and broadcasts finalized gift effects', () => {
  const serverSource = read('src/server.js');
  const transportSource = read('src/server/runtime-transport.js');
  const apiContextSource = read('src/server/api-context.js');
  const giftRoutesSource = read('src/server/routes/gift-routes.js');

  assert.match(serverSource, /giftEffectModule\.createGiftEffectResolver\(/);
  assert.match(transportSource, /buildGiftFrameEvent\([\s\S]*?item,[\s\S]*?getSettings\(\)/);
  assert.match(transportSource, /getWebSocketHub\(\)\?\.broadcast\(frameEvent\)/);
  assert.match(apiContextSource, /resolveEffect/);
  assert.match(apiContextSource, /previewEffect/);
  assert.match(giftRoutesSource, /GET \/api\/gifts\/effects\/resolve/);
  assert.match(giftRoutesSource, /POST \/api\/gifts\/effects\/preview/);
  assert.match(giftRoutesSource, /\^\\d\{1,12\}\$/);
});

test('gift effect preview resolves the gift and broadcasts to the fixed overlay url', async () => {
  const { routes } = require('../../src/server/routes/gift-routes');
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
  const { routes } = require('../../src/server/routes/gift-routes');
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
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const overlayJs = readOverlayModules();
  const playerJs = read('public/js/overlays/gift-effect-player.js');

  assert.equal(require('../../src/server/access-policy').getOverlayScope('/gift-effects'), 'gift-effects');
  assert.match(html, /meta name="referrer" content="no-referrer"/);
  assert.match(html, /id="giftEffectStage"/);
  assert.match(css, /\.gift-effects-overlay-body\s*\{[^}]*background:\s*transparent/);
  assert.match(overlayJs, /payload\.type === ["']gift:effect["']/);
  assert.match(overlayJs, /createGiftEffectPlayer\(/);
  assert.match(overlayJs, /effectPlayer\.enqueue\(payload\)/);
  assert.match(playerJs, /referrerPolicy\s*=\s*["']no-referrer["']/);
  assert.match(playerJs, /crossOrigin\s*=\s*["']anonymous["']/);
  assert.match(playerJs, /\['rgbRect', layout\.rgbFrame\]/);
  assert.match(playerJs, /\['alphaRect', layout\.alphaFrame\]/);
  assert.match(playerJs, /vec3 rgb = texture2D\(video, rgbRect\.xy \+ uv \* rgbRect\.zw\)\.rgb/);
  assert.match(playerJs, /float alpha = texture2D\(video, alphaRect\.xy \+ uv \* alphaRect\.zw\)\.r/);
  assert.match(playerJs, /gl_FragColor = vec4\(rgb, alpha\)/);
  assert.match(playerJs, /video\.videoWidth !== effect\.layout\.videoWidth/);
  assert.match(playerJs, /video\.videoHeight !== effect\.layout\.videoHeight/);
  assert.doesNotMatch(playerJs, /height \* 9 \/ 16|activeHeight|horizontalPadding/);
  assert.match(overlayJs, /PREVIEW_MODE/);
  assert.match(overlayJs, /visibilitychange/);
  assert.doesNotMatch(overlayJs, /innerHTML/);
  assert.doesNotMatch(css, /mix-blend-mode/);
});

test('effect 1 uses a transparent video and a separate two-line caption', () => {
  const html = read('public/pages/overlays/gift-effects.html');
  const css = read('public/css/overlays/gift-effects.css');
  const asset = path.join(ROOT_DIR, 'public/img/overlays/gift-frame/woodland-bloom/woodland-bloom-v4.webm');
  assert.ok(fs.statSync(asset).size > 0);
  const video = html.match(/<video\b(?=[^>]*\sid="giftFrameVideo")[^>]*>/)?.[0];
  assert.ok(video, 'effect 1 must keep its media element');
  assert.match(video, /\smuted(?:\s|=|>)/);
  assert.match(video, /\splaysinline(?:\s|=|>)/);
  assert.match(html, /感谢<\/span><strong id="giftInfoUser"/);
  assert.match(html, /送出<\/span><strong id="giftInfoName"/);
  assert.doesNotMatch(html, /particleStage|giftFrameAccents|giftInfoAmount|frame-composite\.webp/);
  assert.match(css, /width: 1920px;[\s\S]*?height: 1080px;[\s\S]*?scale\(var\(--frame-scale/);
});

test('toolbox includes a gift effect tab with lookup and preview controls', () => {
  const html = readAdminHtml();
  const indexSource = read('public/js/admin/app.js');
  const toolSource = read('public/js/admin/gift-effects.js');

  assert.match(html, /data-other-feature="otherGiftEffectsFeature"/);
  assert.match(html, /id="otherGiftEffectsFeature"[^>]+data-other-feature-panel/);
  assert.match(html, /<input\b(?=[^>]*\sid="giftEffectGiftId")(?=[^>]*\sinputmode="numeric")[^>]*>/);
  assert.match(html, /id="giftEffectOverlayUrl"/);
  assert.match(html, /id="giftEffectLookupBtn"/);
  assert.match(html, /id="giftEffectOpenBtn"/);
  assert.doesNotMatch(html, /BILIBILI FULL-SCREEN EFFECT|id="giftEffectLiveUrl"/);
  assert.match(indexSource, /import \{ giftEffects \} from ["']\.\/gift-effects\.js["'];/);
  assert.match(toolSource, /\/api\/gifts\/effects\/preview/);
  assert.doesNotMatch(toolSource, /\?giftId=/);
  assert.doesNotMatch(toolSource, /debug/);
  assert.match(toolSource, /window\.open\(`\$\{liveUrl\}\?preview=1`, ["']liraGiftEffectPreview["']\)/);
  assert.match(toolSource, /navigator\.clipboard\.writeText\(liveUrl\)/);
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
