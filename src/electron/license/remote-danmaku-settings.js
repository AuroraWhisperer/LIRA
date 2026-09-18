'use strict';

function createRemoteDanmakuSettings(request) {
  return {
    getWelcomeSettings: (token) => request('GET', '/api/device/welcome-settings', undefined, token),
    updateWelcomeSettings: (settings, token) => request('PUT', '/api/device/welcome-settings', settings, token),
    getWelcomeSettingsV2: (token) => request('GET', '/api/device/welcome-settings/v2', undefined, token),
    updateWelcomeSettingsV2: (settings, token) => request('PUT', '/api/device/welcome-settings/v2', settings, token),
    getPkReportSettings: (token) => request('GET', '/api/device/pk-report-settings', undefined, token),
    updatePkReportSettings: (settings, token) => request('PUT', '/api/device/pk-report-settings', settings, token),
  };
}

module.exports = { createRemoteDanmakuSettings };
