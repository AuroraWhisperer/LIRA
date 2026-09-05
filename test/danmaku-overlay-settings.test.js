'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const settingsRoutes = require('../src/server/routes/settings-routes');

test('danmaku overlay style defaults to signal and accepts only named themes', async () => {
  assert.equal(DEFAULT_SETTINGS.danmakuOverlayStyle, 'signal');
  assert.equal(DEFAULT_SETTINGS.danmakuFullscreenDurationSeconds, '6');

  for (const style of [
    'bubble',
    'signal',
    'minimal',
    'ranked',
    'transparent',
    'outline',
  ]) {
    const result = await postSettings({ danmakuOverlayStyle: ` ${style} ` });
    assert.equal(result.status, 200);
    assert.deepEqual(result.writes, [['danmakuOverlayStyle', style]]);
    assert.equal(result.broadcastReason, 'settings');
  }

  const invalid = await postSettings({ danmakuOverlayStyle: 'rainbow' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.payload, {
    ok: false,
    error: '设置 danmakuOverlayStyle 的值无效。',
  });
  assert.deepEqual(invalid.writes, []);
  assert.equal(invalid.configureCalls, 0);
});

test('fullscreen danmaku duration accepts safe integer seconds from 2 through 30', async () => {
  for (const value of [2, 30, '2', '30']) {
    const result = await postSettings({
      danmakuFullscreenDurationSeconds: value,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.writes, [
      ['danmakuFullscreenDurationSeconds', String(value)],
    ]);
    assert.equal(result.broadcastReason, 'settings');
  }

  for (const value of [
    '',
    null,
    undefined,
    true,
    [2],
    '2.0',
    '2e0',
    '0x2',
    1,
    31,
    2.5,
    NaN,
  ]) {
    const result = await postSettings({
      danmakuFullscreenDurationSeconds: value,
    });
    assert.equal(result.status, 400, `expected ${String(value)} to fail`);
    assert.deepEqual(result.writes, []);
    assert.equal(result.configureCalls, 0);
  }
});

async function postSettings(body) {
  const writes = [];
  let configureCalls = 0;
  let broadcastReason = '';
  let payload = null;
  const response = {
    writeHead(status) {
      this.status = status;
    },
    end(value) {
      payload = JSON.parse(value);
    },
  };
  const context = {
    settings: {
      defaults: { ...DEFAULT_SETTINGS, danmakuOverlayStyle: 'signal' },
      setMany(values) {
        writes.push(...Object.entries(values));
        return Object.keys(values);
      },
    },
    bilibili: {
      configure() {
        configureCalls += 1;
      },
    },
    broadcastSnapshot(reason) {
      broadcastReason = reason;
    },
    system: {
      getState() {
        return { settings: {} };
      },
    },
  };

  await settingsRoutes.routes['POST /api/settings'](
    context,
    {
      async body() {
        return body;
      },
    },
    response,
  );

  return {
    status: response.status,
    payload,
    writes,
    configureCalls,
    broadcastReason,
  };
}
