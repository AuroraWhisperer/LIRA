'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT = path.join(__dirname, '../..');

function tagById(html, id) {
  const tags = html.match(new RegExp(`<[^>]+\\sid\\s*=\\s*["']${id}["'][^>]*>`, 'g')) || [];
  assert.equal(tags.length, 1, `${id} should exist once`);
  return tags[0];
}

test('license titlebar exposes accessible window controls without form submission', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'license.html'), 'utf8');
  for (const id of ['licenseMinimizeBtn', 'licenseMaximizeBtn', 'licenseCloseBtn']) {
    const button = tagById(html, id);
    assert.match(button, /^<button\b/);
    assert.match(button, /\stype=["']button["']/);
    assert.match(button, /\saria-label=["'][^"']+["']/);
  }
});

test('license window controls dispatch actions and reflect maximize events', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'license.js'), 'utf8');
  const elements = new Map(
    ['licenseMinimizeBtn', 'licenseMaximizeBtn', 'licenseCloseBtn'].map((id) => [id, new EventTarget()]),
  );
  const maximizeButton = elements.get('licenseMaximizeBtn');
  maximizeButton.dataset = {};
  const attributes = new Map();
  maximizeButton.setAttribute = (name, value) => attributes.set(name, value);
  const calls = [];
  let onMaximized;
  let unsubscribed = false;
  const window = new EventTarget();
  window.songAssistantDesktop = {
    minimizeWindow: () => calls.push('minimize'),
    maximizeWindow: () => calls.push('maximize'),
    closeWindow: () => calls.push('close'),
    onWindowMaximized: (callback) => {
      onMaximized = callback;
      return () => {
        unsubscribed = true;
      };
    },
  };

  vm.runInNewContext(script, {
    window,
    document: { getElementById: (id) => elements.get(id) || null },
  });
  for (const button of elements.values()) {
    button.dispatchEvent(new Event('click'));
  }
  assert.deepEqual(calls, ['minimize', 'maximize', 'close']);
  onMaximized(true);
  assert.equal(maximizeButton.dataset.maximized, 'true');
  assert.equal(maximizeButton.title, '还原');
  assert.equal(attributes.get('aria-label'), '还原');
  onMaximized(false);
  assert.equal(maximizeButton.dataset.maximized, 'false');
  assert.equal(maximizeButton.title, '最大化');
  assert.equal(attributes.get('aria-label'), '最大化');
  window.dispatchEvent(new Event('pagehide'));
  assert.equal(unsubscribed, true);
});

test('license page provides credentials and defaults to registration without a bypass action', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'license.html'), 'utf8');
  for (const id of ['licenseAccountName', 'licensePassword', 'licenseActivationCode']) {
    assert.match(tagById(html, id), /^<input\b/);
  }
  assert.match(tagById(html, 'licenseForm'), /^<form\b/);
  assert.match(tagById(html, 'licenseSubmitBtn'), /\stype=["']submit["']/);
  assert.match(tagById(html, 'licenseRetryBtn'), /\stype=["']button["']/);
  assert.match(tagById(html, 'licenseRegisterMode'), /\saria-pressed=["']true["']/);
  assert.match(tagById(html, 'licenseLoginMode'), /\saria-pressed=["']false["']/);
  assert.match(tagById(html, 'licensePassword'), /\sautocomplete=["']new-password["']/);
  assert.doesNotMatch(html, /跳过/);
});

test('license renderer keeps credentials and navigation inside the main-process boundary', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'license.js'), 'utf8');
  assert.match(script, /window\.liraLicense/);
  assert.doesNotMatch(script, /window\.location/);
  assert.doesNotMatch(script, /api\.lir[a-z]+hub\.cn/);
  assert.doesNotMatch(script, /localStorage/);
});

test('license page replaces the form with an accessible gift initialization card', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'license.html'), 'utf8');
  tagById(html, 'licenseLoginCard');
  tagById(html, 'giftCatalogInitializationHeading');
  tagById(html, 'giftCatalogInitializationPercent');
  const card = tagById(html, 'giftCatalogInitializationCard');
  assert.match(card, /\saria-busy=["']true["']/);
  assert.match(card, /\shidden(?:\s|\/?>)/);
  const progress = tagById(html, 'giftCatalogInitializationProgress');
  assert.match(progress, /^<progress\b/);
  assert.match(progress, /\smax=["']100["']/);
  assert.match(progress, /\saria-label=["'][^"']+["']/);
  assert.match(tagById(html, 'giftCatalogInitializationStatus'), /\srole=["']status["']/);
  for (const id of ['giftCatalogInitializationRetryBtn', 'giftCatalogInitializationBackBtn']) {
    const button = tagById(html, id);
    assert.match(button, /^<button\b/);
    assert.match(button, /\stype=["']button["']/);
  }
  assert.match(tagById(html, 'giftCatalogInitializationBackBtn'), /\shidden(?:\s|\/?>)/);
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

test('account settings page has no device-management controls', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'settings-license.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'admin', 'toolbox', 'settings.html'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'electron', 'preload.js'), 'utf8');

  tagById(html, 'licenseAccountName');
  tagById(html, 'licenseDeviceName');
  assert.doesNotMatch(html, /安全存储|设备私钥|首次授权|激活密钥|设备管理/);
  assert.doesNotMatch(script, /createPairingCode|listPairingCodes|revokePairingCode/);
  assert.doesNotMatch(preload, /createPairingCode|listPairingCodes|revokePairingCode/);
});
