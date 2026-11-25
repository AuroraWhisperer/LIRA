'use strict';

const { normalizeRemoteRootOrigin } = require('../shared/remote-url-policy');

function readAuthorizedIdentity(licenseManager) {
  try {
    if (licenseManager?.isAuthorized?.() !== true) return null;
    const identity = licenseManager.getCloudSyncIdentity();
    const streamerId = identity?.streamerId;
    if (typeof streamerId === 'string' ? !streamerId.trim()
      : !Number.isSafeInteger(streamerId) || streamerId <= 0) return null;
    const origin = normalizeRemoteRootOrigin(licenseManager.getRemoteBaseUrl());
    const generation = licenseManager.getAuthorizationGeneration();
    if (!origin || !Number.isSafeInteger(generation) || generation < 0) return null;
    return { origin, streamerId, generation };
  } catch {
    return null;
  }
}

module.exports = { readAuthorizedIdentity };
