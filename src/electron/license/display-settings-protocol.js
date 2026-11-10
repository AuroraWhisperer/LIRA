'use strict';

const { RemoteLicenseError } = require('./remote-license-error');
const { sanitizeWelcomeV2 } = require('../../shared/welcome-settings-contract');
const { fixedReplyParameters, sanitizeFixedReplySettings } = require('../../shared/fixed-reply-contract');

function createDisplaySettingsEndpoints({ request }) {
  return {
    getOverlaySettings: (token, requestOptions) => request('GET', '/api/device/overlay-settings', undefined, token, requestOptions),
    updateOverlaySettings: (settings, token) => request('PUT', '/api/device/overlay-settings', settings, token),

    getOverlayFilters: (token) => request('GET', '/api/device/overlay-filters', undefined, token),
    updateOverlayFilters: (settings, token) => request('PUT', '/api/device/overlay-filters', settings, token),
    getOverlayViewers: (token) => request('GET', '/api/device/overlay-viewers?limit=200', undefined, token),
    dailyBotRequest: (operation, input, token) => {
      const routes = {
        read: ['GET', '/api/device/daily-bot-settings'],
        update: ['PUT', `/api/device/daily-bot-settings/${input.kind}`],
        readLibrary: ['GET', `/api/device/daily-bot-libraries/${input.kind}${input.version ? `?version=${input.version}` : ''}`],
        updateLibrary: ['PUT', `/api/device/daily-bot-libraries/${input.kind}`],
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
        (['update', 'readLibrary', 'updateLibrary'].includes(operation) && !['checkin', 'fortune'].includes(input.kind)) ||
        (operation === 'readLibrary' && input.version !== undefined &&
          (typeof input.version !== 'string' || !/^[a-f0-9]{64}$/.test(input.version))) ||
        (['status', 'upload', 'preflight', 'commit', 'cancel'].includes(operation) &&
          !/^[A-Za-z0-9-]{16,80}$/.test(input.id)) ||
        (operation === 'upload' && (!Number.isInteger(input.sequence) || input.sequence < 0 || input.sequence >= 200))
      ) {
        throw Object.assign(new Error('DAILY_BOT_INVALID_REQUEST'), { code: 'DAILY_BOT_INVALID_REQUEST' });
      }
      const [method, pathname] = route;
      return request(method, pathname, method === 'GET' ? undefined : input.body, token);
    },
    getWelcomeSettings: (token) => request('GET', '/api/device/welcome-settings', undefined, token),
    updateWelcomeSettings: (settings, token) => request('PUT', '/api/device/welcome-settings', settings, token),
    getWelcomeSettingsV2: (token) => request('GET', '/api/device/welcome-settings/v2', undefined, token),
    updateWelcomeSettingsV2: (settings, token) => request('PUT', '/api/device/welcome-settings/v2', settings, token),
    getPkReportSettings: (token) => request('GET', '/api/device/pk-report-settings', undefined, token),
    updatePkReportSettings: (settings, token) => request('PUT', '/api/device/pk-report-settings', settings, token),
  };
}

