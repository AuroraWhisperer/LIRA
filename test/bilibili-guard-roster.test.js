'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { fetchGuardRoster } = require('../src/bilibili/guard-roster');

function member(uid, extra = {}) {
  return { ruid: 99, rank: uid, uinfo: { uid, base: { name: `虚构粉丝${uid}`,
    face: 'https://i0.hdslb.com/bfs/face/fixture.jpg' }, guard: { level: 3 } }, ...extra };
}

function fixture(pages) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: new URL(url), options });
    const data = url.includes('room_init') ? { room_id: 1234, uid: 99 }
      : pages[Number(new URL(url).searchParams.get('page')) - 1];
    return { ok: true, json: async () => ({ code: 0, data }) };
  };
  return { requests, fetchImpl };
}

test('guard roster resolves short room ID and owner, merges top3 and all pages without credentials', async () => {
  const f = fixture([
    { info: { num: 5 }, top3: [member(1), member(2), member(3)], list: [member(4)] },
    { info: { num: 5 }, top3: [member(1), member(2), member(3)], list: [member(5)] },
  ]);
  const result = await fetchGuardRoster('42', { fetchImpl: f.fetchImpl });
  assert.equal(result.roomId, '1234');
  assert.equal(result.ownerUid, '99');
  assert.deepEqual(result.members.map((m) => m.uid), ['1', '2', '3', '4', '5']);
  assert.equal(result.members[0].level, 3);
  assert.equal(f.requests[1].url.searchParams.get('ruid'), '99');
  assert.equal(f.requests[1].url.searchParams.get('roomid'), '1234');
  assert.equal(f.requests.every((r) => !r.options.headers.Cookie), true);
  assert.equal(f.requests.every((r) => r.options.signal instanceof AbortSignal), true);
});

test('guard roster handles zero members and skips hidden identities', async () => {
  const empty = fixture([{ info: { num: 0 }, top3: [], list: [] }]);
  assert.equal((await fetchGuardRoster('42', empty)).members.length, 0);
  const hidden = member(0, { rank: 1, uinfo: { uid: 0, base: { is_mystery: true } } });
  const unsafe = member(Number.MAX_SAFE_INTEGER + 1, { rank: 3 });
  const f = fixture([{ info: { num: 3 }, top3: [hidden], list: [member(2), unsafe] }]);
  const result = await fetchGuardRoster('42', f);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.members.map((m) => m.uid), ['2']);
});

test('guard roster rejects partial pages, changing totals, and another room owner', async () => {
  for (const pages of [
    [{ info: { num: 2 }, top3: [], list: [member(1)] }, { info: { num: 2 }, list: [] }],
    [{ info: { num: 2 }, top3: [], list: [member(1)] }, { info: { num: 2 }, list: [member(1)] }],
    [{ info: { num: 2 }, top3: [], list: [member(1)] }, { info: { num: 3 }, list: [member(2)] }],
    [{ info: { num: 1 }, top3: [], list: [member(1, { ruid: 88 })] }],
  ]) {
    await assert.rejects(fetchGuardRoster('42', fixture(pages)), /名单|房主/);
  }
});

test('guard roster rejects invalid IDs, upstream errors, and cancellation', async () => {
  await assert.rejects(fetchGuardRoster('https://untrusted.example'), /直播间/);
  await assert.rejects(fetchGuardRoster('42', { fetchImpl: async () => ({ ok: false, status: 412 }) }), /B站/);
  await assert.rejects(fetchGuardRoster('42', { fetchImpl: async () => ({ ok: true, json: async () => ({ code: -352 }) }) }), /B站/);
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(fetchGuardRoster('42', { ...fixture([]), signal: abort.signal }));
});
