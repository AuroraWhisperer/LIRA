'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT = path.join(__dirname, '../..');

test('license renderer keeps credentials and navigation inside the main-process boundary', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'license.js'), 'utf8');
  assert.match(script, /window\.liraLicense/);
  assert.doesNotMatch(script, /window\.location/);
  assert.doesNotMatch(script, /api\.lir[a-z]+hub\.cn/);
  assert.doesNotMatch(script, /localStorage/);
});

function controlElement() {
  const attributes = new Map();
  return {
    hidden: true,
    disabled: false,
    textContent: '',
    events: {},
    addEventListener(name, callback) {
      this.events[name] = callback;
    },
    removeAttribute(name) {
      attributes.delete(name);
      if (name === 'src') delete this.src;
    },
  };
}

for (const [label, previewUrl, rendered] of [
  ['an https preview', 'https://cdn.example.test/bg.png', true],
  ['an unsafe preview URL', 'javascript:alert(1)', false],
]) {
  test(`song background controls stay disabled until the initial response renders ${label}`, async () => {
    const ids = [
      'licenseSongBackground',
      'licenseSongBgPreview',
      'licenseSongBgEmpty',
      'licenseSongBgMeta',
      'licenseSongBgFile',
      'licenseSongBgPickBtn',
      'licenseSongBgDeleteBtn',
      'licenseSongBgResult',
    ];
    const elements = new Map(ids.map((id) => [id, controlElement()]));
    let finishInitial;
    const initial = new Promise((resolve) => {
      finishInitial = resolve;
    });
    const { initCloudSongBackground } = await loadModuleExports(
      path.join(ROOT, 'public', 'js', 'admin', 'song-background.js'),
      {
        URL: class extends URL {
          static createObjectURL() { return 'blob:background-preview'; }
          static revokeObjectURL() {}
        },
        AbortController,
        fetch: async () => new Response(new Blob(['image'], { type: 'image/png' })),
        document: { getElementById: (id) => elements.get(id) || null },
        window: {
          location: { href: 'http://127.0.0.1:3001/admin' },
          addEventListener() {},
          liraLicense: { getSongPageBackground: () => initial },
        },
      },
    );
    const controls = ['licenseSongBgFile', 'licenseSongBgPickBtn', 'licenseSongBgDeleteBtn'].map((id) =>
      elements.get(id),
    );
    const initialized = initCloudSongBackground();
    assert.deepEqual(
      controls.map((control) => control.disabled),
      [true, true, true],
    );
    finishInitial({ background: { previewUrl, bytes: 2048 } });
    await initialized;
    assert.deepEqual(
      controls.map((control) => control.disabled),
      [false, false, false],
    );
    const preview = elements.get('licenseSongBgPreview');
    assert.equal(preview.src, rendered ? 'blob:background-preview' : undefined);
    assert.equal(preview.hidden, !rendered);
    assert.equal(elements.get('licenseSongBgResult').textContent === '', rendered);
  });
}

for (const [label, profile, expected] of [
  ['profile names', { streamer: { accountName: '<b>mlbb</b>' }, device: { name: 'Studio PC' } }, ['<b>mlbb</b>', 'Studio PC']],
  ['an error response', { ok: false, error: 'LICENSE_NOT_AUTHORIZED' }, null],
]) {
  test(`account settings render ${label} as text from the license bridge`, async () => {
    const elements = new Map(
      ['licenseAccountDevice', 'licenseAccountName', 'licenseDeviceName'].map((id) => [id, controlElement()]),
    );
    const { initLicenseAccountDevice } = await loadModuleExports(
      path.join(ROOT, 'public', 'js', 'admin', 'settings-license.js'),
    );
    let requests = 0;
    await initLicenseAccountDevice({
      documentRef: { getElementById: (id) => elements.get(id) || null },
      licenseBridge: {
        getProfile: async () => {
          requests++;
          return profile;
        },
      },
    });
    assert.equal(requests, 1);
    assert.equal(elements.get('licenseAccountDevice').hidden, false);
    const rendered = [elements.get('licenseAccountName').textContent, elements.get('licenseDeviceName').textContent];
    if (expected) assert.deepEqual(rendered, expected);
    else assert.ok(rendered.every((text) => text && !text.includes('LICENSE_NOT_AUTHORIZED')));
  });
}

test('account renderer and preload expose no device-management API', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'settings-license.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'electron', 'preload.js'), 'utf8');
  assert.doesNotMatch(script, /createPairingCode|listPairingCodes|revokePairingCode/);
  assert.doesNotMatch(preload, /createPairingCode|listPairingCodes|revokePairingCode/);
});
