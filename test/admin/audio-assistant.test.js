'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const entry = path.resolve('public/js/admin/audio-assistant.js');

test('audio assistant accepts only valid local preferences and clamps saved ratios', async () => {
  const { normalizeAudioAssistantPreferences: normalize } = await loadModuleExports(entry);
  for (const value of [null, [], 'broken', { enabled: 'true', placement: 'desktop', x: '12', y: NaN, dock: 'top' }]) {
    const prefs = normalize(value);
    assert.equal(prefs.enabled, false);
    assert.equal(prefs.placement, 'top');
    assert.equal(prefs.dock, '');
    assert.ok(prefs.x > 0 && prefs.x < 1);
    assert.ok(prefs.y > 0 && prefs.y < 1);
  }
  const prefs = normalize({ enabled: true, placement: 'side', x: -3, y: 9, dock: 'right' });
  assert.deepEqual(JSON.parse(JSON.stringify(prefs)), { enabled: true, placement: 'side', x: 0, y: 1, dock: 'right' });
});

test('floating positions stay below the titlebar and above the player after resizing', async () => {
  const { resolveAudioAssistantPosition: place } = await loadModuleExports(entry);
  for (const area of [{ width: 1440, top: 70, bottom: 760 }, { width: 900, top: 70, bottom: 420 }]) {
    for (const dock of ['', 'left', 'right']) {
      for (const x of [0, 0.5, 1]) {
        for (const y of [0, 0.5, 1]) {
          const point = place({ x, y, dock }, area);
          assert.ok(point.x >= 0 && point.x + (dock ? 24 : 52) <= area.width);
          assert.ok(point.y >= area.top && point.y + 52 <= area.bottom);
          if (dock === 'left') assert.equal(point.x, 0);
          if (dock === 'right') assert.equal(point.x + 24, area.width);
        }
      }
    }
  }
});
