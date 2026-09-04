'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('local runtime gates admin, business API and websocket before license authorization', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-license-gate-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const runtime = require('../src/server').createServerRuntime({
    dataDir,
    licenseGate: { isAuthorized: () => false },
  });
  try {
    const info = await runtime.start({ host: '127.0.0.1', startPort: 0 });
    const admin = await fetch(`${info.baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(admin.status, 302);
    assert.equal(admin.headers.get('location'), '/license');
    const license = await fetch(`${info.baseUrl}/license`);
    assert.equal(license.status, 200);
    assert.match(await license.text(), /licenseForm/);
    const api = await fetch(`${info.baseUrl}/api/state`);
    assert.equal(api.status, 423);
    assert.deepEqual(await api.json(), {
      ok: false,
      error: 'LICENSE_REQUIRED',
    });
  } finally {
    await runtime.stop({ exitProcess: false });
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch (_) {}
  }
});

test('Electron startup restores authorized work and owns the system-resume listener', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'electron', 'main.js'),
    'utf8',
  );
  const bootstrapIndex = source.indexOf('await licenseManager.bootstrap();');
  const windowMatch = /createMainWindow\(\s*serverInfo\.baseUrl/.exec(
    source.slice(bootstrapIndex),
  );
  const windowIndex = windowMatch ? bootstrapIndex + windowMatch.index : -1;
  const listenerIndex = source.indexOf(
    'licenseManager.onStateChanged',
    windowIndex,
  );
  const initialResumeIndex = source.indexOf(
    'if (licenseManager.getState() === LicenseState.AUTHORIZED)',
    listenerIndex,
  );

  assert.ok(bootstrapIndex >= 0 && windowIndex > bootstrapIndex);
  assert.ok(listenerIndex > windowIndex && initialResumeIndex > listenerIndex);
  assert.match(
    source.slice(initialResumeIndex, initialResumeIndex + 350),
    /resumeAuthorizedWork/,
  );
  assert.match(
    source,
    /createLicenseResumeHandler\(\{\s*powerMonitor,\s*getLicenseManager: \(\) => licenseManager,\s*afterResume: async \(\) => \{[^]*?cloudSyncController\?\.syncNow\(\)[^]*?remoteGiftController\?\.resume\(\)[^]*?\},\s*writeLog,?\s*\}\)/,
  );
  assert.match(source, /licenseResumeController\.register\(\)/);
  assert.match(
    source,
    /registerLicenseIpc\(\{[^]*?getDesktopBaseUrl: \(\) => serverInfo\.baseUrl/,
  );
  assert.match(
    source,
    /app\.on\(["']before-quit["'][^]*?licenseResumeController\?\.unregister\(\)/,
  );
  const initialGiftStart = source.indexOf(
    'remoteGiftController.start()',
    initialResumeIndex,
  );
  const initialStart = source.indexOf(
    'cloudSyncController\n        .start()',
    initialGiftStart,
  );
  const initialStartThen = source.indexOf('.then(()', initialStart);
  assert.ok(initialGiftStart > initialResumeIndex);
  assert.ok(initialStart > initialGiftStart);
  assert.ok(initialStartThen > initialStart);
  assert.match(source, /remoteGiftController\?\.stop\(\)/);

  const resumeSync = source.indexOf('cloudSyncController?.syncNow()');
  const resumeGifts = source.indexOf('remoteGiftController?.resume()');
  assert.ok(resumeSync >= 0 && resumeGifts > resumeSync);
  assert.match(
    source,
    /licenseResumeController\?\.unregister\(\)[^]*?const controllersToDrain = \[remoteGiftController, cloudSyncController\][^]*?controller\.dispose\(\)/,
  );

  const preload = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'electron', 'preload.js'),
    'utf8',
  );
  assert.doesNotMatch(
    preload,
    /remoteGift|gift-events|watchGiftEvents|accessToken|Authorization|EventSource/u,
  );
  const licenseIpc = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'electron', 'ipc', 'license-ipc.js'),
    'utf8',
  );
  assert.doesNotMatch(
    licenseIpc,
    /getGiftEventsInternal|watchGiftEventsInternal|gift-events/u,
  );
});
