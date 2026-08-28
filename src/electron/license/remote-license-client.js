'use strict';

class RemoteLicenseError extends Error {
  constructor(code, message, options = {}) {
    super(message || code);
    this.name = 'RemoteLicenseError';
    this.code = code;
    this.status = options.status || 0;
    this.retryable = options.retryable === true;
  }
}

function createRemoteLicenseClient(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) || 10000;
  const baseUrl = String(options.baseUrl || process.env.LIRA_LICENSE_API_BASE || 'https://api.lirahub.cn')
    .replace(/\/+$/, '');
  const parsedBase = new URL(baseUrl);
  const allowInsecure = Boolean(options.allowInsecure || process.env.NODE_ENV === 'test' || !options.isProduction);
  if (parsedBase.protocol !== 'https:' && !(allowInsecure && parsedBase.hostname === '127.0.0.1')) {
    throw new Error('License API must use HTTPS.');
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');

  async function request(method, pathname, payload, token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        signal: controller.signal,
        redirect: 'error'
      });
      const text = await response.text();
      if (text.length > 1024 * 1024) throw new RemoteLicenseError('RESPONSE_TOO_LARGE', '授权服务器响应过大。');
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch (_) {
        throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', { status: response.status });
      }
      if (!response.ok || data.ok === false) {
        const code = String(data.error || data.code || `HTTP_${response.status}`);
        throw new RemoteLicenseError(code, code, {
          status: response.status,
          retryable: response.status >= 500
        });
      }
      return data;
    } catch (error) {
      if (error instanceof RemoteLicenseError) throw error;
      if (error?.name === 'AbortError') throw new RemoteLicenseError('REQUEST_TIMEOUT', '连接授权服务器超时，请重试。', { retryable: true });
      throw new RemoteLicenseError('NETWORK_UNAVAILABLE', '无法连接授权服务器，请检查网络后重试。', { retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl,
    activate: body => request('POST', '/api/device/activate', body),
    challenge: body => request('POST', '/api/device/challenge', body),
    verify: body => request('POST', '/api/device/verify', body),
    heartbeat: token => request('POST', '/api/device/heartbeat', {}, token),
    profile: token => request('GET', '/api/device/profile', undefined, token),
    syncSongs: (songs, token) => request('PUT', '/api/device/songs/sync', { songs }, token),
    createPairingCode: token => request('POST', '/api/device/pairing-codes', {}, token),
    listPairingCodes: token => request('GET', '/api/device/pairing-codes', undefined, token),
    revokePairingCode: (id, token) => request('POST', `/api/device/pairing-codes/${encodeURIComponent(String(id))}/revoke`, {}, token)
  };
}

module.exports = { createRemoteLicenseClient, RemoteLicenseError };
