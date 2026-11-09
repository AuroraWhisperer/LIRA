'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGiftCardRuntime } = require('../../src/server/gift-card-runtime');
const { createGiftExportRuntime } = require('../../src/server/gift-export-runtime');
const { normalizeGiftCardProfilePage } = require('../../src/shared/gift-card-profiles');

const day = '2026-09-19';
const time = Date.parse(`${day}T01:00:00Z`);
const profile = {
  eventId: 'one',
  senderId: '123',
  userName: '新名字',
  avatarUrl: null,
  guardLevel: 2,
  createdAt: new Date(time).toISOString(),
};
const page = (overrides = {}) => ({
  ok: true,
  day,
  syncEpoch: 'epoch',
  items: [profile],
  nextCursor: null,
  ...overrides,
});
const avatar = 'https://i0.hdslb.com/bfs/face/synthetic.webp';

test('missing gift avatars resolve by unique sender UID and reach the export snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: time });
  const calls = [];
  const profiles = [
    profile,
    { ...profile, eventId: 'two' },
    { ...profile, eventId: 'same-name', senderId: '456' },
    { ...profile, eventId: 'unknown', senderId: null },
  ];
  const original = structuredClone(profiles);
  const items = profiles.map((item) => ({
    eventId: item.eventId,
    gift: { userName: item.userName, giftId: '1', giftName: '礼物', num: 1, unitPrice: 1, createdAt: item.createdAt },
  }));
  const runtime = createGiftExportRuntime({
    getServices: () => ({
      gifts: { getViewRevision: () => 'a', getSelection: () => ({ viewRevision: 'a', items }) },
      overtimeGiftCatalog: { getGlobalSnapshot: () => ({ gifts: [] }) },
    }),
    getUserAvatar: async (uid) => {
      calls.push(uid);
      return uid === '123' ? avatar : '';
    },
    getSettingsStore: () => ({ getSettings: () => ({}) }),
  });
  runtime.configureGiftSync({ cardProfiles: async () => page({ items: profiles }) });
  const result = await runtime.prepareGiftExport({});
  assert.deepEqual(calls.sort(), ['123', '456']);
  assert.deepEqual(
    result.items.map((item) => item.gift.avatarUrl || null),
    [avatar, null, null],
  );
  assert.equal(result.items[0].gift.num, 2);
  assert.deepEqual(profiles, original);
});

test('avatar lookups have bounded concurrency and waiting, without mutating an already returned snapshot', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = [];
  const calls = [];
  let started;
  const fourStarted = new Promise((resolve) => {
    started = resolve;
  });
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }),
    now: () => time,
    fetchPage: async () =>
      page({
        items: Array.from({ length: 8 }, (_, index) => ({
          ...profile,
          eventId: `event-${index}`,
          senderId: String(index + 1),
        })),
      }),
    ensureAvatar: (uid) => {
      calls.push(uid);
      const promise = new Promise((resolve) => {
        pending.push({ resolve });
      });
      if (calls.length === 4) started();
      return promise;
    },
  });
  const resultPromise = runtime.getProfiles();
  await fourStarted;
  assert.equal(calls.length, 4);
  t.mock.timers.tick(4000);
  const result = await resultPromise;
  assert.equal(result.items.length, 8);
  pending.forEach(({ resolve }) => resolve(avatar));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 4);
  assert.ok(result.items.every((item) => item.avatarUrl === null));
});

test('same-day avatars survive empty packets and temporary lookup failures then recover', async () => {
  let fail = true;
  let calls = 0;
  let revision = 'a';
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => revision }),
    now: () => time,
    fetchPage: async () => page(),
    ensureAvatar: async () => {
      calls += 1;
      if (fail) throw new Error('upstream unavailable');
      return avatar;
    },
  });
  assert.equal((await runtime.getProfiles()).items[0].avatarUrl, null);
  fail = false;
  assert.equal((await runtime.getProfiles()).items[0].avatarUrl, avatar);
  fail = true;
  assert.equal((await runtime.getProfiles()).items[0].avatarUrl, avatar);
  assert.equal(calls, 2);
  revision = 'b';
  assert.equal((await runtime.getProfiles()).items[0].avatarUrl, null);
});

