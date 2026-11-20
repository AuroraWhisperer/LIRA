'use strict';

const { createCloudSyncController } = require('../../src/electron/cloud-sync-controller');
const { mapSongForSync } = require('../../src/shared/cloud-song-snapshot');

const LOCAL_BLIND_BOX_CONFIG = [
  {
    name: '本地盲盒',
    price: 10,
    outputs: [{ name: '本地礼物', price: 20 }],
  },
];
const CLOUD_BLIND_BOX_CONFIG = [
  {
    name: '云端盲盒',
    price: 5,
    outputs: [{ name: '云端礼物', price: 8 }],
  },
];

function createFixture(overrides = {}) {
  const calls = [];
  let stateListener = null;
  let localListener = null;
  let timerId = 0;
  let cloudWatch = null;
  const timers = new Map();
  let cloudSongs = [{ title: 'Cloud song', artist: 'Singer' }];
  let songState = { initialized: true, revision: 3, updatedAt: '2026-11-18 00:00:00' };
  function commitSongs(songs) {
    calls.push(['push-songs', songs]);
    cloudSongs = songs.map(mapSongForSync);
    songState = { ...songState, revision: songState.revision + 1, updatedAt: '2026-11-18 00:00:01' };
    return { ok: true, count: songs.length, ...songState };
  }
  const licenseManager = {
    LicenseState: { AUTHORIZED: 'authorized' },
    getState: () => 'authorized',
    getSnapshot: () => ({ streamer: { accountName: 'fixture' } }),
    getCloudSyncIdentity: () => ({ accountName: 'fixture', streamerId: 1 }),
    getRemoteBaseUrl: () => 'https://api.example.test',
    onStateChanged(listener) {
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    },
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
          giftBlindBoxConfig: CLOUD_BLIND_BOX_CONFIG,
        },
      },
      songs: songState,
      bilibili: {
        initialized: true,
        revision: 4,
        loggedIn: true,
        uid: '288594073',
      },
    }),
    updateCloudSettings: async (settings) => {
      calls.push(['push-settings', settings]);
      return { initialized: true, revision: 5, values: settings };
    },
    getCloudSongs: async () => ({ songs: cloudSongs, ...songState }),
    syncSongs: async (songs) => commitSongs(songs),
    getBilibiliCredentialsInternal: async () => ({
      initialized: true,
      revision: 4,
      loggedIn: true,
      uid: '288594073',
      cookie: 'DedeUserID=288594073; SESSDATA=cloud; bili_jct=cloud-csrf',
    }),
    setBilibiliCredentialsInternal: async (cookie) => {
      calls.push(['push-bilibili', cookie]);
      return { initialized: true, revision: 7, loggedIn: true };
    },
    clearBilibiliCredentialsInternal: async () => {
      calls.push(['clear-bilibili']);
      return { initialized: true, revision: 7, loggedIn: false };
    },
    watchCloudStateChangesInternal: async (options = {}) => {
      cloudWatch = options;
      options.onOpen?.();
      await new Promise((resolve) => {
        if (options.signal?.aborted) return resolve();
        options.signal?.addEventListener('abort', resolve, { once: true });
      });
    },
    ...overrides.licenseManager,
  };
  const runtime = {
    prepareCloudRoomAccount: () => false,
    getCloudSettingsSnapshot: () => ({
      roomId: 'local-room',
      enableBilibili: true,
      paused: false,
      queueLimit: 25,
      userCooldownSeconds: 5,
      onlyFromLibrary: false,
      allowDuplicate: true,
      giftBlindBoxConfig: LOCAL_BLIND_BOX_CONFIG,
    }),
    applyCloudSettingsSnapshot: async (settings) => calls.push(['apply-settings', settings]),
    getCloudSongsSnapshot: () => [{ name: 'Local song' }],
    replaceCloudSongsSnapshot: async (songs) => calls.push(['apply-songs', songs]),
    onCloudSyncRequested(listener) {
      localListener = listener;
      return () => {
        localListener = null;
      };
    },
    ...overrides.runtime,
  };
  const bilibiliAuth = {
    getAuthState: async () => ({ loggedIn: false, uid: 0 }),
    getCookieHeader: async () => '',
    replaceCookieHeader: async (cookie) => calls.push(['apply-bilibili', cookie]),
    logout: async () => calls.push(['apply-bilibili-logout']),
    ...overrides.bilibiliAuth,
  };
  const controller = createCloudSyncController({
    now: overrides.now,
    licenseManager,
    runtime,
    bilibiliAuth,
    timers: {
      setTimeout(callback, delay) {
        const timer = {
          id: ++timerId,
          callback,
          delay,
          unrefCalled: false,
          unref() {
            this.unrefCalled = true;
          },
        };
        timers.set(timer.id, timer);
        return timer;
      },
      clearTimeout(timer) {
        if (timer) timers.delete(timer.id);
      },
    },
  });
  return {
    calls,
    commitSongs,
    controller,
    emitLocal: (scope) => localListener?.(scope),
    emitCloud: (event) => cloudWatch?.onChange?.(event),
    emitState: (state) => stateListener?.({ state }),
    timers,
  };
}

module.exports = { createFixture, LOCAL_BLIND_BOX_CONFIG, CLOUD_BLIND_BOX_CONFIG };
