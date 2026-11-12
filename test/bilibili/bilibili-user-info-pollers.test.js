'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { HistoryPoller } = require('../../src/bilibili/danmaku/history-poller');
const { OnlineRankPoller } = require('../../src/bilibili/danmaku/online-rank-poller');
const { BilibiliApiClient } = require('../../src/bilibili/danmaku/api-client');
const { MessageDeduplicator } = require('../../src/bilibili/danmaku/message-deduplicator');
const { UserInfoService } = require('../../src/bilibili/users/user-info-service');

test('history poller deduplicates and submits a stable old-to-new hint order', async () => {
  const now = Date.now();
  const observed = [];
  const service = new UserInfoService({ now: () => now });
  service.setRoom({ roomId: '100', ownerUid: '999' });
  const context = service.beginRoomRun();
  const poller = new HistoryPoller(
    {
      async fetchHistory() {
        return {
          room: [
            {
              uid: '1',
              nickname: 'new',
              text: '点歌 新',
              timeline: now - 1000,
            },
            {
              uid: '1',
              nickname: 'old',
              text: '点歌 旧',
              timeline: now - 2000,
            },
            {
              uid: '1',
              nickname: 'old',
              text: '点歌 旧',
              timeline: now - 2000,
            },
          ],
        };
      },
    },
    (message) => observed.push(message.userName),
    {
      startedAtMs: now - 5000,
      roomOwnerUid: '999',
      deduplicator: new MessageDeduplicator(),
      isCommandText: () => true,
      onIdentityHint: (hint, ingestContext) => service.ingestHint(hint, ingestContext),
    },
  );

  await poller.pollHistory(context);
  assert.deepEqual(observed, ['old', 'new']);
});

test('online rank merges both orderings beyond 100 viewers and uses available results through failures', async (t) => {
  t.mock.method(console, 'log', () => {});
  const service = new UserInfoService();
  t.after(() => service.dispose());
  service.setRoom({ roomId: '100', ownerUid: '999' });
  const context = service.beginRoomRun();
  const rows = (offset) => Array.from({ length: 100 }, (_, index) => ({
    uid: String(index + offset), name: `Viewer ${index + offset}`,
  }));
  let requests = 0;
  let failedSorts = [];
  let empty = false;
  t.mock.method(globalThis, 'fetch', async (input) => {
    requests += 1;
    const url = new URL(input);
    assert.equal(url.pathname, '/xlive/general-interface/v1/rank/queryContributionRank');
    assert.equal(url.searchParams.get('room_id'), '100');
    assert.equal(url.searchParams.get('ruid'), '999');
    assert.equal(url.searchParams.get('type'), 'online_rank');
    const sort = url.searchParams.get('switch');
    assert.ok(['contribution_rank', 'entry_time_rank'].includes(sort));
    assert.equal(url.searchParams.get('page'), '1');
    assert.equal(url.searchParams.get('page_size'), '100');
    if (failedSorts.includes(sort)) throw new Error('synthetic offline');
    const item = empty ? null : rows(sort === 'contribution_rank' ? 1 : 51);
    return new Response(JSON.stringify({ code: 0, data: { item, count: empty ? 0 : (sort === 'contribution_rank' ? 179 : 0) } }));
  });
  const poller = new OnlineRankPoller(new BilibiliApiClient('100'), service);
  t.after(() => poller.stop());

  await poller.pollOnlineRank(context);
  assert.equal(service.listOnline().length, 150);
  assert.equal(service.listOnline().find((viewer) => viewer.uid === '150').name, 'Viewer 150');
  assert.equal(requests, 2, 'read each ordering once without requesting duplicate later pages');

  failedSorts = ['entry_time_rank'];
  await poller.pollOnlineRank(context);
  assert.equal(service.listOnline().length, 100);
  assert.ok(service.listOnline().some((viewer) => viewer.uid === '1'));
  failedSorts = ['contribution_rank'];
  await poller.pollOnlineRank(context);
  assert.equal(service.listOnline().length, 100);
  assert.ok(service.listOnline().some((viewer) => viewer.uid === '150'));
  assert.equal(requests, 6);

  failedSorts = ['contribution_rank', 'entry_time_rank'];
  await assert.rejects(poller.pollOnlineRank(context), /synthetic offline/);
  assert.equal(service.listOnline().length, 100);
  assert.equal(requests, 8, 'failure does not start an extra retry loop');

  failedSorts = [];
  empty = true;
  await poller.pollOnlineRank(context);
  assert.equal(service.listOnline().length, 0);
  assert.equal(requests, 10);
  empty = false;
  await poller.pollOnlineRank(context);
  assert.equal(service.listOnline().length, 150, 'viewers recover after the upstream null empty list');
});

