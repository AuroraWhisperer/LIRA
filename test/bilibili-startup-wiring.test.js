'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');

test('server startup uses the same forced Bilibili reconnect as refresh live', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8');
  const startupBlock = source.match(
    /openAdminPageIfNeeded\(baseUrl\);[\s\S]*?return \{ server, port, host, baseUrl \};/,
  );

  assert.ok(startupBlock, 'server startup block should be present');
  assert.match(startupBlock[0], /bilibiliRuntime\.reconnect\(\)\.catch/);
  assert.doesNotMatch(startupBlock[0], /bilibiliRuntime\.configure\(\)/);
  assert.match(startupBlock[0], /startup reconnect failed/);
});

test('server composition exposes only processed gifts and leaves legacy history alone', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8');

  const domainSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server', 'domain-services.js'), 'utf8');
  assert.doesNotMatch(domainSource, /processedOnly/);
  const giftSource = fs.readFileSync(path.join(ROOT_DIR, 'src', 'bilibili', 'gift', 'index.js'), 'utf8');
  assert.match(giftSource, /createGiftProjectionService/);
  assert.doesNotMatch(giftSource, /createGiftDetectionService|repairGiftV2Events/);
  assert.doesNotMatch(source, /LOCAL_GIFT_DETECTION_ENABLED|giftDetectionEnabled/);
  assert.doesNotMatch(source, /repairGiftV2Events/);
});

test('desktop injects Electron safeStorage into the server AI secret boundary', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /protocol,[\s\S]*?safeStorage,[\s\S]*?session/);
  assert.match(
    source,
    /createDesktopRuntime\(serverRuntimeModule, \{[\s\S]*?dataDir: pathState\.dataDir,[\s\S]*?safeStorage[\s\S]*?\}\)/,
  );
});

test('only a completed Bilibili login marks cloud credentials dirty', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /if \(result\?\.state\?\.loggedIn\) cloudSyncController\?\.markDirty\('bilibili'\)/);
});
