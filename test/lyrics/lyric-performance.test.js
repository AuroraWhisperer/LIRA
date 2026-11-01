'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

async function createProfile({ reducedMotion = false, onChange } = {}) {
  const { createLyricPerformanceProfile } = await loadModuleExports(
    path.join(__dirname, '../../public/js/shared/lyric-performance.js'),
    { window: { matchMedia: () => ({ matches: reducedMotion }) } },
  );
  return createLyricPerformanceProfile({ onChange });
}

function recordFrames(profile, count, duration = 34) {
  for (let i = 0; i < count; i += 1) profile.recordFrame(duration);
}

test('reduced motion remains static through healthy frames and visibility resets', async () => {
  const changes = [];
  const profile = await createProfile({ reducedMotion: true, onChange: (value) => changes.push(value.wordAnimation) });
  assert.equal(profile.profile.wordAnimation, 'static');
  assert.equal(profile.profile.effects, 'low');
  recordFrames(profile, 12, 60);
  recordFrames(profile, 300);
  assert.deepEqual(changes, []);
  profile.setVisible(false);
  profile.setVisible(true);
  recordFrames(profile, 300);
  assert.equal(profile.profile.wordAnimation, 'static');
  assert.equal(profile.profile.effects, 'low');
  assert.deepEqual(changes, ['static']);
});
