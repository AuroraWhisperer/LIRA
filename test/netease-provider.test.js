'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NeteaseMusicProvider } = require('../src/music/providers/netease-provider');
const { getMusicHomeContent, writeMusicPlaylistTracks } = require('../src/music/lyrics-service');

function createProvider() {
  return new NeteaseMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => 'MUSIC_U=test-token; __csrf=test-csrf'
  });
}

test('Netease provider resolves a full stream with the current account rights', async () => {
  const provider = createProvider();
  let captured;
  provider.requestJson = async (pathname, params) => {
    captured = { pathname, params };
    return {
      code: 200,
      data: [{
        id: 461011,
        url: 'https://cdn.test/full.mp3',
        code: 200,
        expi: 1200,
        level: 'standard',
        type: 'mp3',
        freeTrialInfo: null
      }]
    };
  };

  const stream = await provider.resolvePlayableUrl({ sourceTrackId: '461011' });

  assert.equal(captured.pathname, '/api/song/enhance/player/url/v1');
  assert.equal(captured.params.ids, '[461011]');
  assert.equal(captured.params.level, 'standard');
  assert.equal(captured.params.encodeType, 'mp3');
  assert.equal(stream.url, 'https://cdn.test/full.mp3');
  assert.equal(stream.trial, false);
  assert.equal(stream.level, 'standard');
  assert.equal(stream.type, 'mp3');
  assert.ok(stream.expireAt > Date.now());
});

test('Netease provider preserves an official trial stream for a non-VIP account', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    code: 200,
    data: [{
      id: 461011,
      url: 'http://cdn.test/trial.mp3',
      code: 200,
      expi: 600,
      freeTrialInfo: { start: 30, end: 60 }
    }]
  });

  const stream = await provider.resolvePlayableUrl({ sourceTrackId: '461011' });

  assert.equal(stream.url, 'http://cdn.test/trial.mp3');
  assert.equal(stream.trial, true);
  assert.equal(stream.trialStartMs, 30000);
  assert.equal(stream.trialEndMs, 60000);
});

test('Netease provider rejects songs that the current account cannot play or trial', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    code: 200,
    data: [{ id: 461011, url: null, code: -110, freeTrialInfo: null }]
  });

  await assert.rejects(
    provider.resolvePlayableUrl({ sourceTrackId: '461011' }),
    /无法播放或试听/
  );
});

test('Netease provider rejects unsafe upstream stream protocols', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    code: 200,
    data: [{ id: 461011, url: 'javascript:alert(1)', code: 200 }]
  });

  await assert.rejects(
    provider.resolvePlayableUrl({ sourceTrackId: '461011' }),
    /地址无效/
  );
});

test('Netease search enriches result artwork with one batched song-detail request', async () => {
  const provider = createProvider();
  const requests = [];
  provider.requestJson = async (pathname, params) => {
    requests.push({ pathname, params });
    if (pathname === '/api/search/get/web') {
      return {
        result: {
          songs: [{
            id: 11,
            name: 'A',
            album: { id: 1, name: 'Old' },
            artists: [{ name: 'Singer', img1v1Url: 'https://artist.test/a.jpg' }]
          }, {
            id: 22,
            name: 'B',
            album: { id: 2, name: 'Other' },
            artists: [{ name: 'Second singer', img1v1Url: 'https://artist.test/b.jpg' }]
          }]
        }
      };
    }
    return {
      songs: [
        { id: 22, album: { picUrl: 'https://album.test/b.jpg' } },
        { id: 11, album: { picUrl: 'https://album.test/a.jpg' } }
      ]
    };
  };

  const tracks = await provider.searchTracks('A', { limit: 9 });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].pathname, '/api/song/detail');
  assert.equal(requests[1].params.ids, '[11,22]');
  assert.equal(tracks[0].coverUrl, 'https://album.test/a.jpg');
  assert.equal(tracks[1].coverUrl, 'https://album.test/b.jpg');
});

