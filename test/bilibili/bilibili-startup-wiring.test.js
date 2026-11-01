'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '../..');

test('only a completed Bilibili login marks cloud credentials dirty', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'src', 'electron', 'main.js'), 'utf8');
  assert.match(source, /if \(result\?\.state\?\.loggedIn\) cloudSyncController\?\.markDirty\('bilibili'\)/);
});
