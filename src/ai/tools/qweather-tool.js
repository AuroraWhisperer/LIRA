'use strict';

const { fetchJson, joinApiUrl, createPublicError } = require('../http-client');

function createQWeatherTool(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  async function resolveLocation(config, location) {
    requireConfig(config);
    const url = joinApiUrl(config.qweatherApiHost, '/geo/v2/city/lookup');
    url.searchParams.set('location', String(location || ''));
    url.searchParams.set('number', '5');
    url.searchParams.set('key', config.qweatherApiKey);
    const payload = await fetchJson(url, { timeoutMs: config.requestTimeoutMs, fetchImpl });
    const candidates = Array.isArray(payload?.location) ? payload.location : [];
    if (!candidates.length) throw createPublicError('WEATHER_LOCATION_NOT_FOUND', '没有查到这个天气地点。');
    if (isAmbiguousLocation(location, candidates)) {
      return { ambiguous: true, candidates: candidates.slice(0, 3).map(normalizeLocation) };
    }
    return { ambiguous: false, location: normalizeLocation(candidates[0]) };
  }

  async function getWeather(config, input) {
    const resolved = await resolveLocation(config, input.location);
    if (resolved.ambiguous) return resolved;
    const location = resolved.location;
    const dataType = input.dataType || 'weather';
    if (dataType === 'air') return getAir(config, location);
    if (dataType === 'warning') return getWarning(config, location);
    const pathName = shouldUseForecast(input.date) ? '/v7/weather/3d' : '/v7/weather/now';
    const url = joinApiUrl(config.qweatherApiHost, pathName);
    url.searchParams.set('location', location.id);
    url.searchParams.set('key', config.qweatherApiKey);
    const payload = await fetchJson(url, { timeoutMs: config.requestTimeoutMs, fetchImpl });
    return {
      location,
      observedAt: payload.updateTime || '',
      now: payload.now || null,
      forecast: Array.isArray(payload.daily) ? payload.daily : []
    };
  }

  async function getAir(config, location) {
    const url = joinApiUrl(config.qweatherApiHost, '/v7/air/now');
    url.searchParams.set('location', location.id);
    url.searchParams.set('key', config.qweatherApiKey);
    const payload = await fetchJson(url, { timeoutMs: config.requestTimeoutMs, fetchImpl });
    return { location, observedAt: payload.updateTime || '', air: payload.now || null };
  }

  async function getWarning(config, location) {
    const url = joinApiUrl(config.qweatherApiHost, '/v7/warning/now');
    url.searchParams.set('location', location.id);
    url.searchParams.set('key', config.qweatherApiKey);
    const payload = await fetchJson(url, { timeoutMs: config.requestTimeoutMs, fetchImpl });
    return { location, observedAt: payload.updateTime || '', warnings: payload.warning || [] };
  }

  return { resolveLocation, getWeather };
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
