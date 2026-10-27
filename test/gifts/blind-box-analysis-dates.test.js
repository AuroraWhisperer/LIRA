'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getBlindBoxAnalysis, getBlindBoxStats } = require('../../src/bilibili/gift/blind-box-analysis');
const { routes } = require('../../src/server/routes/gift-routes');
const { createFixture } = require('../helpers/gift-query-fixture');

test('blind box snapshots reuse unchanged rows across lyric updates and invalidate for writes, source, filter and day', t => {
  const { createSceneExtraDisplay } = require('../../src/server/scene-extra-display');
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-18T12:00:00') });
  const fixture = createFixture();
  t.after(() => fixture.close());
  fixture.insertGift(null, 'local', { cmd: 'SEND_GIFT', isBlindBox: true, blindBoxName: '心动盲盒',
    blindBoxPrice: 9, totalPrice: 10, createdAt: new Date().toISOString() });
  const rows = t.mock.method(fixture.context.queryStore, 'listBlindBoxRows');
  let heartOnly = false;
  const display = createSceneExtraDisplay({ displayPorts: {
    gifts: { getBlindBoxStats: options => getBlindBoxStats(fixture.context, options) },
    settings: { get: () => ({ blindboxHeartBoxOnly: String(heartOnly) }) },
  } });
  for (let i = 0; i < 20; i++) {
    display('lyrics', () => ({ lyricState: { currentMs: i * 250 }, lyricTimeline: { lines: [] } }));
    assert.equal(display('blindbox').summary.totalProfit, 1);
  }
  assert.equal(rows.mock.callCount(), 1);
  fixture.giftDb.prepare('UPDATE gift_events SET blind_profit = 2').run();
  assert.equal(display('blindbox').summary.totalProfit, 2);
  assert.equal(rows.mock.callCount(), 2, 'in-place changes invalidate even with the same row count');
  heartOnly = true;
  assert.equal(display('blindbox').heartBoxProgress.openedSinceCastle, 1);
  assert.equal(rows.mock.callCount(), 3);
  fixture.setActiveSource(fixture.resolveSource('a'.repeat(64)).id);
  assert.equal(display('blindbox').summary.boxCount, 0);
  const emptyReads = rows.mock.callCount();
  display('blindbox');
  assert.equal(rows.mock.callCount(), emptyReads, 'empty results are reusable');
  fixture.clearActiveSource();
  assert.equal(display('blindbox').summary.boxCount, 1);
  fixture.setActiveSource(1, { syncState: 'SOURCE_SWITCHING' });
  assert.equal(display('blindbox').summary.boxCount, 0, 'unavailable source never exposes cached local data');
  fixture.clearActiveSource();
  assert.equal(display('blindbox').summary.boxCount, 1);
  t.mock.timers.setTime(new Date('2026-09-19T12:00:00').getTime());
  assert.equal(display('blindbox').summary.boxCount, 0);
});

test('blind box projections trim the cached leaderboard without changing totals or the full-list default', t => {
  const fixture = createFixture();
  t.after(() => fixture.close());
  for (const [index, totalPrice] of [12, 10, 8].entries()) {
    fixture.insertGift(null, `projection-${index}`, { cmd: 'SEND_GIFT', userId: String(index + 1),
      userName: `User ${index}`, isBlindBox: true, blindBoxPrice: 9,
      totalPrice, createdAt: new Date().toISOString() });
  }
  const reads = t.mock.method(fixture.context.queryStore, 'listBlindBoxRows');
  const full = getBlindBoxStats(fixture.context);
  assert.equal(full.perUser.length, 3);
  const summary = getBlindBoxStats(fixture.context, { top: '0', hideLoss: '1' });
  assert.deepEqual(summary.perUser, []);
  assert.deepEqual(summary.summary, full.summary);
  const top = getBlindBoxStats(fixture.context, { top: '1', hideLoss: '1' });
  assert.deepEqual(top.perUser, full.perUser.filter(user => user.totalProfit > 0).slice(0, 1));
  assert.deepEqual(getBlindBoxStats(fixture.context, { top: -1, hideLoss: true }).perUser,
    full.perUser.filter(user => user.totalProfit > 0));
  top.perUser[0].totalProfit = 999;
  assert.deepEqual(getBlindBoxStats(fixture.context).perUser, full.perUser);
  assert.equal(reads.mock.callCount(), 1);
  for (const options of [{ top: 11 }, { top: '01' }, { hideLoss: 'true' }]) {
    assert.throws(() => getBlindBoxStats(fixture.context, options), { code: 'INVALID_GIFT_STATS_OPTIONS' });
  }
});

