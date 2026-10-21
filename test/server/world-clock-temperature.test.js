'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorldClockTemperature } = require('../../src/server/world-clock-temperature');
const { createOverlayToken } = require('../../src/server/access-policy');
const { listenHttpServer } = require('../helpers/transport-fixtures');

const START = Date.parse('2026-10-21T13:30:00Z');
const LOCATION = { latitude: '39.90421', longitude: '116.40739' };
function weather(latitude = 39.9042, longitude = 116.4074) {
  return {
    fallbackedLocation: false,
    currentLocation: { latitude: String(latitude), longitude: String(longitude) },
    currentCondition: {
      unitsRaw: { temperature: '°C' },
      currentRaw: { temp: -1, cap: ' 小雨 ', created: '2026-10-21T21:20:00+08:00' },
    },
  };
}
function response(body = weather(), headers = {}) {
  const json = JSON.stringify({ WeatherData: { '_@STATE@_': body } });
  return new Response(`<html><script type='application/json' id='redux-data'>${json}</script></html>`, { headers: {
    'content-type': 'text/html',
    ...headers,
  } });
}

test('temperature reads the requested MSN city and shares its response until the next whole hour', async t => {
  let time = START;
  const first = Promise.withResolvers();
  const requests = [];
  const nextWeather = weather();
  nextWeather.currentCondition.currentRaw.temp = 2;
  nextWeather.currentCondition.currentRaw.cap = '多云';
  const service = createWorldClockTemperature({ now: () => time, fetch: (url, options) => {
    requests.push({ url, options });
    return requests.length === 1 ? first.promise : Promise.resolve(response(nextWeather));
  } });
  t.after(() => service.close());
  const pending = service.getTemperature(LOCATION);
  const duplicate = service.getTemperature({ latitude: 39.9042, longitude: 116.4074 });
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.origin + url.pathname, 'https://www.msn.cn/zh-cn/weather/forecast');
  assert.deepEqual(JSON.parse(Buffer.from(url.searchParams.get('loc'), 'base64').toString()), {
    g: 'zh-cn', x: '116.4074', y: '39.9042',
  });
  assert.equal(url.searchParams.get('weadegreetype'), 'C');
  assert.match(requests[0].options.headers['User-Agent'], /LIRA\/[\d.]+ .*github.com\/AuroraWhisperer\/LIRA/);
  assert.equal(requests[0].options.redirect, 'error');
  first.resolve(response());
  assert.equal((await pending).temperature, -1);
  assert.deepEqual(await duplicate, await pending);
  time += 30 * 60000 - 1;
  const cached = await service.getTemperature(LOCATION);
  assert.equal(cached.temperature, -1);
  assert.equal(cached.condition, '小雨');
  assert.equal(cached.validAt, '2026-10-21T13:20:00.000Z');
  assert.equal(cached.updatedAt, cached.validAt);
  assert.equal(cached.fetchedAt, new Date(START).toISOString());
  assert.equal(requests.length, 1, 'requests before the next whole hour share the cached page');
  time += 1;
  const refreshed = await service.getTemperature(LOCATION);
  assert.equal(refreshed.temperature, 2);
  assert.equal(refreshed.condition, '多云');
  assert.equal(refreshed.fetchedAt, new Date(time).toISOString());
  assert.equal(requests.length, 2);
});

test('missing or invalid weather descriptions preserve a valid temperature without inferring clear skies', async t => {
  for (const cap of [undefined, null, '', '  ', 0, { text: '晴朗' }]) {
    const body = weather();
    body.currentCondition.currentRaw.cap = cap;
    const service = createWorldClockTemperature({ now: () => START, fetch: async () => response(body) });
    t.after(() => service.close());
    const result = await service.getTemperature(LOCATION);
    assert.equal(result.temperature, -1);
    assert.equal(result.condition, null);
  }
});

test('a response crossing the hour does not keep the previous hour cached', async t => {
  let time = START + 30 * 60000 - 1000;
  let requests = 0;
  const first = Promise.withResolvers();
  const service = createWorldClockTemperature({ now: () => time, fetch: () => {
    requests++;
    return requests === 1 ? first.promise : Promise.resolve(response());
  } });
  t.after(() => service.close());
  const pending = service.getTemperature(LOCATION);
  time += 2000;
  first.resolve(response());
  await pending;
  await service.getTemperature(LOCATION);
  assert.equal(requests, 2);
});

test('a new software runtime fetches fresh data even within the same hour', async t => {
  let requests = 0;
  const options = { now: () => START, fetch: async () => { requests++; return response(); } };
  const previous = createWorldClockTemperature(options);
  await previous.getTemperature(LOCATION);
  await previous.close();
  const current = createWorldClockTemperature(options);
  t.after(() => current.close());
  await current.getTemperature(LOCATION);
  assert.equal(requests, 2);
});

