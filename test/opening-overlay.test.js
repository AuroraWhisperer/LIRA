'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const test = require('node:test');
const { addFrameProtectionHeaders, contentType } = require('../src/server/http-utils');
const openingRoutes = require('../src/server/routes/opening-routes');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');

const ROOT_DIR = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('opening overlay assets and explicit route are registered', () => {
  const musicPath = path.join(ROOT_DIR, 'public/img/overlays/opening/music.ogg');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/pages/overlays/opening.html')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/css/overlays/opening.css')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/js/overlays/opening.js')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/img/overlays/opening/avatar.webp')));
  assert.ok(fs.existsSync(musicPath));
  assert.ok(fs.statSync(musicPath).size > 100_000);
  assert.equal(fs.readFileSync(musicPath).subarray(0, 4).toString('ascii'), 'OggS');
  const server = read('src', 'server', 'http-utils.js');
  assert.match(server, /\['\/opening',\s*'pages\/overlays\/opening\.html'\]/);
  assert.match(server, /'\.ogg':\s*'audio\/ogg'/);
  assert.equal(contentType(path.join(ROOT_DIR, 'public/img/overlays/opening/music.ogg')), 'audio/ogg');
});

test('opening overlay is frameable and keeps the required character transform layers', () => {
  const headers = new Map();
  addFrameProtectionHeaders({ setHeader(name, value) { headers.set(name, value); } }, '/opening');
  assert.equal(headers.has('Content-Security-Policy'), false);
  assert.equal(headers.has('X-Frame-Options'), false);

  const html = read('public', 'pages', 'overlays', 'opening.html');
  assert.match(html, /<html[^>]+class="opening-disabled"/);
  assert.match(html, /<body[^>]+class="opening-disabled"/);
  assert.match(html, /class="opening-viewport opening-disabled"/);
  assert.match(html, /class="opening-stage is-disabled"/);
  for (const className of ['character-anchor', 'character-enter', 'character-float', 'character-sway', 'character-breathe', 'character-image']) {
    assert.match(html, new RegExp(`class="[^"]*${className}[^"]*"`));
  }
  assert.match(html, /class="track-waveform"/);
  assert.match(html, /id="openingTrackPath"/);
  assert.match(html, /<animateMotion[^>]+repeatCount="indefinite"/);
  assert.match(html, /<mpath href="#openingTrackPath"/);
  assert.match(html, /<audio id="openingAudio" loop preload="metadata"><\/audio>/);
  assert.doesNotMatch(html, /id="openingAudio"[^>]+autoplay/);
  assert.doesNotMatch(html, /id="openingAudio"[^>]+src=/);
  assert.doesNotMatch(html, /SINGING LIVE/);
  assert.match(html, /class="opening-eyebrow">歌声即将开始<\/span>/);
  assert.match(html, /id="openingFooter"[^>]*>欢迎来到直播间<\/p>/);
  assert.doesNotMatch(html, /<span class="track-heart"/);
  assert.doesNotMatch(html, />@<\/span>/);
  assert.doesNotMatch(html, /track-flow/);
});

