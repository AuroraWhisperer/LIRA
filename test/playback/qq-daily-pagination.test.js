'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getMusicHomeContent } = require('../../src/music/music-catalog-service');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');
const { createPlaybackApp, flushAsyncWork } = require('../helpers/playback-app');

function qqFeed(pageSize, reply = (_method, _page, response) => response) {
  const provider = new QQMusicProvider();
  const pages = [], detailPages = [], firstPlays = [];
  const song = id => ({ id, mid: `mid${id}`, title: `单曲${id}` });
  provider.getSafeCookieHeader = async () => '';
  provider.requestMusicuPost = async ({ req_1: request }) => {
    if (request.method === 'get_recommend_feed') {
      const { page } = request.param;
      pages.push(page);
      const cards = Array.from({ length: pageSize(page) }, (_, i) => ({ type: 200, id: page * 1000 + i }));
      return reply(request.method, page, { req_1: { data: { v_shelf: [{ v_niche: [{ v_card: cards }] }] } } });
    }
    assert.equal(request.method, 'CgiGetTrackInfo');
    const page = Math.floor(request.param.ids[0] / 1000);
    detailPages.push(page);
    return reply(request.method, page, { req_1: { data: { tracks: request.param.ids.map(song) } } });
  };
  provider.requestMusicu = async ({ songlist }) => {
    firstPlays.push(songlist.param.firstplay);
    return { songlist: { data: { tracks: Array.from({ length: 50 }, (_, i) => song(firstPlays.length * 100 + i)) } } };
  };
  return { provider, pages, detailPages, firstPlays };
}

async function dailyDrawer(provider, platform = 'qq') {
  const starts = [], batches = [];
  const app = await createPlaybackApp({ current: null, selectedSource: platform }, {
    homeAction: 'daily', authState: { platform, loggedIn: true },
    async loadHome(request) {
      starts.push(request.page ?? 1);
      const result = await getMusicHomeContent({ get: () => provider }, request);
      batches.push(result.tracks.map(track => track.id));
      return result;
    },
  });
  await app.init();
  await flushAsyncWork();
  await app.emitHomeAction();
  await flushAsyncWork();
  return { app, starts, batches, async refresh() {
    await app.emit('playbackDrawerRefresh', 'click');
    await flushAsyncWork();
  } };
}

for (const [size, consumed] of [[7, 5], [50, 2]]) {
  test(`QQ daily refresh continues after the ${consumed} feed pages read at ${size} tracks per page`, async () => {
    const { provider, pages, detailPages } = qqFeed(() => size);
    const { app, refresh, starts, batches } = await dailyDrawer(provider);
    const firstPages = pages.slice();
    await refresh();
    const [first, second] = batches;
    const seen = new Set(first);
    const expectedPages = Array.from({ length: consumed * 2 }, (_, i) => i + 1);
    assert.deepEqual({ starts, firstPages, secondPages: pages.slice(firstPages.length),
      detailPages, counts: [first.length, second.length], overlap: second.filter(id => seen.has(id)).length }, {
      starts: [1, consumed + 1], firstPages: expectedPages.slice(0, consumed), secondPages: expectedPages.slice(consumed),
      detailPages: expectedPages, counts: [size * consumed, size * consumed], overlap: 0,
    });
    assert.match(app.element('playbackDrawerBody').innerHTML, new RegExp(`单曲${(consumed + 1) * 1000}`));
  });
}

for (const method of ['get_recommend_feed', 'CgiGetTrackInfo']) {
  test(`QQ daily retries the unconsumed page after a partial batch when ${method} times out`, async () => {
    let failed = false;
    const { provider, pages, detailPages, firstPlays } = qqFeed(() => 50, (call, page, response) => {
      if (call === method && page === 2 && !failed) {
        failed = true;
        throw new Error('temporary timeout');
      }
      return response;
    });
    const { refresh, starts, batches } = await dailyDrawer(provider);
    await refresh();
    await refresh();
    assert.deepEqual(starts, [1, 2, 4]);
    assert.deepEqual(pages, [1, 2, 2, 3, 4, 5]);
    assert.deepEqual(detailPages, method === 'CgiGetTrackInfo' ? pages : [1, 2, 3, 4, 5]);
    assert.deepEqual(batches.map(ids => [ids.length, ids[0]]), [
      [50, 'qq:mid1000'], [100, 'qq:mid2000'], [100, 'qq:mid4000'],
    ]);
    assert.deepEqual(firstPlays, []);
  });
}

