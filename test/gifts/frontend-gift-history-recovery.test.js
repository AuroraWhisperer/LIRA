'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createGiftHistoryFixture: createFixture } = require('../helpers/gift-history-fixture');

const LIVE_EMPTY = {
  items: [],
  total: 0,
  totalPages: 1,
  hasMore: false,
  syncState: 'LIVE',
  partial: false,
};
const UNAVAILABLE = {
  ok: false,
  code: 'GIFT_SOURCE_UNAVAILABLE',
  error: '当前礼物来源尚未就绪。',
};

test('gift history recovers an empty ledger without receiving a gift', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply(UNAVAILABLE, 409);
  assert.doesNotMatch(ui.body(), /失败|暂无礼物记录|尚未就绪/);

  ui.runTimer();
  await ui.reply({
    ok: true,
    data: { ...LIVE_EMPTY, syncState: 'BOOTSTRAPPING', partial: true },
  });
  assert.doesNotMatch(ui.body(), /暂无礼物记录/);
  ui.runTimer();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.match(ui.body(), /暂无礼物记录/);
  assert.equal([...ui.timers.values()][0].delay, 10000);
  assert.equal(
    ui.requests.every((request) => request.url.startsWith('/api/gifts/history?')),
    true,
  );
  ui.runTimer();
  await ui.reply({
    ok: true,
    data: {
      ...LIVE_EMPTY,
      total: 1,
      items: [{ eventId: 'new', gift: { giftName: '新收到的礼物' } }],
    },
  });
  assert.match(ui.body(), /新收到的礼物/);
  ui.close();
  assert.equal(ui.timers.size, 0);
});

test('slow gift history recovery exposes retry and cancels work on close', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply(UNAVAILABLE, 409);
  ui.elapse(16000);
  ui.runTimer();
  await ui.reply(UNAVAILABLE, 409);

  ui.click('giftHistoryRetryBtn');
  assert.equal(ui.timers.size, 0);
  await ui.reply(UNAVAILABLE, 409);
  const staleTimer = [...ui.timers.values()][0];
  ui.close();
  const count = ui.requests.length;
  staleTimer.callback();
  assert.equal(ui.requests.length, count);

  ui.open();
  const pending = ui.requests.at(-1);
  const body = ui.body();
  ui.close();
  assert.equal(pending.options.signal.aborted, true);
  await ui.reply({ ok: true, data: LIVE_EMPTY }, 200, pending);
  assert.equal(ui.body(), body);
  assert.equal(ui.timers.size, 0);
});

test('gift history preserves loaded rows on update failures and reconnects offline records', async () => {
  const ui = await createFixture();
  const data = {
    ...LIVE_EMPTY,
    total: 1,
    partial: true,
    syncState: 'CATCHING_UP',
    items: [{ eventId: 'one', gift: { giftName: '保留的礼物' } }],
  };
  ui.open();
  await ui.reply({ ok: true, data });
  const rows = ui.body();
  ui.runTimer();
  await ui.reply({ ok: false, error: 'SQLITE_INTERNAL: private detail' }, 500);
  assert.equal(ui.body(), rows);
  assert.doesNotMatch(ui.get('giftLedgerSyncStatus').title, /SQLITE|private/);

  ui.runTimer();
  await ui.reply({ ok: true, data: { ...data, syncState: 'OFFLINE' } });
  assert.equal(ui.body(), rows);
  ui.close();
});

test('a switching gift source removes previously loaded rows before retrying', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({
    ok: true,
    data: {
      ...LIVE_EMPTY,
      partial: true,
      syncState: 'CATCHING_UP',
      total: 1,
      items: [{ eventId: 'old', gift: { giftName: '之前账号的礼物' } }],
    },
  });
  ui.runTimer();
  await ui.reply(UNAVAILABLE, 409);
  assert.doesNotMatch(ui.body(), /之前账号/);
  ui.close();
});

test('clearing gifts submits once, rejects stale reads, and recovers without gifts', async () => {
  const ui = await createFixture();
  ui.open();
  const staleRead = ui.requests.at(-1);
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  assert.match(ui.dialog().innerHTML, /无法撤销/);
  await ui.confirm(true);
  const clearRequest = ui.requests.at(-1);
  assert.equal(clearRequest.url, '/api/database/clear-gifts');
  assert.equal(JSON.parse(clearRequest.options.body).confirm, true);
  assert.equal(ui.get('giftHistoryClearDatabaseBtn').disabled, true);
  await ui.click('giftHistoryClearDatabaseBtn');
  assert.equal(ui.requests.at(-1), clearRequest);
  assert.equal(staleRead.options.signal.aborted, true);

  await ui.reply({ ok: true, data: {} }, 200, clearRequest);
  await clearing;
  const newRead = ui.requests.at(-1);
  await ui.reply(
    {
      ok: true,
      data: {
        ...LIVE_EMPTY,
        total: 1,
        items: [{ eventId: 'stale', gift: { giftName: '已删除的礼物' } }],
      },
    },
    200,
    staleRead,
  );
  assert.doesNotMatch(ui.body(), /已删除的礼物/);
  await ui.reply(UNAVAILABLE, 409, newRead);
  ui.runTimer();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.equal(ui.requests.filter((request) => request.options.method === 'POST').length, 1);
  ui.close();
});

test('a partially completed clear retries only the gift history read', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  await ui.confirm(true);
  await ui.reply({ ok: false, partial: true, error: 'server internals' }, 500);
  await clearing;
  await ui.reply({ ok: false }, 500);
  ui.click('giftHistoryRetryBtn');
  assert.equal(ui.requests.filter((request) => request.options.method === 'POST').length, 1);
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  ui.close();
});

test('an uncertain gift clear never claims records were preserved or repeats deletion', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  await ui.confirm(true);
  ui.requests.at(-1).reject(new TypeError('network disconnected'));
  await clearing;
  assert.doesNotMatch(ui.body(), /未删除|network disconnected/);
  ui.click('giftHistoryRetryBtn');
  assert.equal(ui.requests.filter((request) => request.options.method === 'POST').length, 1);
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  ui.close();
});

test('canceling the clear confirmation preserves records and resumes pending recovery', async () => {
  const ui = await createFixture();
  ui.open();
  await ui.reply(UNAVAILABLE, 409);
  const clearing = ui.click('giftHistoryClearDatabaseBtn');
  ui.runTimer();
  await ui.confirm(false);
  await clearing;
  assert.equal(
    ui.requests.some((request) => request.options.method === 'POST'),
    false,
  );
  await ui.reply({ ok: true, data: LIVE_EMPTY });
  assert.match(ui.body(), /暂无礼物记录/);
  ui.close();
});