test('online rank does not treat failed or malformed responses as empty success', async (t) => {
  let payload;
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload)));
  const api = new BilibiliApiClient('100');
  for (payload of [
    { code: -101, data: { count: 0, item: null } },
    { code: 0, data: { count: 2, item: null } },
    { code: 0, data: { count: 0 } },
  ]) await assert.rejects(api.fetchOnlineRank('100', '999'));
});

test('a manual online rank refresh waits for the existing request without another upstream read', async (t) => {
  t.mock.method(console, 'log', () => {});
  const service = new UserInfoService();
  t.after(() => service.dispose());
  service.setRoom({ roomId: '100', ownerUid: '999' });
  const context = service.beginRoomRun();
  const reads = [];
  let requests = 0;
  const poller = new OnlineRankPoller(
    {
      fetchOnlineRank() {
        requests += 1;
        return new Promise((resolve) => { reads.push(resolve); });
      },
    },
    service,
  );
  t.after(() => poller.stop());
  const background = poller.pollOnlineRank(context);
  let manualDone = false;
  const manual = poller.pollOnlineRank(context).then(() => { manualDone = true; });
  await new Promise(setImmediate);
  assert.equal(manualDone, false);
  assert.equal(requests, 2);
  reads[0]({ item: [{ uid: '1', name: 'Alice' }], count: 1 });
  await new Promise(setImmediate);
  assert.equal(manualDone, false, 'manual refresh also waits for the entry-time ordering');
  reads[1]({ item: [{ uid: '2', name: 'Bob' }], count: 0 });
  await Promise.all([background, manual]);
  assert.deepEqual(service.listOnline().map((viewer) => viewer.uid), ['1', '2']);
});

test('a stopped online rank request cannot overwrite or release the next connection request', async (t) => {
  t.mock.method(console, 'log', () => {});
  const service = new UserInfoService();
  t.after(() => service.dispose());
  service.setRoom({ roomId: '100', ownerUid: '999' });
  const oldContext = service.beginRoomRun();
  const reads = [];
  const poller = new OnlineRankPoller({
    fetchOnlineRank: () => new Promise((resolve) => { reads.push(resolve); }),
  }, service);
  t.after(() => poller.stop());
  const oldRequest = poller.pollOnlineRank(oldContext);
  poller.stop();
  service.endRoomRun(oldContext);
  const context = service.beginRoomRun();
  const currentRequest = poller.pollOnlineRank(context);
  reads[0]({ item: [{ uid: '1', name: 'Old viewer' }] });
  reads[1]({ item: [{ uid: '3', name: 'Old entry' }] });
  await oldRequest;
  assert.equal(service.listOnline().length, 0);
  const manual = poller.pollOnlineRank(context);
  assert.equal(reads.length, 4, 'finishing the old request must not allow a duplicate current request');
  reads[2]({ item: [{ uid: '2', name: 'Current viewer' }] });
  reads[3]({ item: [] });
  await Promise.all([currentRequest, manual]);
  assert.deepEqual(service.listOnline().map((viewer) => viewer.uid), ['2']);
});
