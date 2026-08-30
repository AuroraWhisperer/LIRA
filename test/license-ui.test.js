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
  assert.doesNotMatch(script, /api\.lir[a-z]+hub\.cn/);
  assert.doesNotMatch(script, /localStorage/);
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

test('pairing code UI confirms revocation, shows lifecycle timestamps and maps error codes', () => {
  const script = fs.readFileSync(
    path.join(ROOT, 'public', 'js', 'admin', 'settings-license.js'),
    'utf8',
  );
  const confirmIndex = script.indexOf('dangerConfirm(');
  const revokeIndex = script.indexOf('licenseBridge.revokePairingCode(');
  assert.ok(confirmIndex >= 0, 'revocation must ask for confirmation');
  assert.ok(
    revokeIndex > confirmIndex,
    'dangerConfirm must gate the revoke call',
  );
  assert.match(
    script,
    /createdAt \|\| item\.created_at|created_at \|\| item\.createdAt/,
  );
  assert.match(
    script,
    /expiresAt \|\| item\.expires_at|expires_at \|\| item\.expiresAt/,
  );
  assert.match(script, /usedAt \|\| item\.used_at|used_at \|\| item\.usedAt/);
  assert.match(script, /usedDeviceName\s*\|\|\s*item\.used_device_name/);
  assert.match(script, /PAIRING_CODE_ALREADY_CONSUMED/);
  assert.match(script, /TOO_MANY_ACTIVE_PAIRING_CODES/);
  assert.match(script, /TOO_MANY_PAIRING_CODE_REQUESTS/);
  assert.match(script, /payload\?\.pairingCodes/);
  assert.match(script, /response\?\.ok === false/);
  assert.match(
    script,
    /assertPairingResponse\(await licenseBridge\.getProfile\(\)\)/,
  );
  assert.match(
    script,
    /renderCodes\([\s\S]*?assertPairingResponse\(await licenseBridge\.listPairingCodes\(\)\)/,
  );
});