test('known sender avatars avoid lookups and unsafe fetched avatars are discarded', async () => {
  const calls = [];
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }),
    now: () => time,
    fetchPage: async () =>
      page({
        items: [
          profile,
          { ...profile, eventId: 'known', avatarUrl: avatar },
          { ...profile, eventId: 'unsafe', senderId: '456' },
        ],
      }),
    ensureAvatar: async (uid) => {
      calls.push(uid);
      return 'https://evil.invalid/avatar.png';
    },
  });
  const result = await runtime.getProfiles();
  assert.deepEqual(calls, ['456']);
  assert.deepEqual(
    result.items.map((item) => item.avatarUrl),
    [avatar, avatar, null],
  );
});

test('refresh can repair cached missing avatars while gift metadata is temporarily unavailable', async () => {
  let metadataAvailable = true;
  let avatarAvailable = false;
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }),
    now: () => time,
    fetchPage: async () => {
      if (!metadataAvailable) throw new Error('offline');
      return page();
    },
    ensureAvatar: async () => (avatarAvailable ? avatar : ''),
  });
  assert.equal((await runtime.getProfiles()).items[0].avatarUrl, null);
  metadataAvailable = false;
  avatarAvailable = true;
  const result = await runtime.getProfiles();
  assert.equal(result.partial, true);
  assert.equal(result.items[0].avatarUrl, avatar);
});

test('a late avatar lookup cannot cross a gift-source or runtime-reset boundary', async () => {
  for (const change of ['source', 'reset']) {
    let revision = 'a';
    let resolve;
    let started;
    const called = new Promise((done) => {
      started = done;
    });
    const runtime = createGiftCardRuntime({
      getGifts: () => ({ getViewRevision: () => revision }),
      now: () => time,
      fetchPage: async () => page(),
      ensureAvatar: () =>
        new Promise((done) => {
          resolve = done;
          started();
        }),
    });
    const pending = runtime.getProfiles();
    await called;
    if (change === 'source') revision = 'b';
    else runtime.reset();
    resolve(avatar);
    await assert.rejects(pending, { code: 'GIFT_VIEW_STALE' });
  }
});

test('card metadata validates identities and images and never accepts injected profile fields', () => {
  assert.deepEqual(normalizeGiftCardProfilePage(page({ items: [{ ...profile, secret: 'private' }] })).items, [profile]);
  for (const changes of [
    { senderId: '' },
    { senderId: 123 },
    { senderId: 'other-user' },
    { guardLevel: 4 },
    { createdAt: 'invalid' },
    { avatarUrl: 'https://evil.invalid/avatar.webp' },
  ]) {
    assert.throws(() => normalizeGiftCardProfilePage(page({ items: [{ ...profile, ...changes }] })));
  }
});

test('card metadata preserves incremental markers only with a valid revision and append contract', () => {
  const revision = 'a'.repeat(64);
  const normalized = normalizeGiftCardProfilePage(page({ revision, incremental: true, append: true }));
  assert.equal(normalized.incremental, true);
  assert.equal(normalized.append, true);
  for (const changes of [
    { incremental: 'true' },
    { incremental: true, revision: undefined },
    { append: true },
    { incremental: true, append: false },
    { incremental: true, append: true, unchanged: true, items: [] },
  ]) {
    assert.throws(() => normalizeGiftCardProfilePage(page({ revision, ...changes })));
  }
});

test('metadata retries use cached profiles only within the same source and Shanghai day', async () => {
  let revision = 'a';
  let now = time;
  let fail = false;
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => revision }),
    now: () => now,
    fetchPage: async () => {
      if (fail) throw new Error('offline');
      return page();
    },
  });
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
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => revision }),
    now: () => time,
    fetchPage: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = runtime.getProfiles('a');
  revision = 'b';
  resolve(page());
  await assert.rejects(pending, { code: 'GIFT_VIEW_STALE' });
});

test('metadata pagination shares concurrent reads and discards pages from a changed server epoch', async () => {
  const cursors = [];
  let changeEpoch = false;
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }),
    now: () => time,
    fetchPage: async ({ cursor }) => {
      cursors.push(cursor);
      return cursor
        ? page({ syncEpoch: changeEpoch ? 'new-epoch' : 'epoch', items: [{ ...profile, eventId: 'two' }] })
        : page({ nextCursor: 'one' });
    },
  });
  const [first, concurrent] = await Promise.all([runtime.getProfiles('a'), runtime.getProfiles('a')]);
  assert.equal(first, concurrent);
  assert.deepEqual(cursors, [null, 'one']);
  assert.deepEqual(
    first.items.map((item) => item.eventId),
    ['one', 'two'],
  );
  changeEpoch = true;
  await assert.rejects(runtime.getProfiles('a'), { code: 'GIFT_VIEW_STALE' });
});

