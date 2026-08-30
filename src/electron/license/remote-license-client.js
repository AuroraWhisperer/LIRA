'use strict';

const DEFAULT_BASE_URL = 'https://api.lirahub.cn';

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
  const baseUrl = resolveConfiguredBaseUrl(options.baseUrl);
  const parsedBase = new URL(baseUrl);
  const allowInsecure = Boolean(
    options.allowInsecure ||
    process.env.NODE_ENV === 'test' ||
    !options.isProduction,
  );
  if (
    parsedBase.protocol !== 'https:' &&
    !(allowInsecure && parsedBase.hostname === '127.0.0.1')
  ) {
    throw new Error('License API must use HTTPS.');
  }
  if (
    parsedBase.username ||
    parsedBase.password ||
    parsedBase.search ||
    parsedBase.hash
  ) {
    throw new Error(
      'License API base URL must not contain credentials or query parameters.',
    );
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');

  async function requestWithBody(
    method,
    pathname,
    body,
    contentType,
    token,
    requestOptions = {},
  ) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${pathname}`, {
        method,
        headers: {
          Accept: 'application/json',
          ...(contentType ? { 'Content-Type': contentType } : {}),
          ...(requestOptions.headers || {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
        redirect: 'error',
      });
      if (response.status === 304 && requestOptions.allowNotModified === true) {
        return {
          notModified: true,
          etag: safeHeaderValue(response.headers?.get?.('etag')),
        };
      }
      const text = await response.text();
      if (text.length > 1024 * 1024) {
        throw new RemoteLicenseError(
          'RESPONSE_TOO_LARGE',
          '授权服务器响应过大。',
          {
            status: response.status,
            retryable: response.ok || isRetryableStatus(response.status),
          },
        );
      }
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        throw new RemoteLicenseError(
          'INVALID_RESPONSE',
          '授权服务器返回无效响应。',
          {
            status: response.status,
            retryable: response.ok || isRetryableStatus(response.status),
          },
        );
      }
      // Every successful or structured error response in the protocol is a
      // JSON object.  Accessing `.ok` on `null` throws and spreading an array
      // into the metadata result silently changes the response shape; both
      // cases used to be misclassified as transient network failures.
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new RemoteLicenseError(
          'INVALID_RESPONSE',
          '授权服务器返回无效响应。',
          {
            status: response.status,
            retryable: response.ok || isRetryableStatus(response.status),
          },
        );
      }
      if (!response.ok || data.ok === false) {
        const code = normalizeErrorCode(
          data.error || data.code,
          `HTTP_${response.status}`,
        );
        throw new RemoteLicenseError(code, code, {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }
      if (requestOptions.includeResponseMeta === true) {
        return {
          ...data,
          etag:
            safeHeaderValue(response.headers?.get?.('etag')) ||
            safeHeaderValue(data.etag),
        };
      }
      return data;
    } catch (error) {
      if (error instanceof RemoteLicenseError) throw error;
      if (error?.name === 'AbortError')
        throw new RemoteLicenseError(
          'REQUEST_TIMEOUT',
          '连接授权服务器超时，请重试。',
          { retryable: true },
        );
      throw new RemoteLicenseError(
        'NETWORK_UNAVAILABLE',
        '无法连接授权服务器，请检查网络后重试。',
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(method, pathname, payload, token) {
    return requestWithBody(
      method,
      pathname,
      payload === undefined ? undefined : JSON.stringify(payload),
      payload === undefined ? '' : 'application/json',
      token,
    );
  }

  async function requestRaw(method, pathname, bodyBuffer, contentType, token) {
    return requestWithBody(method, pathname, bodyBuffer, contentType, token);
  }

  async function requestGiftCatalog(etag) {
    const normalizedEtag = safeHeaderValue(etag);
    return requestWithBody(
      'GET',
      '/api/public/gifts/catalog',
      undefined,
      '',
      // The catalog endpoint is public.  Never forward a device session token,
      // even when a caller has one available for other protected operations.
      undefined,
      {
        allowNotModified: true,
        includeResponseMeta: true,
        headers: normalizedEtag ? { 'If-None-Match': normalizedEtag } : {},
      },
    );
  }

  return {
    baseUrl,
    activate: (body) => request('POST', '/api/device/activate', body),
    challenge: (body) => request('POST', '/api/device/challenge', body),
    verify: (body) => request('POST', '/api/device/verify', body),
    heartbeat: (token) => request('POST', '/api/device/heartbeat', {}, token),
    profile: (token) => request('GET', '/api/device/profile', undefined, token),
    syncSongs: (songs, token) =>
      request('PUT', '/api/device/songs/sync', { songs }, token),
    getCloudSongs: (token) =>
      request('GET', '/api/device/songs', undefined, token),
    getGiftCatalog: (etag, token) => requestGiftCatalog(etag, token),
    getSongPageBackground: (token) =>
      request('GET', '/api/device/song-page/background', undefined, token),
    uploadSongPageBackground: (bytes, contentType, token) =>
      requestRaw(
        'PUT',
        '/api/device/song-page/background',
        bytes,
        contentType,
        token,
      ),
    deleteSongPageBackground: (token) =>
      request('DELETE', '/api/device/song-page/background', undefined, token),
    createPairingCode: (token) =>
      request('POST', '/api/device/pairing-codes', {}, token),
    listPairingCodes: (token) =>
      request('GET', '/api/device/pairing-codes', undefined, token),
    revokePairingCode: (id, token) =>
      request(
        'POST',
        `/api/device/pairing-codes/${encodeURIComponent(String(id))}/revoke`,
        {},
        token,
      ),
  };
}

function isRetryableStatus(status) {
  const value = Number(status) || 0;
  return value === 408 || value === 429 || value >= 500;
}

function normalizeErrorCode(value, fallback = 'LICENSE_ERROR') {
  const code = String(value ?? '').trim();
  return /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : fallback;
}

function safeHeaderValue(value) {
  const text = String(value || '')
    .trim()
    .slice(0, 256);
  return /[\r\n]/u.test(text) ? '' : text;
}

function resolveConfiguredBaseUrl(value) {
  return String(value || process.env.LIRA_LICENSE_API_BASE || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
}

module.exports = {
  DEFAULT_BASE_URL,
  createRemoteLicenseClient,
  RemoteLicenseError,
  normalizeErrorCode,
  resolveConfiguredBaseUrl,
};
