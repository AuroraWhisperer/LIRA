'use strict';

const { RemoteLicenseError } = require('./remote-license-error');
const { parseEventBlock } = require('../../shared/bounded-sse-reader');

function createCloudAccountEndpoints({ request, readEventStream }) {
  function watchCloudStateChanges(token, options = {}) {
    return readEventStream(
      '/api/device/cloud-state/events',
      token,
      options,
      () => options.onOpen?.(),
      (block) => handleCloudStateEventBlock(block, options.onChange),
    );
  }

  return {
    profile: (token) => request('GET', '/api/device/profile', undefined, token),
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
    watchCloudStateChanges,
    getFanFacts: (after, epoch, token, requestOptions = {}) => {
      const query = new URLSearchParams({ after: String(after), limit: '200' });
      if (epoch) query.set('epoch', epoch);
      return request('GET', `/api/device/fan-facts?${query}`, undefined, token, requestOptions);
    },
  };
}

function handleCloudStateEventBlock(block, onChange) {
  const { eventName, data } = parseEventBlock(block);
  if (eventName !== 'cloud-state-changed' || !data) return;
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (error) {
    void error;
    return;
  }
  const scopes = {};
  for (const scope of ['settings', 'songs', 'bilibili']) {
    const revision = Number(parsed?.scopes?.[scope]);
    if (Number.isSafeInteger(revision) && revision >= 0) {
      scopes[scope] = revision;
    }
  }
  if (Object.keys(scopes).length > 0) onChange?.({ scopes });
}

function createCloudAccountOperations({ remote, withAuthorizedToken, withAuthorizedSecret, getAuthorizationGeneration, setProfile, getSnapshot }) {
  let pendingProfile = null;

  function getProfile() {
    const generation = getAuthorizationGeneration();
    if (pendingProfile?.generation === generation) return pendingProfile.promise;
    const pending = { generation };
    pending.promise = withAuthorizedToken(
      (token) => remote.profile(token),
      {
        acceptResult: (result) => {
          setProfile(result);
          return getSnapshot();
        },
      },
    ).finally(() => {
      if (pendingProfile === pending) pendingProfile = null;
    });
    pendingProfile = pending;
    return pending.promise;
  }

  async function getCloudState(requestOptions = {}) {
    return withAuthorizedToken(
      (token) => remote.getCloudState(token, requestOptions), { signal: requestOptions.signal },
    );
  }

  async function watchCloudStateChangesInternal(options = {}) {
    return withAuthorizedToken((token) => remote.watchCloudStateChanges(token, options), { sanitize: false, signal: options.signal });
  }

  async function updateCloudSettings(settings, requestOptions = {}) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new RemoteLicenseError('INVALID_SYNC_SETTINGS', '云端同步设置格式无效。');
    }
    return withAuthorizedToken(
      (token) => remote.updateCloudSettings(settings, token, requestOptions), { signal: requestOptions.signal },
    );
  }

  async function getBilibiliCredentialsInternal(requestOptions = {}) {
    return withAuthorizedSecret((token) => remote.getBilibiliCredentials(token, requestOptions), requestOptions.signal);
  }

  function guardExpiryRequest(operation, requestOptions = {}) {
    return withAuthorizedToken(async (token) => {
      try { return await operation(token); }
      catch (error) {
        if (error.status === 404 || error.status === 405) {
          throw new RemoteLicenseError('GUARD_EXPIRY_UNSUPPORTED', '请更新服务器后使用大航海到期同步。');
        }
        throw error;
      }
    }, { signal: requestOptions.signal });
  }

  async function setBilibiliCredentialsInternal(cookie, requestOptions = {}) {
    const value = String(cookie || '').trim();
    if (!value || value.length > 12_000 || /[\r\n\0]/u.test(value)) {
      throw new RemoteLicenseError('BILIBILI_CREDENTIALS_INVALID', '直播账号登录凭据无效。');
    }
    return withAuthorizedToken(
      (token) => remote.setBilibiliCredentials(value, token, requestOptions), { signal: requestOptions.signal },
    );
  }

  async function clearBilibiliCredentialsInternal(requestOptions = {}) {
    return withAuthorizedToken(
      (token) => remote.clearBilibiliCredentials(token, requestOptions), { signal: requestOptions.signal },
    );
  }

  return {
    getProfile, getCloudState, watchCloudStateChangesInternal, updateCloudSettings, getBilibiliCredentialsInternal, setBilibiliCredentialsInternal, clearBilibiliCredentialsInternal,
    getGuardExpiryWarningsInternal: (requestOptions = {}) =>
      guardExpiryRequest((token) => remote.getGuardExpiryWarnings(token, requestOptions), requestOptions),
    getGuardExpiryAccountInternal: (requestOptions = {}) =>
      guardExpiryRequest((token) => remote.getGuardExpiryAccount(token, requestOptions), requestOptions),
    updateGuardExpiryAccountInternal: (input, requestOptions = {}) =>
      guardExpiryRequest((token) => remote.updateGuardExpiryAccount(input, token, requestOptions), requestOptions),
    clearGuardExpiryAccountInternal: (requestOptions = {}) =>
      guardExpiryRequest((token) => remote.clearGuardExpiryAccount(token, requestOptions), requestOptions),
    getFanFactsInternal: (input = {}) =>
      withAuthorizedToken(
        (token) => remote.getFanFacts(input.after || 0, input.epoch, token, { signal: input.signal }),
        { signal: input.signal },
      ),
  };
}

module.exports = { createCloudAccountEndpoints, createCloudAccountOperations };
