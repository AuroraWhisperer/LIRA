'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemoteLicenseClient } = require('../../src/electron/license/remote-license-client');
const {
  createFixture,
  LOCAL_BLIND_BOX_CONFIG,
} = require('../helpers/cloud-sync-controller-fixture');

test('authorized bootstrap applies initialized cloud settings, songs, and Bilibili credentials', async () => {
  const fixture = createFixture();
  await fixture.controller.start();
  assert.deepEqual(
    fixture.calls.map((call) => call[0]),
    ['apply-settings', 'apply-songs', 'apply-bilibili'],
  );
  const timer = [...fixture.timers.values()][0];
  assert.equal(timer.delay, 600_000);
  assert.equal(timer.unrefCalled, true);
  fixture.controller.dispose();
  assert.equal(fixture.timers.size, 0);
});

test('queued cloud sync cannot bypass a throttled dirty upload', async () => {
  let uploads = 0;
  let now = 0;
  const client = createRemoteLicenseClient({
    fetchImpl: async () => new Response('busy', { status: 429, headers: { 'Retry-After': '900' } }),
  });
  const fixture = createFixture({
    now: () => now,
    licenseManager: {
      syncSongs: async () => {
        uploads += 1;
        if (uploads === 1) return client.syncSongs([], 'token');
        return { initialized: true, revision: 6 };
      },
    },
  });
  try {
    await fixture.controller.start();
    fixture.emitLocal('songs');
    await fixture.controller.whenIdle();
    assert.equal(uploads, 1);
    fixture.emitCloud({ scopes: { songs: 100 } });
    await fixture.controller.whenIdle();
    assert.equal(uploads, 1);
    await fixture.controller.syncNow();
    assert.equal(uploads, 1);
    assert.ok([...fixture.timers.values()].some((timer) => timer.delay > 890_000));
    now = 900_000;
    await fixture.controller.syncNow();
    assert.equal(uploads, 2);
    await fixture.controller.syncNow();
    assert.equal(uploads, 2);
  } finally {
    fixture.controller.dispose();
  }
});

test('repeated gift interaction intents preserve the original retry deadline', async () => {
  let now = 0;
  let uploads = 0;
  const client = createRemoteLicenseClient({
    fetchImpl: async () => new Response('busy', { status: 429, headers: { 'Retry-After': '60' } }),
  });
  const fixture = createFixture({
    now: () => now,
    licenseManager: {
      updateCloudSettings: async (values) => {
        uploads += 1;
        if (uploads === 1) return client.updateCloudSettings(values, 'token');
        return { revision: 5, values: { ...values, giftStatsQueryEnabled: false } };
      },
    },
  });
  try {
    await fixture.controller.start();
    const intent = { key: 'giftAutoThanksEnabled', enabled: true };
    assert.equal((await fixture.controller.setGiftInteraction(intent)).ok, false);
    now = 30_000;
    assert.equal((await fixture.controller.setGiftInteraction(intent)).ok, false);
    assert.equal(uploads, 1);
    now = 60_000;
    assert.equal((await fixture.controller.setGiftInteraction(intent)).ok, true);
    assert.equal(uploads, 2);
  } finally {
    fixture.controller.dispose();
  }
});

test('only non-credential uninitialized scopes are seeded from the authorized desktop', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: { initialized: false, revision: 0, values: {} },
        songs: { initialized: false, revision: 0 },
        bilibili: { initialized: false, revision: 0, loggedIn: false },
      }),
    },
    bilibiliAuth: {
      getAuthState: async () => ({ loggedIn: true, uid: 42 }),
      getCookieHeader: async () => 'DedeUserID=42; SESSDATA=local; bili_jct=local-csrf',
    },
  });
  await fixture.controller.start();
  assert.deepEqual(
    fixture.calls.map((call) => call[0]),
    ['push-settings', 'apply-settings', 'push-songs', 'apply-bilibili-logout'],
  );
  fixture.controller.dispose();
});

test('a settings upload applies the server-assigned custom id and mapping state', async () => {
  const submitted = [
    {
      giftId: null,
      name: '本地主播盲盒',
      price: 5,
      outputs: [{ giftId: '35207', name: '幸运泡泡', price: 1.5 }],
    },
  ];
  const assigned = [{ ...submitted[0], customId: '11111111-1111-4111-8111-111111111111' }];
  const mappingState = {
    mode: 'v2',
    catalogVersion: 'sha256:catalog',
    settingsRevision: 8,
    customCount: 1,
    takenOverCount: 0,
    migrationPendingCount: 0,
    applied: true,
  };
  const fixture = createFixture({
    licenseManager: {
      updateCloudSettings: async (settings) => {
        fixture.calls.push(['push-settings', settings]);
        return {
          initialized: true,
          revision: 8,
          values: { ...settings, giftBlindBoxCustomConfigV2: assigned },
          blindBoxMapping: mappingState,
        };
      },
    },
    runtime: {
      getCloudSettingsSnapshot: () => ({
        roomId: 'local-room',
        enableBilibili: true,
        paused: false,
        queueLimit: 25,
        userCooldownSeconds: 5,
        onlyFromLibrary: false,
        allowDuplicate: true,
        giftBlindBoxConfig: LOCAL_BLIND_BOX_CONFIG,
        giftBlindBoxCustomConfigV2: submitted,
      }),
      setBlindBoxMappingState: (state) => fixture.calls.push(['mapping-state', state]),
    },
  });

  fixture.emitLocal('settings');
  await fixture.controller.whenIdle();

  const applied = fixture.calls.find((call) => call[0] === 'apply-settings');
  assert.deepEqual(applied[1].giftBlindBoxCustomConfigV2, assigned);
  assert.deepEqual(fixture.calls.find((call) => call[0] === 'mapping-state')[1], mappingState);
  fixture.controller.dispose();
});