test('QQ daily radio fallback leaves a failed last feed page available for retry', async () => {
  const { provider, pages, firstPlays } = qqFeed(() => 1, (method, _page, response) => {
    if (method === 'get_recommend_feed' && pages.length === 1) return { req_1: { code: -1, data: { v_shelf: [] } } };
    return response;
  });
  const first = await provider.getDailyTrackPage({ page: 50, limit: 1 });
  assert.equal(first.tracks.length, 1);
  assert.equal(first.nextPage, 50);
  const retry = await provider.getDailyTrackPage({ page: first.nextPage, limit: 1 });
  assert.deepEqual([retry.tracks[0].id, retry.nextPage], ['qq:mid50000', null]);
  assert.deepEqual(pages, [50, 50]);
  assert.deepEqual(firstPlays, [0]);
});

test('QQ daily consumes a successful detail response even when only some cards have tracks', async () => {
  const { provider, pages } = qqFeed(() => 3, (method, page, response) => {
    if (method === 'CgiGetTrackInfo') response.req_1.data.tracks.length = page === 1 ? 0 : 1;
    return response;
  });
  const batch = await provider.getDailyTrackPage({ page: 1, limit: 18 });
  assert.deepEqual(batch.tracks.map(track => track.id), ['qq:mid2000']);
  assert.equal(batch.nextPage, 3);
  assert.deepEqual(pages, [1, 2]);
});

test('QQ daily continues past a read empty page and keeps firstplay semantics for radio fallback', async () => {
  const { provider, pages, detailPages, firstPlays } = qqFeed(page => page === 1 ? 3 : 0);
  const { refresh, starts, batches } = await dailyDrawer(provider);
  await refresh();
  assert.deepEqual({ starts, pages, detailPages, firstPlays, counts: batches.map(ids => ids.length) }, {
    starts: [1, 3], pages: [1, 2, 3], detailPages: [1], firstPlays: [0], counts: [3, 50],
  });
  const empty = qqFeed(() => 0);
  const radio = await dailyDrawer(empty.provider);
  await radio.refresh();
  assert.deepEqual(empty.firstPlays, [1, 0]);
  assert.deepEqual(empty.pages, [1, 2]);
});

test('QQ daily stops at feed page 50 and reopening the drawer starts a new pass', async () => {
  const { provider, pages } = qqFeed(() => 1);
  const { app, refresh, starts } = await dailyDrawer(provider);
  for (let i = 0; i < 10; i++) await refresh();
  assert.deepEqual(starts, [1, 6, 11, 16, 21, 26, 31, 36, 41, 46]);
  assert.deepEqual(pages, Array.from({ length: 50 }, (_, i) => i + 1));
  assert.match(app.element('playbackDrawerBody').innerHTML, /没有更多内容了/);
  await app.emit('playbackDrawerClose', 'click');
  await app.emitHomeAction();
  await flushAsyncWork();
  assert.deepEqual(pages.slice(50), [1, 2, 3, 4, 5]);
});

test('NetEase daily refresh still takes successive windows of its fixed daily list', async () => {
  const provider = new NeteaseMusicProvider();
  const songs = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `每日${i + 1}`, al: { picUrl: 'test:' } }));
  provider.getLoginCookieHeader = async () => '';
  provider.requestJson = async () => ({ recommend: songs });
  const { starts, batches, refresh } = await dailyDrawer(provider, 'netease');
  await refresh();
  await refresh();
  assert.deepEqual(starts, [1, 2, 3]);
  assert.deepEqual(batches.map(ids => ids[0]), ['netease:1', 'netease:101', 'netease:1']);
});