test('midnight and runtime reset reject late replies and reset clears cached sender evidence', async () => {
  let now = time;
  let fetch = async () => page();
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }),
    now: () => now,
    fetchPage: (input) => fetch(input),
  });
  await runtime.getProfiles();
  let resolve;
  fetch = () =>
    new Promise((done) => {
      resolve = done;
    });
  const beforeMidnight = runtime.getProfiles();
  now += 86400000;
  resolve(page());
  await assert.rejects(beforeMidnight, { code: 'GIFT_VIEW_STALE' });
  now = time;
  const beforeReset = runtime.getProfiles();
  runtime.reset();
  resolve(page());
  await assert.rejects(beforeReset, { code: 'GIFT_VIEW_STALE' });
  fetch = async () => {
    throw new Error('offline');
  };
  assert.deepEqual((await runtime.getProfiles()).items, []);
});

test('export derives the merged snapshot before pagination while leaving selected raw rows untouched', async () => {
  const items = ['one', 'two'].map((eventId) => ({
    eventId,
    gift: {
      userName: '旧名字',
      guardLevel: 3,
      giftId: '1',
      giftName: '礼物',
      unitPrice: 20,
      num: 2,
      createdAt: new Date(time).toISOString(),
    },
  }));
  const before = structuredClone(items);
  const runtime = createGiftExportRuntime({
    getServices: () => ({
      gifts: { getSelection: () => ({ viewRevision: 'a', items }), getViewRevision: () => 'a' },
      overtimeGiftCatalog: { getGlobalSnapshot: () => ({ gifts: [] }) },
    }),
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

test('unchanged profile revisions transfer a 5000-row day once across twenty refreshes and retry missing avatars', async () => {
  let revision = 'a'.repeat(64);
  let transferred = 0;
  let calls = 0;
  let avatarAvailable = false;
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async (input) => {
      calls++;
      assert.equal(input.afterRevision, undefined, 'old servers do not receive incremental requests');
      if (input.revision === revision) return page({ revision, unchanged: true, items: [] });
      const start = input.cursor ? Number(input.cursor.slice(6)) + 1 : 0;
      const items = Array.from({ length: Math.min(200, 5000 - start) }, (_, index) => ({ ...profile, eventId: `event-${start + index}` }));
      transferred += items.length;
      return page({ revision, items, nextCursor: start + items.length < 5000 ? items.at(-1).eventId : null });
    },
    ensureAvatar: async () => avatarAvailable ? avatar : '',
  });
  const first = await runtime.getProfiles();
  for (let index = 1; index < 20; index++) {
    const next = await runtime.getProfiles('a', first.contentRevision);
    assert.equal(next.unchanged, true);
    assert.deepEqual(next.items, []);
  }
  assert.equal(calls, 44);
  assert.equal(transferred, 5000);
  avatarAvailable = true;
  const repaired = await runtime.getProfiles('a', first.contentRevision);
  assert.equal(repaired.items[0].avatarUrl, avatar);
  assert.notEqual(repaired.contentRevision, first.contentRevision);
  assert.equal(first.items[0].avatarUrl, null);
  revision = 'b'.repeat(64);
  assert.equal((await runtime.getProfiles('a', repaired.contentRevision)).items.length, 5000);
  assert.equal(transferred, 10000);
});

test('a changing revision across profile pages is never acknowledged as a complete snapshot', async () => {
  const requests = [];
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async (input) => {
      requests.push(input);
      return input.cursor ? page({ revision: 'b'.repeat(64), items: [{ ...profile, eventId: 'two' }] })
        : page({ revision: 'a'.repeat(64), nextCursor: 'one' });
    },
  });
  const incomplete = await runtime.getProfiles();
  assert.equal(incomplete.partial, true);
  assert.deepEqual(incomplete.items, []);
  await runtime.getProfiles();
  assert.equal(requests.length, 4);
  assert.ok(requests.every((input) => input.revision === undefined));
});

