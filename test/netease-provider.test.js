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

test('Netease liked tracks fall back to the first playlist when its title is localized', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  provider.getUserPlaylists = async () => [
    { id: 'first', title: 'Favorites' },
    { id: 'second', title: 'Daily Mix' }
  ];
  provider.getPlaylistTracks = async (playlistId) => [{ sourceTrackId: playlistId }];

  const tracks = await provider.getLikedTracks({ limit: 20 });

  assert.deepEqual(tracks, [{ sourceTrackId: 'first' }]);
});
