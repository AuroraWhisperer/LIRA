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
  assert.match(startupBlock[0], /reconnectBilibiliListener\(\)\.catch/);
  assert.doesNotMatch(startupBlock[0], /configureBilibiliListener\(\)/);
  assert.match(startupBlock[0], /startup reconnect failed/);
});
