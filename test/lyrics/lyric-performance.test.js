'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('sustained long frames degrade WAAPI to manual and then static without repeated changes', async () => {
  const { createLyricPerformanceProfile } = await loadModuleExports(
    path.join(__dirname, '../../public/js/shared/lyric-performance.js'),
    {
      window: { matchMedia: () => ({ matches: false }) },
    },
  );
  const changes = [];
  const profile = createLyricPerformanceProfile({
    onChange: (value) => changes.push(value.wordAnimation),
  });
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.equal(profile.profile.wordAnimation, 'manual');
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.equal(profile.profile.wordAnimation, 'static');
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.deepEqual(changes, ['manual', 'static']);

  profile.setVisible(false);
  assert.equal(profile.profile.wordAnimation, 'waapi', 'a hidden surface resets to the full profile');
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.equal(profile.profile.wordAnimation, 'waapi', 'hidden frames must not degrade the profile');
  assert.deepEqual(changes, ['manual', 'static', 'waapi']);
});
