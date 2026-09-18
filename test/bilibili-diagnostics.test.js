'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { installTerminalLog } = require('../src/electron/terminal-log');
const { createBilibiliClient } = require('../src/server/bilibili-client');
const { logDanmakuCommand } = require('../src/bilibili/bilibili-message-handler');
const { HistoryPoller } = require('../src/bilibili/danmaku/history-poller');
const { MessageDeduplicator } = require('../src/bilibili/danmaku/message-deduplicator');
const {
  songRequestSummary,
  summarizeAuthState,
  summarizeConnectionAuth,
  songRequestReason,
} = require('../src/bilibili/diagnostics');

function captureLog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-bilibili-diagnostic-'));
  const filePath = path.join(directory, 'terminal.log');
  t.mock.method(console, 'info', () => {});
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const restore = installTerminalLog(filePath, { runId: 'diagnostics-test' });
  t.after(() => {
    restore();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const content = () => fs.readFileSync(filePath, 'utf8');
  return {
    content,
    events: () => content().split('\n')
      .filter((line) => line.includes('[Bilibili][Diagnostic] '))
      .map((line) => JSON.parse(line.split('[Bilibili][Diagnostic] ')[1])),
  };
}

test('diagnostic projections exclude credentials, viewer identity and message text', () => {
  const input = {
    message: '点歌 私密歌曲', uid: '912345678', userName: '私密昵称',
    messageTimestamp: 1789634000000, source: 'danmaku',
  };
  const summary = songRequestSummary(input);
  assert.equal(summary.commandRef, songRequestSummary(input).commandRef);
  assert.notEqual(summary.commandRef, songRequestSummary({ ...input, message: '点歌 另一首' }).commandRef);
  assert.equal(songRequestSummary({ ...input, message: '普通聊天正文' }), null);
  assert.equal(songRequestSummary({ ...input, userName: '私**称' }).nameMasked, true);
  const auth = summarizeConnectionAuth({
    cookieHeader: 'SESSDATA=synthetic-session; bili_jct=synthetic-csrf; DedeUserID=912345678',
    uid: 912345678,
  });
  assert.deepEqual(auth, { hasUid: true, hasSessdata: true, hasCsrf: true });
  const state = summarizeAuthState({
    loggedIn: true, uid: 912345678, hasSessdata: true,
    keyCookieNames: ['SESSDATA', 'bili_jct'], cookieHeader: 'secret',
  });
  assert.equal(state.loggedIn, true);
  assert.doesNotMatch(JSON.stringify({ summary, auth, state }), /私密|912345678|synthetic|secret/);
});

test('song request pipeline persists ingress, masking, rejection, dedup and queue results', (t) => {
  const log = captureLog(t);
  let result = { accepted: true, queueItem: { id: 27, song_name: '私密歌曲' } };
  const broadcasts = [];
  const client = createBilibiliClient('123', {
    isShuttingDown: () => false,
    aiDanmakuDeliveryVerifier: { observe() {} },
    domainServices: {
      messages: {
        handleDanmaku(danmaku) {
          if (!danmaku.message.startsWith('点歌')) return { accepted: false };
          if (result instanceof Error) throw result;
          return result;
        },
        logDanmaku: logDanmakuCommand,
      },
      customReplies: { isCommandText: () => false },
    },
    aiAssistant: { handleDanmaku() {} },
    broadcastSnapshot: (reason) => broadcasts.push(reason),
    updateLiveStatus() {},
    bilibiliDiagnostics: {},
    bilibiliAuthCache: { cookieHeader: 'SESSDATA=synthetic-session', uid: 42 },
    bilibiliClientGeneration: 5,
  });
  t.after(() => client.stop());
  const timestamp = Date.now();
  const packet = (text, at = timestamp) => ({
    cmd: 'DANMU_MSG', info: [[0, 0, 0, 0, at], text, [912345678, '私**称']],
  });
  client.messageHandlers.handleDanmaku(packet('普通聊天正文'));
  client.messageHandlers.handleDanmaku(packet('点歌 私密歌曲'));
  client.messageHandlers.handleDanmaku(packet('点歌 私密歌曲'));
  result = { accepted: false, reason: '当前已暂停接收点歌。' };
  client.messageHandlers.handleDanmaku(packet('点歌 第二首'));
  result = new Error('队列里已经有这首歌。');
  client.messageHandlers.handleDanmaku(packet('点歌 第三首'));
  client.messageHandlers.handleDanmaku(packet('点歌 过期', timestamp - 60_000));

  const events = log.events();
  assert.equal(events.filter((event) => event.event === 'danmaku-first-received').length, 1);
  const ingress = events.find((event) => event.event === 'command-ingress');
  const received = events.find((event) => event.event === 'command-received');
  const accepted = events.find((event) => event.status === 'accepted');
  const broadcast = events.find((event) => event.event === 'queue-broadcast');
  assert.equal(ingress.nameMasked, true);
  assert.equal(received.clientGeneration, 5);
  assert.equal(ingress.commandRef, received.commandRef);
  assert.equal(ingress.commandRef, accepted.commandRef);
  assert.equal(accepted.commandRef, broadcast.commandRef);
  assert.equal(accepted.queueId, 27);
  assert.ok(events.some((event) => event.reason === 'deduplicated:seen-key'));
  assert.ok(events.some((event) => event.reason === 'requests-paused'));
  assert.ok(events.some((event) => event.reason === 'song-already-queued' && event.status === 'failed'));
  assert.ok(events.some((event) => event.reason === 'stale-timestamp'));
  assert.equal(broadcasts.filter((reason) => reason === 'bilibili:danmaku').length, 1);
  assert.doesNotMatch(log.content(), /私密|私\*\*称|912345678|普通聊天正文|synthetic-session/);
});

test('history sampling reports stale/duplicate commands without repeating idle samples', async (t) => {
  const log = captureLog(t);
  const at = Date.now();
  const delivered = [];
  const poller = new HistoryPoller({
    fetchHistory: async () => ({ room: [
      { text: '点歌 历史歌曲', uid: 42, nickname: '私密昵称', timeline: at },
      { text: '点歌 旧歌曲', uid: 42, timeline: at - 60_000 },
    ] }),
  }, (message) => delivered.push(message), {
    startedAtMs: at,
    deduplicator: new MessageDeduplicator(),
  });
  const context = { roomId: '123', ownerUid: '456' };
  await poller.pollHistory(context);
  await poller.pollHistory(context);
  await poller.pollHistory(context);
  assert.equal(delivered.length, 1);
  const samples = log.events().filter((event) => event.event === 'history-sample');
  assert.equal(samples.length, 1);
  assert.equal(samples[0].stale, 1);
  assert.equal(samples[0].processed, 1);
  assert.doesNotMatch(log.content(), /历史歌曲|旧歌曲|私密昵称/);
});

test('queue refusal codes preserve useful distinctions without echoing request text', () => {
  for (const [reason, code] of [
    ['不是点歌指令。', 'not-a-song-command'],
    ['用户冷却中，还需 10 秒。', 'user-cooldown'],
    ['歌库里没有同时满足全部条件「私密条件」的可随机歌曲。', 'no-random-candidate'],
    ['歌曲名不能为空。', 'empty-song-name'],
    ['点歌队列已达到上限。', 'queue-full'],
    ['歌库里没有这首歌。', 'song-not-in-library'],
    ['secret unknown error', 'unexpected-error'],
  ]) assert.equal(songRequestReason(reason), code);
});