function createDisplaySettingsOperations({ remote, withAuthorizedToken, getAuthorizationGeneration, getOverlayOwner, isDisposed }) {
  let pendingOverlaySettings = null;

  function getOverlaySettings(requestOptions = {}) {
    const read = () => overlayOperation((token) => remote.getOverlaySettings(token, requestOptions), requestOptions.signal);
    // The event subscriber owns its abort signal; only ordinary reads share work.
    if (requestOptions.signal) return read();
    const owner = getOverlayOwner();
    const generation = getAuthorizationGeneration();
    if (pendingOverlaySettings?.owner === owner && pendingOverlaySettings.generation === generation) {
      return pendingOverlaySettings.promise;
    }
    const pending = { owner, generation };
    pending.promise = read().finally(() => {
      if (pendingOverlaySettings === pending) pendingOverlaySettings = null;
    });
    pendingOverlaySettings = pending;
    return pending.promise;
  }

  async function updateOverlaySettings(settings) {
    return overlayOperation((token) => remote.updateOverlaySettings(settings, token));
  }

  function overlayFilterOperation(operation) {
    return overlayOperation(async (token) => {
      try {
        return await operation(token);
      } catch (error) {
        if (error.status === 404 || error.status === 405) {
          throw new RemoteLicenseError('OVERLAY_FILTERS_UNSUPPORTED', '请更新服务器后使用弹幕屏蔽。');
        }
        throw error;
      }
    });
  }

  async function getOverlayFilters() {
    return overlayFilterOperation((token) => remote.getOverlayFilters(token));
  }

  async function updateOverlayFilters(settings) {
    return overlayFilterOperation((token) => remote.updateOverlayFilters(settings, token));
  }

  async function getOverlayViewers() {
    return overlayFilterOperation((token) => remote.getOverlayViewers(token));
  }

  async function getWelcomeSettings() {
    return overlayOperation((token) => remote.getWelcomeSettings(token));
  }

  async function dailyBotRequestInternal(operation, input = {}) {
    return overlayOperation((token) => remote.dailyBotRequest(operation, input, token));
  }

  async function getWelcomeSettingsV2() {
    return overlayOperation(async (token) => {
      try {
        return sanitizeWelcomeV2(await remote.getWelcomeSettingsV2(token));
      } catch (error) {
        if (error.status !== 404) throw error;
        return { ...(await remote.getWelcomeSettings(token)), schemaVersion: 1 };
      }
    });
  }

  async function updateWelcomeSettingsV2(settings) {
    return overlayOperation((token) => remote.updateWelcomeSettingsV2(settings, token));
  }

  async function getPkReportSettings() {
    return overlayOperation((token) => remote.getPkReportSettings(token));
  }

  async function getFixedReplySettings() {
    return overlayOperation(async (token) => {
      const state = await remote.getCloudState(token);
      return fixedReplyState(state?.settings);
    });
  }

  async function updateFixedReplySettings(settings) {
    const patch = fixedReplyParameters(settings);
    return overlayOperation(async (token) => {
      const state = await remote.updateCloudSettings(patch, token);
      return fixedReplyState(state);
    });
  }

  function fixedReplyState(state) {
    const settings = sanitizeFixedReplySettings({ ...state?.values, ok: true });
    if (!Number.isSafeInteger(state.revision) || state.revision < 0) {
      throw new RemoteLicenseError('INVALID_RESPONSE', '固定回复设置未确认，请刷新后重试。');
    }
    return { ...settings, revision: state.revision };
  }

  async function updatePkReportSettings(settings) {
    return overlayOperation((token) => remote.updatePkReportSettings(settings, token));
  }

  async function updateWelcomeSettings(settings) {
    return overlayOperation((token) => remote.updateWelcomeSettings(settings, token));
  }

  function overlayOperation(operation, signal) {
    const owner = getOverlayOwner();
    const assertOwner = () => {
      if (isDisposed() || owner !== getOverlayOwner()) {
        throw new RemoteLicenseError('LICENSE_NOT_AUTHORIZED', '授权账号已变化，请重新读取配置。');
      }
    };
    return withAuthorizedToken(
      async (token) => {
        assertOwner();
        const result = await operation(token);
        assertOwner();
        return result;
      },
      { signal },
    );
  }

  return { getOverlaySettings, updateOverlaySettings, getOverlayFilters, updateOverlayFilters, getOverlayViewers, getWelcomeSettings, dailyBotRequestInternal, getWelcomeSettingsV2, updateWelcomeSettingsV2, getPkReportSettings, getFixedReplySettings, updateFixedReplySettings, updatePkReportSettings, updateWelcomeSettings };
}

module.exports = { createDisplaySettingsEndpoints, createDisplaySettingsOperations };
