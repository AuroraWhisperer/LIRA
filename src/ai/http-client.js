'use strict';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function fetchJson(url, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 12000;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let response;
  try {
    response = await fetchImpl(url, {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw createPublicError('UPSTREAM_TIMEOUT', '查询超时了，请稍后再试。');
    }
    throw createPublicError('UPSTREAM_UNAVAILABLE', '查询服务暂时不可用。');
  }

  const length = Number(response.headers?.get?.('content-length')) || 0;
  if (length > MAX_RESPONSE_BYTES) throw createPublicError('UPSTREAM_TOO_LARGE', '查询结果过大，无法处理。');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw createPublicError('UPSTREAM_TOO_LARGE', '查询结果过大，无法处理。');
  }
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw createPublicError('UPSTREAM_INVALID_RESPONSE', '查询服务返回了无法识别的数据。');
  }
  if (!response.ok) {
    const code = String(payload?.error?.code || payload?.code || `HTTP_${response.status}`).slice(0, 80);
    throw createPublicError(code, '查询服务返回错误，请检查配置或稍后再试。');
  }
  return payload;
}

function createPublicError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function joinApiUrl(host, pathName) {
  const base = String(host || '').replace(/\/+$/, '');
  return new URL(`${base}/${String(pathName || '').replace(/^\/+/, '')}`);
}

module.exports = { fetchJson, createPublicError, joinApiUrl };