test('blind box cache rejects rolled-back values and observes other database connections', t => {
  const { DatabaseSync } = require('node:sqlite');
  const fixture = createFixture();
  t.after(() => fixture.close());
  fixture.insertGift(null, 'local', { cmd: 'SEND_GIFT', isBlindBox: true,
    blindBoxPrice: 9, totalPrice: 10, createdAt: new Date().toISOString() });
  const read = () => getBlindBoxStats(fixture.context);
  const initial = read();
  initial.summary.totalProfit = 500;
  assert.equal(read().summary.totalProfit, 1, 'callers cannot mutate the cached result');
  fixture.giftDb.exec('BEGIN');
  fixture.giftDb.prepare('UPDATE gift_events SET blind_profit = 3').run();
  assert.equal(read().summary.totalProfit, 3);
  fixture.giftDb.exec('ROLLBACK');
  assert.equal(read().summary.totalProfit, 1);
  const second = new DatabaseSync(fixture.giftDb.prepare('PRAGMA database_list').get().file);
  try { second.prepare('UPDATE gift_events SET blind_profit = 4').run(); }
  finally { second.close(); }
  assert.equal(read().summary.totalProfit, 4);
});

test('blind box cache follows changed local-day boundaries even when the date label stays the same', t => {
  const timezone = process.env.TZ;
  t.after(() => {
    if (timezone === undefined) delete process.env.TZ;
    else process.env.TZ = timezone;
  });
  process.env.TZ = 'UTC';
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-18T12:00:00Z') });
  const fixture = createFixture();
  t.after(() => fixture.close());
  fixture.insertGift(null, 'early-local', { cmd: 'SEND_GIFT', isBlindBox: true,
    blindBoxPrice: 9, totalPrice: 10, createdAt: '2026-09-18T01:00:00Z' });
  const initial = getBlindBoxStats(fixture.context);
  assert.equal(initial.summary.boxCount, 1);
  const date = new Date().toDateString();
  process.env.TZ = 'America/New_York';
  assert.equal(new Date().toDateString(), date);
  const current = getBlindBoxAnalysis(fixture.context);
  assert.equal(current.summary.boxCount, 0);
  const refreshed = getBlindBoxStats(fixture.context);
  assert.equal(refreshed.today, current.today);
  assert.deepEqual(refreshed.summary, current.summary);
});

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
      startDate: '2026-08-31',
      endDate: '2026-09-01',
      view,
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
    assert.deepEqual(
      result.items.map((item) => item.giftName),
      ['end'],
    );
    assert.deepEqual(result.dateRange, { startDate: '2026-09-01', endDate: '2026-09-01' });
  }
  const dates = { startDate: '2026-08-31', endDate: '2026-09-01', view: 'records' };
  const filtered = getBlindBoxAnalysis(fixture.context, { ...dates, viewer: 'name:小月', box: '心动盲盒' });
  assert.deepEqual(
    filtered.items.map((item) => item.giftName),
    ['start'],
  );
  const page = getBlindBoxAnalysis(fixture.context, { ...dates, limit: 1, page: 2 });
  assert.deepEqual(
    page.items.map((item) => item.giftName),
    ['start'],
  );
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
    { startDate: '2026-02-29' },
    { endDate: '2026-04-31' },
    { startDate: '2026-9-01' },
    { startDate: 'not-a-date' },
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
  const context = {
    queryStore: {
      listBlindBoxRows(options) {
        bounds = options;
        return [];
      },
    },
  };
  getBlindBoxAnalysis(context, { startDate: '2026-03-08' });
  assert.equal(bounds.from, '2026-03-08T05:00:00.000Z');
  assert.equal(bounds.to, '2026-03-09T04:00:00.000Z');
  getBlindBoxAnalysis(context, { startDate: '2026-11-01' });
  assert.equal(bounds.from, '2026-11-01T04:00:00.000Z');
  assert.equal(bounds.to, '2026-11-02T05:00:00.000Z');
});

test('analysis and stats routes pass filters through and return 400 for invalid options', (t) => {
  const fixture = seed(t);
  const context = { gifts: {
    getBlindBoxAnalysis: (options) => getBlindBoxAnalysis(fixture.context, options),
    getBlindBoxStats: (options) => getBlindBoxStats(fixture.context, options),
  } };
  function request(query, route = 'GET /api/gifts/blind-box-analysis') {
    let status;
    let payload;
    routes[route](
      context,
      { query: new URLSearchParams(query) },
      {
        writeHead(code) {
          status = code;
        },
        end(body) {
          payload = JSON.parse(body);
        },
      },
    );
    return { status, payload };
  }
  const result = request('startDate=2026-08-31&endDate=2026-09-01');
  assert.equal(result.status, 200);
  assert.equal(result.payload.data.summary.boxCount, 2);
  const invalid = request('startDate=2026-02-30');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, 'INVALID_GIFT_FILTER');
  const summary = request('top=0&hideLoss=1', 'GET /api/gifts/blind-box-stats');
  assert.equal(summary.status, 200);
  assert.deepEqual(summary.payload.data.perUser, []);
  const invalidTop = request('top=01', 'GET /api/gifts/blind-box-stats');
  assert.equal(invalidTop.status, 400);
  assert.equal(invalidTop.payload.code, 'INVALID_GIFT_STATS_OPTIONS');
});
