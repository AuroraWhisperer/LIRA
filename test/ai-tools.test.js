'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCurrentTime } = require('../src/ai/tools/current-time-tool');
const { createQWeatherTool } = require('../src/ai/tools/qweather-tool');
const { createAmapTool } = require('../src/ai/tools/amap-tool');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('current time tool uses IANA timezone without an external API', () => {
  const result = getCurrentTime(
    { timeZone: 'Asia/Shanghai' },
    { now: '2026-08-06T04:00:00.000Z' },
  );
  assert.equal(result.timeZone, 'Asia/Shanghai');
  assert.match(result.formatted, /12:00:00/);
  assert.throws(() => getCurrentTime({ timeZone: 'Not/AZone' }), /时区/);
});

test('QWeather does not send a request after its monthly quota is exhausted', async () => {
  let fetchCalls = 0;
  const tool = createQWeatherTool({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({});
    },
    quotaStore: { consume: () => ({ allowed: false }) },
  });
  await assert.rejects(
    tool.getWeather(
      { qweatherApiHost: 'https://weather.test', qweatherApiKey: 'key' },
      { location: '苏州' },
    ),
    (error) => error.code === 'QWEATHER_MONTHLY_LIMIT',
  );
  assert.equal(fetchCalls, 0);
});

test('QWeather refunds quota when a successful response has no locations', async () => {
  let releases = 0;
  const tool = createQWeatherTool({
    fetchImpl: async () => jsonResponse({ code: '200', location: [] }),
    quotaStore: {
      consume: () => ({ allowed: true }),
      release: () => {
        releases += 1;
      },
    },
  });

  await assert.rejects(
    tool.resolveLocation(
      { qweatherApiHost: 'https://weather.test', qweatherApiKey: 'key' },
      '未知地点',
    ),
    (error) => error.code === 'WEATHER_LOCATION_NOT_FOUND',
  );
  assert.equal(releases, 1);
});

test('AMap refunds quota when route normalization finds no route', async () => {
  let releases = 0;
  const tool = createAmapTool({
    fetchImpl: async (url) => {
      const pathName = new URL(url).pathname;
      if (pathName.includes('/direction/')) {
        return jsonResponse({ status: '1', route: { paths: [] } });
      }
      return jsonResponse({
        status: '1',
        geocodes: [{ formatted_address: '地点', location: '120,30' }],
      });
    },
    quotaStore: {
      consume: () => ({ allowed: true }),
      release: () => {
        releases += 1;
      },
    },
  });

  await assert.rejects(
    tool.getRoute(
      { amapApiHost: 'https://amap.test', amapApiKey: 'key' },
      { origin: '甲地', destination: '乙地', city: '苏州', mode: 'driving' },
    ),
    (error) => error.code === 'AMAP_ROUTE_NOT_FOUND',
  );
  assert.equal(releases, 1);
});

test('provider connection checks refund quota for invalid successful payloads', async () => {
  let qweatherReleases = 0;
  const qweather = createQWeatherTool({
    fetchImpl: async () => jsonResponse({ code: '200', location: [{}] }),
    quotaStore: {
      consume: () => ({ allowed: true }),
      release: () => {
        qweatherReleases += 1;
      },
    },
  });
  await assert.rejects(
    qweather.testConnection({
      qweatherApiHost: 'https://weather.test',
      qweatherApiKey: 'key',
    }),
    (error) => error.code === 'QWEATHER_INVALID_RESPONSE',
  );
  assert.equal(qweatherReleases, 1);

  let amapReleases = 0;
  const amap = createAmapTool({
    fetchImpl: async () => jsonResponse({ status: '1', geocodes: [{}] }),
    quotaStore: {
      consume: () => ({ allowed: true }),
      release: () => {
        amapReleases += 1;
      },
    },
  });
  await assert.rejects(
    amap.testConnection({
      amapApiHost: 'https://amap.test',
      amapApiKey: 'key',
    }),
    (error) => error.code === 'AMAP_INVALID_RESPONSE',
  );
  assert.equal(amapReleases, 1);
});

