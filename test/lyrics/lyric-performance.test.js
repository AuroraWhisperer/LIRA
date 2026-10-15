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

test('sustained long frames reduce effects while preserving continuous fill', async () => {
  const changes = [];
  const profile = await createProfile({ onChange: (value) => changes.push(value.effects) });
  recordFrames(profile, 3, 60);
  assert.equal(profile.profile.effects, 'full');
  profile.recordFrame(60);
  assert.equal(profile.profile.effects, 'low');
  recordFrames(profile, 300, 60);
  assert.equal(profile.profile.wordAnimation, 'waapi');
  assert.equal(profile.profile.targetFps, 30);
  assert.deepEqual(changes, ['low']);

  profile.setVisible(false);
  assert.equal(profile.profile.wordAnimation, 'waapi', 'a hidden surface resets to the full profile');
  for (let i = 0; i < 4; i += 1) profile.recordFrame(60);
  assert.equal(profile.profile.wordAnimation, 'waapi', 'hidden frames must not degrade the profile');
  assert.equal(profile.profile.effects, 'full');
  assert.deepEqual(changes, ['low', 'full']);
});

test('effect recovery requires sustained healthy frames and ignores immediate redraws', async () => {
  const changes = [];
  const profile = await createProfile({ onChange: (value) => changes.push(value.effects) });
  recordFrames(profile, 8, 60);
  recordFrames(profile, 29);
  assert.equal(profile.profile.effects, 'low');
  recordFrames(profile, 200, 0);
  assert.equal(profile.profile.effects, 'low', 'immediate redraws are not scheduled frames');

  profile.recordFrame(60);
  recordFrames(profile, 29);
  assert.equal(profile.profile.effects, 'low', 'a long frame restarts sustained recovery');
  profile.recordFrame(34);
  assert.equal(profile.profile.wordAnimation, 'waapi');
  assert.equal(profile.profile.effects, 'full');
  assert.equal(profile.profile.targetFps, 30);
  recordFrames(profile, 180);
  assert.deepEqual(changes, ['low', 'full']);
});

test('renewed load reduces effects again without changing the highlight mode', async () => {
  const profile = await createProfile();
  recordFrames(profile, 4, 60);
  assert.equal(profile.profile.effects, 'low');
  recordFrames(profile, 30);
  assert.equal(profile.profile.effects, 'full');

  recordFrames(profile, 4, 60);
  assert.equal(profile.profile.effects, 'low');
  recordFrames(profile, 29);
  assert.equal(profile.profile.effects, 'low');
  profile.recordFrame(34);
  assert.equal(profile.profile.effects, 'full');
  assert.equal(profile.profile.wordAnimation, 'waapi');
});

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
