'use strict';

const { fetchJson, joinApiUrl, createPublicError } = require('../http-client');
const { requireApiQuota } = require('../api-quota-store');

function createAmapTool(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const quotaStore = options.quotaStore;

  async function request(config, pathName, params) {
    if (!config.amapApiHost || !config.amapApiKey) {
      throw createPublicError('AMAP_NOT_CONFIGURED', '高德地图尚未配置。');
    }
    const url = joinApiUrl(config.amapApiHost, pathName);
    url.searchParams.set('key', config.amapApiKey);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== '' && value !== null && value !== undefined) url.searchParams.set(key, String(value));
    }
    requireApiQuota(quotaStore, pathName === '/v3/place/text' ? 'amap_search' : 'amap_lbs');
    const payload = await fetchJson(url, { timeoutMs: config.requestTimeoutMs, fetchImpl });
    if (String(payload.status || '1') !== '1') {
      throw createPublicError(String(payload.infocode || 'AMAP_ERROR'), '高德地图查询失败。');
    }
    return payload;
  }

  async function resolveLocation(config, input) {
    const payload = await request(config, '/v3/geocode/geo', { address: input.address, city: input.city });
    const matches = (payload.geocodes || []).slice(0, 5).map((item) => ({
      formattedAddress: item.formatted_address || '', province: item.province || '', city: item.city || '',
      district: item.district || '', adcode: item.adcode || '', location: item.location || ''
    }));
    if (!matches.length) throw createPublicError('AMAP_LOCATION_NOT_FOUND', '没有查到这个地点。');
    return { ambiguous: matches.length > 1, matches };
  }

  async function searchPlaces(config, input) {
    const payload = await request(config, '/v3/place/text', {
      keywords: input.keywords, city: input.district || input.city, citylimit: input.city || input.district ? 'true' : 'false',
      location: input.location, offset: 5, page: 1, extensions: 'base'
    });
    return {
      count: Number(payload.count) || 0,
      places: (payload.pois || []).slice(0, 5).map((poi) => ({
        id: poi.id || '', name: poi.name || '', type: poi.type || '', address: poi.address || '',
        location: poi.location || '', distance: poi.distance || '', adname: poi.adname || ''
      }))
    };
  }

  async function getRoute(config, input) {
    const [origin, destination] = await Promise.all([
      ensureCoordinate(config, input.origin, input.city),
      ensureCoordinate(config, input.destination, input.city)
    ]);
    const mode = ['driving', 'transit', 'walking'].includes(input.mode) ? input.mode : 'driving';
    const pathName = mode === 'transit' ? '/v3/direction/transit/integrated' : `/v3/direction/${mode}`;
    const payload = await request(config, pathName, {
      origin: origin.location, destination: destination.location, city: input.city, extensions: 'base'
    });
    return normalizeRoute(payload.route, mode, origin, destination);
  }

  async function ensureCoordinate(config, value, city) {
    const text = String(value || '').trim();
    if (/^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(text)) return { location: text, name: text };
    const resolved = await resolveLocation(config, { address: text, city });
    if (resolved.ambiguous) return { ambiguous: true, candidates: resolved.matches };
    return { ...resolved.matches[0], name: text };
  }

  return { resolveLocation, searchPlaces, getRoute };
}

function normalizeRoute(route, mode, origin, destination) {
  if (origin.ambiguous || destination.ambiguous) {
    return { ambiguous: true, origin, destination };
  }
  const candidate = mode === 'transit' ? route?.transits?.[0] : route?.paths?.[0];
  if (!candidate) throw createPublicError('AMAP_ROUTE_NOT_FOUND', '没有查到可用路线。');
  return {
    mode, origin, destination,
    distanceMeters: Number(candidate.distance) || 0,
    durationSeconds: Number(candidate.duration) || 0,
    taxiCost: route?.taxi_cost || ''
  };
}

module.exports = { createAmapTool, normalizeRoute };
