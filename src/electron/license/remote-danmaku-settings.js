'use strict';

function createRemoteDanmakuSettings(request) {
  return {
    getOverlayFilters: (token) => request('GET', '/api/device/overlay-filters', undefined, token),
    updateOverlayFilters: (settings, token) => request('PUT', '/api/device/overlay-filters', settings, token),
    getOverlayViewers: (token) => request('GET', '/api/device/overlay-viewers', undefined, token),
    dailyBotRequest: (operation, input, token) => {
      const routes = {
        read: ['GET', '/api/device/daily-bot-settings'],
        update: ['PUT', `/api/device/daily-bot-settings/${input.kind}`],
        decide: ['PUT', '/api/device/daily-bot-takeover'],
        start: ['POST', '/api/device/daily-bot-imports'],
        status: ['GET', `/api/device/daily-bot-imports/${input.id}`],
        upload: ['PUT', `/api/device/daily-bot-imports/${input.id}/batches/${input.sequence}`],
        preflight: ['POST', `/api/device/daily-bot-imports/${input.id}/preflight`],
        commit: ['POST', `/api/device/daily-bot-imports/${input.id}/commit`],
        cancel: ['POST', `/api/device/daily-bot-imports/${input.id}/cancel`],
      };
      const route = routes[operation];
      if (
        !route ||
        (operation === 'update' && !['checkin', 'fortune'].includes(input.kind)) ||
        (['status', 'upload', 'preflight', 'commit', 'cancel'].includes(operation) &&
          !/^[A-Za-z0-9-]{16,80}$/.test(input.id)) ||
        (operation === 'upload' && (!Number.isInteger(input.sequence) || input.sequence < 0 || input.sequence >= 200))
      ) {
        throw Object.assign(new Error('DAILY_BOT_INVALID_REQUEST'), { code: 'DAILY_BOT_INVALID_REQUEST' });
      }
      return request(route[0], route[1], route[0] === 'GET' ? undefined : input.body, token);
    },
    getWelcomeSettings: (token) => request('GET', '/api/device/welcome-settings', undefined, token),
    updateWelcomeSettings: (settings, token) => request('PUT', '/api/device/welcome-settings', settings, token),
    getWelcomeSettingsV2: (token) => request('GET', '/api/device/welcome-settings/v2', undefined, token),
    updateWelcomeSettingsV2: (settings, token) => request('PUT', '/api/device/welcome-settings/v2', settings, token),
    getPkReportSettings: (token) => request('GET', '/api/device/pk-report-settings', undefined, token),
    updatePkReportSettings: (settings, token) => request('PUT', '/api/device/pk-report-settings', settings, token),
  };
}

module.exports = { createRemoteDanmakuSettings };
