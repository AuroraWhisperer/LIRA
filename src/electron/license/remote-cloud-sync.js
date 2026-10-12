'use strict';

function createRemoteCloudSync(request) {
  return {
    getGuardExpiryWarnings: (token, requestOptions) =>
      request('GET', '/api/device/guard-expiry', undefined, token, { ...requestOptions, maxResponseBytes: 8 * 1024 * 1024 }),
    getGuardExpiryAccount: (token, requestOptions) =>
      request('GET', '/api/device/guard-expiry/account', undefined, token, requestOptions),
    updateGuardExpiryAccount: (input, token, requestOptions) =>
      request('PUT', '/api/device/guard-expiry/account', input, token, requestOptions),
    clearGuardExpiryAccount: (token, requestOptions) =>
      request('DELETE', '/api/device/guard-expiry/account', undefined, token, requestOptions),
    getCloudState: (token, requestOptions) =>
      request('GET', '/api/device/cloud-state', undefined, token, requestOptions),
    updateCloudSettings: (settings, token, requestOptions) =>
      request('PUT', '/api/device/cloud-settings', settings, token, requestOptions),
    getBilibiliCredentials: (token, requestOptions) =>
      request('GET', '/api/device/bilibili-credentials', undefined, token, requestOptions),
    setBilibiliCredentials: (cookie, token, requestOptions) =>
      request('PUT', '/api/device/bilibili-credentials', { cookie }, token, requestOptions),
    clearBilibiliCredentials: (token, requestOptions) =>
      request('DELETE', '/api/device/bilibili-credentials', undefined, token, requestOptions),
  };
}

module.exports = { createRemoteCloudSync };
