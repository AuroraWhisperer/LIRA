'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');

test('server startup uses the same forced Bilibili reconnect as refresh live', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'server.js'), 'utf8');
  const startupBlock = source.match(
    /openAdminPageIfNeeded\(baseUrl\);[\s\S]*?return \{ server, port, host, baseUrl \};/
  );

  assert.ok(startupBlock, 'server startup block should be present');
  assert.match(startupBlock[0], /bilibiliRuntime\.reconnect\(\)\.catch/);
  assert.doesNotMatch(startupBlock[0], /bilibiliRuntime\.configure\(\)/);
  assert.match(startupBlock[0], /startup reconnect failed/);
});

test('desktop injects Electron safeStorage into the server AI secret boundary', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /protocol, safeStorage, session/);
  assert.match(source, /createDesktopRuntime\(serverRuntimeModule, \{[\s\S]*?dataDir: pathState\.dataDir,[\s\S]*?safeStorage[\s\S]*?\}\)/);
});
