'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { listenHttpServer } = require('../helpers/transport-fixtures');

test('HTTP license gate redirects admin and rejects business API before dispatch', async (t) => {
  let authorized = false;
  const pages = [];
  const { origin } = await listenHttpServer(t, {
    isLicenseAuthorized: () => authorized,
    createApiContext: () => assert.fail('unauthorized requests must not reach business state'),
    inflightTracker: { run: (callback) => callback() },
    servePageOrAsset(req, res, url) {
      pages.push(url.pathname);
      res.end('synthetic page');
    },
  });
  const admin = await fetch(`${origin}/admin`, { redirect: 'manual' });
  assert.equal(admin.status, 302);
  assert.equal(admin.headers.get('location'), '/license');
  const license = await fetch(`${origin}/license`);
  assert.equal(license.status, 200);
  await license.text();
  const api = await fetch(`${origin}/api/state`);
  assert.equal(api.status, 423);
  assert.deepEqual(await api.json(), { ok: false, error: 'LICENSE_REQUIRED' });
  assert.deepEqual(pages, ['/license']);

  authorized = true;
  const unlocked = await fetch(`${origin}/admin`, { redirect: 'manual' });
  assert.equal(unlocked.status, 200);
  await unlocked.text();
  assert.deepEqual(pages, ['/license', '/admin']);
  // Runtime-to-transport license wiring: test/server/server-cleanup-failures.test.js.
  // WebSocket authorization belongs to test/server/http-websocket-boundary.test.js;
  // license form markup belongs to license-ui.test.js.
});

test('Electron startup restores authorized work and owns the system-resume listener', () => {
  const source = fs.readFileSync(path.join(__dirname, '../..', 'src', 'electron', 'main.js'), 'utf8');
  const bootstrapIndex = source.indexOf('await licenseManager.bootstrap();');
  const windowMatch = /createMainWindow\(\s*serverInfo\.baseUrl/.exec(source.slice(bootstrapIndex));
  const windowIndex = windowMatch ? bootstrapIndex + windowMatch.index : -1;
  const readiness = fs.readFileSync(
    path.join(__dirname, '../..', 'src', 'electron', 'desktop-readiness-controller.js'),
    'utf8',
  );
  assert.ok(bootstrapIndex >= 0 && windowIndex > bootstrapIndex);
  assert.ok(source.indexOf('readinessController.start()', windowIndex) > windowIndex);
  assert.match(
    source,
    /createLicenseResumeHandler\(\{\s*powerMonitor,\s*getLicenseManager: \(\) => licenseManager,\s*afterResume: async \(\) => \{[^]*?cloudSyncController\?\.syncNow\(\)[^]*?remoteGiftController\?\.resume\(\)[^]*?\},\s*writeLog,?\s*\}\)/,
  );
  assert.match(source, /licenseResumeController\.register\(\)/);
  assert.match(source, /registerLicenseIpc\(\{[^]*?getDesktopBaseUrl: \(\) => serverInfo\.baseUrl/);
  assert.match(
    source,
    /giftCatalog:\s*\{[^]*?getGiftCatalogInitializationState[^]*?initializeGiftCatalog[^]*?onGiftCatalogInitializationStateChanged/,
  );
  // Readiness ordering, catalog gating and navigation generations: test/desktop/desktop-readiness-controller.test.js.
  assert.match(readiness, /refreshGiftCatalog\(\s*runtime,[^]*?'authorized-session'/);
  assert.match(source, /app\.on\(["']before-quit["'][^]*?licenseResumeController\?\.unregister\(\)/);

  const resumeSync = source.indexOf('cloudSyncController?.syncNow()');
  const resumeGifts = source.indexOf('remoteGiftController?.resume()');
  assert.ok(resumeSync >= 0 && resumeGifts > resumeSync);
  assert.match(
    source,
    /licenseResumeController\?\.unregister\(\)[^]*?const controllersToDrain = \[\s*sceneCloudController,\s*remoteGiftController,\s*cloudSyncController,\s*fanProfileController,\s*desktopAuth,?\s*\][^]*?controller\.dispose\(\)/,
  );

  const preload = fs.readFileSync(path.join(__dirname, '../..', 'src', 'electron', 'preload.js'), 'utf8');
  assert.doesNotMatch(preload, /remoteGift|gift-events|watchGiftEvents|accessToken|Authorization|EventSource/u);
  for (const file of ['license-ipc.js', 'license-overlay-ipc.js', 'license-songs-ipc.js', 'license-public-values.js']) {
    const licenseIpc = fs.readFileSync(path.join(__dirname, '../..', 'src', 'electron', 'ipc', file), 'utf8');
    assert.doesNotMatch(licenseIpc, /getGiftEventsInternal|watchGiftEventsInternal|gift-events/u, file);
  }
});
