'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteLicenseClient } = require('../../src/electron/license/remote-license-client');
const { createFixture } = require('../helpers/cloud-sync-controller-fixture');

test('malformed cloud state cannot seed remote scopes or clear a local login', async () => {
  const valid = {
    settings: { initialized: true, revision: 2, values: { giftBlindBoxConfig: [] } },
    songs: { initialized: true, revision: 3 },
    bilibili: { initialized: true, revision: 4 },
  };
  for (const malformed of [
    {},
    { ...valid, bilibili: undefined },
    { ...valid, settings: { initialized: 'false', revision: 2, values: {} } },
    { ...valid, songs: { initialized: false, revision: -1 } },
    { ...valid, settings: { initialized: true, revision: 2 } },
    { ...valid, settings: { initialized: true, revision: 2, values: [] } },
  ]) {
    let response = malformed;
    const client = createRemoteLicenseClient({ fetchImpl: async () => new Response(JSON.stringify(response)) });
    const fixture = createFixture({ licenseManager: { getCloudState: () => client.getCloudState('synthetic-token') } });
    try {
      await assert.rejects(fixture.controller.start(), { code: 'INVALID_RESPONSE' });
      assert.deepEqual(fixture.calls, [], 'an invalid snapshot must not cause any local or remote mutation');
      response = valid;
      await fixture.controller.syncNow();
      assert.deepEqual(
        fixture.calls.map(([kind]) => kind),
        ['apply-settings', 'apply-songs', 'apply-bilibili'],
      );
    } finally {
      fixture.controller.dispose();
    }
  }
});

test('malformed cloud credentials preserve the login and remain retryable', async () => {
  for (const malformed of [
    {},
    { revision: 4, loggedIn: 'false' },
    { revision: -1, loggedIn: false },
    { revision: 4, loggedIn: true },
    { revision: 4, loggedIn: true, cookie: {} },
  ]) {
    let response = malformed;
    const client = createRemoteLicenseClient({ fetchImpl: async () => new Response(JSON.stringify(response)) });
    const fixture = createFixture({
      licenseManager: { getBilibiliCredentialsInternal: () => client.getBilibiliCredentials('synthetic-token') },
    });
    try {
      await assert.rejects(fixture.controller.start(), { code: 'INVALID_RESPONSE' });
      assert.equal(
        fixture.calls.some(([kind]) => kind.startsWith('apply-bilibili')),
        false,
      );
      response = { revision: 4, loggedIn: false };
      await fixture.controller.syncNow();
      assert.equal(fixture.calls.filter(([kind]) => kind === 'apply-bilibili-logout').length, 1);
    } finally {
      fixture.controller.dispose();
    }
  }
});

test('invalid cloud songs preserve the snapshot and revision until a valid retry', async () => {
  for (const songs of [undefined, null, {}, '[]']) {
    let response = { initialized: true, revision: 3, songs };
    let reads = 0;
    const client = createRemoteLicenseClient({
      fetchImpl: async () => {
        reads += 1;
        return new Response(JSON.stringify(response));
      },
    });
    const fixture = createFixture({
      licenseManager: {
        getCloudSongs: () => client.getCloudSongs('token'),
      },
    });
    try {
      await assert.rejects(fixture.controller.start(), { code: 'INVALID_RESPONSE' });
      assert.equal(
        fixture.calls.some((call) => call[0] === 'apply-songs'),
        false,
      );
      response = { initialized: true, revision: 3, songs: [] };
      await fixture.controller.syncNow();
      assert.equal(reads, 2);
      assert.deepEqual(
        fixture.calls.filter((call) => call[0] === 'apply-songs'),
        [['apply-songs', []]],
      );
    } finally {
      fixture.controller.dispose();
    }
  }
});

test('an oversized song snapshot leaves its revision retryable while Bilibili restores and follows SSE', async (t) => {
  let oversized = true;
  let bilibiliRevision = 4;
  let songReads = 0;
  const credentialReads = [];
  const fixture = createFixture({ licenseManager: {
    getCloudState: async () => ({
      settings: { initialized: true, revision: 2, values: { giftBlindBoxConfig: [] } },
      songs: { initialized: true, revision: 3 },
      bilibili: { initialized: true, revision: bilibiliRevision },
    }),
    async getCloudSongs() {
      songReads += 1;
      if (oversized) throw Object.assign(new Error(), { code: 'RESPONSE_TOO_LARGE' });
      return { initialized: true, revision: 3, songs: [] };
    },
    async getBilibiliCredentialsInternal() {
      credentialReads.push(bilibiliRevision);
      return { loggedIn: bilibiliRevision === 4, revision: bilibiliRevision, cookie: 'fixture' };
    },
  } });
  t.after(() => fixture.controller.dispose());
  await assert.rejects(fixture.controller.start(), { code: 'RESPONSE_TOO_LARGE' });
  bilibiliRevision = 5;
  fixture.emitCloud({ scopes: { bilibili: bilibiliRevision } });
  await fixture.controller.whenIdle();
  assert.deepEqual(credentialReads, [4, 5]);
  assert.deepEqual(fixture.calls.map(([kind]) => kind), ['apply-settings', 'apply-bilibili', 'apply-bilibili-logout']);

  oversized = false;
  await fixture.controller.syncNow();
  assert.equal(songReads, 3);
  assert.deepEqual(fixture.calls.at(-1), ['apply-songs', []]);
  assert.deepEqual(credentialReads, [4, 5]);
});

test('a Retry-After on the song read still pauses subsequent scope requests', async (t) => {
  let now = 0;
  const error = Object.assign(new Error(), { code: 'RATE_LIMITED', retryAfterMs: 60_000 });
  let songReads = 0;
  const fixture = createFixture({ now: () => now, licenseManager: {
    async getCloudSongs() {
      songReads += 1;
      if (songReads === 1) throw error;
      return { initialized: true, revision: 3, songs: [] };
    },
    async getBilibiliCredentialsInternal() {
      assert.ok(now >= 60_000, 'the shared retry deadline must expire first');
      return { loggedIn: false, revision: 4 };
    },
  } });
  t.after(() => fixture.controller.dispose());
  await assert.rejects(fixture.controller.start(), error);
  now = 59_999;
  await fixture.controller.syncNow();
  assert.equal(songReads, 1);
  now = 60_000;
  await fixture.controller.syncNow();
  assert.equal(songReads, 2);
  assert.equal(fixture.calls.at(-1)[0], 'apply-bilibili-logout');
});
