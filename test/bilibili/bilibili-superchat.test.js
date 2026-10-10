'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { extractBilibiliSuperChatMessage } = require('../../src/bilibili/parsers/superchat-parser');
const { MessageHandlers, formatBilibiliSuperChatLog } = require('../../src/bilibili/danmaku/message-handlers');
const { MessageDeduplicator } = require('../../src/bilibili/danmaku/message-deduplicator');

function packet(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.alloc(16 + body.length);
  frame.writeUInt32BE(frame.length, 0);
  frame.writeUInt16BE(16, 4);
  frame.writeUInt16BE(0, 6);
  frame.writeUInt32BE(5, 8);
  frame.writeUInt32BE(1, 12);
  body.copy(frame, 16);
  return frame;
}

function superChat(id, uid, message, price, startTime, extra = {}) {
  return { cmd: 'SUPER_CHAT_MESSAGE', data: { id, uid, message, price, start_time: startTime,
    user_info: { uname: `观众${uid}`, face: 'https://i0.hdslb.com/bfs/face/sc.jpg' }, ...extra } };
}

function createHandler(t, startedAtMs) {
  const superChats = [];
  const deletions = [];
  const commands = [];
  const hints = [];
  const logs = [];
  t.mock.method(console, 'log', (line) => logs.push(String(line)));
  t.mock.method(console, 'info', () => {});
  const handler = new MessageHandlers(
    {
      onSuperChat: (item) => superChats.push(item),
      onSuperChatDelete: (ids) => deletions.push(ids),
      onMessage: (item) => commands.push(item),
    },
    {
      ingestHint(hint, context) {
        hints.push({ hint, context });
        return { snapshot: { uid: hint.uid, name: `${hint.name}·资料`, avatarUrl: hint.avatarUrl,
          guard: { known: true, level: 2 }, fansMedal: { known: true, value: { name: '本房牌', level: 21 } } } };
      },
    },
    new MessageDeduplicator(),
    { commandCounts: {}, recentCommands: [], recentGiftLikeCommands: [] },
    { startedAtMs, connectionGeneration: 4, connectionAttempt: 2, roomOwnerUid: '456' },
  );
  handler.updateRoomRunContext({ roomId: '100', ownerUid: '456' });
  return { handler, superChats, deletions, commands, hints, logs };
}

test('SC deletion is distinct from creation and never becomes a command or identity hint', async (t) => {
  const f = createHandler(t, 0);
  await f.handler.handlePackets(Buffer.concat([
    packet({ cmd: 'SUPER_CHAT_MESSAGE_DELETE:1', data: { ids: [123, '123', 'sc-2', '', null, {}, -1] } }),
    packet({ cmd: 'SUPER_CHAT_MESSAGE_DELETE', data: { ids: null } }),
    packet({ cmd: 'SUPER_CHAT_MESSAGE_UNKNOWN', data: { price: 30, message: '点歌 测试' } }),
  ]));
  assert.deepEqual(f.deletions, [['123', 'sc-2']]);
  assert.deepEqual(f.superChats, []);
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.hints, []);
});

test('SC accepts known creation variants and preserves the exact upstream string ID', async (t) => {
  const f = createHandler(t, 0);
  await f.handler.handlePackets(packet({ ...superChat(1, 123, '支持', 30, 1800000000,
    { id_str: '9007199254740993' }), cmd: 'SUPER_CHAT_MESSAGE_JPN:1' }));
  assert.equal(f.superChats[0].id, '9007199254740993');
});

test('every SuperChat packet reaches the SC consumer; only fresh, unique commands are queued and pinned by price', async (t) => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const f = createHandler(t, (nowSeconds - 60) * 1000);
  await f.handler.handlePackets(Buffer.concat([
    packet(superChat(1, 123, '点歌 晴天', 30, nowSeconds, { medal_info: { medal_name: '本房牌', medal_level: 21, target_id: 456 } })),
    packet(superChat(2, 123, '点歌 晴天', 30, nowSeconds)),
    packet(superChat(3, 124, '主播辛苦了', 50, nowSeconds)),
    packet(superChat(4, 125, '点歌 稻香', 1, nowSeconds)),
    packet(superChat(5, 126, '点歌 七里香', 30, nowSeconds - 3600)),
  ]));

  assert.deepEqual(f.superChats.map((item) => [item.id, item.price, item.source]),
    [['1', 30, 'superchat'], ['2', 30, 'superchat'], ['3', 50, 'superchat'], ['4', 1, 'superchat'], ['5', 30, 'superchat']],
    'every paid message is delivered, including duplicates and non-commands');
  assert.equal(f.superChats[0].userName, '观众123·资料', 'the SC uses the ingested identity');
  assert.equal(f.superChats[0].requesterGuardLevel, 2);
  assert.equal(f.superChats[0].currentRoomVerified, true);
  assert.deepEqual([f.superChats[0].connectionGeneration, f.superChats[0].connectionAttempt, f.superChats[0].cmd],
    [4, 2, 'SUPER_CHAT_MESSAGE']);
  assert.equal(f.hints.length, 5);
  assert.deepEqual(f.hints[0].context, { roomId: '100', ownerUid: '456', source: 'superchat', roomIdentityVerified: true });
  assert.equal(f.hints[1].context.roomIdentityVerified, false);

  assert.deepEqual(f.commands.map((item) => [item.message, item.uid, item.isPinned]),
    [['点歌 晴天', '123', true], ['点歌 稻香', '125', false]],
    'duplicate, non-command and stale SCs never become commands; pinning follows the price threshold');
  assert.equal(f.commands[0].source, 'superchat');
  assert.equal(f.commands[0].requesterMedalName, '本房牌');
  assert.equal(f.logs.filter((line) => line.startsWith('[Bilibili][SuperChat] status=received')).length, 5);
});

test('SuperChat log lines carry the ingested requester and connection trace', () => {
  const line = formatBilibiliSuperChatLog(
    { uid: 123, userName: 'Alice', message: '支持主播', price: 30, messageTimestamp: 1785769654000 },
    { connectionGeneration: 2, connectionAttempt: 3, cmd: 'SUPER_CHAT_MESSAGE' },
  );
  assert.ok(line.startsWith('[Bilibili][SuperChat] status=received '));
  for (const field of ['user="Alice"', 'uid="123"', 'price=30', 'message="支持主播"']) assert.ok(line.includes(field), field);
  assert.deepEqual(JSON.parse(line.slice(line.indexOf('trace=') + 6)), {
    connectionGeneration: 2, connectionAttempt: 3, cmd: 'SUPER_CHAT_MESSAGE', messageTimestamp: '2026-08-03T15:07:34.000Z',
  });
});

test('superchat metadata drops a medal explicitly belonging to another room', () => {
  const result = extractBilibiliSuperChatMessage(
    {
      data: {
        message: '点歌',
        uid: 123,
        user_info: { uname: '点歌人' },
        medal_info: { medal_name: '别家牌子', medal_level: 30, target_id: 999, guard_level: 2 },
      },
    },
    456,
  );
  assert.equal(result.medalName, '');
  assert.equal(result.medalLevel, 0);
  assert.equal(result.guardLevel, 0);
  assert.equal(result.currentRoomVerified, true);
});

test('superchat maps a trusted user face into the identity avatar', () => {
  const result = extractBilibiliSuperChatMessage({
    data: { uid: 123, user_info: { uname: '点歌人', face: 'https://i0.hdslb.com/bfs/face/superchat.jpg' } },
  });
  assert.equal(result.avatarUrl, 'https://i0.hdslb.com/bfs/face/superchat.jpg');
});