test('Netease search preserves artist artwork when song-detail lookup fails', async () => {
  const provider = createProvider();
  provider.requestJson = async (pathname) => pathname === '/api/search/get/web'
    ? {
      result: {
        songs: [{
          id: 11,
          name: 'A',
          album: { id: 1, name: 'Old' },
          artists: [{ name: 'Singer', img1v1Url: 'https://artist.test/a.jpg' }]
        }]
      }
    }
    : Promise.reject(new Error('HTTP 500'));

  const tracks = await provider.searchTracks('A');

  assert.equal(tracks[0].coverUrl, 'https://artist.test/a.jpg');
});

test('Netease provider writes numeric tracks to a playlist', async () => {
  const provider = createProvider();
  let captured;
  provider.requestWeapiJson = async (pathname, payload) => {
    captured = { pathname, payload };
    return { code: 200 };
  };

  const result = await provider.addTracksToPlaylist(
    { id: '123456', title: '我的歌单' },
    [{ sourceTrackId: '789012' }]
  );

  assert.equal(captured.pathname, '/weapi/playlist/manipulate/tracks');
  assert.equal(captured.payload.op, 'add');
  assert.equal(captured.payload.pid, '123456');
  assert.equal(captured.payload.trackIds, '["789012"]');
  assert.equal(captured.payload.tracks, '[{"type":3,"id":"789012"}]');
  assert.equal(result.songlist[0].existed, 0);
});

test('Netease provider reports an existing track without treating it as a failure', async () => {
  const provider = createProvider();
  provider.requestWeapiJson = async () => ({ code: 502, message: '歌单中歌曲重复' });

  const result = await provider.addTracksToPlaylist(
    { id: '123456', title: '我喜欢的音乐' },
    [{ sourceTrackId: '789012' }]
  );

  assert.equal(result.songlist[0].existed, 1);
});

test('Netease provider checks the complete playlist track id list', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    playlist: { trackIds: [{ id: 123 }, { id: 789012 }] }
  });

  assert.equal(await provider.playlistContainsTrack('123456', { sourceTrackId: '789012' }), true);
  assert.equal(await provider.playlistContainsTrack('123456', { sourceTrackId: '345678' }), false);
});

test('playlist write service routes Netease writes to its provider', async () => {
  const provider = createProvider();
  provider.requestWeapiJson = async () => ({ code: 200 });
  const registry = { get: (platform) => {
    assert.equal(platform, 'netease');
    return provider;
  } };

  const result = await writeMusicPlaylistTracks(registry, {
    platform: 'netease',
    playlist: { id: '123456', title: '我的歌单' },
    tracks: [{ sourceTrackId: '789012' }]
  }, 'add');

  assert.equal(result.source, 'netease');
  assert.equal(result.result.songlist[0].songId, '789012');
});

test('created playlist content marks only playlists without the track as available', async () => {
  const provider = {
    async getCreatedPlaylists() {
      return [
        { id: '1', title: '我喜欢的音乐' },
        { id: '2', title: '我的歌单' }
      ];
    },
    async getPlaylistTracks(playlistId) {
      return playlistId === '1' ? [{ sourceTrackId: '789012' }] : [{ sourceTrackId: '345678' }];
    }
  };
  const result = await getMusicHomeContent({ get: () => provider }, {
    platform: 'netease',
    action: 'created-playlists',
    track: { source: 'netease', sourceTrackId: '789012' }
  });

  assert.equal(result.playlists[0].containsTrack, true);
  assert.equal(result.playlists[1].containsTrack, false);
});

test('Netease liked tracks reject instead of falling back to an arbitrary playlist', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  provider.getUserPlaylists = async () => [
    { id: 'first', title: 'Favorites' },
    { id: 'second', title: 'Daily Mix' }
  ];
  provider.getPlaylistTracks = async (playlistId) => [{ sourceTrackId: playlistId }];

  await assert.rejects(
    provider.getLikedTracks({ limit: 20 }),
    /我喜欢/
  );
});