test('invalid coordinates never reach the provider', async t => {
  let requests = 0;
  const service = createWorldClockTemperature({ fetch: async () => { requests++; return response(); } });
  t.after(() => service.close());
  for (const input of [
    {}, { latitude: '', longitude: 0 }, { latitude: 'NaN', longitude: 0 },
    { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 },
    { latitude: 'https://example.com/', longitude: 0 },
  ]) await assert.rejects(service.getTemperature(input), { status: 400 });
  assert.equal(requests, 0);
});

test('failed upstream responses observe Retry-After without serving old data as current', async t => {
  let time = START;
  let requests = 0;
  const service = createWorldClockTemperature({ now: () => time, fetch: async () => {
    requests++;
    return requests === 2 ? new Response('', { status: 429, headers: { 'retry-after': '3600' } }) : response();
  } });
  t.after(() => service.close());
  await service.getTemperature(LOCATION);
  time += 61 * 60000;
  await assert.rejects(service.getTemperature(LOCATION), { status: 503 });
  time += 30 * 60000;
  await assert.rejects(service.getTemperature(LOCATION), { status: 503 });
  assert.equal(requests, 2);
  time += 30 * 60000;
  assert.equal((await service.getTemperature(LOCATION)).fetchedAt, new Date(time).toISOString());
  assert.equal(requests, 3, 'a later request can recover after the retry delay');
});

test('malformed pages, wrong cities, units and stale timestamps cannot masquerade as current temperatures', async t => {
  const noTemperature = weather();
  noTemperature.currentCondition.currentRaw.temp = null;
  const oldWeather = weather();
  oldWeather.currentCondition.currentRaw.created = '2026-10-19T12:00:00Z';
  const futureWeather = weather();
  futureWeather.currentCondition.currentRaw.created = '2026-10-22T12:00:00Z';
  const wrongUnits = weather();
  wrongUnits.currentCondition.unitsRaw.temperature = '°F';
  const fallbackWeather = weather();
  fallbackWeather.fallbackedLocation = true;
  const cases = [
    () => response(noTemperature), () => response(oldWeather), () => response(futureWeather),
    () => response(wrongUnits), () => response(fallbackWeather), () => response(weather(51.5074, -0.1278)),
    () => response(weather(), { 'content-length': String(512 * 1024 + 1) }),
    () => new Response('<script id="redux-data">invalid JSON</script>'),
    () => new Response('<html>Weather page changed</html>'), () => new Response(null, { status: 304 }),
  ];
  for (const makeResponse of cases) {
    let requests = 0;
    const service = createWorldClockTemperature({ now: () => START, fetch: async () => { requests++; return makeResponse(); } });
    t.after(() => service.close());
    await assert.rejects(service.getTemperature(LOCATION), { status: 503 });
    await assert.rejects(service.getTemperature(LOCATION), { status: 503 });
    assert.equal(requests, 1, 'errors back off for at least one minute');
  }
});

test('closing aborts shared work and refuses new requests', async () => {
  let signal;
  const service = createWorldClockTemperature({ fetch: (_url, options) => new Promise((_resolve, reject) => {
    signal = options.signal;
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const rejected = assert.rejects(service.getTemperature(LOCATION), { status: 503 });
  await service.close();
  await rejected;
  assert.equal(signal.aborted, true);
  await assert.rejects(service.getTemperature(LOCATION), { status: 503 });
  await service.close();
});

test('cache capacity is bounded without evicting city data before its expiry', async t => {
  let requests = 0;
  const service = createWorldClockTemperature({ now: () => START, fetch: async url => {
    requests++;
    const location = JSON.parse(Buffer.from(new URL(url).searchParams.get('loc'), 'base64').toString());
    return response(weather(Number(location.y), Number(location.x)));
  } });
  t.after(() => service.close());
  for (let index = 0; index < 128; index++) await service.getTemperature({ latitude: 0, longitude: index });
  await assert.rejects(service.getTemperature({ latitude: 0, longitude: 128 }), { status: 503 });
  await service.getTemperature({ latitude: 0, longitude: 0 });
  assert.equal(requests, 128);
});

test('temperature route requires management authority and keeps validation at its owner', async t => {
  const sessionToken = 'synthetic-world-clock-admin';
  let requests = 0;
  const worldClock = createWorldClockTemperature({ now: () => START, fetch: async () => { requests++; return response(); } });
  t.after(() => worldClock.close());
  const { origin } = await listenHttpServer(t, {
    inflightTracker: { run: work => work() },
    createApiContext: () => ({ sessionToken, worldClock }),
  });
  const url = `${origin}/api/world-clock/temperature?latitude=39.9042&longitude=116.4074`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${createOverlayToken(sessionToken, 'clock')}` } })).status, 403);
  const headers = { Authorization: `Bearer ${sessionToken}` };
  const result = await fetch(url, { headers });
  assert.equal(result.status, 200);
  const data = (await result.json()).data;
  assert.equal(data.temperature, -1);
  assert.equal(data.condition, '小雨');
  assert.equal((await fetch(`${origin}/api/world-clock/temperature?latitude=91&longitude=0`, { headers })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers })).status, 405);
  assert.equal(requests, 1);
});