test('AMap separates search and LBS quota categories before sending requests', async () => {
  const categories = [];
  let fetchCalls = 0;
  const tool = createAmapTool({
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ status: '1', pois: [] });
    },
    quotaStore: {
      consume(category) {
        categories.push(category);
        return { allowed: category !== 'amap_search' };
      },
    },
  });
  await assert.rejects(
    tool.searchPlaces(
      { amapApiHost: 'https://amap.test', amapApiKey: 'key' },
      { keywords: '餐厅' },
    ),
    (error) => error.code === 'AMAP_SEARCH_MONTHLY_LIMIT',
  );
  assert.deepEqual(categories, ['amap_search']);
  assert.equal(fetchCalls, 0);
});

test('AMap automatically uses the first matching endpoint and completes the route query', async () => {
  const requestedPaths = [];
  const tool = createAmapTool({
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      requestedPaths.push(parsedUrl.pathname);
      if (parsedUrl.pathname.includes('/direction/')) {
        assert.equal(parsedUrl.searchParams.get('origin'), '112.6,37.7');
        assert.equal(parsedUrl.searchParams.get('destination'), '112.6,37.7');
        return jsonResponse({
          status: '1',
          route: { transits: [{ distance: '16000', duration: '2400' }] },
        });
      }
      return jsonResponse({
        status: '1',
        geocodes: [
          { formatted_address: '太原南站候车厅', location: '112.6,37.7' },
          { formatted_address: '太原南站东广场', location: '112.61,37.71' },
        ],
      });
    },
    quotaStore: { consume: () => ({ allowed: true }) },
  });

  const result = await tool.getRoute(
    {
      amapApiHost: 'https://amap.test',
      amapApiKey: 'key',
      requestTimeoutMs: 3000,
    },
    {
      origin: '太原南站',
      destination: '太原武宿机场',
      city: '太原',
      mode: 'transit',
    },
  );

  assert.equal(result.distanceMeters, 16000);
  assert.equal(result.durationSeconds, 2400);
  assert.deepEqual(result.origin.alternatives, ['太原南站东广场']);
  assert.deepEqual(result.destination.alternatives, ['太原南站东广场']);
  assert.deepEqual(requestedPaths, [
    '/v3/geocode/geo',
    '/v3/geocode/geo',
    '/v3/direction/transit/integrated',
  ]);
});

test('AMap prefers a complete place-name match over an earlier unrelated result', async () => {
  const routeDestinations = [];
  const tool = createAmapTool({
    fetchImpl: async (url) => {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname.includes('/direction/')) {
        routeDestinations.push(parsedUrl.searchParams.get('destination'));
        return jsonResponse({
          status: '1',
          route: { paths: [{ distance: '12000', duration: '1800' }] },
        });
      }
      return jsonResponse({
        status: '1',
        geocodes:
          parsedUrl.searchParams.get('address') === '苏州园区站'
            ? [
                {
                  formatted_address: '江苏省苏州市常熟市园区站(公交站)',
                  location: '120.886491,31.685435',
                },
                {
                  formatted_address: '江苏省苏州市吴中区苏州园区站(进站口)',
                  location: '120.710567,31.341312',
                },
              ]
            : [
                {
                  formatted_address: '江苏省苏州市吴中区金鸡湖',
                  location: '120.665152,31.316274',
                },
              ],
      });
    },
    quotaStore: { consume: () => ({ allowed: true }) },
  });

  const result = await tool.getRoute(
    {
      amapApiHost: 'https://amap.test',
      amapApiKey: 'key',
      requestTimeoutMs: 3000,
    },
    {
      origin: '金鸡湖',
      destination: '苏州园区站',
      city: '苏州',
      mode: 'driving',
    },
  );

  assert.equal(result.destination.location, '120.710567,31.341312');
  assert.deepEqual(routeDestinations, ['120.710567,31.341312']);
});
