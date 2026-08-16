'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createDesktopState } = require('../src/electron/desktop-state');

test('desktop state instances isolate runtime, window, and update mutations', () => {
  const first = createDesktopState();
  const second = createDesktopState();

  first.window.baseUrl = 'http://127.0.0.1:3000';
  first.lifecycle.gracefulQuitStarted = true;
  first.update.value.status = 'available';

  assert.equal(second.window.baseUrl, '');
  assert.equal(second.lifecycle.gracefulQuitStarted, false);
  assert.equal(second.update.value.status, 'idle');
});
