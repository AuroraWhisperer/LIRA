'use strict';

function createRemoteCloudSync(request) {
  return {
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
