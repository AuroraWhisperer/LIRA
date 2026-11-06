'use strict';

const { normalizeRemoteRootOrigin } = require('../../shared/remote-url-policy');
const { readBoundedSse } = require('../../shared/bounded-sse-reader');
const { RemoteLicenseError, normalizeErrorCode } = require('./remote-license-error');

const DEFAULT_BASE_URL = 'https://api.lirahub.cn';

function createLicenseTransport(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs) || 10000;
  const now = options.now || Date.now;
  const baseUrl = resolveConfiguredBaseUrl(options.baseUrl);
  if (!normalizeRemoteRootOrigin(baseUrl)) {
    throw new Error(
      'License API base URL must be an HTTPS root origin with a DNS hostname and without credentials, query, or fragment.',
    );
  }
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable.');

  async function requestWithBody(method, pathname, body, contentType, token, requestOptions = {}) {
    const controller = new AbortController();
    const externalSignal = requestOptions.signal;
    let timedOut = false;
    const abortFromCaller = () => controller.abort(externalSignal.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else
      externalSignal?.addEventListener('abort', abortFromCaller, {
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
      const maxResponseBytes = Math.max(1024, Number(requestOptions.maxResponseBytes) || 1024 * 1024);
      const text = await readResponseText(
        response,
        maxResponseBytes,
        () =>
          new RemoteLicenseError(
            'RESPONSE_TOO_LARGE',
            requestOptions.responseTooLargeMessage || '授权服务器响应过大。',
            {
              status: response.status,
              retryAfterMs: readRetryAfter(response, now()),
              retryable: requestOptions.retryResponseTooLarge !== false && (response.ok || isRetryableStatus(response.status)),
            },
          ),
      );
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (_) {
        throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', {
          status: response.status,
          retryAfterMs: readRetryAfter(response, now()),
          retryable: response.ok || isRetryableStatus(response.status),
        });
      }
      // Protocol responses must be JSON objects. Reject other shapes here so
      // they remain INVALID_RESPONSE instead of becoming network errors.
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', {
          status: response.status,
          retryAfterMs: readRetryAfter(response, now()),
          retryable: response.ok || isRetryableStatus(response.status),
        });
      }
      if (!response.ok || data.ok === false) {
        const code = normalizeErrorCode(data.error || data.code, `HTTP_${response.status}`);
        throw new RemoteLicenseError(code, code, {
          status: response.status,
          retryAfterMs: readRetryAfter(response, now()),
          retryable: isRetryableStatus(response.status),
          index: data.index,
          fieldErrors: data.fieldErrors,
        });
      }
      if (requestOptions.includeResponseMeta === true) {
        return {
          ...data,
          etag: safeHeaderValue(response.headers?.get?.('etag')) || safeHeaderValue(data.etag),
        };
      }
      return data;
    } catch (error) {
      if (error instanceof RemoteLicenseError) throw error;
      if (error?.name === 'AbortError' && externalSignal?.aborted) throw error;
      if (error?.name === 'AbortError' && timedOut)
        throw new RemoteLicenseError('REQUEST_TIMEOUT', '连接授权服务器超时，请重试。', { retryable: true });
      throw new RemoteLicenseError('NETWORK_UNAVAILABLE', '无法连接授权服务器，请检查网络后重试。', {
        retryable: true,
      });
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

  async function readEventStream(pathname, token, options, onOpen, onBlock, headers = {}) {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(options.signal.reason);
    if (options.signal?.aborted) abortFromCaller();
    else options.signal?.addEventListener('abort', abortFromCaller, { once: true });
    let timer;
    let timedOut = false;
    function deadline(delay) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, delay);
      timer.unref?.();
    }
    deadline(15_000);
    try {
      controller.signal.throwIfAborted();
      let response;
      try {
        response = await fetchImpl(`${baseUrl}${pathname}`, {
          method: 'GET',
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token}`,
            ...headers,
          },
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        throw new RemoteLicenseError('NETWORK_UNAVAILABLE', '无法连接授权服务器，请检查网络后重试。', { retryable: true });
      }
      if (!response.ok) throw await readStreamError(response, now());
      const contentType = String(response.headers?.get?.('content-type') || '');
      if (!/^text\/event-stream(?:\s*;|$)/iu.test(contentType) || !response.body?.getReader) {
        try {
          await response.body?.cancel?.();
        } catch (error) {
          void error;
        }
        throw new RemoteLicenseError('INVALID_RESPONSE', '授权服务器返回无效响应。', {
          status: response.status,
          retryable: true,
        });
      }
      return await readBoundedSse(response, {
        signal: controller.signal,
        onOpen(response) {
          deadline(60_000);
          onOpen(response);
        },
        onBlock(block) {
          deadline(60_000);
          onBlock(block);
        },
        createLimitError: () => new RemoteLicenseError('RESPONSE_TOO_LARGE', '授权服务器响应过大。', {
          status: response.status,
          retryable: true,
        }),
      });
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason;
      if (timedOut) throw new RemoteLicenseError('REQUEST_TIMEOUT', '连接授权服务器超时，请重试。', { retryable: true });
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  return { baseUrl, request, requestRaw, readEventStream };
}

async function readResponseText(response, maxBytes, createLimitError) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw createLimitError();
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw createLimitError();
      }
      chunks.push(Buffer.from(value));
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks, bytes));
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw createLimitError();
    return text;
  } finally {
    reader.releaseLock();
  }
}

async function readStreamError(response, now) {
  let data = {};
  try {
    const text = await readResponseText(
      response,
      64 * 1024,
      () => new RemoteLicenseError('RESPONSE_TOO_LARGE', '授权服务器响应过大。'),
    );
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    void error;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  const code = normalizeErrorCode(data?.error || data?.code, `HTTP_${response.status}`);
  return new RemoteLicenseError(code, code, {
    status: response.status,
    retryAfterMs: readRetryAfter(response, now),
    retryable: isRetryableStatus(response.status),
    index: data.index,
  });
}

function readRetryAfter(response, now) {
  const value = String(response.headers?.get?.('retry-after') || '').trim();
  if (!value) return undefined;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*[, ]/.test(value)
      ? Math.max(0, Date.parse(value) - now)
      : NaN;
  return Number.isSafeInteger(delay) && delay >= 0 ? delay : undefined;
}

function isRetryableStatus(status) {
  const value = Number(status) || 0;
  return value === 408 || value === 429 || value >= 500;
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

module.exports = { createLicenseTransport, DEFAULT_BASE_URL, resolveConfiguredBaseUrl, safeHeaderValue };