test('an older initialized cloud state preserves and seeds the local blind-box config', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: {
          initialized: true,
          revision: 2,
          values: {
            roomId: '123',
            enableBilibili: true,
            paused: false,
            queueLimit: 50,
            userCooldownSeconds: 0,
            onlyFromLibrary: false,
            allowDuplicate: true,
          },
        },
        songs: { initialized: true, revision: 3 },
        bilibili: { initialized: true, revision: 4, loggedIn: true },
      }),
    },
  });

  await fixture.controller.start();

  const applied = fixture.calls.find((call) => call[0] === 'apply-settings');
  assert.equal(Object.prototype.hasOwnProperty.call(applied[1], 'giftBlindBoxConfig'), false);
  const seeded = fixture.calls.find((call) => call[0] === 'push-settings');
  assert.deepEqual(seeded[1].giftBlindBoxConfig, LOCAL_BLIND_BOX_CONFIG);
  fixture.controller.dispose();
});

test('an explicit empty cloud blind-box config is applied without reseeding', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: {
          initialized: true,
          revision: 2,
          values: {
            roomId: '123',
            enableBilibili: true,
            paused: false,
            queueLimit: 50,
            userCooldownSeconds: 0,
            onlyFromLibrary: false,
            allowDuplicate: true,
            giftBlindBoxConfig: [],
          },
        },
        songs: { initialized: true, revision: 3 },
        bilibili: { initialized: true, revision: 4, loggedIn: true },
      }),
    },
  });

  await fixture.controller.start();

  assert.deepEqual(fixture.calls.find((call) => call[0] === 'apply-settings')[1].giftBlindBoxConfig, []);
  assert.equal(
    fixture.calls.some((call) => call[0] === 'push-settings'),
    false,
  );
  fixture.controller.dispose();
});

test('an uninitialized Bilibili scope clears local login without a cloud mutation', async () => {
  const fixture = createFixture({
    licenseManager: {
      getCloudState: async () => ({
        settings: { initialized: true, revision: 1, values: {} },
        songs: { initialized: true, revision: 1 },
        bilibili: { initialized: false, revision: 0, loggedIn: false },
      }),
      getCloudSongs: async () => ({
        songs: [],
        initialized: true,
        revision: 1,
      }),
    },
  });
  await fixture.controller.start();
  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-bilibili-logout'),
    true,
  );
  assert.equal(
    fixture.calls.some((call) => call[0] === 'clear-bilibili'),
    false,
  );
  fixture.controller.dispose();
});

test('a failed dirty upload is retried and blocks an older cloud pull', async () => {
  let attempts = 0;
  const fixture = createFixture({
    licenseManager: {
      updateCloudSettings: async (settings) => {
        attempts += 1;
        fixture.calls.push(['push-settings', settings]);
        if (attempts === 1) throw new Error('NETWORK_UNAVAILABLE');
        return { initialized: true, revision: 8, values: settings };
      },
    },
  });
  fixture.emitLocal('settings');
  await fixture.controller.whenIdle();
  assert.equal(attempts, 1);
  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-settings'),
    false,
  );

  await fixture.controller.syncNow();
  assert.equal(attempts, 2);
  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-settings'),
    true,
  );
  fixture.controller.dispose();
});

test('a mutation during upload remains dirty and uploads the newer snapshot', async () => {
  let localSongs = [{ name: 'First local song' }];
  let releaseFirstUpload;
  let signalFirstUpload;
  let attempts = 0;
  const firstUploadStarted = new Promise((resolve) => {
    signalFirstUpload = resolve;
  });
  const firstUploadBlocked = new Promise((resolve) => {
    releaseFirstUpload = resolve;
  });
  const fixture = createFixture({
    licenseManager: {
      syncSongs: async (songs) => {
        attempts += 1;
        fixture.calls.push(['push-songs', songs]);
        if (attempts === 1) {
          signalFirstUpload();
          await firstUploadBlocked;
        }
        return { initialized: true, revision: 5 + attempts };
      },
    },
    runtime: {
      getCloudSongsSnapshot: () => localSongs,
    },
  });

  fixture.emitLocal('songs');
  await firstUploadStarted;
  localSongs = [{ name: 'Newer local song' }];
  fixture.emitLocal('songs');
  releaseFirstUpload();
  await fixture.controller.whenIdle();

  assert.deepEqual(
    fixture.calls.filter((call) => call[0] === 'push-songs').map((call) => call[1]),
    [[{ name: 'First local song' }], [{ name: 'Newer local song' }]],
  );
  fixture.controller.dispose();
});

