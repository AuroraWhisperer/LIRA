'use strict';

const {
  normalizeProcessedGiftEvent,
} = require('../../shared/processed-gift-contract');
const { isDnsHostname } = require('../../shared/remote-url-policy');

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
  if (
    parsedBase.protocol !== 'https:' ||
    !isDnsHostname(parsedBase.hostname) ||
    parsedBase.username ||
    parsedBase.password ||
    parsedBase.pathname !== '/' ||
    parsedBase.search ||
    parsedBase.hash
  ) {
    throw new Error(
      'License API base URL must be an HTTPS root origin with a DNS hostname and without credentials, query, or fragment.',
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
    const externalSignal = requestOptions.signal;
    let timedOut = false;
    const abortFromCaller = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener('abort', abortFromCaller, {
      once: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
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
      const maxResponseBytes = Math.max(
        1024,
        Number(requestOptions.maxResponseBytes) || 1024 * 1024,
      );
      if (text.length > maxResponseBytes) {
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
      if (error?.name === 'AbortError' && externalSignal?.aborted) throw error;
      if (error?.name === 'AbortError' && timedOut)
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
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }

  async function request(method, pathname, payload, token, requestOptions) {
    return requestWithBody(
      method,
      pathname,
      payload === undefined ? undefined : JSON.stringify(payload),
      payload === undefined ? '' : 'application/json',
      token,
      requestOptions,
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

  async function watchCloudStateChanges(token, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/device/cloud-state/events`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: options.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new RemoteLicenseError(
        'NETWORK_UNAVAILABLE',
        '无法连接授权服务器，请检查网络后重试。',
        { retryable: true },
      );
    }

    if (!response.ok) {
      const error = await readStreamError(response);
      throw error;
    }
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (!/^text\/event-stream(?:\s*;|$)/iu.test(contentType)) {
      throw new RemoteLicenseError(
        'INVALID_RESPONSE',
        '授权服务器返回无效响应。',
        { status: response.status, retryable: true },
      );
    }
    if (!response.body?.getReader) {
      throw new RemoteLicenseError(
        'INVALID_RESPONSE',
        '授权服务器返回无效响应。',
        { status: response.status, retryable: true },
      );
    }

    options.onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        if (buffer.length > 64 * 1024) {
          throw new RemoteLicenseError(
            'RESPONSE_TOO_LARGE',
            '授权服务器响应过大。',
            { status: response.status, retryable: true },
          );
        }
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handleCloudStateEventBlock(block, options.onChange);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  async function getGiftEvents(after, limit, token, options = {}) {
    const query = new URLSearchParams();
    if (after !== null && after !== undefined) {
      query.set('after', String(after));
    }
    query.set('limit', String(limit));
    if (options.syncEpoch) query.set('syncEpoch', String(options.syncEpoch));
    return request(
      'GET',
      `/api/device/gift-events?${query.toString()}`,
      undefined,
      token,
      { maxResponseBytes: 512 * 1024, signal: options.signal },
    );
  }

  async function getGiftHistory(pageToken, token, options = {}) {
    const query = new URLSearchParams();
    if (pageToken !== null && pageToken !== undefined) {
      query.set('pageToken', String(pageToken));
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return request(
      'GET',
      `/api/device/gift-history${suffix}`,
      undefined,
      token,
      { maxResponseBytes: 512 * 1024, signal: options.signal },
    );
  }

  async function watchGiftEvents(token, options = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}/api/device/gift-events/stream`, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${token}`,
        },
        signal: options.signal,
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new RemoteLicenseError(
        'NETWORK_UNAVAILABLE',
        '无法连接授权服务器，请检查网络后重试。',
        { retryable: true },
      );
    }

    if (!response.ok) throw await readStreamError(response);
    const contentType = String(response.headers?.get?.('content-type') || '');
    if (!/^text\/event-stream(?:\s*;|$)/iu.test(contentType)) {
      throw new RemoteLicenseError(
        'INVALID_RESPONSE',
        '授权服务器返回无效响应。',
        { status: response.status, retryable: true },
      );
    }
    if (!response.body?.getReader) {
      throw new RemoteLicenseError(
        'INVALID_RESPONSE',
        '授权服务器返回无效响应。',
        { status: response.status, retryable: true },
      );
    }

    const rawSyncEpoch = response.headers?.get?.(
      'x-lira-gift-sync-epoch',
    );
    const syncEpoch = normalizeSyncEpochHeader(rawSyncEpoch);
    if (rawSyncEpoch !== null && syncEpoch === null) {
      throw new RemoteLicenseError(
        'INVALID_RESPONSE',
        '授权服务器返回无效响应。',
        { status: response.status, retryable: true },
      );
    }
    options.onOpen?.({ syncEpoch });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        if (buffer.length > 64 * 1024) {
          throw new RemoteLicenseError(
            'RESPONSE_TOO_LARGE',
            '授权服务器响应过大。',
            { status: response.status, retryable: true },
          );
        }
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary = buffer.indexOf('\n\n');
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          handleGiftEventBlock(block, options.onEvent);
          boundary = buffer.indexOf('\n\n');
        }
        if (done) break;
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  return {
    baseUrl,
    activate: (body) => request('POST', '/api/device/activate', body),
    challenge: (body) => request('POST', '/api/device/challenge', body),
    verify: (body) => request('POST', '/api/device/verify', body),
    heartbeat: (token) => request('POST', '/api/device/heartbeat', {}, token),
    profile: (token) => request('GET', '/api/device/profile', undefined, token),
    getCloudState: (token) =>
      request('GET', '/api/device/cloud-state', undefined, token),
    watchCloudStateChanges,
    getGiftEvents,
    getGiftHistory,
    watchGiftEvents,
    updateCloudSettings: (settings, token) =>
      request('PUT', '/api/device/cloud-settings', settings, token),
    syncSongs: (songs, token) =>
      request('PUT', '/api/device/songs/sync', { songs }, token),
    getCloudSongs: (token) =>
      request('GET', '/api/device/songs', undefined, token, {
        maxResponseBytes: 4 * 1024 * 1024,
      }),
    getBilibiliCredentials: (token) =>
      request('GET', '/api/device/bilibili-credentials', undefined, token),
    setBilibiliCredentials: (cookie, token) =>
      request('PUT', '/api/device/bilibili-credentials', { cookie }, token),
    clearBilibiliCredentials: (token) =>
      request(
        'DELETE',
        '/api/device/bilibili-credentials',
        undefined,
        token,
      ),
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
  };
}

function handleGiftEventBlock(block, onEvent) {
  let eventName = '';
  const dataLines = [];
  for (const line of String(block || '').split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (eventName !== 'gift-event' || dataLines.length === 0) return;
  try {
    const event = normalizeProcessedGiftEvent(
      JSON.parse(dataLines.join('\n')),
    );
    onEvent?.(event);
  } catch (error) {
    // A malformed event is isolated to its SSE block. Cursor recovery remains
    // authoritative for valid finalized events after reconnect.
    void error;
    return;
  }
}

function handleCloudStateEventBlock(block, onChange) {
  let eventName = '';
  const dataLines = [];
  for (const line of String(block || '').split('\n')) {
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (eventName !== 'cloud-state-changed' || dataLines.length === 0) return;
  let parsed;
  try {
    parsed = JSON.parse(dataLines.join('\n'));
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

async function readStreamError(response) {
  let data = {};
  try {
    const text = await response.text();
    if (text.length <= 64 * 1024) data = text ? JSON.parse(text) : {};
  } catch (error) {
    void error;
  }
  const code = normalizeErrorCode(
    data?.error || data?.code,
    `HTTP_${response.status}`,
  );
  return new RemoteLicenseError(code, code, {
    status: response.status,
    retryable: isRetryableStatus(response.status),
  });
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

function normalizeSyncEpochHeader(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text || text.length > 128 || /[\r\n]/u.test(text)) return null;
  return text;
}

function resolveConfiguredBaseUrl(value) {
  return String(value || process.env.LIRA_LICENSE_API_BASE || DEFAULT_BASE_URL)
    .trim()
    .replace(/\/+$/, '');
}

module.exports = {
  DEFAULT_BASE_URL,
  createRemoteLicenseClient,
  handleGiftEventBlock,
  RemoteLicenseError,
  normalizeErrorCode,
  resolveConfiguredBaseUrl,
};
