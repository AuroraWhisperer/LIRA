'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { contentType } = require('../../src/server/http-utils');
const { addFrameProtectionHeaders } = require('../../src/server/page-assets');
const { getOpeningConfig } = require('../../src/server/opening-service');
const settingsRoutes = require('../../src/server/routes/settings-routes');
const { closeDatabases, createDatabases } = require('../../src/storage/database');
const settingsStoreModule = require('../../src/storage/settings-store');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { DEFAULT_SETTINGS } = settingsStoreModule;

const ROOT_DIR = path.join(__dirname, '../..');

test('opening samples stay outside public assets and the overlay route remains registered', () => {
  for (const name of ['music.ogg', 'avatar.webp', 'opening-character.png']) {
    assert.equal(fs.existsSync(path.join(ROOT_DIR, 'public/img/overlays/opening', name)), false);
  }
  assert.equal(require('../../src/server/access-policy').getOverlayScope('/opening'), 'opening');
  assert.equal(contentType(path.join(ROOT_DIR, 'test/fixtures/opening/music.ogg')), 'audio/ogg');
});

test('opening overlay is a sandboxed frameable page', () => {
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
});

test('opening settings keep payload names, legacy fallbacks and unsaved form drafts', async () => {
  const { openingSettingsPayload } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/start-animation.js'));
  assert.equal(openingSettingsPayload({ style: 'classic', trackMotion: 'barber' }).openingTrackMotion, 'barber');
  assert.equal(
    getOpeningConfig({
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
    getOpeningConfig({
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
    getOpeningConfig({
      settings: {
        get() {
          return { openingTrackMotion: 'sparkle' };
        },
      },
      system: { dataDir: os.tmpdir() },
    }).trackMotion,
    'heart',
  );
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
      const config = getOpeningConfig({
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
  assert.equal(responsePayload.ok, false);
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
    const firstSession = settingsStoreModule.bootstrapSettingsStore(databases.songDb);
    firstSession.setSetting('openingEnabled', 'true');

    const nextSession = settingsStoreModule.bootstrapSettingsStore(databases.songDb);
    assert.equal(nextSession.getSettings().openingEnabled, 'false');
  } finally {
    closeDatabases(databases);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
