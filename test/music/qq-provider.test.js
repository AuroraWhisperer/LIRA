'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zzcSign } = require('@jixun/qmweb-sign');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { writeMusicPlaylistTracks } = require('../../src/music/lyrics-service');

const COOKIE =
  'qqmusic_uin=123456; qqmusic_key=test-key; qm_keyst=test-client-key; qqmusic_guid=987654321; tmeLoginType=2';

function createProvider() {
  return new QQMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => COOKIE,
  });
}

test('QQ provider signs AddSonglist requests and preserves QQ numeric ids', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(
      JSON.stringify({
        code: 0,
        'music.musicasset.PlaylistDetailWrite.AddSonglist': {
          code: 0,
          data: {
            retCode: 0,
            result: {
              dirId: 201,
              tid: 2924077536,
              songlist: [{ songId: 563728446, existed: 0 }],
            },
          },
        },
      }),
      { status: 200 },
    );
  };

  try {
    const provider = createProvider();
    const result = await provider.addTracksToPlaylist(
      { id: '2924077536', tid: '2924077536', dirId: '201', title: '我喜欢' },
      [{ sourceSongId: 563728446 }],
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
    assert.deepEqual(payload['music.musicasset.PlaylistDetailWrite.AddSonglist'].param.v_songInfo, [
      { songId: 563728446, songType: 0 },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider maps sourceSongId and playlist tid/dirId', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  let playlistRequest;
  global.fetch = async (url, options) => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            song: {
              list: [
                {
                  id: 563728446,
                  mid: 'song-mid',
                  type: 1,
                  title: '测试歌曲',
                  singer: [],
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    playlistRequest = { url: String(url), options };
    return new Response(
      JSON.stringify({
        code: 0,
        'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': {
          code: 0,
          data: {
            v_playlist: [
              { tid: 2924077536, dirId: 201, dirName: '我喜欢', songNum: 481 },
              { tid: 7527135346, dirId: 21, dirName: '测试歌单', songNum: 31 },
            ],
          },
        },
      }),
      { status: 200 },
    );
  };

  try {
    const provider = createProvider();
    const tracks = await provider.searchTracks('测试');
    const playlists = await provider.getCreatedPlaylists({
      includeLiked: false,
    });
    assert.equal(tracks[0].sourceSongId, 563728446);
    assert.equal(tracks[0].sourceSongType, 1);
    assert.equal(playlists[0].tid, '7527135346');
    assert.equal(playlists[0].dirId, '21');
    assert.equal(playlists[0].trackCount, 31);
    const payload = JSON.parse(playlistRequest.options.body);
    assert.equal(new URL(playlistRequest.url).origin, 'https://u6.y.qq.com');
    assert.equal(payload.comm.authst, 'test-client-key');
    assert.equal(payload.comm.ct, '19');
    assert.equal(payload['music.musicasset.PlaylistBaseRead.GetPlaylistByUin'].method, 'GetPlaylistByUin');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ provider reads collected playlists from the desktop client API', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        code: 0,
        'music.musicasset.PlaylistFavRead': {
          code: 0,
          data: {
            v_list: [
              {
                tid: 7453216549,
                dirId: 0,
                name: '收藏歌单',
                songnum: 112,
                logo: 'https://example.test/cover.jpg',
              },
            ],
          },
        },
      }),
      { status: 200 },
    );

  try {
    const playlists = await createProvider().getCollectedPlaylists({
      limit: 50,
    });
    assert.equal(playlists.length, 1);
    assert.equal(playlists[0].id, '7453216549');
    assert.equal(playlists[0].title, '收藏歌单');
    assert.equal(playlists[0].trackCount, 112);
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ created playlists fall back to the web API when client auth is unavailable', async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      return new Response(
        JSON.stringify({
          code: 2000,
          'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': { code: 2000 },
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        code: 0,
        data: {
          disslist: [
            {
              tid: 7527135346,
              dirid: 21,
              dissname: '网页回退歌单',
              songnum: 31,
            },
          ],
        },
      }),
      { status: 200 },
    );
  };

  try {
    const playlists = await createProvider().getCreatedPlaylists({
      limit: 50,
      includeLiked: false,
    });
    assert.equal(call, 2);
    assert.equal(playlists[0].title, '网页回退歌单');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ liked tracks uses the client playlist and slices the requested page', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return new Response(
        JSON.stringify({
          code: 0,
          'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': {
            code: 0,
            data: {
              v_playlist: [
                {
                  tid: 2924077536,
                  dirId: 201,
                  dirName: '我喜欢',
                  songNum: 150,
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }
    const songlist = Array.from({ length: 150 }, (_, index) => ({
      id: index + 1,
      mid: `song-${index + 1}`,
      title: `歌曲 ${index + 1}`,
      singer: [],
    }));
    return new Response(
      JSON.stringify({
        code: 0,
        'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo': {
          code: 0,
          data: { songlist, total_song_num: 150 },
        },
      }),
      { status: 200 },
    );
  };

  try {
    const tracks = await createProvider().getLikedTracks({
      limit: 100,
      offset: 100,
    });
    assert.equal(tracks.length, 50);
    assert.equal(tracks[0].sourceTrackId, 'song-101');
    assert.equal(requests[1].body['music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo'].param.disstid, 2924077536);
  } finally {
    global.fetch = originalFetch;
  }
});

test('QQ liked tracks rejects an incomplete login instead of returning an empty list', async () => {
  const provider = new QQMusicProvider({
    getAuthState: () => ({ loggedIn: false }),
    getCookieHeader: () => 'pt2gguin=o123456; superuin=o123456',
  });

  await assert.rejects(provider.getLikedTracks({ limit: 100, offset: 0 }), /登录/);
});

test('QQ playlist detail sends server-side pagination parameters', async () => {
  const originalFetch = global.fetch;
  let capturedUrl = '';
  global.fetch = async (url) => {
    capturedUrl = String(url);
    return new Response(
      JSON.stringify({
        code: 0,
        cdlist: [
          {
            songlist: [{ id: 1, mid: 'page-two-song', title: '第二页', singer: [] }],
          },
        ],
      }),
      { status: 200 },
    );
  };

  try {
    const provider = new QQMusicProvider({
      getAuthState: () => ({ loggedIn: false }),
      getCookieHeader: () => '',
    });
    const tracks = await provider.getPlaylistTracks('2924077536', {
      limit: 100,
      offset: 100,
    });
    const url = new URL(capturedUrl);
    assert.equal(url.searchParams.get('song_begin'), '100');
    assert.equal(url.searchParams.get('song_num'), '100');
    assert.equal(tracks[0].sourceTrackId, 'page-two-song');
  } finally {
    global.fetch = originalFetch;
  }
});

test('playlist write service rejects tracks without QQ numeric songId before fetch', async () => {
  const registry = { get: () => createProvider() };
  await assert.rejects(
    writeMusicPlaylistTracks(
      registry,
      {
        platform: 'qq',
        playlist: {
          id: '2924077536',
          tid: '2924077536',
          dirId: '201',
          title: '我喜欢',
        },
        tracks: [{ sourceTrackId: 'song-mid' }],
      },
      'add',
    ),
    /songId/,
  );
});

function radioBatch(...ids) {
  return { songlist: { data: { tracks: ids.map((id) => ({ mid: id, title: `电台 ${id}`, singer: [] })) } } };
}

test('QQ radio refill deduplicates tracks and stops when a round adds nothing new', async () => {
  for (const [limit, batches, expectedIds, expectedCalls] of [
    [40, [radioBatch('a', 'b', 'a'), radioBatch('b', 'c'), radioBatch('a', 'c'), radioBatch('d')], ['a', 'b', 'c'], 3],
    [40, [radioBatch()], [], 1],
    [40, [null], [], 1],
    [50, Array.from({ length: 20 }, (_, index) => radioBatch(`song-${index}`)), null, 12],
  ]) {
    const provider = createProvider();
    const requests = [];
    provider.requestMusicu = async (body) => {
      requests.push(body.songlist.param);
      const batch = batches[requests.length - 1];
      if (batch === null) throw new Error('synthetic radio failure');
      return batch;
    };
    const tracks = await provider.getRadioTracks({ limit, page: 1 });
    assert.equal(requests.length, expectedCalls, `limit ${limit} must stop after ${expectedCalls} rounds`);
    if (expectedIds) assert.deepEqual(tracks.map((track) => track.sourceTrackId), expectedIds);
    else assert.equal(new Set(tracks.map((track) => track.sourceTrackId)).size, tracks.length);
    assert.deepEqual(
      requests.map((param) => param.firstplay),
      requests.map((_, index) => (index === 0 ? 1 : 0)),
      'only the first round of page one starts a new radio session',
    );
  }
});

test('QQ recent tracks require login and fall back from the musicu history to the legacy list', async () => {
  const loggedOut = new QQMusicProvider({
    getAuthState: () => ({ loggedIn: false }),
    getCookieHeader: () => 'qqmusic_uin=123456; pt2gguin=o123456',
  });
  loggedOut.requestMusicu = async () => assert.fail('a logged-out account must not request play history');
  await assert.rejects(loggedOut.getRecentTracks(), /登录/);

  const song = (mid) => ({ mid, title: `最近 ${mid}`, singer: [] });
  for (const [musicu, legacy, expectedIds, legacyCalls] of [
    [{ req_0: { data: { result_song_list: [{ songInfo: song('m1') }, song('m2')] } } }, null, ['m1', 'm2'], 0],
    [new Error('synthetic musicu failure'), { data: { songlist: [song('l1')] } }, ['l1'], 1],
    [{ req_0: { data: { result_song_list: [] } } }, { data: { song_list: [song('l2')] } }, ['l2'], 1],
  ]) {
    const provider = createProvider();
    const legacyParams = [];
    let historyParam;
    provider.requestMusicu = async (body) => {
      historyParam = body.req_0.param;
      if (musicu instanceof Error) throw musicu;
      return musicu;
    };
    provider.requestJson = async (_url, params) => {
      legacyParams.push(params);
      return legacy;
    };
    const tracks = await provider.getRecentTracks({ limit: 2 });
    assert.deepEqual(tracks.map((track) => track.sourceTrackId), expectedIds);
    assert.equal(historyParam.num, 2);
    assert.equal(legacyParams.length, legacyCalls);
    if (legacyCalls) {
      assert.equal(legacyParams[0].userid, historyParam.uin);
      assert.equal(legacyParams[0].ein, '2');
    }
  }

  const empty = createProvider();
  empty.requestMusicu = async () => ({ req_0: { code: 104003, data: { result_song_list: [] } } });
  empty.requestJson = async () => ({ data: { songlist: [] } });
  await assert.rejects(empty.getRecentTracks(), /没有返回最近播放歌曲[\s\S]*104003/);
});
