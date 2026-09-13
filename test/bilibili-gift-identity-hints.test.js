'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  extractBilibiliGiftIdentity,
} = require('../src/bilibili/users/gift-identity-hints');
const { MessageHandlers } = require('../src/bilibili/danmaku/message-handlers');

test('gift messages supply identity only, independently of amounts and gift metadata', () => {
  const packet = {
    cmd: 'SEND_GIFT',
    data: {
      uid: 42,
      uname: 'Alice',
      face: 'https://i0.hdslb.com/bfs/face/alice.jpg',
    },
  };
  const expected = {
    hint: { uid: '42', name: 'Alice', avatarUrl: packet.data.face },
    roomIdentityVerified: false,
  };
  assert.deepEqual(extractBilibiliGiftIdentity(packet), expected);
  Object.assign(packet.data, {
    price: 'invalid',
    total_coin: -10,
    num: 0,
    blind_gift: { price: 999 },
    combo_num: 100,
    giftId: '1',
  });
  assert.deepEqual(extractBilibiliGiftIdentity(packet), expected);
  assert.equal(
    extractBilibiliGiftIdentity({ cmd: 'SEND_GIFT', data: {} }),
    null,
  );
  assert.equal(
    extractBilibiliGiftIdentity({ cmd: 'COMBO_END', data: packet.data }),
    null,
  );
  assert.equal(
    extractBilibiliGiftIdentity({ cmd: 'DANMU_MSG', data: packet.data }),
    null,
  );
});

test('V2 identity uses only sender protobuf fields and never requires gift totals', () => {
  const pb = Buffer.concat([
    Buffer.from([8, 42, 18, 5]),
    Buffer.from('Alice'),
  ]).toString('base64');
  assert.deepEqual(
    extractBilibiliGiftIdentity({ cmd: 'SEND_GIFT_V2', data: { pb } }),
    {
      hint: { uid: '42', name: 'Alice', avatarUrl: '' },
      roomIdentityVerified: false,
    },
  );
  assert.equal(
    extractBilibiliGiftIdentity({
      cmd: 'SEND_GIFT_V2',
      data: { pb: 'malformed' },
    }),
    null,
  );
});

test('guard identity preserves the verified role without interpreting a paid order', () => {
  for (const [name, level] of [
    ['舰长', 3],
    ['提督', 2],
    ['总督', 1],
  ]) {
    const packet = {
      cmd: 'USER_TOAST_MSG_V2',
      data: {
        sender_uinfo: { uid: 42, base: { name: 'Alice' } },
        guard_info: { role_name: name },
        option: { source: 0 },
      },
    };
    assert.deepEqual(extractBilibiliGiftIdentity(packet), {
      hint: {
        uid: '42',
        name: 'Alice',
        avatarUrl: '',
        roomIdentity: { guardKnown: true, guardLevel: level },
      },
      roomIdentityVerified: true,
    });
    packet.data.option.source = 2;
    assert.equal(extractBilibiliGiftIdentity(packet), null);
  }
  const ordinary = extractBilibiliGiftIdentity({
    cmd: 'SEND_GIFT',
    data: { uid: 42, uname: 'Alice', guard_level: 1 },
  });
  assert.equal(ordinary.roomIdentityVerified, false);
  assert.equal(ordinary.hint.roomIdentity, undefined);
});

test('local message handling only ingests user hints even if a caller supplies an old gift callback', () => {
  const identities = [];
  const handler = new MessageHandlers(
    { onGift: () => assert.fail('raw gift callback must never run') },
    {
      ingestHint(hint, context) {
        identities.push({ hint, context });
        return { snapshot: null };
      },
    },
    null,
    { parsedGiftCount: 0 },
  );
  handler.updateRoomRunContext({ roomId: '100', ownerUid: '200' });
  handler.handleIdentityMessage({
    cmd: 'USER_TOAST_MSG',
    data: { uid: 42, uname: 'Alice', guard_level: 3 },
  });
  assert.equal(identities.length, 1);
  assert.equal(identities[0].hint.roomIdentity.guardLevel, 3);
  assert.equal(identities[0].context.roomIdentityVerified, true);
  assert.equal(handler.diagnostics.parsedGiftCount, 0);
  assert.equal(handler.handleGift, undefined);
});