test('a local song mutation during a cloud pull blocks the stale replacement', async () => {
  let localSongs = [{ name: 'Original local song' }];
  let releaseCloudSongs;
  let signalCloudSongs;
  const cloudSongsStarted = new Promise((resolve) => {
    signalCloudSongs = resolve;
  });
  const cloudSongsBlocked = new Promise((resolve) => {
    releaseCloudSongs = resolve;
  });
  const fixture = createFixture({
    licenseManager: {
      getCloudSongs: async () => {
        signalCloudSongs();
        await cloudSongsBlocked;
        return {
          songs: [{ title: 'Stale cloud song', artist: 'Cloud' }],
          initialized: true,
          revision: 3,
        };
      },
    },
    runtime: {
      getCloudSongsSnapshot: () => localSongs,
    },
  });

  const initialSync = fixture.controller.start();
  await cloudSongsStarted;
  localSongs = [{ name: 'New local song' }];
  fixture.emitLocal('songs');
  releaseCloudSongs();
  await initialSync;
  await fixture.controller.whenIdle();

  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-songs'),
    false,
  );
  assert.deepEqual(fixture.calls.find((call) => call[0] === 'push-songs')?.[1], [{ name: 'New local song' }]);
  fixture.controller.dispose();
});

test('a local Bilibili mutation during a cloud pull blocks stale credentials', async () => {
  let localCookie = 'DedeUserID=288594073; SESSDATA=local-new';
  let releaseCloudCredentials;
  let signalCloudCredentials;
  const cloudCredentialsStarted = new Promise((resolve) => {
    signalCloudCredentials = resolve;
  });
  const cloudCredentialsBlocked = new Promise((resolve) => {
    releaseCloudCredentials = resolve;
  });
  const fixture = createFixture({
    licenseManager: {
      getBilibiliCredentialsInternal: async () => {
        signalCloudCredentials();
        await cloudCredentialsBlocked;
        return {
          initialized: true,
          revision: 4,
          loggedIn: true,
          uid: '288594073',
          cookie: 'DedeUserID=288594073; SESSDATA=stale-cloud',
        };
      },
    },
    bilibiliAuth: {
      getAuthState: async () => ({ loggedIn: true, uid: 288594073 }),
      getCookieHeader: async () => localCookie,
    },
  });

  const initialSync = fixture.controller.start();
  await cloudCredentialsStarted;
  localCookie = 'DedeUserID=288594073; SESSDATA=local-latest';
  fixture.emitLocal('bilibili');
  releaseCloudCredentials();
  await initialSync;
  await fixture.controller.whenIdle();

  assert.equal(
    fixture.calls.some((call) => call[0] === 'apply-bilibili'),
    false,
  );
  assert.deepEqual(
    fixture.calls.find((call) => call[0] === 'push-bilibili'),
    ['push-bilibili', 'DedeUserID=288594073; SESSDATA=local-latest'],
  );
  fixture.controller.dispose();
});

test('authorization loss stops polling and dispose removes both subscriptions', async () => {
  const fixture = createFixture();
  await fixture.controller.start();
  assert.equal(fixture.timers.size, 1);
  fixture.emitState('blocked');
  assert.equal(fixture.timers.size, 0);
  fixture.controller.dispose();
  fixture.emitLocal('songs');
  await fixture.controller.whenIdle();
  assert.equal(
    fixture.calls.some((call) => call[0] === 'push-songs'),
    false,
  );
});

test('stopping a cloud read prevents late settings and song writes', async () => {
  let resolveRead;
  let entered;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  const fixture = createFixture({
    licenseManager: {
      getCloudState: () => {
        entered();
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
    },
  });
  const task = fixture.controller.start();
  await reading;
  fixture.controller.stop();
  resolveRead({ settings: { initialized: true, revision: 99, values: {} } });
  await task;
  assert.deepEqual(fixture.calls, []);
  fixture.controller.dispose();
});

test('disposing during a song fetch prevents applying its late response', async () => {
  let resolveRead;
  let entered;
  const reading = new Promise((resolve) => {
    entered = resolve;
  });
  const fixture = createFixture({
    licenseManager: {
      getCloudSongs: () => {
        entered();
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
    },
  });
  const task = fixture.controller.start();
  await reading;
  fixture.controller.dispose();
  const before = fixture.calls.length;
  resolveRead({ songs: [{ title: 'late' }], revision: 3 });
  await task;
  assert.equal(fixture.calls.length, before);
});
