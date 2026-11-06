'use strict';

const crypto = require('node:crypto');
const { normalizeRemoteRootOrigin } = require('../shared/remote-url-policy');

const REBUILD_ERROR_CODES = new Set([
  'SYNC_EPOCH_MISMATCH',
  'CURSOR_AHEAD',
  'CURSOR_TOO_OLD',
  'INVALID_BOOTSTRAP_TOKEN',
  'REBUILD_REQUIRED',
]);
const BOOTSTRAP_RESTART_CODES = new Set(['BOOTSTRAP_TOKEN_EXPIRED']);

function normalizeResolvedSource(source, expectedKey) {
  const id = Number(source?.id);
  if (!Number.isSafeInteger(id) || id < 1 || source?.sourceKey !== expectedKey) {
    throw new Error('INVALID_GIFT_SOURCE');
  }
  return Object.freeze({ id, sourceKey: expectedKey });
}

function hasHistoryCapability(discovery) {
  return (
    discovery?.historyBootstrapVersion === 1 &&
    typeof discovery.syncEpoch === 'string' &&
    discovery.syncEpoch.length > 0 &&
    discovery.syncEpoch.length <= 128
  );
}

function requiresProjectionReplacement(state, discovery) {
  if (state.bootstrapComplete) {
    return (
      state.syncEpoch !== discovery.syncEpoch ||
      !Number.isSafeInteger(state.finalCursor) ||
      state.finalCursor > discovery.latestCursor ||
      state.finalCursor < discovery.earliestCursor - 1
    );
  }
  const hasPageToken = state.bootstrapPageToken !== null;
  const hasRecoveryCursor = state.bootstrapRecoveryCursor !== null;
  const hasBootstrapEpoch = state.bootstrapSyncEpoch !== null;
  return (
    (hasPageToken && (!hasRecoveryCursor || !hasBootstrapEpoch)) ||
    (!hasPageToken && (hasRecoveryCursor || hasBootstrapEpoch)) ||
    (state.bootstrapSyncEpoch !== null && state.bootstrapSyncEpoch !== discovery.syncEpoch) ||
    (state.finalCursor !== null && !Number.isSafeInteger(state.finalCursor))
  );
}

function validateEpochAwareCursorPage(page, currentCursor) {
  let previous = currentCursor;
  for (const event of page.events) {
    if (event.cursor !== previous + 1) throw cursorGapError();
    previous = event.cursor;
  }
  if (
    currentCursor < page.earliestCursor - 1 ||
    currentCursor > page.latestCursor ||
    previous !== page.nextCursor ||
    page.nextCursor > page.latestCursor ||
    (page.hasMore && page.nextCursor <= currentCursor) ||
    (page.hasMore && page.nextCursor >= page.latestCursor) ||
    (!page.hasMore && page.nextCursor !== page.latestCursor)
  ) {
    throw cursorGapError();
  }
}

function giftSyncStalledError() {
  const error = new Error('GIFT_SYNC_STALLED');
  error.code = 'GIFT_SYNC_STALLED';
  return error;
}

function cursorGapError() {
  const error = new Error('GIFT_CURSOR_GAP');
  error.code = 'REBUILD_REQUIRED';
  return error;
}

function requiresProjectionRebuild(error) {
  return REBUILD_ERROR_CODES.has(error?.code);
}

function canRestartBootstrap(error) {
  return BOOTSTRAP_RESTART_CODES.has(error?.code);
}

// Active source identity contract, still used by the controller. Keep these versioned hash inputs stable.
function createRemoteGiftSourceKey(baseUrl, streamer = {}) {
  const accountName = String(streamer?.accountName || '')
    .trim()
    .toLowerCase();
  const streamerId = streamer?.streamerId;
  if (!accountName || !Number.isSafeInteger(streamerId) || streamerId <= 0) {
    throw new Error('REMOTE_GIFT_SOURCE_UNAVAILABLE');
  }
  const source = ['gift-source-v2', canonicalizeGiftSourceOrigin(baseUrl), accountName, streamerId].join('\n');
  return crypto.createHash('sha256').update(source).digest('hex');
}

function canonicalizeGiftSourceOrigin(baseUrl) {
  const origin = normalizeRemoteRootOrigin(baseUrl);
  if (!origin) throw new Error('INVALID_GIFT_SOURCE_ORIGIN');
  return origin;
}

module.exports = {
  createRemoteGiftSourceKey,
  normalizeResolvedSource,
  hasHistoryCapability,
  requiresProjectionReplacement,
  validateEpochAwareCursorPage,
  giftSyncStalledError,
  requiresProjectionRebuild,
  canRestartBootstrap,
};
