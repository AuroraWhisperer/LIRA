'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');

let onboarding;
test.before(async () => {
  onboarding = await loadModuleExports(path.join(__dirname, '..', 'public', 'js', 'admin', 'onboarding.js'), { window: {} });
});

test('onboarding state gates required steps and optional AI', () => {
  assert.equal(onboarding.getStepGate('bilibili', { bilibiliAvailable: false, bilibiliLoggedIn: true, roomId: '12', liveStatus: { connected: true } }), false);
  assert.equal(onboarding.getStepGate('bilibili', { bilibiliAvailable: true, bilibiliLoggedIn: true, roomId: '12', liveStatus: { connected: true } }), true);
  assert.equal(onboarding.getStepGate('import', { importAcknowledged: false }), false);
  assert.equal(onboarding.getStepGate('import', { importAcknowledged: true }), true);
  assert.equal(onboarding.getStepGate('ai', { aiEnabled: false }), true);
  assert.equal(onboarding.getStepGate('ai', { aiEnabled: true, hasDeepSeekApiKey: true, aiTested: false }), false);
  assert.equal(onboarding.getStepGate('ai', { aiEnabled: true, hasDeepSeekApiKey: true, aiTested: true }), true);
});

test('onboarding navigation stays within bounds and tracks optional omissions', () => {
  assert.equal(onboarding.getNextStep('welcome', {}), 'bilibili');
  assert.equal(onboarding.getNextStep('bilibili', { bilibiliAvailable: false }), 'bilibili');
  assert.equal(onboarding.getNextStep('complete', {}), 'complete');
  assert.equal(JSON.stringify(onboarding.getIncompleteOptionalSteps({ aiEnabled: false })), JSON.stringify(['ai']));
  assert.equal(JSON.stringify(onboarding.getIncompleteOptionalSteps({ aiEnabled: false, skippedOptional: ['ai'] })), JSON.stringify([]));
});

test('completion requires both the current version and a timestamp', () => {
  assert.equal(onboarding.isOnboardingComplete({ onboardingVersion: '1', onboardingCompletedAt: '2026-08-19T00:00:00.000Z' }), true);
  assert.equal(onboarding.isOnboardingComplete({ onboardingVersion: '1', onboardingCompletedAt: '' }), false);
  assert.equal(onboarding.isOnboardingComplete({ onboardingVersion: '2', onboardingCompletedAt: '2026-08-19T00:00:00.000Z' }), false);
});

test('normalizeOnboardingState keeps the Quanmin host-login platform distinct', () => {
  const state = onboarding.normalizeOnboardingState({ musicPlatform: 'wesing' });
  assert.equal(state.musicPlatform, 'wesing');
  assert.equal(state.bilibiliAvailable, true);
});

test('settings defaults start onboarding as incomplete', () => {
  assert.equal(DEFAULT_SETTINGS.onboardingVersion, '');
  assert.equal(DEFAULT_SETTINGS.onboardingCompletedAt, '');
  assert.equal(DEFAULT_SETTINGS.onboardingSkippedOptional, '');
});
