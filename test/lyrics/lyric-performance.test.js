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

test('static recovery requires sustained healthy frames and restarts the count for manual recovery', async () => {
  const changes = [];
  const profile = await createProfile({ onChange: (value) => changes.push(value.wordAnimation) });
  recordFrames(profile, 8, 60);
  recordFrames(profile, 149);
  assert.equal(profile.profile.wordAnimation, 'static');
  recordFrames(profile, 200, 0);
  assert.equal(profile.profile.wordAnimation, 'static', 'immediate redraws are not scheduled frames');

  profile.recordFrame(60);
  recordFrames(profile, 149);
  assert.equal(profile.profile.wordAnimation, 'static', 'a long frame restarts sustained recovery');
  profile.recordFrame(34);
  assert.equal(profile.profile.wordAnimation, 'manual');
  assert.equal(profile.profile.effects, 'low');
  recordFrames(profile, 29);
  assert.equal(profile.profile.wordAnimation, 'manual', 'static health does not carry into the next tier');
  profile.recordFrame(34);
  assert.equal(profile.profile.wordAnimation, 'waapi');
  assert.equal(profile.profile.effects, 'full');
  assert.equal(profile.profile.targetFps, 30);
  recordFrames(profile, 180);
  assert.deepEqual(changes, ['manual', 'static', 'manual', 'waapi']);
});

test('a failed recovery drops back down and must earn each recovery tier again', async () => {
  const profile = await createProfile();
  recordFrames(profile, 8, 60);
  recordFrames(profile, 150);
  assert.equal(profile.profile.wordAnimation, 'manual');
  recordFrames(profile, 4, 60);
  assert.equal(profile.profile.wordAnimation, 'static');
  recordFrames(profile, 149);
  assert.equal(profile.profile.wordAnimation, 'static');
  profile.recordFrame(34);
  recordFrames(profile, 30);
  assert.equal(profile.profile.wordAnimation, 'waapi');

  recordFrames(profile, 4, 60);
  assert.equal(profile.profile.wordAnimation, 'manual');
  recordFrames(profile, 29);
  assert.equal(profile.profile.wordAnimation, 'manual');
  profile.recordFrame(34);
  assert.equal(profile.profile.wordAnimation, 'waapi', 'the existing light-degradation recovery remains available');
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
