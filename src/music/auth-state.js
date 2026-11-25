'use strict';

function sanitizeAuthState(auth) {
  return {
    loggedIn: Boolean(auth && auth.loggedIn),
    cookieCount: Number(auth && auth.cookieCount) || 0,
    keyCookieNames: Array.isArray(auth && auth.keyCookieNames) ? auth.keyCookieNames : [],
    encryptedSnapshotExists: Boolean(auth && auth.encryptedSnapshotExists),
    lastSavedAt: auth && auth.lastSavedAt ? auth.lastSavedAt : '',
  };
}

async function readProviderHealthSession(provider) {
  const request = provider.getRequestSession &&
    await provider.getSafeAuthState(source => provider.getRequestSession(source, true));
  if (request?.state && Object.hasOwn(request.state, 'encryptedSnapshotExists') && Object.hasOwn(request.state, 'lastSavedAt')) {
    return request;
  }
  return { state: await provider.getSafeAuthState(), cookieHeader: request?.cookieHeader };
}

module.exports = { sanitizeAuthState, readProviderHealthSession };
