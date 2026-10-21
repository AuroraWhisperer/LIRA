'use strict';

const { version } = require('../../package.json');
const { readResponseText } = require('../shared/response-body');

const HOUR_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 128;
const USER_AGENT = `LIRA/${version} (+https://github.com/AuroraWhisperer/LIRA)`;

function unavailable() {
  return Object.assign(new Error('温度暂时无法更新，请稍后再试。'), { status: 503 });
}

function coordinate(value, limit) {
  const number = Number(value);
  if (value == null || String(value).trim() === '' || !Number.isFinite(number) || Math.abs(number) > limit) {
    throw Object.assign(new Error('请提供有效的经纬度。'), { status: 400 });
  }
  return Number(number.toFixed(4));
}

function currentTemperature(data, now) {
  const updatedAt = Date.parse(data?.updatedAt);
  if (!Number.isFinite(updatedAt) || now - updatedAt > 24 * HOUR_MS || updatedAt > now + HOUR_MS) throw unavailable();
  return { ...data };
}

function parseWeather(html, latitude, longitude, now) {
  const match = html.match(/<script\b(?=[^>]*\sid=["']redux-data["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!match) throw unavailable();
  const state = JSON.parse(match[1]).WeatherData?.['_@STATE@_'];
  const location = state?.currentLocation;
  const current = state?.currentCondition;
  const temperature = current?.currentRaw?.temp;
  const updatedAt = Date.parse(current?.currentRaw?.created);
  if (state?.fallbackedLocation || coordinate(location?.latitude, 90) !== latitude
    || coordinate(location?.longitude, 180) !== longitude || current?.unitsRaw?.temperature !== '°C'
    || !Number.isFinite(temperature) || !Number.isFinite(updatedAt)) throw unavailable();
  const timestamp = new Date(updatedAt).toISOString();
  return currentTemperature({
    temperature: Math.round(temperature * 10) / 10,
    validAt: timestamp,
    updatedAt: timestamp,
    fetchedAt: new Date(now).toISOString(),
  }, now);
}

function createWorldClockTemperature(options = {}) {
  const fetchImpl = options.fetch || fetch;
  const now = options.now || Date.now;
  const cache = new Map();
  const controller = new AbortController();

  async function refresh(entry, latitude, longitude) {
    const startedAt = now();
    try {
      const url = new URL('https://www.msn.cn/zh-cn/weather/forecast');
      url.searchParams.set('loc', Buffer.from(JSON.stringify({
        g: 'zh-cn', x: String(longitude), y: String(latitude),
      })).toString('base64'));
      url.searchParams.set('weadegreetype', 'C');
      const response = await fetchImpl(
        url,
        { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) },
      );
      if (!response.ok) {
        const retry = response.headers.get('retry-after');
        entry.retryAt = Math.max(now() + 60000, /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry) || 0);
        await response.body?.cancel();
        throw unavailable();
      }
      const text = await readResponseText(response, 512 * 1024, unavailable);
      entry.data = parseWeather(text, latitude, longitude, now());
      entry.expiresAt = startedAt + HOUR_MS - startedAt % HOUR_MS;
      entry.retryAt = 0;
    } catch {
      entry.retryAt = Math.max(entry.retryAt, now() + 60000);
      throw unavailable();
    }
  }

  async function getTemperature(input) {
    const latitude = coordinate(input.latitude, 90);
    const longitude = coordinate(input.longitude, 180);
    if (controller.signal.aborted) throw unavailable();
    const key = `${latitude},${longitude}`;
    let entry = cache.get(key);
    if (!entry) {
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const expired = [...cache].find(([, value]) => !value.pending && Math.max(value.expiresAt, value.retryAt) <= now());
        if (!expired) throw unavailable();
        cache.delete(expired[0]);
      }
      entry = { expiresAt: 0, retryAt: 0, pending: null };
      cache.set(key, entry);
    }
    if (entry.retryAt > now()) throw unavailable();
    if (entry.expiresAt <= now()) {
      if (!entry.pending) {
        entry.pending = refresh(entry, latitude, longitude).finally(() => { entry.pending = null; });
      }
      await entry.pending;
    }
    if (controller.signal.aborted) throw unavailable();
    return currentTemperature(entry.data, now());
  }

  async function close() {
    controller.abort();
    await Promise.allSettled([...cache.values()].map(entry => entry.pending));
    cache.clear();
  }

  return { getTemperature, close };
}

module.exports = { createWorldClockTemperature };
