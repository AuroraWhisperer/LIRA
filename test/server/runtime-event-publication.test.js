'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRuntimeTransport } = require('../../src/server/runtime-transport');
const { buildMusicRuntime } = require('../../src/server/music-runtime');
const { createWebSocketHub } = require('../../src/server/ws');

test('runtime publication preserves gift snapshot/frame order, danmaku topic and overtime payload', (t) => {
  t.mock.method(console, 'log', () => {});
  const sent = [];
  const item = Object.freeze({ id: 4, text: 'hello' });
  let settings = { giftFrameEnabled: 'true', giftFrameThresholdRmb: '20' };
  const transport = createRuntimeTransport({
    defaultPort: 3000,
    getHost: () => '127.0.0.1',
    getStartedPort: () => 3010,
    getSessionToken: () => 'test-session',
    getState: () => ({}),
    getSettings: () => settings,
    getDanmakuFeedBuffer: () => ({
      push: (message) => (message ? item : null),
      pushGift: () => null,
    }),
    getWebSocketHub: () => ({
      broadcastSnapshot: (context, reason) => sent.push(['snapshot', context.allowedOrigins, reason]),
      broadcast: (payload, options) => sent.push(['event', payload, options]),
    }),
  });
  transport.publishGiftFlushed({
    id: 5,
    gift_id: 7,
    total_price: 25,
    detection_status: 'final',
  });
  assert.deepEqual(sent[0], ['snapshot', ['http://127.0.0.1:3010'], 'bilibili:gift']);
  assert.equal(sent[1][1].type, 'gift:frame');
  assert.equal(sent[1][1].giftEventId, 5);
  assert.equal(sent[1][1].totalPriceCents, 2500);
  settings = { giftFrameEnabled: 'false' };
  transport.publishGiftFlushed({ id: 6, total_price: 25 });
  assert.equal(sent.length, 3);
  transport.publishDanmaku({ text: 'hello' });
  assert.deepEqual(sent[3], ['event', { type: 'danmaku:message', item }, { topic: 'danmaku' }]);
  transport.publishDanmaku(null);
  assert.equal(sent.length, 4);
  const state = { remainingMs: 1000 };
  const adjustment = { seconds: 2 };
  transport.publishOvertimeUpdate({ reason: 'tick', state });
  transport.publishOvertimeUpdate({ reason: 'gift', state, adjustment });
  assert.deepEqual(sent.slice(4), [
    ['event', { type: 'overtime:update', reason: 'tick', state }, undefined],
    ['event', { type: 'overtime:update', reason: 'gift', state, adjustment }, undefined],
  ]);
});

