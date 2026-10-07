'use strict';

const assert = require('node:assert/strict');
const { getClockConfig } = require('../../src/server/clock-contract');
const { projectOverlayResponse } = require('../../src/server/overlay-projection');
const { normalizeSceneConfig } = require('../../src/server/scene-components');
const { normalizeSettingsPatch } = require('../../src/server/settings-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');
const { clockSettingsPayload } = require('../../public/js/shared/clock-settings.js');

// One clock appearance travels through the settings write boundary, stored
// settings, an independent scene instance and the clock overlay projection.
// Field-specific invalid values stay in the calling test.
function assertClockRoundTrip(config) {
  const payload = { ...clockSettingsPayload(config) };
  assert.equal(normalizeSettingsPatch(payload, DEFAULT_SETTINGS).error, undefined);
  assert.deepEqual(getClockConfig(payload), config);
  assert.deepEqual(normalizeSceneConfig('clock', config), config);
  assert.deepEqual(projectOverlayResponse('clock', '/api/clock/config', { ...config, secret: 'private' }), config);
  return payload;
}

module.exports = { assertClockRoundTrip };
