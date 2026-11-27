'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routes } = require('../../src/server/routes/gift-routes');
const { DEFAULT_GIFT_DISPLAY } = require('../../src/bilibili/gift/display-settings');

test('gift ledger routes pass only allowlisted filters and reject source selectors', () => {
  const calls = [];
  const context = {
    gifts: {
      getHistory(options) {
        calls.push(['history', options]);
        return { items: [], hasMore: false };
      },
      getStatistics(options) {
        calls.push(['statistics', options]);
        return { summary: {}, partial: true };
      },
    },
  };

  const forbidden = createResponse();
  routes['GET /api/gifts/history'](context, createRequest('sourceId=99&range=all'), forbidden);
  assert.equal(forbidden.status, 400);
  assert.equal(forbidden.payload.code, 'GIFT_SOURCE_SELECTOR_FORBIDDEN');
  assert.deepEqual(calls, []);

  const history = createResponse();
  routes['GET /api/gifts/history'](
    context,
    createRequest('query=%25_&range=90d&limit=25&cursor=opaque&sortField=price&sortDirection=asc&amountAbove=10.01&conditional=1&delta=1'),
    history,
  );
  assert.equal(history.status, 200);
  assert.deepEqual(calls[0], [
    'history',
    {
      query: '%_',
      range: '90d',
      limit: '25',
      cursor: 'opaque',
      amountAbove: '10.01',
      conditional: true,
      delta: true,
      sortField: 'price',
      sortDirection: 'asc',
    },
  ]);

  const statistics = createResponse();
  routes['GET /api/gifts/statistics'](context, createRequest('query=box&range=all&amountAbove=10.01'), statistics);
  assert.equal(statistics.status, 200);
  assert.deepEqual(calls[1], ['statistics', { query: 'box', range: 'all', limit: undefined, cursor: null }]);
});

test('gift ledger routes return 400 for invalid sorting and filter parameters', () => {
  for (const code of ['INVALID_GIFT_SORT_FIELD', 'INVALID_GIFT_SORT_DIRECTION', 'INVALID_GIFT_FILTER']) {
    const error = new Error('礼物排序参数无效。');
    error.code = code;
    const response = createResponse();
    routes['GET /api/gifts/history'](
      {
        gifts: {
          getHistory() {
            throw error;
          },
        },
      },
      createRequest('range=all'),
      response,
    );
    assert.equal(response.status, 400);
    assert.equal(response.payload.code, code);
  }
});

test('gift ledger routes expose stable source-unavailable errors', () => {
  const error = new Error('当前礼物来源尚未就绪。');
  error.code = 'GIFT_SOURCE_UNAVAILABLE';
  const response = createResponse();

  routes['GET /api/gifts/statistics'](
    {
      gifts: {
        getStatistics() {
          throw error;
        },
      },
    },
    createRequest('range=30d'),
    response,
  );

  assert.equal(response.status, 409);
  assert.equal(response.payload.ok, false);
  assert.equal(response.payload.code, 'GIFT_SOURCE_UNAVAILABLE');
});

test('gift ledger routes distinguish a missing query from an explicit empty query', () => {
  const calls = [];
  const context = {
    gifts: {
      getHistory(options) {
        calls.push(options);
        if (options.query === '') {
          const error = new Error('礼物搜索内容不能为空。');
          error.code = 'INVALID_GIFT_QUERY';
          throw error;
        }
        return { items: [], hasMore: false };
      },
    },
  };

  const missing = createResponse();
  routes['GET /api/gifts/history'](context, createRequest('range=all'), missing);
  const explicitEmpty = createResponse();
  routes['GET /api/gifts/history'](context, createRequest('query=&range=all'), explicitEmpty);

  assert.equal(missing.status, 200);
  assert.equal(calls[0].query, undefined);
  assert.equal(calls[1].query, '');
  assert.equal(explicitEmpty.status, 400);
  assert.equal(explicitEmpty.payload.code, 'INVALID_GIFT_QUERY');
});

function createRequest(query) {
  return { query: new URLSearchParams(query) };
}

