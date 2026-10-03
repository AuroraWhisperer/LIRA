'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

test('cloud song sync exposes its action, cloud count, result and last sync record', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'admin', 'song', 'import-export.html'), 'utf8');
  for (const id of ['licenseSongSync', 'licenseLastCloudSync', 'licenseCloudCount', 'licenseSyncResult']) {
    tagById(html, id);
  }
  const button = tagById(html, 'licenseSyncSongsBtn');
  assert.match(button, /^<button\b/);
  assert.match(button, /\stype=["']button["']/);
});

test('song background controls wait for the initial response before accepting changes', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'song-background.js'), 'utf8');
  assert.match(script, /fileInput\.disabled = isBusy/);
  assert.match(script, /setBusy\(true\);[\s\S]*?await refreshSongBackground\(\)[\s\S]*?setBusy\(false\);/);
});

test('account settings show non-sensitive profile data without device-management controls', () => {
  const script = fs.readFileSync(path.join(ROOT, 'public', 'js', 'admin', 'settings-license.js'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'public', 'pages', 'admin', 'toolbox', 'settings.html'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src', 'electron', 'preload.js'), 'utf8');

  assert.match(script, /await licenseBridge\.getProfile\(\)/);
  assert.match(script, /accountEl\.textContent/);
  assert.match(script, /deviceEl\.textContent/);
  tagById(html, 'licenseAccountName');
  tagById(html, 'licenseDeviceName');
  assert.doesNotMatch(html, /安全存储|设备私钥|首次授权|激活密钥|设备管理/);
  assert.doesNotMatch(script, /createPairingCode|listPairingCodes|revokePairingCode/);
  assert.doesNotMatch(preload, /createPairingCode|listPairingCodes|revokePairingCode/);
});
