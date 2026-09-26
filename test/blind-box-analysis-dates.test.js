'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getBlindBoxAnalysis, getBlindBoxStats } = require('../src/bilibili/gift/blind-box-analysis');
const { routes } = require('../src/server/routes/gift-routes');
const { createFixture } = require('./helpers/gift-query-fixture');

function seed(t) {
  const fixture = createFixture();
  t.after(() => fixture.close());
  const source = fixture.resolveSource('a'.repeat(64));
  fixture.setActiveSource(source.id);
  for (const [id, date, user, box] of [
    ['before', '2026-08-30T23:59:59.999', '之前', '边界外'],
    ['start', '2026-08-31T00:00:00.000', '小月', '心动盲盒'],
    ['end', '2026-09-01T23:59:59.999', '小星', '幸运盲盒'],
    ['after', '2026-09-02T00:00:00.000', '之后', '边界外'],
  ]) {
    fixture.insertGift(source.id, id, {
      giftName: id,
      userName: user,
      blindBoxName: box,
      isBlindBox: true,
      blindBoxPrice: 9,
      totalPrice: 10,
      createdAt: new Date(date).toISOString(),
    });
  }
  const other = fixture.resolveSource('b'.repeat(64));
  for (const sourceId of [other.id, null]) {
    fixture.insertGift(sourceId, `excluded-${sourceId}`, {
      cmd: sourceId === null ? 'SEND_GIFT' : 'LIRA_SERVER_GIFT',
      isBlindBox: true,
      blindBoxPrice: 900,
      totalPrice: 1000,
      createdAt: new Date('2026-09-01T12:00:00').toISOString(),
    });
  }
  return fixture;
}

test('blind box date ranges include both local days across months in all views and isolate sources', (t) => {
  const fixture = seed(t);
  for (const view of ['users', 'boxes', 'records']) {
    const result = getBlindBoxAnalysis(fixture.context, {
      startDate: '2026-08-31', endDate: '2026-09-01', view,
    });
    assert.deepEqual(result.dateRange, { startDate: '2026-08-31', endDate: '2026-09-01' });
    assert.deepEqual(result.summary, { boxCount: 2, totalCost: 18, totalValue: 20, totalProfit: 2 });
    assert.equal(result.pagination.total, 2);
    assert.deepEqual(result.filters.viewers.map((item) => item.label).sort(), ['小星', '小月']);
    assert.deepEqual(result.filters.boxes.sort(), ['幸运盲盒', '心动盲盒']);
  }
});

test('single-day analysis accepts identical endpoints or one endpoint, with filters and pagination', (t) => {
  const fixture = seed(t);
  for (const dates of [
    { startDate: '2026-09-01' },
    { endDate: '2026-09-01' },
    { startDate: '2026-09-01', endDate: '2026-09-01' },
  ]) {
    const result = getBlindBoxAnalysis(fixture.context, { ...dates, view: 'records' });
    assert.deepEqual(result.items.map((item) => item.giftName), ['end']);
    assert.deepEqual(result.dateRange, { startDate: '2026-09-01', endDate: '2026-09-01' });
  }
  const dates = { startDate: '2026-08-31', endDate: '2026-09-01', view: 'records' };
  const filtered = getBlindBoxAnalysis(fixture.context, { ...dates, viewer: 'name:小月', box: '心动盲盒' });
  assert.deepEqual(filtered.items.map((item) => item.giftName), ['start']);
  const page = getBlindBoxAnalysis(fixture.context, { ...dates, limit: 1, page: 2 });
  assert.deepEqual(page.items.map((item) => item.giftName), ['start']);
  assert.deepEqual(page.summary, { boxCount: 2, totalCost: 18, totalValue: 20, totalProfit: 2 });
});

test('omitted dates preserve today stats and explicit empty dates match that default', (t) => {
  const fixture = seed(t);
  const result = getBlindBoxAnalysis(fixture.context);
  const today = getBlindBoxStats(fixture.context);
  assert.equal(result.today, today.today);
  assert.deepEqual(result.summary, today.summary);
  assert.deepEqual(getBlindBoxAnalysis(fixture.context, { startDate: '', endDate: '' }), result);
  const empty = getBlindBoxAnalysis(fixture.context, { startDate: '2026-08-01' });
  assert.equal(empty.summary.boxCount, 0);
  assert.deepEqual(empty.items, []);
});

test('invalid dates and reversed ranges fail before querying records', () => {
  for (const options of [
    { startDate: '2026-02-29' }, { endDate: '2026-04-31' },
    { startDate: '2026-9-01' }, { startDate: 'not-a-date' },
    { startDate: '2026-09-02', endDate: '2026-09-01' },
  ]) {
    assert.throws(() => getBlindBoxAnalysis({}, options), { code: 'INVALID_GIFT_FILTER' });
  }
});

test('local date bounds follow daylight saving changes instead of assuming 24 hours', (t) => {
  const timezone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  t.after(() => {
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
  });
  let bounds;
  const context = { queryStore: { listBlindBoxRows(options) { bounds = options; return []; } } };
  getBlindBoxAnalysis(context, { startDate: '2026-03-08' });
  assert.equal(bounds.from, '2026-03-08T05:00:00.000Z');
  assert.equal(bounds.to, '2026-03-09T04:00:00.000Z');
  getBlindBoxAnalysis(context, { startDate: '2026-11-01' });
  assert.equal(bounds.from, '2026-11-01T04:00:00.000Z');
  assert.equal(bounds.to, '2026-11-02T05:00:00.000Z');
});

test('analysis route passes dates through and returns 400 for invalid ranges', (t) => {
  const fixture = seed(t);
  const context = { gifts: { getBlindBoxAnalysis: (options) => getBlindBoxAnalysis(fixture.context, options) } };
  function request(query) {
    let status;
    let payload;
    routes['GET /api/gifts/blind-box-analysis'](context, { query: new URLSearchParams(query) }, {
      writeHead(code) { status = code; },
      end(body) { payload = JSON.parse(body); },
    });
    return { status, payload };
  }
  const result = request('startDate=2026-08-31&endDate=2026-09-01');
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.summary.boxCount, 2);
  const invalid = request('startDate=2026-02-30');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, 'INVALID_GIFT_FILTER');
});
