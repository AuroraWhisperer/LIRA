'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('../helpers/css-bundle');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { addFrameProtectionHeaders, contentType } = require('../../src/server/http-utils');
const { prepareSettingsBootstrap } = require('../../src/server/settings-bootstrap');
const openingRoutes = require('../../src/server/routes/opening-routes');
const settingsRoutes = require('../../src/server/routes/settings-routes');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const settingsStoreModule = require('../../src/storage/settings-store');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { DEFAULT_SETTINGS } = settingsStoreModule;

const ROOT_DIR = path.join(__dirname, '../..');
const read = (...parts) => fs.readFileSync(path.join(ROOT_DIR, ...parts), 'utf8');

test('opening samples stay outside public assets and the overlay route remains registered', () => {
  const musicPath = path.join(ROOT_DIR, 'test/fixtures/opening/music.ogg');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/pages/overlays/opening.html')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/css/overlays/opening.css')));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, 'public/js/overlays/opening.js')));
  assert.ok(fs.statSync(musicPath).size > 100_000);
  assert.equal(fs.readFileSync(musicPath).subarray(0, 4).toString('ascii'), 'OggS');
  for (const name of ['music.ogg', 'avatar.webp', 'opening-character.png']) {
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'test/fixtures/opening', name)));
    assert.equal(fs.existsSync(path.join(ROOT_DIR, 'public/img/overlays/opening', name)), false);
  }
  const serverRuntime = [read('src', 'server.js'), read('src', 'server', 'http-server.js')].join('\n');
  assert.equal(require('../../src/server/access-policy').getOverlayScope('/opening'), 'opening');
  assert.equal(contentType(musicPath), 'audio/ogg');
  assert.match(serverRuntime, /requestUrl\.pathname\.startsWith\('\/opening-character\/'\)/);
  assert.match(serverRuntime, /serveOpeningCharacter/);
});

test('opening overlay is frameable and starts with disabled media', () => {
  const headers = new Map();
  addFrameProtectionHeaders(
    {
      setHeader(name, value) {
        headers.set(name, value);
      },
    },
    '/opening',
  );
  assert.equal(headers.get('Content-Security-Policy'), 'sandbox allow-scripts');
  assert.equal(headers.has('X-Frame-Options'), false);

  const html = read('public', 'pages', 'overlays', 'opening.html');
  assert.match(html, /<html[^>]+class="opening-disabled"/);
  assert.match(html, /<body[^>]+class="opening-disabled"/);
  assert.match(html, /class="opening-viewport opening-disabled"/);
  assert.match(html, /class="opening-stage is-disabled"/);
  const audio = html.match(/<audio\b(?=[^>]*\sid="openingAudio")[^>]*>/)?.[0];
  assert.ok(audio, 'opening audio element must be present');
  assert.match(audio, /\sloop(?:\s|=|>)/);
  assert.match(audio, /\spreload="metadata"/);
  assert.doesNotMatch(audio, /\s(?:autoplay|src)(?:\s|=|>)/);
  const avatar = html.match(/<img\b(?=[^>]*\sid="openingAvatar")[^>]*>/)?.[0];
  assert.ok(avatar, 'opening character element must be present');
  assert.match(avatar, /\shidden(?:\s|=|>)/);
  assert.doesNotMatch(avatar, /\ssrc\s*=/);
});

