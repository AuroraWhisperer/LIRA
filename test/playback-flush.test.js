'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  acknowledgePlaybackFlush,
  requestPlaybackFlush
} = require('../src/electron/playback-flush');

test('reports skipped when the renderer window is unavailable', async () => {
  assert.deepEqual(await requestPlaybackFlush(null, 5), { status: 'skipped' });
});

test('reports renderer acknowledgement before the shutdown timeout', async () => {
  const sent = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      send(channel) {
        sent.push(channel);
        queueMicrotask(acknowledgePlaybackFlush);
      }
    }
  };

  assert.deepEqual(await requestPlaybackFlush(window, 50), { status: 'ack' });
  assert.deepEqual(sent, ['app:prepare-shutdown']);
});

test('reports timeout when the renderer does not acknowledge shutdown', async () => {
  const window = {
    isDestroyed: () => false,
    webContents: { send() {} }
  };

  assert.deepEqual(await requestPlaybackFlush(window, 5), { status: 'timeout' });
});

test('reports send errors without blocking shutdown', async () => {
  const window = {
    isDestroyed: () => false,
    webContents: {
      send() {
        throw new Error('renderer gone');
      }
    }
  };

  assert.deepEqual(await requestPlaybackFlush(window, 5), {
    status: 'error',
    message: 'renderer gone'
  });
});