test('incremental profiles transfer five appended rows after a 5000-row day without changing prior snapshots', async () => {
  const rows = Array.from({ length: 5000 }, (_, index) => ({ ...profile, eventId: `event-${index}` }));
  const checkpoints = new Map();
  let revision = 'a'.repeat(64);
  let calls = 0;
  let transferred = 0;
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async ({ cursor, revision: requestedRevision, afterRevision }) => {
      calls++;
      const common = { revision, incremental: true };
      if (requestedRevision === revision) return page({ ...common, unchanged: true, items: [] });
      const append = checkpoints.has(afterRevision);
      const start = cursor ? Number(cursor.slice(6)) + 1 : append ? checkpoints.get(afterRevision) : 0;
      const items = rows.slice(start, start + 200);
      transferred += items.length;
      checkpoints.set(revision, rows.length);
      return page({ ...common, ...(append ? { append: true } : {}), items,
        nextCursor: start + items.length < rows.length ? items.at(-1).eventId : null });
    },
  });
  const first = await runtime.getProfiles();
  assert.equal(calls, 25);
  assert.equal(transferred, 5000);
  let latest = first;
  for (let index = 0; index < 5; index++) {
    rows.push({ ...profile, eventId: `event-${rows.length}` });
    revision = (index + 11).toString(16).repeat(64);
    latest = await runtime.getProfiles();
    assert.equal(latest.partial, false);
  }
  assert.equal(calls, 30);
  assert.equal(transferred, 5005);
  assert.deepEqual(latest.items.map(item => item.eventId), rows.map(item => item.eventId));
  assert.equal(first.items.length, 5000);
  assert.notEqual(latest.items, first.items);
  const unchanged = await runtime.getProfiles('a', latest.contentRevision);
  assert.equal(unchanged.unchanged, true);
  assert.equal(transferred, 5005);
});

test('append pagination keeps one accepted baseline and a full fallback replaces it across epochs', async () => {
  const requests = [];
  let phase = 'initial';
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async (input) => {
      requests.push(input);
      if (phase === 'initial') return page({ revision: 'a'.repeat(64), incremental: true,
        items: [{ ...profile, avatarUrl: avatar }] });
      if (phase === 'empty') return page({ revision: 'c'.repeat(64), incremental: true, append: true, items: [] });
      if (phase === 'full') return page({ revision: 'd'.repeat(64), incremental: true,
        syncEpoch: 'new-epoch', items: [{ ...profile, eventId: 'replacement' }] });
      return page({ revision: 'b'.repeat(64), incremental: true, append: true,
        items: [{ ...profile, eventId: input.cursor ? 'three' : 'two' }],
        nextCursor: input.cursor ? null : 'two' });
    },
  });
  const first = await runtime.getProfiles();
  phase = 'append';
  const appended = await runtime.getProfiles();
  assert.deepEqual(appended.items.map(item => item.eventId), ['one', 'two', 'three']);
  assert.deepEqual(requests.slice(1).map(input => input.afterRevision), ['a'.repeat(64), 'a'.repeat(64)]);
  assert.equal(requests[1].revision, 'a'.repeat(64));
  assert.equal(requests[2].revision, undefined);
  assert.deepEqual(first.items.map(item => item.eventId), ['one']);
  phase = 'empty';
  const empty = await runtime.getProfiles();
  assert.equal(empty.items, appended.items);
  assert.equal(empty.contentRevision, appended.contentRevision);
  phase = 'full';
  const replaced = await runtime.getProfiles();
  assert.equal(requests.at(-1).afterRevision, 'c'.repeat(64));
  assert.deepEqual(replaced.items.map(item => item.eventId), ['replacement']);
  assert.equal(replaced.items[0].avatarUrl, null, 'a new epoch cannot reuse the old sender evidence');
  assert.deepEqual(appended.items.map(item => item.eventId), ['one', 'two', 'three']);
});

