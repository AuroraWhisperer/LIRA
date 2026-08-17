'use strict';

const { fetchJson, joinApiUrl, createPublicError } = require('../http-client');
const { withApiQuota } = require('../api-quota-store');

function createQWeatherTool(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const quotaStore = options.quotaStore;

  async function resolveLocation(config, location, options = {}) {
    requireConfig(config);
    const url = joinApiUrl(config.qweatherApiHost, '/geo/v2/city/lookup');
    url.searchParams.set('location', String(location || ''));
    url.searchParams.set('number', '5');
    url.searchParams.set('key', config.qweatherApiKey);
    return requestWithQuota(url, config, (payload) => {
      const candidates = Array.isArray(payload?.location) ? payload.location : [];
      if (!candidates.length) throw createPublicError('WEATHER_LOCATION_NOT_FOUND', '没有查到这个天气地点。');
      if (isAmbiguousLocation(location, candidates)) {
        return { ambiguous: true, candidates: candidates.slice(0, 3).map(normalizeLocation) };
      }
      return { ambiguous: false, location: normalizeLocation(candidates[0]) };
    }, options);
  }

  async function getWeather(config, input, options = {}) {
    const resolved = await resolveLocation(config, input.location, options);
    if (resolved.ambiguous) return resolved;
    const location = resolved.location;
    const dataType = input.dataType || 'weather';
    if (dataType === 'air') return getAir(config, location, options);
    if (dataType === 'warning') return getWarning(config, location, options);
    const pathName = shouldUseForecast(input.date) ? '/v7/weather/3d' : '/v7/weather/now';
    const url = joinApiUrl(config.qweatherApiHost, pathName);
    url.searchParams.set('location', location.id);
    url.searchParams.set('key', config.qweatherApiKey);
    return requestWithQuota(url, config, (payload) => ({
      location,
      observedAt: payload.updateTime || '',
      now: payload.now || null,
      forecast: Array.isArray(payload.daily) ? payload.daily : []
    }), options);
  }

  async function getAir(config, location, options) {
    const url = joinApiUrl(config.qweatherApiHost, '/v7/air/now');
    url.searchParams.set('location', location.id);
    url.searchParams.set('key', config.qweatherApiKey);
    return requestWithQuota(url, config, (payload) => ({
      location, observedAt: payload.updateTime || '', air: payload.now || null
    }), options);
  }

  async function getWarning(config, location, options) {
    const url = joinApiUrl(config.qweatherApiHost, '/v7/warning/now');
    url.searchParams.set('location', location.id);
    url.searchParams.set('key', config.qweatherApiKey);
    return requestWithQuota(url, config, (payload) => ({
      location, observedAt: payload.updateTime || '', warnings: payload.warning || []
    }), options);
  }

  // 预扣配额 → 请求 → 校验业务 code；任何失败都退款，避免失败请求永久扣配额。
  async function requestWithQuota(url, config, transform = (payload) => payload, options = {}) {
    return withApiQuota(quotaStore, 'qweather', async () => {
      let payload;
      payload = await fetchJson(url, {
        timeoutMs: config.requestTimeoutMs,
        fetchImpl,
        signal: options.signal
      });
      const code = String(payload?.code || '');
      if (code === '401' || code === '403') {
        throw createPublicError('QWEATHER_AUTH_FAILED', '和风天气拒绝了该 API Key。');
      }
      if (code && code !== '200') {
        throw createPublicError('QWEATHER_REJECTED', '和风天气返回了业务错误。');
      }
      return transform(payload);
    });
  }

  async function testConnection(config = {}, options = {}) {
    if (!config.qweatherApiHost) {
      throw createPublicError('QWEATHER_HOST_MISSING', '请先填写和风天气专属 API Host。');
    }
    if (!config.qweatherApiKey) {
      throw createPublicError('QWEATHER_KEY_MISSING', '请先填写和风天气 API Key。');
    }
    const url = joinApiUrl(config.qweatherApiHost, '/geo/v2/city/lookup');
    url.searchParams.set('location', '北京');
    url.searchParams.set('number', '1');
    url.searchParams.set('key', config.qweatherApiKey);
    try {
      return await requestWithQuota(url, config, (payload) => {
        if (!Array.isArray(payload?.location) || !payload.location[0]?.id) {
          throw createPublicError('QWEATHER_INVALID_RESPONSE', '和风天气返回格式不正确。');
        }
        return { provider: 'qweather' };
      }, options);
    } catch (error) {
      if (/^(?:401|403|HTTP_401|HTTP_403)$/i.test(String(error?.code || ''))) {
        throw createPublicError('QWEATHER_AUTH_FAILED', '和风天气拒绝了该 API Key。');
      }
      throw error;
    }
  }

  return { resolveLocation, getWeather, testConnection };
}

function requireConfig(config) {
  if (!config.qweatherApiHost || !config.qweatherApiKey) {
    throw createPublicError('QWEATHER_NOT_CONFIGURED', '和风天气尚未配置。');
  }
}

function normalizeLocation(item) {
  return {
    id: String(item?.id || ''), name: String(item?.name || ''),
    adm1: String(item?.adm1 || ''), adm2: String(item?.adm2 || ''),
    country: String(item?.country || ''), lat: String(item?.lat || ''), lon: String(item?.lon || '')
  };
}

function isAmbiguousLocation(query, candidates) {
  const normalized = String(query || '').trim();
  if (!normalized || candidates.length < 2) return false;
  const first = normalizeLocation(candidates[0]);
  const second = normalizeLocation(candidates[1]);
  return first.name === second.name && `${first.adm1}${first.adm2}` !== `${second.adm1}${second.adm2}`;
}

function shouldUseForecast(date) {
  return !['', 'today', '今天', 'now', '现在'].includes(String(date || '').trim().toLowerCase());
}

module.exports = { createQWeatherTool, isAmbiguousLocation };
