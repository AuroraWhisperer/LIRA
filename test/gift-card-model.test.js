'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGiftCards } = require('../public/js/shared/gift-card-model.js');
const { giftTier } = require('../public/js/shared/gift-banner.js');
const day = '2026-09-19';
const makeItem = (eventId, options = {}) => ({
  eventId,
  gift: {
    giftId: '1',
    giftName: '礼物',
    userName: '旧名字',
    num: 1,
    unitPrice: 10,
    totalPrice: 10,
    guardLevel: 3,
    createdAt: '2026-09-19T01:00:00Z',
    ...options,
  },
});
const evidence = (item, senderId = '100', changes = {}) => ({
  eventId: item.eventId,
  senderId,
  userName: item.gift.userName,
  avatarUrl: null,
  guardLevel: item.gift.guardLevel,
  createdAt: item.gift.createdAt,
  ...changes,
});

test('today cards merge by UID and exact gift ID/name using exact historical values without changing inputs', () => {
  const items = [
    makeItem('a', { num: 2, unitPrice: 10 }),
    makeItem('b', { num: 3, unitPrice: 20 }),
    makeItem('c', { giftId: '2' }),
    makeItem('d', { giftName: '另一个礼物' }),
    makeItem('e'),
  ];
  const before = structuredClone(items);
  const profiles = items.map((item, index) => evidence(item, index === 4 ? '200' : '100'));
  const result = buildGiftCards(items, { day, profiles });
  assert.equal(result.length, 4);
  assert.equal(result[0].gift.num, 5);
  assert.equal(result[0].cardTotalCents, '8000');
  assert.equal(giftTier(result[0].gift, [3000, 10000, 100000], result[0].cardTotalCents), 1);
  assert.deepEqual(items, before);
  assert.equal(
    buildGiftCards([...items, makeItem('new')], { day, profiles: [...profiles, evidence(makeItem('new'))] })[0].eventId,
    result[0].eventId,
  );
});

test('latest known name and rank apply to every today card including selected earlier records', () => {
  const items = [makeItem('a'), makeItem('b', { giftId: '2' })];
  const profiles = items.map((item) => evidence(item));
  profiles.push(
    evidence(makeItem('unselected'), '100', { userName: '新名字', guardLevel: 2, createdAt: '2026-09-19T02:00:00Z' }),
  );
  for (const guardLevel of [2, 1, 3, 0]) {
    profiles.at(-1).guardLevel = guardLevel;
    const result = buildGiftCards(items, { day, profiles });
    assert.ok(result.every((card) => card.gift.userName === '新名字' && card.gift.guardLevel === guardLevel));
  }
  profiles.push(
    evidence(makeItem('unknown'), '100', { userName: '', guardLevel: null, createdAt: '2026-09-19T03:00:00Z' }),
  );
  const previous = buildGiftCards(items, { day, profiles });
  profiles.push(
    evidence(makeItem('renewal'), '100', { userName: '新名字', guardLevel: 0, createdAt: '2026-09-19T04:00:00Z' }),
  );
  assert.deepEqual(buildGiftCards(items, { day, profiles }), previous);
});

test('merged values retain cent precision and large quantities without using an averaged unit price', () => {
  const items = [
    makeItem('a', { unitPrice: 0.01, num: Number.MAX_SAFE_INTEGER }),
    makeItem('b', { unitPrice: 0.02, num: 2 }),
  ];
  const [card] = buildGiftCards(items, { day, profiles: items.map((item) => evidence(item)) });
  assert.equal(card.gift.num, '9007199254740993');
  assert.equal(card.cardTotalCents, '9007199254740995');
  assert.equal(giftTier(card.gift, [3000, 10000, 100000], card.cardTotalCents), 3);
});

test('unknown senders and older dates remain separate and do not borrow another day identity', () => {
  const items = [makeItem('a'), makeItem('b'), makeItem('old', { createdAt: '2026-09-18T01:00:00Z' })];
  assert.deepEqual(buildGiftCards(items, { day }), items);
  assert.deepEqual(buildGiftCards(items, { day, profiles: items.map((item) => evidence(item, null)) }), items);
  const result = buildGiftCards(items, { day, profiles: items.map((item) => evidence(item)) });
  assert.equal(result.length, 2);
  assert.equal(result[1], items[2]);
  assert.deepEqual(buildGiftCards(items, { day: '2026-09-20', profiles: items.map((item) => evidence(item)) }), items);
});
