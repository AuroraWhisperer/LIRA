'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { extractBilibiliLiveLotteryEvents } = require('../../src/bilibili/parsers/live-lottery-parser');
const { createBilibiliClient } = require('../../src/server/bilibili-client');

test('anchor lottery lifecycle preserves prizes, requirements and separate close/result events', () => {
  const data = {
    id: '9007199254740993', award_name: '测试奖品', award_num: 2, time: 120,
    require_type: 1, require_value: 10, require_text: '粉丝勋章等级要求',
    join_type: 1, danmu: '测试口令', gift_id: 42, gift_num: 1,
  };
  const [start] = extractBilibiliLiveLotteryEvents({ cmd: 'ANCHOR_LOT_START:1', data }, { roomId: '123' });
  assert.deepEqual([start.kind, start.phase, start.id, start.roomId, start.sourceRoomId],
    ['anchor-lottery', 'start', data.id, '123', '123']);
  assert.deepEqual(start.data, data);
  start.data.award_name = 'changed';
  assert.equal(data.award_name, '测试奖品');

  const [end] = extractBilibiliLiveLotteryEvents({ cmd: 'ANCHOR_LOT_END', data: { id: data.id } }, { roomId: '123' });
  assert.equal(end.phase, 'end');
  assert.deepEqual(end.winners, []);
  const [award] = extractBilibiliLiveLotteryEvents({ cmd: 'ANCHOR_LOT_AWARD', data: {
    ...data, award_users: [
      { uid: 42, uname: '旧昵称', uinfo: { uid: 43, base: { name: '测试观众', is_mystery: true } } },
      { uid: '44', uname: '测试观众二' }, null,
    ],
  } }, { roomId: '123' });
  assert.equal(award.phase, 'award');
  assert.deepEqual(award.winners.map(({ uid, userName, isMystery }) => ({ uid, userName, isMystery })), [
    { uid: '43', userName: '测试观众', isMystery: true },
    { uid: '44', userName: '测试观众二', isMystery: false },
  ]);
});

test('red-pocket announcements retain source/announced rooms and can omit the lottery ID', () => {
  for (const cmd of ['POPULARITY_RED_POCKET_NEW', 'POPULARITY_RED_POCKET_V2_NEW']) {
    const [event] = extractBilibiliLiveLotteryEvents({ cmd, data: {
      roomid: 456, wait_num_v2: 2, uid: 42, uname: '旧昵称',
      sender_info: { uid: 43, base: { name: '测试发送者' } },
    } }, { roomId: '123' });
    assert.deepEqual([event.kind, event.phase, event.id, event.roomId, event.sourceRoomId],
      ['red-pocket', 'new', '', '456', '123']);
    assert.equal(event.sender.uid, '43');
    assert.equal(event.sender.userName, '测试发送者');
    assert.equal(event.data.wait_num_v2, 2);
  }
});

test('red-pocket starts accept individual and queued payloads without discarding upstream content', () => {
  const first = {
    lot_id: 10, start_time: 1800000000, end_time: 1800000060, join_requirement: 1,
    sender_uid: 42, sender_name: '测试发送者', awards: [{ gift_id: 3, gift_name: '测试礼物', num: 2 }],
  };
  const second = { ...first, lot_id: 11 };
  for (const data of [[first, second], { list: [first, second] }, { lot_info: [first, second] }]) {
    const events = extractBilibiliLiveLotteryEvents({ cmd: 'POPULARITY_RED_POCKET_V2_START', data }, { roomId: '123' });
    assert.deepEqual(events.map(event => event.id), ['10', '11']);
    assert.deepEqual(events[0].data, first);
    assert.equal(events[0].sender.uid, '42');
  }
  const [legacy] = extractBilibiliLiveLotteryEvents({ cmd: 'POPULARITY_RED_POCKET_START', data: first }, { roomId: '123' });
  assert.equal(legacy.id, '10');
  const [classic] = extractBilibiliLiveLotteryEvents({ cmd: 'RED_POCKET_START', data: {
    id: 12, remain_time: 30, num: 2, new_message: '测试口令', sender_uid: 42,
  } }, { roomId: '123' });
  assert.equal(classic.id, '12');
  assert.equal(classic.data.remain_time, 30);
  assert.equal(classic.data.new_message, '测试口令');
});

