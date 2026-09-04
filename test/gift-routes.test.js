'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { routes } = require('../src/server/routes/gift-routes');

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
  routes['GET /api/gifts/history'](
    context,
    createRequest('sourceId=99&range=all'),
    forbidden,
  );
  assert.equal(forbidden.status, 400);
  assert.equal(forbidden.payload.code, 'GIFT_SOURCE_SELECTOR_FORBIDDEN');
  assert.deepEqual(calls, []);

  const history = createResponse();
  routes['GET /api/gifts/history'](
    context,
    createRequest('query=%25_&range=90d&limit=25&cursor=opaque'),
    history,
  );
  assert.equal(history.status, 200);
  assert.deepEqual(calls[0], [
    'history',
    { query: '%_', range: '90d', limit: '25', cursor: 'opaque' },
  ]);

  const statistics = createResponse();
  routes['GET /api/gifts/statistics'](
    context,
    createRequest('query=box&range=all'),
    statistics,
  );
  assert.equal(statistics.status, 200);
  assert.deepEqual(calls[1], [
    'statistics',
    { query: 'box', range: 'all', limit: undefined, cursor: null },
  ]);
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
  routes['GET /api/gifts/history'](
    context,
    createRequest('range=all'),
    missing,
  );
  const explicitEmpty = createResponse();
  routes['GET /api/gifts/history'](
    context,
    createRequest('query=&range=all'),
    explicitEmpty,
  );

  assert.equal(missing.status, 200);
  assert.equal(calls[0].query, undefined);
  assert.equal(calls[1].query, '');
  assert.equal(explicitEmpty.status, 400);
  assert.equal(explicitEmpty.payload.code, 'INVALID_GIFT_QUERY');
});

function createRequest(query) {
  return { query: new URLSearchParams(query) };
}

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