test('gift selection rejects invalid bodies and maps stale selection to conflict', async () => {
  for (const body of [null, [], 'invalid']) {
    const response = createResponse();
    await routes['POST /api/gifts/selection']({}, { body: async () => body }, response);
    assert.equal(response.status, 400);
  }
  const response = createResponse();
  await routes['POST /api/gifts/selection'](
    {
      gifts: {
        getSelection() {
          throw Object.assign(new Error('来源已变更'), { code: 'GIFT_VIEW_STALE' });
        },
      },
    },
    { body: async () => ({ viewRevision: 'old' }) },
    response,
  );
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, 'GIFT_VIEW_STALE');
});

test('gift display settings persist valid cents and leave saved configuration unchanged on invalid input', async () => {
  const settings = {};
  const broadcasts = [];
  const context = {
    settings: {
      get: () => settings,
      set: (key, value) => {
        settings[key] = value;
      },
    },
    broadcastSnapshot: (reason) => broadcasts.push(reason),
  };
  const config = {
    palette: 'bilibili-four',
    tailStyle: 'swallowtail',
    textureStyle: 'starlight',
    sheen: true,
    thresholds: [9999, 49999, 99999],
    visibleRows: 1,
    scrollSpeed: 26,
    minGiftAmountCents: 1250,
  };
  const saved = createResponse();
  await routes['POST /api/gifts/display-settings'](context, { body: async () => config }, saved);
  assert.equal(saved.status, 200);
  const rejected = createResponse();
  await routes['POST /api/gifts/display-settings'](
    context,
    { body: async () => ({ ...config, thresholds: [100, 100, 100] }) },
    rejected,
  );
  assert.equal(rejected.status, 400);
  for (const scrollSpeed of [0, 51, 1.5, '25']) {
    const invalid = createResponse();
    await routes['POST /api/gifts/display-settings'](
      context,
      { body: async () => ({ ...config, scrollSpeed }) },
      invalid,
    );
    assert.equal(invalid.status, 400);
  }
  for (const minGiftAmountCents of [-10, 1, 1251, 0.5, '1250', null, Number.MAX_SAFE_INTEGER + 1]) {
    const invalid = createResponse();
    await routes['POST /api/gifts/display-settings'](
      context,
      { body: async () => ({ ...config, minGiftAmountCents }) },
      invalid,
    );
    assert.equal(invalid.status, 400);
  }
  const read = createResponse();
  routes['GET /api/gifts/display-settings'](context, {}, read);
  assert.deepEqual(read.payload.data, config);
  assert.deepEqual(broadcasts, ['settings']);
});

function createDisplayContext() {
  const settings = { giftDisplayConfig: JSON.stringify(DEFAULT_GIFT_DISPLAY) };
  const writes = [];
  const broadcasts = [];
  return {
    settings, writes, broadcasts,
    context: {
      settings: {
        get: () => settings,
        set(key, value) { settings[key] = value; writes.push(key); },
      },
      broadcastSnapshot: reason => broadcasts.push(reason),
    },
  };
}

test('legacy gift display POST still replaces the complete configuration after a concurrent write', async () => {
  const fixture = createDisplayContext();
  const response = createResponse();
  let release;
  const pending = routes['POST /api/gifts/display-settings'](fixture.context, {
    body: () => new Promise(resolve => { release = resolve; }),
  }, response);
  fixture.settings.giftDisplayConfig = JSON.stringify({ ...DEFAULT_GIFT_DISPLAY, scrollSpeed: 34 });
  release({ ...DEFAULT_GIFT_DISPLAY, thresholds: [3500, 10000, 100000] });
  await pending;
  assert.equal(response.status, 200);
  assert.equal(response.payload.data.thresholds[0], 3500);
  assert.equal(response.payload.data.scrollSpeed, 12);
});