test('versioned red-pocket winner rows resolve identities and the award table without mutating input', () => {
  const data = {
    lot_id: 10, version: 1,
    awards: { 3: { award_name: '测试礼物', award_type: 1 } },
    winner_info: [
      [42, '旧昵称', 99, 3, false, 100, 1800000000, 1, { uid: '9007199254740993', base: { name: '测试中奖者' } }],
      [43, '神秘观众', 98, 4, true],
      null, [],
    ],
  };
  const original = structuredClone(data);
  const [event] = extractBilibiliLiveLotteryEvents({ cmd: 'POPULARITY_RED_POCKET_V2_WINNER_LIST', data }, { roomId: '123' });
  assert.equal(event.phase, 'award');
  assert.deepEqual(event.winners, [
    { uid: '9007199254740993', userName: '测试中奖者', isMystery: false, giftId: '3', giftCount: 1, awardName: '测试礼物', awardType: 1 },
    { uid: '43', userName: '神秘观众', isMystery: true, giftId: '4', giftCount: 1, awardName: '', awardType: null },
  ]);
  assert.deepEqual(data, original);
  for (const cmd of ['POPULARITY_RED_POCKET_WINNER_LIST', 'POPULARITY_RED_POCKET_V2_WINNER_LIST']) {
    const [objectResult] = extractBilibiliLiveLotteryEvents({ cmd, data: {
      lot_id: 10, winner_info: [{ uid: 42, name: '测试中奖者', gift_id: 3, gift_num: 2, award_name: '测试奖品' }],
    } }, { roomId: '123' });
    assert.equal(objectResult.winners[0].giftCount, 2);
    assert.equal(objectResult.winners[0].awardName, '测试奖品');
  }
});

test('invalid messages and imprecise IDs are ignored instead of misidentifying a lottery or room', () => {
  for (const message of [
    null, { cmd: 'ANCHOR_LOT_START_UNKNOWN', data: { id: 1 } },
    { cmd: 'ANCHOR_LOT_START', data: [] },
    ...[undefined, true, 0, Number.MAX_SAFE_INTEGER + 1].map(id => ({ cmd: 'ANCHOR_LOT_START', data: { id } })),
    { cmd: 'ANCHOR_LOT_START', data: { id: 1, room_id: 'invalid' } },
    { cmd: 'POPULARITY_RED_POCKET_V2_NEW', data: {} },
    { cmd: 'POPULARITY_RED_POCKET_V2_NEW', data: { lot_id: Number.MAX_SAFE_INTEGER + 1, wait_num_v2: 1 } },
  ]) assert.deepEqual(extractBilibiliLiveLotteryEvents(message, { roomId: '123' }), []);
  assert.deepEqual(extractBilibiliLiveLotteryEvents({ cmd: 'ANCHOR_LOT_START', data: { id: 1 } }), []);
});

function packet(payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const frame = Buffer.alloc(16 + body.length);
  frame.writeUInt32BE(frame.length, 0);
  frame.writeUInt16BE(16, 4);
  frame.writeUInt32BE(5, 8);
  frame.writeUInt32BE(1, 12);
  body.copy(frame, 16);
  return frame;
}

test('authenticated packets reach the reusable callback without entering song, gift or SC consumers', async (t) => {
  const events = [];
  let shuttingDown = false;
  let otherCalls = 0;
  const client = createBilibiliClient('123', {
    isShuttingDown: () => shuttingDown,
    onLiveLottery: event => events.push(event),
    bilibiliAuthCache: { cookieHeader: '', uid: 0 },
    userInfoService: { ingestHint: () => { otherCalls++; } },
    domainServices: {
      customReplies: { isCommandText: () => false },
      messages: { handleDanmaku: () => { otherCalls++; } },
      superChats: { add: () => { otherCalls++; } },
      gifts: { add: () => { otherCalls++; } },
    },
  });
  t.after(() => client.stop());
  const frames = Buffer.concat([
    packet({ cmd: 'ANCHOR_LOT_START', data: { id: 1, award_name: '测试奖品' } }),
    packet({ cmd: 'POPULARITY_RED_POCKET_V2_START', data: { lot_id: 2 } }),
  ]);
  await client.messageHandlers.handlePackets(frames);
  await client.messageHandlers.handlePackets(frames, { roomId: '123', authenticated: false });
  assert.equal(events.length, 0);
  await client.messageHandlers.handlePackets(frames, { roomId: '123', authenticated: true });
  assert.deepEqual(events.map(event => event.kind), ['anchor-lottery', 'red-pocket']);
  assert.equal(otherCalls, 0);
  shuttingDown = true;
  await client.messageHandlers.handlePackets(frames, { roomId: '123', authenticated: true });
  assert.equal(events.length, 2);
});
