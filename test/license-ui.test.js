'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('license page is independent from existing onboarding and exposes only three inputs', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'public', 'pages', 'license.html'),
    'utf8',
  );
  const inputs = [...html.matchAll(/<input\b/gi)];
  assert.equal(inputs.length, 3);
  assert.match(html, /id="licenseAccountName"/);
  assert.match(html, /id="licensePassword"/);
  assert.match(html, /id="licenseActivationCode"/);
  assert.match(html, /激活并进入 LIRA/);
  assert.doesNotMatch(html, /跳过/);
});

test('license renderer uses main-process bridge and clears secrets on success', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'license.js'),
    'utf8',
  );
  assert.match(script, /window\.liraLicense/);
  assert.match(script, /passwordInput\.value = ''/);
  assert.match(script, /codeInput\.value = ''/);
  assert.match(script, /api\.getGiftCatalogState\(\)/);
  assert.match(script, /api\.retryGiftCatalog\(\)/);
  assert.match(script, /api\.onGiftCatalogStateChanged/);
  assert.doesNotMatch(script, /window\.location/);
  assert.doesNotMatch(script, /api\.lir[a-z]+hub\.cn/);
  assert.doesNotMatch(script, /localStorage/);
});

test('license page replaces the form with an accessible gift initialization card', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'public', 'pages', 'license.html'),
    'utf8',
  );
  const styles = fs.readFileSync(
    path.join(ROOT, 'public', 'css', 'license.css'),
    'utf8',
  );
  assert.match(html, /id="licenseLoginCard"/);
  assert.match(html, /id="giftCatalogInitializationCard"[^>]*aria-busy="true"[^>]*hidden/s);
  assert.match(html, /id="giftCatalogInitializationProgress"[^>]*max="100"/s);
  assert.match(html, /id="giftCatalogInitializationStatus"[^>]*role="status"/s);
  assert.match(html, /id="giftCatalogInitializationRetryBtn"/);
  assert.match(styles, /\.license-initialization-card\s*\{/);
  assert.match(styles, /\.license-progress::-webkit-progress-value\s*\{/);
});

test('license renderer explains session replacement and temporary server failures', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'license.js'),
    'utf8',
  );
  assert.match(script, /SESSION_SUPERSEDED/);
  assert.match(script, /另一个 LIRA 进程登录/);
  assert.match(script, /HTTP_\(429\|5\\d\\d\)/);
  assert.match(script, /授权服务器暂时不可用/);
});

test('license renderer re-enables both actions after a failed async attempt', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'license.js'),
    'utf8',
  );
  assert.match(script, /function finishBusy\(\)/);
  assert.match(script, /submitButton\.disabled = false/);
  assert.match(script, /retryButton\.disabled = false/);
  assert.match(script, /finally\s*\{\s*finishBusy\(\);\s*\}/);
});

test('cloud song sync requires an explicit overwrite confirmation', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'import.js'),
    'utf8',
  );
  const dialogIndex = script.indexOf('showConfirmationDialog({');
  const syncIndex = script.indexOf('window.liraLicense.syncSongs(');
  assert.ok(dialogIndex >= 0, 'sync must ask for confirmation first');
  assert.ok(
    syncIndex > dialogIndex,
    'confirmation must happen before syncSongs is invoked',
  );
  assert.match(script, /if \(!confirmed\)/);
  assert.match(script, /variant: 'caution'/);
  assert.match(script, /覆盖同步/);
});

test('cloud song sync snapshots local songs after confirmation', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'import.js'),
    'utf8',
  );
  const confirmedGuardIndex = script.indexOf('if (!confirmed)');
  const snapshotIndex = script.indexOf(
    "const songs = [...(window['AdminApp']?.state?.getSongs?.() || [])];",
  );
  const syncIndex = script.indexOf(
    'window.liraLicense.syncSongs(songs)',
    snapshotIndex,
  );
  assert.ok(confirmedGuardIndex >= 0, 'confirmation result must be checked');
  assert.ok(
    snapshotIndex > confirmedGuardIndex,
    'local songs must be read after confirmation',
  );
  assert.ok(
    syncIndex > snapshotIndex,
    'the confirmed snapshot must be the one uploaded',
  );
});

test('cloud song sync compares against the cloud count and records the last sync locally', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'import.js'),
    'utf8',
  );
  const html = fs.readFileSync(
    path.join(ROOT, 'public', 'pages', 'admin', 'song', 'import-export.html'),
    'utf8',
  );
  assert.match(script, /window\.liraLicense\.getCloudSongs\(\)/);
  assert.match(script, /云端现有/);
  assert.match(script, /lira:license:lastCloudSync/);
  assert.match(script, /本机上次同步/);
  assert.match(html, /id="licenseLastCloudSync"/);
  assert.match(html, /id="licenseCloudCount"/);
  assert.match(
    script,
    /syncButton\.disabled = true;[\s\S]*?await refreshCloudSongCount\(\)[\s\S]*?syncButton\.disabled = false;/,
  );
  assert.match(
    script,
    /syncButton\.disabled = false;\s*\}\s*\n\s*\n\s*syncButton\.addEventListener/,
  );
  assert.match(script, /Number\.isSafeInteger\(reportedCount\)/);
});

test('song background controls wait for the initial response before accepting changes', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'import.js'),
    'utf8',
  );
  assert.match(script, /fileInput\.disabled = isBusy/);
  assert.match(
    script,
    /setBusy\(true\);[\s\S]*?await refreshSongBackground\(\)[\s\S]*?setBusy\(false\);/,
  );
});

test('account settings show non-sensitive profile data without device-management controls', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'settings-license.js'),
    'utf8',
  );
  const html = fs.readFileSync(
    path.join(ROOT, 'public', 'pages', 'admin', 'toolbox', 'settings.html'),
    'utf8',
  );
  const preload = fs.readFileSync(
    path.join(ROOT, 'src', 'electron', 'preload.js'),
    'utf8',
  );

  assert.match(script, /await licenseBridge\.getProfile\(\)/);
  assert.match(script, /accountEl\.textContent/);
  assert.match(script, /deviceEl\.textContent/);
  assert.match(html, /登录密码[\s\S]*?为保护账户安全不可查看/);
  assert.match(html, /设备管理[\s\S]*?由服务器管理员统一处理/);
  assert.doesNotMatch(script, /createPairingCode|listPairingCodes|revokePairingCode/);
  assert.doesNotMatch(preload, /createPairingCode|listPairingCodes|revokePairingCode/);
});