test('opening overlay keeps canvas, disabled, reduced-motion and safe text constraints', () => {
  const css = readCssBundle('public', 'css', 'overlays', 'opening.css');
  const script = read('public', 'js', 'overlays', 'opening.js');
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /container-type:\s*size/);
  assert.match(css, /width:\s*min\(100vw,\s*177\.7778vh\)/);
  assert.match(css, /height:\s*min\(100vh,\s*56\.25vw\)/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /font-size:\s*var\(--opening-title-size(?:,[^)]+)?\)/);
  assert.match(css, /white-space:\s*normal/);
  assert.match(css, /cqw/);
  assert.match(css, /\[data-track-motion='barber'\][^\{]*\.track-barber/);
  assert.match(css, /\[data-track-motion='progress'\][^\{]*\.track-progress/);
  assert.match(css, /\.opening-stage\.is-reduced-motion[^\{]*\.track-barber/);
  assert.match(css, /\.opening-stage\.quality-low[^\{]*\.track-progress/);
  assert.match(css, /\.opening-stage\.is-paused\s+\*::before/);
  assert.match(css, /\.opening-stage\.is-reduced-motion\s+\.character-float[^\{]*\{[^}]*transform:\s*none/);
  assert.match(css, /\.opening-stage\.is-reduced-motion\s+\.opening-glow[^\{]*\{[^}]*animation:\s*none/);
  assert.match(css, /\.opening-stage\.is-disabled\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.opening-stage\.is-disabled\s*\{[^}]*animation:\s*none/);
  assert.match(
    css,
    /html\.opening-disabled,\s*body\.opening-disabled[^\{]*\{[^}]*background:\s*transparent\s*!important/,
  );
  assert.match(css, /\.opening-viewport\.opening-disabled/);
  assert.match(script, /textContent/);
  assert.match(css, /\.character-image\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(script, /audio:\s*'browser'/);
  assert.match(script, /openingNameRow/);
  assert.match(script, /audio === 'browser'/);
});

test('Toolbox opening controls preserve media defaults and the settings boundary', async () => {
  const html = read('public', 'pages', 'admin', 'toolbox', 'start-animation.html');
  const script = read('public', 'js', 'admin', 'start-animation.js');
  const styles = read('public', 'css', 'admin', 'toolbox', 'start-animation.css');
  assert.match(html, /id="openingEnabled"[^>]*type="checkbox"/);
  assert.doesNotMatch(html, /id="openingEnabled"[^>]+checked/);
  assert.match(html, /id="openingPreviewBtn"[^>]+disabled/);
  for (const id of [
    'openingTitle',
    'openingTitleCount',
    'openingSubtitle',
    'openingName',
    'openingFooter',
    'openingQuality',
    'openingTrackMotion',
    'openingShowNotes',
    'openingShowEq',
    'openingCharacterFile',
    'openingCharacterName',
    'openingResetCharacter',
    'openingAudioFile',
    'openingAudioVolume',
    'openingUrl',
    'openingPreviewBtn',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<select\b[^>]*\sid="openingTrackMotion"[^>]*>[\s\S]*?<option\b(?=[^>]*\svalue="heart")(?=[^>]*\sselected(?:\s|>))[^>]*>/);
  assert.match(html, /<option\b[^>]*\svalue="barber"/);
  assert.match(html, /<option\b[^>]*\svalue="progress"/);
  assert.match(html, /id="openingTitle"[^>]+maxlength="20"/);
  assert.match(html, /id="openingName"[^>]+value=""/);
  assert.match(script, /OPENING_AUDIO_ENDPOINT/);
  assert.match(script, /MAX_CHARACTER_UPLOAD_BYTES/);
  assert.match(script, /openingTrackMotion:\s*config\.trackMotion/);
  assert.equal(DEFAULT_SETTINGS.openingEnabled, 'false');
  assert.equal(DEFAULT_SETTINGS.openingFooter, '欢迎来到直播间');
  assert.equal(DEFAULT_SETTINGS.openingTrackMotion, 'heart');
  assert.equal(DEFAULT_SETTINGS.openingCharacterFile, '');
  assert.equal(DEFAULT_SETTINGS.openingCharacterName, '');
  assert.equal(DEFAULT_SETTINGS.openingPixelCharacterFile, '');
  assert.equal(DEFAULT_SETTINGS.openingPixelCharacterName, '');
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return { openingFooter: 'SINGING LIVE' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).footer,
    '欢迎来到直播间',
  );
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return { openingTrackMotion: 'barber' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).trackMotion,
    'barber',
  );
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return { openingTrackMotion: 'sparkle' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).trackMotion,
    'heart',
  );
  assert.equal(
    openingRoutes.getOpeningConfig({
      settings: {
        get() {
          return {};
        },
      },
      system: { dataDir: os.tmpdir() },
    }).characterUrl,
    '',
  );
  assert.match(script, /openingTitleCount/);
  assert.match(script, /Array\.from\(config\.title\)\.length}\/20/);
  assert.doesNotMatch(script, /localStorage/);
  assert.doesNotMatch(html, /<iframe/);
  assert.match(styles, /overflow-y:\s*auto/);
  const openingTitle = { value: '未保存的标题', dataset: {},
    closest: (selector) => selector.split(',').map((part) => part.trim()).includes('#openingAnimationForm') ? {} : null };
  const ordinarySetting = { value: '旧值', dataset: {}, closest: () => null };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/forms.js'), {
    document: {
      getElementById: (id) => ({ openingTitle, ordinarySetting })[id] || null,
      querySelectorAll: () => [],
      querySelector: () => null,
    },
  });
  new FormsService().fillForm({ openingTitle: '服务端旧标题', ordinarySetting: '服务端新值' });
  assert.equal(openingTitle.value, '未保存的标题');
  assert.equal(ordinarySetting.value, '服务端新值');
  assert.match(read('public', 'js', 'admin', 'app.js'), /module\.initStartAnimation/);
});

test('opening media defaults and missing uploads have no bundled fallback', async () => {
  const dataDir = createScratchDirectory('lira-opening-empty-');
  try {
    for (const values of [
      {},
      {
        openingAudioFile: 'missing.mp3',
        openingAudioName: 'old music',
        openingCharacterFile: 'missing.png',
        openingCharacterName: 'old image',
      },
    ]) {
      const config = openingRoutes.getOpeningConfig({
        system: { dataDir },
        settings: { get: () => values },
      });
      assert.equal(config.audioUrl, '');
      assert.equal(config.audioName, '');
      assert.equal(config.characterUrl, '');
      assert.equal(config.characterName, '');
      assert.equal(config.pixelCharacterUrl, '');
      assert.equal(config.pixelCharacterName, '');
      assert.equal(config.hasUploadedPixelCharacter, false);
      assert.equal(config.hasUploadedAudio, false);
      assert.equal(config.hasUploadedCharacter, false);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  const overlay = await import('../../public/js/overlays/opening.js');
  assert.equal(overlay.DEFAULTS.audioUrl, '');
  assert.equal(overlay.DEFAULTS.characterUrl, '');
  assert.equal(overlay.safeAudioUrl('/img/overlays/opening/music.ogg'), '');
  assert.equal(overlay.safeCharacterUrl('/img/overlays/opening/avatar.webp'), '');
  assert.equal(overlay.safeAudioUrl('/opening-media/custom.mp3'), '/opening-media/custom.mp3');
  assert.equal(overlay.safeCharacterUrl('/opening-character/custom.webp'), '/opening-character/custom.webp');
  assert.equal(overlay.safeAudioUrl('https://example.com/music.mp3'), '');
  assert.equal(overlay.safeCharacterUrl('https://example.com/image.png'), '');
});

test('opening track motion settings reject values outside the public enum', async () => {
  const writes = [];
  let configureCalls = 0;
  let broadcastReason = '';
  let responsePayload = null;
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      responsePayload = JSON.parse(value);
    },
  };
  const context = {
    settings: {
      defaults: DEFAULT_SETTINGS,
      setMany(values) {
        writes.push(...Object.entries(values));
        return Object.keys(values);
      },
    },
    bilibili: {
      configure() {
        configureCalls += 1;
      },
    },
    broadcastSnapshot(reason) {
      broadcastReason = reason;
    },
    system: {
      getState() {
        return { settings: {} };
      },
    },
  };

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return { openingTrackMotion: 'sparkle' };
      },
    },
    response,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(responsePayload, {
    ok: false,
    error: '设置 openingTrackMotion 的值无效。',
  });
  assert.deepEqual(writes, []);
  assert.equal(configureCalls, 0);

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return { openingTrackMotion: ' barber ' };
      },
    },
    response,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(writes, [['openingTrackMotion', 'barber']]);
  assert.equal(configureCalls, 1);
  assert.equal(broadcastReason, 'settings');
});

test('opening animation starts disabled for every application session', () => {
  const dataDir = createScratchDirectory('lira-opening-startup-');
  const databases = createDatabases({
    dataDir,
    defaultSettings: DEFAULT_SETTINGS,
  });

  try {
    const firstSession = prepareSettingsBootstrap(databases.songDb, settingsStoreModule).settingsStore;
    firstSession.setSetting('openingEnabled', 'true');

    const nextSession = prepareSettingsBootstrap(databases.songDb, settingsStoreModule).settingsStore;
    assert.equal(nextSession.getSettings().openingEnabled, 'false');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