test('gift display patches merge against the latest settings in either request-body completion order', async t => {
  for (const order of [[0, 1], [1, 0]]) {
    await t.test(`completion order ${order.join(',')}`, async () => {
      const fixture = createDisplayContext();
      const requests = [{ threshold1: 3500 }, { scrollSpeed: 34, threshold2: 12000 }].map(patch => {
        let release;
        const response = createResponse();
        const pending = routes['POST /api/gifts/display-settings'](fixture.context, {
          body: () => new Promise(resolve => { release = resolve; }),
        }, response);
        return { response, pending, release: () => release({ patch }) };
      });
      for (const index of order) {
        requests[index].release();
        await requests[index].pending;
        assert.equal(requests[index].response.status, 200);
      }
      const saved = JSON.parse(fixture.settings.giftDisplayConfig);
      assert.equal(saved.thresholds[0], 3500);
      assert.equal(saved.thresholds[1], 12000);
      assert.equal(saved.scrollSpeed, 34);
      const receipt = requests[order[1]].response.payload.data;
      assert.equal(receipt.thresholds[0], 3500);
      assert.equal(receipt.thresholds[1], 12000);
      assert.equal(receipt.scrollSpeed, 34);
      assert.equal(fixture.writes.length, 2);
      assert.equal(fixture.broadcasts.length, 2);
    });
  }
});

test('gift display patches validate the complete merged thresholds before writing once', async () => {
  const fixture = createDisplayContext();
  const rejected = createResponse();
  let release;
  const pending = routes['POST /api/gifts/display-settings'](fixture.context, {
    body: () => new Promise(resolve => { release = resolve; }),
  }, rejected);
  fixture.settings.giftDisplayConfig = JSON.stringify({ ...DEFAULT_GIFT_DISPLAY, thresholds: [3000, 3200, 100000] });
  release({ patch: { threshold1: 3500, scrollSpeed: 34 } });
  await pending;
  assert.equal(rejected.status, 400);
  assert.equal(JSON.parse(fixture.settings.giftDisplayConfig).thresholds[0], 3000);
  assert.equal(JSON.parse(fixture.settings.giftDisplayConfig).scrollSpeed, 12);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.broadcasts.length, 0);
  const accepted = createResponse();
  await routes['POST /api/gifts/display-settings'](fixture.context, {
    body: async () => ({ patch: { threshold1: 12000, threshold2: 20000 } }),
  }, accepted);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.payload.data.thresholds[0], 12000);
  assert.equal(accepted.payload.data.thresholds[1], 20000);
  assert.equal(fixture.writes.length, 1);
  assert.equal(fixture.broadcasts.length, 1);
});

test('gift display rejects invalid patch envelopes and preserves body authorization errors', async () => {
  const fixture = createDisplayContext();
  for (const body of [
    { patch: null },
    { patch: {} },
    { patch: [] },
    { patch: { thresholds: [3500, 10000, 100000] } },
    { patch: { threshold1: 3500.5 } },
    { patch: { scrollSpeed: 34 }, visibleRows: 5 },
  ]) {
    const response = createResponse();
    await routes['POST /api/gifts/display-settings'](fixture.context, { body: async () => body }, response);
    assert.equal(response.status, 400);
  }
  for (const code of ['REQUEST_AUTHORIZATION_CHANGED', 'REQUEST_BODY_TOO_LARGE']) {
    await assert.rejects(routes['POST /api/gifts/display-settings'](fixture.context, {
      body: async () => { throw Object.assign(new Error(code), { code }); },
    }, createResponse()), { code });
  }
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.broadcasts.length, 0);
});

test('gift display does not acknowledge or broadcast a patch when persistence fails', async () => {
  const fixture = createDisplayContext();
  fixture.context.settings.set = () => { throw new Error('synthetic storage failure'); };
  const response = createResponse();
  await assert.rejects(routes['POST /api/gifts/display-settings'](fixture.context, {
    body: async () => ({ patch: { threshold1: 3500 } }),
  }, response), /synthetic storage failure/);
  assert.equal(response.status, 0);
  assert.equal(JSON.parse(fixture.settings.giftDisplayConfig).thresholds[0], 3000);
  assert.equal(fixture.broadcasts.length, 0);
});

function createResponse() {
  return {
    status: 0,
    payload: null,
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.payload = JSON.parse(body);
    },
  };
}