test('opening overlay animation honors quality, motion, visibility, and safe text rendering', () => {
  const css = read('public', 'css', 'overlays', 'opening.css');
  const script = read('public', 'js', 'overlays', 'opening.js');
  assert.match(css, /background-color:\s*var\(--opening-night\)/);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /width:\s*min\(100vw,\s*177\.7778vh\)/);
  assert.match(css, /height:\s*min\(100vh,\s*56\.25vw\)/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /font-size:\s*var\(--opening-title-size(?:,[^)]+)?\)/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /cqw/);
  assert.match(css, /\.track::before/);
  assert.match(css, /\.track-heart-motion/);
  assert.match(css, /translate3d\(/);
  assert.match(css, /\.opening-stage\.is-disabled[^\n]*display:\s*none/);
  assert.match(css, /\.opening-stage\.is-disabled[^\n]*animation:\s*none/);
  assert.match(css, /html\.opening-disabled,\s*body\.opening-disabled[^\{]*\{[^}]*background:\s*transparent\s*!important/);
  assert.match(css, /\.opening-viewport\.opening-disabled/);
  assert.doesNotMatch(css, /background-position/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /prefers-reduced-motion/);
  assert.match(script, /Array\.from/);
  assert.match(script, /textContent/);
  assert.match(script, /QUALITY_LIMITS/);
  assert.match(script, /titleSizeForLength/);
  assert.match(script, /title:\s*'唱一首，在一首，给你的歌'/);
  assert.match(script, /MAX_LENGTHS = Object\.freeze\(\{ title: 20/);
  assert.match(script, /name:\s*''/);
  assert.match(script, /audio:\s*'browser'/);
  assert.match(script, /openingNameRow/);
  assert.match(script, /audio === 'browser'/);
  assert.match(script, /stage\.classList\.add\('is-disabled',\s*'is-paused'\)/);
  assert.match(script, /audio\.removeAttribute\('src'\)/);
  assert.match(script, /console\.warn/);
});

test('Toolbox opening animation persists configuration and keeps a fixed source URL', () => {
  const html = read('public', 'pages', 'admin', 'toolbox', 'start-animation.html');
  const script = read('public', 'js', 'admin', 'start-animation.js');
  const overlayScript = read('public', 'js', 'overlays', 'opening.js');
  const openingRoutesSource = read('src', 'server', 'routes', 'opening-routes.js');
  const formsScript = read('public', 'js', 'admin', 'forms.js');
  const styles = read('public', 'css', 'admin', 'other-features', 'start-animation.css');
  assert.match(html, /class="[^"]*other-feature-panel-body[^"]*opening-animation-panel/);
  assert.match(html, /id="openingEnabled"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="openingEnabled"[^>]+checked/);
  assert.match(html, /id="openingPreview"[^>]+hidden/);
  assert.doesNotMatch(html, /STARTING SOON/);
  assert.doesNotMatch(html, /SINGING LIVE/);
  assert.doesNotMatch(html, /关闭总开关后，Browser Source 会变透明/);
  assert.doesNotMatch(html, /URL 即时预览/);
  assert.match(html, /<span>开场文案<\/span>/);
  assert.match(html, /<strong>设置开播画面上的文字<\/strong>/);
  assert.match(html, /class="opening-switch-label">漂浮音符<\/span>/);
  assert.match(html, /class="opening-switch-label">音乐律动<\/span>/);
  for (const id of ['openingTitle', 'openingTitleCount', 'openingSubtitle', 'openingName', 'openingFooter', 'openingQuality', 'openingShowNotes', 'openingShowEq', 'openingAudioFile', 'openingAudioVolume', 'openingUrl', 'openingPreview']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="openingTitle"[^>]+value="唱一首，在一首，给你的歌"/);
  assert.match(html, /id="openingTitle"[^>]+maxlength="20"/);
  assert.match(html, /id="openingName"[^>]+value=""/);
  assert.match(script, /URLSearchParams/);
  assert.match(script, /localOverlayOrigin/);
  assert.match(script, /params\.set\('enabled'/);
  assert.match(script, /params\.set\('audio',\s*'browser'\)/);
  assert.match(script, /buildOpeningSourceUrl/);
  assert.match(script, /openingAudioVolume/);
  assert.match(script, /OPENING_AUDIO_ENDPOINT/);
  assert.match(script, /openingSettingsPayload/);
  assert.match(script, /about:blank/);
  assert.match(script, /enabled:\s*false/);
  assert.match(script, /getElementById\('openingEnabled'\)\?\.addEventListener\('change'/);
  assert.match(script, /volumePercent/);
  assert.doesNotMatch(script, /固定地址刷新后会读取最新设置/);
  assert.match(overlayScript, /enabled:\s*false/);
  assert.match(openingRoutesSource, /parseBoolean\(settings\.openingEnabled,\s*false\)/);
  assert.equal(DEFAULT_SETTINGS.openingEnabled, 'false');
  assert.equal(DEFAULT_SETTINGS.openingFooter, '欢迎来到直播间');
  assert.equal(openingRoutes.getOpeningConfig({
    settings: { get() { return { openingFooter: 'SINGING LIVE' }; } },
    system: { dataDir: os.tmpdir() }
  }).footer, '欢迎来到直播间');
  assert.match(script, /openingTitleCount/);
  assert.match(script, /Array\.from\(config\.title\)\.length}\/20/);
  assert.doesNotMatch(script, /localStorage/);
  assert.match(styles, /aspect-ratio:\s*16 \/ 9/);
  assert.match(styles, /overflow-y:\s*auto/);
  assert.match(styles, /opening-editor-checks input:checked \+ \.opening-switch-ui/);
  assert.match(formsScript, /element\?\.closest\('#openingAnimationForm'\)/);
  assert.match(read('public', 'js', 'admin', 'app.js'), /initStartAnimation\(\)/);
});

test('opening music uploads stay inside the configured data directory', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-opening-test-'));
  const settings = {
    values: {
      openingEnabled: 'true', openingTitle: '', openingSubtitle: '', openingName: '', openingFooter: '',
      openingQuality: 'normal', openingShowNotes: 'true', openingShowEq: 'true',
      openingAudioFile: '', openingAudioName: '', openingAudioVolume: '0.35'
    },
    get() { return { ...this.values }; },
    set(key, value) { this.values[key] = value; }
  };
  const context = { system: { dataDir }, settings, broadcastSnapshot() {} };
  const boundary = 'opening-test-boundary';
  const crlf = '\r\n';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="custom.mp3"${crlf}Content-Type: audio/mpeg${crlf}${crlf}`),
    Buffer.from('audio bytes'),
    Buffer.from(`${crlf}--${boundary}--${crlf}`)
  ]);
  const request = Readable.from([body]);
  request.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  let responsePayload = null;
  const response = {
    writeHead(status) { this.status = status; },
    end(value) { responsePayload = JSON.parse(value); }
  };

  try {
    await openingRoutes.routes['POST /api/opening/music'](context, { req: request }, response);
    assert.equal(response.status, 200);
    assert.equal(responsePayload.ok, true);
    assert.equal(responsePayload.data.audioName, 'custom.mp3');
    const files = fs.readdirSync(openingRoutes.getMusicDir(dataDir));
    assert.equal(files.length, 1);
    assert.match(files[0], /^opening-.*\.mp3$/);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
