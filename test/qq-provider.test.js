'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zzcSign } = require('@jixun/qmweb-sign');
const { QQMusicProvider } = require('../src/music/providers/qq-provider');
const { writeMusicPlaylistTracks } = require('../src/music/lyrics-service');

const COOKIE = 'qqmusic_uin=123456; qqmusic_key=test-key; pgv_pvid=987654321';

function createProvider() {
  return new QQMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => COOKIE
  });
}

test('QQ provider signs AddSonglist requests and preserves QQ numeric ids', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      code: 0,
      'music.musicasset.PlaylistDetailWrite.AddSonglist': {
        code: 0,
        data: {
          retCode: 0,
          result: {
            dirId: 201,
            tid: 2924077536,
            songlist: [{ songId: 563728446, existed: 0 }]
          }
        }
      }
    }), { status: 200 });
  };

  try {
    const provider = createProvider();
    const result = await provider.addTracksToPlaylist(
      { id: '2924077536', tid: '2924077536', dirId: '201', title: '我喜欢' },
      [{ sourceSongId: 563728446 }]
    );
    assert.equal(result.dirId, 201);
    assert.equal(result.songlist[0].existed, 0);

    const url = new URL(captured.url);
    const body = captured.options.body;
    const payload = JSON.parse(body);
    assert.equal(url.origin + url.pathname, 'https://u6.y.qq.com/cgi-bin/musics.fcg');
    assert.equal(url.searchParams.get('sign'), zzcSign(body));
    assert.equal(payload.comm.uin, '123456');
    assert.equal(payload.comm.g_tk, payload.comm.g_tk_new_20200303);
    assert.deepEqual(
      payload['music.musicasset.PlaylistDetailWrite.AddSonglist'].param.v_songInfo,
      [{ songId: 563728446, songType: 0 }]
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider maps sourceSongId and playlist tid/dirId', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          song: {
            list: [{ id: 563728446, mid: 'song-mid', title: '测试歌曲', singer: [] }]
          }
        }
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      code: 0,
      data: {
        disslist: [{ tid: 7527135346, dirid: 21, dissname: '测试歌单' }]
      }
    }), { status: 200 });
  };

  try {
    const provider = createProvider();
    const tracks = await provider.searchTracks('测试');
    const playlists = await provider.getCreatedPlaylists({ includeLiked: false });
    assert.equal(tracks[0].sourceSongId, 563728446);
    assert.equal(playlists[0].tid, '7527135346');
    assert.equal(playlists[0].dirId, '21');
  } finally {
    global.fetch = originalFetch;
  }
});

test('playlist write service rejects tracks without QQ numeric songId before fetch', async () => {
  const registry = { get: () => createProvider() };
  await assert.rejects(
    writeMusicPlaylistTracks(registry, {
      platform: 'qq',
      playlist: { id: '2924077536', tid: '2924077536', dirId: '201', title: '我喜欢' },
      tracks: [{ sourceTrackId: 'song-mid' }]
    }, 'add'),
    /songId/
  );
});