test('finalized gifts reach the danmaku topic and reconnect snapshot without a gift-frame threshold', () => {
  const { createDanmakuFeedBuffer } = require('../../src/bilibili/danmaku/feed-buffer');
  const feed = createDanmakuFeedBuffer();
  const snapshots = [];
  const events = [];
  const transport = createRuntimeTransport({
    defaultPort: 3000,
    getHost: () => '127.0.0.1',
    getStartedPort: () => 3000,
    getSessionToken: () => 'test-session',
    getState: () => ({ danmakuFeed: feed.getSnapshot() }),
    getSettings: () => ({ giftFrameEnabled: 'false' }),
    getDanmakuFeedBuffer: () => feed,
    getWebSocketHub: () => ({
      broadcastSnapshot: (context) => snapshots.push(context.getState()),
      broadcast: (payload, options) => events.push({ payload, options }),
    }),
  });
  transport.publishGiftFlushed({
    id: 5,
    detection_status: 'final',
    user_name: '阿沐',
    gift_name: '小花花',
    num: 2,
    total_price: 0,
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.type, 'danmaku:message');
  assert.equal(events[0].payload.item.kind, 'gift');
  assert.equal(events[0].payload.item.giftCount, 2);
  assert.deepEqual(events[0].options, { topic: 'danmaku' });
  assert.deepEqual(snapshots[0].danmakuFeed, [events[0].payload.item]);
});

test('scene notifications select dynamic projections even with no ordinary WebSocket subscribers', t => {
  const hub = createWebSocketHub();
  t.after(() => hub.stop());
  const changes = [];
  const transport = createRuntimeTransport({
    defaultPort: 3000, getHost: () => '127.0.0.1', getStartedPort: () => 3000,
    getSessionToken: () => 'test-session', getWebSocketHub: () => hub,
    getState() { assert.fail('A notification must not read the complete display snapshot.'); },
    getSettings: () => ({ giftFrameEnabled: 'false' }),
    getDanmakuFeedBuffer: () => ({ push: () => ({ id: 1 }), pushGift: () => null }),
    notifySceneOutput: change => changes.push(change),
  });
  for (const [reason, types] of [
    ['queue:add', ['queue']], ['superchat:delete', ['queue']], ['bilibili:danmaku', ['queue']],
    ['songs:save', ['queue', 'songlist']], ['cloud:songs', ['queue', 'songlist']],
    ['bilibili:gift', ['overtime', 'gift-feed', 'gift-wishes', 'gift-sprint', 'blindbox']],
    ['gift:source', ['overtime', 'gift-feed', 'gift-wishes', 'gift-sprint', 'blindbox']],
    ['gift:sprint:reset', ['overtime', 'gift-feed', 'gift-wishes', 'gift-sprint', 'blindbox']],
    ['database:clear-playback', ['lyrics']],
  ]) {
    transport.broadcastSnapshot(reason);
    assert.deepEqual(changes.pop(), { types }, reason);
  }
  transport.broadcastSnapshot('settings');
  assert.deepEqual(changes.pop(), { types: ['queue', 'overtime', 'songlist', 'opening', 'lyrics', 'gift-feed', 'gift-wishes', 'gift-sprint', 'blindbox'] });
  transport.publishOvertimeUpdate({ reason: 'tick', state: { remainingMs: 1000 } });
  assert.deepEqual(changes.pop(), { types: ['overtime'] });
  transport.publishDanmaku({ text: 'local-only event' });
  assert.deepEqual(changes, [], 'Scene danmaku consumes accepted cloud projection events, not the local topic.');
  transport.broadcastSnapshot('gift:wishes');
  assert.deepEqual(changes.pop(), { types: ['gift-wishes'], invalidateTypes: ['gift-wishes'] });
  transport.publishGiftCatalogUpdate({ gifts: [] });
  assert.deepEqual(changes.pop(), { types: ['gift-feed', 'gift-wishes'], invalidateTypes: ['gift-feed', 'gift-wishes'] });
});

test('lyrics notify scenes after accepted states and changed timelines without changing read or acknowledgement shapes', t => {
  const hub = createWebSocketHub();
  const reads = [];
  const runtime = buildMusicRuntime({
    dataDir: { apiCacheDir: '', lyricCacheDir: '' },
    runtimeOptions: { weSingPlatform: 'linux' },
    settingsStore: { getSettings: () => ({ weSingCachePath: '', weSingLyricOffsetMs: '0' }) },
    webSocketHub: hub,
    onLyricsChanged: () => reads.push({ state: runtime.getLyricState(), timeline: runtime.getLyricTimeline() }),
  });
  t.after(() => { runtime.weSingCapture.stop(); hub.stop(); });
  const timeline = runtime.publishLyricTimeline({ trackTitle: '测试歌曲', lines: [{ startMs: 0, text: '第一句' }] });
  assert.equal(runtime.getLyricTimeline(), timeline);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].timeline, timeline);
  runtime.publishLyricTimeline(timeline);
  assert.equal(reads.length, 1, 'Identical timelines need no new scene read.');
  const state = runtime.publishLyricState({ trackTitle: '测试歌曲', lineText: '第一句', currentMs: 600, generation: 2, sequence: 1 });
  assert.equal(runtime.getLyricState(), state);
  assert.equal(reads.length, 2);
  assert.equal(reads[1].state, state);
  for (const input of [{ generation: 1, sequence: 100 }, { generation: 2, sequence: 1 }]) {
    const rejected = runtime.publishLyricState(input);
    assert.equal(rejected.nextGeneration, 3);
    assert.equal(runtime.getLyricState(), state);
    assert.equal(reads.length, 2, 'A stale generation or duplicate sequence must not notify.');
  }
  assert.equal(Object.hasOwn(state, 'nextGeneration'), false);
  assert.equal(Object.hasOwn(state, 'lyricState'), false);
});