test('failed or inconsistent append pages preserve the accepted snapshot and retry its baseline', async (t) => {
  for (const failure of ['offline', 'unsupported-page', 'revision', 'mode', 'cached-identity', 'page-identity']) {
    await t.test(failure, async () => {
      let initialized = false;
      let broken = true;
      const requests = [];
      const runtime = createGiftCardRuntime({
        getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
        fetchPage: async (input) => {
          requests.push(input);
          if (!initialized) {
            initialized = true;
            return page({ revision: 'a'.repeat(64), incremental: true });
          }
          const common = { revision: 'b'.repeat(64), incremental: true, append: true };
          if (!input.cursor) return page({ ...common, items: [{ ...profile, eventId: 'two' }], nextCursor: 'two' });
          if (broken && failure === 'offline') throw new Error('offline');
          if (broken && failure === 'unsupported-page') {
            throw Object.assign(new Error('invalid continuation'), { status: 400, code: 'INVALID_GIFT_CARD_CURSOR' });
          }
          return page({ ...common,
            ...(broken && failure === 'revision' ? { revision: 'c'.repeat(64) } : {}),
            ...(broken && failure === 'mode' ? { append: undefined } : {}),
            items: [{ ...profile, eventId: broken && failure === 'cached-identity' ? 'one'
              : broken && failure === 'page-identity' ? 'two' : 'three' }] });
        },
      });
      const accepted = await runtime.getProfiles();
      const failed = await runtime.getProfiles();
      assert.equal(failed.partial, true);
      assert.equal(requests.length, 3, 'only a first-page incremental rejection may trigger a full retry');
      assert.equal(failed.contentRevision, accepted.contentRevision);
      assert.deepEqual(failed.items.map(item => item.eventId), ['one']);
      broken = false;
      const recovered = await runtime.getProfiles();
      assert.equal(recovered.partial, false);
      assert.deepEqual(recovered.items.map(item => item.eventId), ['one', 'two', 'three']);
      assert.ok(requests.slice(1).every(input => input.afterRevision === 'a'.repeat(64)));
      assert.deepEqual(accepted.items.map(item => item.eventId), ['one']);
    });
  }
});

test('unsolicited append pages cannot establish a complete cached baseline', async () => {
  const requests = [];
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async (input) => {
      requests.push(input);
      return page({ revision: 'a'.repeat(64), incremental: true, append: true });
    },
  });
  for (let index = 0; index < 2; index++) {
    const result = await runtime.getProfiles();
    assert.equal(result.partial, true);
    assert.deepEqual(result.items, []);
  }
  assert.ok(requests.every(input => input.revision === undefined && input.afterRevision === undefined));
});

test('a newly observed server epoch discards the old baseline even when replacement pagination fails', async (t) => {
  for (const mode of ['append', 'incomplete-full']) {
    await t.test(mode, async () => {
      const requests = [];
      let phase = 'initial';
      const runtime = createGiftCardRuntime({
        getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
        fetchPage: async (input) => {
          requests.push(input);
          if (phase === 'initial') return page({ revision: 'a'.repeat(64), incremental: true });
          if (phase === 'offline' || input.cursor) throw new Error('offline');
          return page({ revision: 'b'.repeat(64), incremental: true, syncEpoch: 'new-epoch',
            ...(mode === 'append' ? { append: true } : { nextCursor: 'two' }),
            items: [{ ...profile, eventId: 'two' }] });
        },
      });
      const accepted = await runtime.getProfiles();
      phase = 'new-epoch';
      await assert.rejects(runtime.getProfiles(), { code: 'GIFT_VIEW_STALE' });
      phase = 'offline';
      const fallback = await runtime.getProfiles();
      assert.equal(fallback.partial, true);
      assert.deepEqual(fallback.items, []);
      assert.equal(requests.at(-1).afterRevision, undefined);
      assert.equal(requests.at(-1).revision, undefined);
      assert.deepEqual(accepted.items.map(item => item.eventId), ['one']);
    });
  }
});

test('a downgraded server gets only one full retry and stops receiving incremental parameters', async () => {
  const requests = [];
  let phase = 'initial';
  const runtime = createGiftCardRuntime({
    getGifts: () => ({ getViewRevision: () => 'a' }), now: () => time,
    fetchPage: async (input) => {
      requests.push(input);
      if (phase === 'initial') return page({ revision: 'a'.repeat(64), incremental: true });
      if (phase === 'unavailable' || input.afterRevision) {
        throw Object.assign(new Error('unsupported parameter'), { status: 400, code: 'INVALID_GIFT_CARD_CURSOR' });
      }
      return page({ revision: 'b'.repeat(64), items: [{ ...profile, eventId: 'replacement' }] });
    },
  });
  await runtime.getProfiles();
  phase = 'unavailable';
  const failed = await runtime.getProfiles();
  assert.equal(failed.partial, true);
  assert.equal(requests.length, 3);
  assert.equal(requests[2].afterRevision, undefined);
  assert.equal(requests[2].revision, undefined);
  phase = 'old-server';
  const recovered = await runtime.getProfiles();
  assert.equal(recovered.partial, false);
  assert.deepEqual(recovered.items.map(item => item.eventId), ['replacement']);
  assert.equal(requests.length, 5);
  await runtime.getProfiles();
  assert.equal(requests.length, 6);
  assert.equal(requests.at(-1).afterRevision, undefined);
  assert.equal(requests.at(-1).revision, 'b'.repeat(64));
});
