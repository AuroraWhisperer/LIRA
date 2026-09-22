'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createLotterySession } = require('../src/electron/dynamic-lottery-session');

test('lottery session fences authorization and Bilibili credential changes', async () => {
  let identity = { streamerId: 42, accountName: '主播甲' };
  let authorizationEpoch = 7;
  let cookieHeader = 'DedeUserID=9007199254740993123; SESSDATA=session-a; bili_jct=csrf-a; sid=one';
  const session = createLotterySession({
    getCookieHeader: async () => cookieHeader,
    getIdentity: () => identity,
    getAuthorizationEpoch: () => authorizationEpoch,
  });

  const initial = await session.getContext();
  assert.deepEqual(initial, {
    streamerId: '42',
    authorizationEpoch: 7,
    sessionEpoch: 1,
    cookieHeader,
  });

  identity = { streamerId: 42, accountName: '主播甲（新昵称）' };
  cookieHeader = 'sid=two; bili_jct=csrf-a; SESSDATA=session-a; DedeUserID=9007199254740993123';
  assert.equal((await session.getContext()).sessionEpoch, 1);

  cookieHeader = 'DedeUserID=9007199254740993123; SESSDATA=session-b; bili_jct=csrf-a';
  assert.equal((await session.getContext()).sessionEpoch, 2);

  authorizationEpoch += 1;
  assert.equal((await session.getContext()).sessionEpoch, 3);

  identity = { streamerId: 43, accountName: '主播乙' };
  assert.equal((await session.getContext()).sessionEpoch, 4);
});

test('lottery session invalidates logout and rejects use after disposal', async () => {
  let cookieHeader = 'DedeUserID=123; SESSDATA=session-a; bili_jct=csrf-a';
  const session = createLotterySession({
    getCookieHeader: async () => cookieHeader,
    getIdentity: () => ({ streamerId: 8, accountName: 'fixture' }),
    getAuthorizationEpoch: () => 2,
  });

  const initial = await session.getContext();
  cookieHeader = '';
  await assert.rejects(session.getContext(), (error) => error.code === 'LOTTERY_SESSION_UNAVAILABLE');

  cookieHeader = 'DedeUserID=123; SESSDATA=session-b; bili_jct=csrf-b';
  assert.ok((await session.getContext()).sessionEpoch > initial.sessionEpoch);

  session.dispose();
  session.dispose();
  await assert.rejects(session.getContext(), (error) => error.code === 'LOTTERY_SESSION_DISPOSED');
});

test('lottery session requires a trusted LIRA identity', async () => {
  const session = createLotterySession({
    getCookieHeader: async () => 'DedeUserID=123; SESSDATA=session-a; bili_jct=csrf-a',
    getIdentity: () => null,
    getAuthorizationEpoch: () => 1,
  });

  await assert.rejects(session.getContext(), (error) => error.code === 'LOTTERY_IDENTITY_UNAVAILABLE');
});
