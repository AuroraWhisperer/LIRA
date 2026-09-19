'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGiftCardRuntime } = require('../src/server/gift-card-runtime');
const { createGiftExportRuntime } = require('../src/server/gift-export-runtime');
const { normalizeGiftCardProfilePage } = require('../src/shared/gift-card-profiles');

const day = '2026-09-19';
const time = Date.parse(`${day}T01:00:00Z`);
const profile = { eventId: 'one', senderId: '123', userName: '新名字', avatarUrl: null, guardLevel: 2, createdAt: new Date(time).toISOString() };
const page = (overrides = {}) => ({ ok: true, day, syncEpoch: 'epoch', items: [profile], nextCursor: null, ...overrides });

test('card metadata validates identities and images and never accepts injected profile fields', () => {
  assert.deepEqual(normalizeGiftCardProfilePage(page({ items: [{ ...profile, secret: 'private' }] })).items, [profile]);
  for (const changes of [{ senderId: '' }, { senderId: 123 }, { senderId: 'other-user' }, { guardLevel: 4 },
    { createdAt: 'invalid' }, { avatarUrl: 'https://evil.invalid/avatar.webp' }]) {
    assert.throws(() => normalizeGiftCardProfilePage(page({ items: [{ ...profile, ...changes }] })));
  }
});

test('metadata retries use cached profiles only within the same source and Shanghai day', async () => {
  let revision = 'a';
  let now = time;
  let fail = false;
  const runtime = createGiftCardRuntime({ getGifts: () => ({ getViewRevision: () => revision }), now: () => now,
    fetchPage: async () => { if (fail) throw new Error('offline'); return page(); } });
  assert.equal((await runtime.getProfiles()).partial, false);
  fail = true;
  assert.deepEqual((await runtime.getProfiles()).items, [profile]);
  revision = 'b';
  assert.deepEqual((await runtime.getProfiles()).items, []);
  fail = false;
  await runtime.getProfiles();
  fail = true;
  now += 86400000;
  assert.deepEqual((await runtime.getProfiles()).items, []);
});

test('a late metadata reply cannot cross a gift-source boundary', async () => {
  let revision = 'a';
  let resolve;
  const runtime = createGiftCardRuntime({ getGifts: () => ({ getViewRevision: () => revision }), now: () => time,
    fetchPage: () => new Promise((done) => { resolve = done; }) });
  const pending = runtime.getProfiles('a');
  revision = 'b';
  resolve(page());
  await assert.rejects(pending, { code: 'GIFT_VIEW_STALE' });
});

test('metadata pagination shares concurrent reads and discards pages from a changed server epoch', async () => {
  const cursors = [];
  let changeEpoch = false;
  const runtime = createGiftCardRuntime({ getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async ({ cursor }) => {
      cursors.push(cursor);
      return cursor ? page({ syncEpoch: changeEpoch ? 'new-epoch' : 'epoch', items: [{ ...profile, eventId: 'two' }] })
        : page({ nextCursor: 'one' });
    } });
  const [first, concurrent] = await Promise.all([runtime.getProfiles('a'), runtime.getProfiles('a')]);
  assert.equal(first, concurrent);
  assert.deepEqual(cursors, [null, 'one']);
  assert.deepEqual(first.items.map((item) => item.eventId), ['one', 'two']);
  changeEpoch = true;
  await assert.rejects(runtime.getProfiles('a'), { code: 'GIFT_VIEW_STALE' });
});

test('midnight and runtime reset reject late replies and reset clears cached sender evidence', async () => {
  let now = time;
  let fetch = async () => page();
  const runtime = createGiftCardRuntime({ getGifts: () => ({ getViewRevision: () => 'a' }), now: () => now,
    fetchPage: (input) => fetch(input) });
  await runtime.getProfiles();
  let resolve;
  fetch = () => new Promise((done) => { resolve = done; });
  const beforeMidnight = runtime.getProfiles();
  now += 86400000;
  resolve(page());
  await assert.rejects(beforeMidnight, { code: 'GIFT_VIEW_STALE' });
  now = time;
  const beforeReset = runtime.getProfiles();
  runtime.reset();
  resolve(page());
  await assert.rejects(beforeReset, { code: 'GIFT_VIEW_STALE' });
  fetch = async () => { throw new Error('offline'); };
  assert.deepEqual((await runtime.getProfiles()).items, []);
});

test('export derives the merged snapshot before pagination while leaving selected raw rows untouched', async () => {
  const items = ['one', 'two'].map((eventId) => ({ eventId, gift: { userName: '旧名字', guardLevel: 3,
    giftId: '1', giftName: '礼物', unitPrice: 20, num: 2, createdAt: new Date(time).toISOString() } }));
  const before = structuredClone(items);
  const runtime = createGiftExportRuntime({
    getServices: () => ({ gifts: { getSelection: () => ({ viewRevision: 'a', items }), getViewRevision: () => 'a' },
      overtimeGiftCatalog: { getGlobalSnapshot: () => ({ gifts: [] }) } }),
    getSettingsStore: () => ({ getSettings: () => ({}) }),
    giftCards: { getProfiles: async () => ({ day, items: [profile, { ...profile, eventId: 'two' }], partial: false }) },
  });
  const result = await runtime.prepareGiftExport({});
  assert.equal(result.selectedCount, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].gift.num, 4);
  assert.equal(result.items[0].cardTotalCents, '8000');
  assert.equal(result.items[0].gift.userName, '新名字');
  assert.equal(result.items[0].gift.guardLevel, 2);
  assert.deepEqual(items, before);
});
