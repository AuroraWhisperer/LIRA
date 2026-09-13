'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  hasHistoryCapability,
  requiresProjectionReplacement,
  validateEpochAwareCursorPage,
  requiresProjectionRebuild,
  canRestartBootstrap,
} = require('../src/electron/remote-gift-recovery-rules');

test('history capability requires the version and a bounded epoch', () => {
  assert.equal(
    hasHistoryCapability({ historyBootstrapVersion: 1, syncEpoch: 'epoch' }),
    true,
  );
  for (const discovery of [
    {},
    { historyBootstrapVersion: 2, syncEpoch: 'e' },
    { historyBootstrapVersion: 1, syncEpoch: '' },
    { historyBootstrapVersion: 1, syncEpoch: 'e'.repeat(129) },
  ]) {
    assert.equal(hasHistoryCapability(discovery), false);
  }
});

test('projection recovery distinguishes expired snapshots and incomplete bootstrap state', () => {
  const discovery = Object.freeze({
    syncEpoch: 'e',
    earliestCursor: 5,
    latestCursor: 10,
  });
  const state = Object.freeze({
    bootstrapComplete: true,
    syncEpoch: 'e',
    finalCursor: 4,
  });
  assert.equal(requiresProjectionReplacement(state, discovery), false);
  for (const patch of [
    { syncEpoch: 'old' },
    { finalCursor: 3 },
    { finalCursor: 11 },
    { finalCursor: 4.5 },
  ]) {
    assert.equal(
      requiresProjectionReplacement({ ...state, ...patch }, discovery),
      true,
    );
  }
  const bootstrap = {
    bootstrapComplete: false,
    bootstrapPageToken: null,
    bootstrapRecoveryCursor: null,
    bootstrapSyncEpoch: null,
    finalCursor: null,
  };
  assert.equal(requiresProjectionReplacement(bootstrap, discovery), false);
  assert.equal(
    requiresProjectionReplacement(
      { ...bootstrap, bootstrapPageToken: 'token' },
      discovery,
    ),
    true,
  );
  assert.equal(
    requiresProjectionReplacement(
      {
        ...bootstrap,
        bootstrapPageToken: 'token',
        bootstrapRecoveryCursor: 10,
        bootstrapSyncEpoch: 'e',
      },
      discovery,
    ),
    false,
  );
});

test('cursor validation rejects gaps and inconsistent page bounds without changing inputs', () => {
  const page = Object.freeze({
    events: Object.freeze([Object.freeze({ cursor: 5 })]),
    earliestCursor: 1,
    latestCursor: 5,
    nextCursor: 5,
    hasMore: false,
  });
  assert.doesNotThrow(() => validateEpochAwareCursorPage(page, 4));
  for (const patch of [
    { events: [{ cursor: 6 }] },
    { nextCursor: 4 },
    { latestCursor: 6 },
    { hasMore: true },
    { earliestCursor: 6 },
  ]) {
    assert.throws(
      () => validateEpochAwareCursorPage({ ...page, ...patch }, 4),
      { code: 'REBUILD_REQUIRED' },
    );
  }
});

test('bootstrap expiry restarts a page sequence while invalid tokens replace the projection', () => {
  assert.equal(canRestartBootstrap({ code: 'BOOTSTRAP_TOKEN_EXPIRED' }), true);
  assert.equal(
    requiresProjectionRebuild({ code: 'BOOTSTRAP_TOKEN_EXPIRED' }),
    false,
  );
  for (const code of [
    'INVALID_BOOTSTRAP_TOKEN',
    'SYNC_EPOCH_MISMATCH',
    'CURSOR_AHEAD',
    'CURSOR_TOO_OLD',
    'REBUILD_REQUIRED',
  ]) {
    assert.equal(requiresProjectionRebuild({ code }), true);
    assert.equal(canRestartBootstrap({ code }), false);
  }
  assert.equal(requiresProjectionRebuild({ retryable: true }), false);
});
