'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { zzcSign } = require('@jixun/qmweb-sign');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { QQMusicClient } = require('../../src/music/providers/qq-provider-client');
const { writeMusicPlaylistTracks } = require('../../src/music/music-catalog-service');

const COOKIE =
  'qqmusic_uin=123456; qqmusic_key=test-key; qm_keyst=test-client-key; qqmusic_guid=987654321; tmeLoginType=2';

test('QQ liked pagination shares only one load and invalidates after writes or account changes', async () => {
  let cookie = COOKIE;
  const provider = new QQMusicProvider({ getAuthState: () => ({ loggedIn: true }), getCookieHeader: () => cookie });
  let playlists = 0;
  let details = 0;
  provider.getLikedPlaylist = async () => { playlists++; return { id: '123' }; };
  provider.requestMusicsClient = async () => {
    details++;
    return { code: 0, 'music.srfDissInfo.DissInfoForPc.uniform_get_Dissinfo': { code: 0, data: {
      songlist: Array.from({ length: 250 }, (_, i) => ({ id: i + 1, mid: `song-${i}`, title: i ? `Song ${i}` : '', singer: [] })),
    } } };
  };
  const page = (offset, loadingSession = 'load-one') => provider.getLikedTracks({ limit: 100, offset, loadingSession });
  const first = await provider.getLikedTrackPage({ limit: 100, offset: 0, loadingSession: 'load-one' });
  assert.equal(first.tracks.length, 99);
  assert.equal(first.nextOffset, 100);
  assert.equal((await page(first.nextOffset))[0].sourceTrackId, 'song-100');
  assert.equal((await page(200)).length, 50);
  assert.deepEqual([playlists, details], [1, 1]);
  await page(0, 'refresh');
  assert.deepEqual([playlists, details], [2, 2]);
  cookie = COOKIE.replace('123456', '789012');
  await page(100);
  assert.deepEqual([playlists, details], [3, 3]);
  provider.addTracksToPlaylist = async () => ({ ok: true });
  await writeMusicPlaylistTracks({ get: () => provider }, { platform: 'qq', tracks: [{ sourceTrackId: 'new' }] }, 'add');
  await page(0);
  assert.deepEqual([playlists, details], [4, 4]);
});

test('QQ public playlist fallback still requests each actual page', async () => {
  const provider = createProvider();
  provider.getLikedPlaylist = async () => ({ id: '123' });
  provider.requestMusicsClient = async () => { throw new Error('client unavailable'); };
  const offsets = [];
  provider.requestJson = async (_url, params) => { offsets.push(params.song_begin); return { cdlist: [{ songlist: [] }] }; };
  await provider.getLikedTracks({ limit: 100, offset: 0, loadingSession: 'public' });
  await provider.getLikedTracks({ limit: 100, offset: 100, loadingSession: 'public' });
  assert.deepEqual(offsets, ['0', '100']);
});

test('QQ liked reads fall back on missing client songs without caching failures', async () => {
  const provider = createProvider();
  provider.getLikedPlaylist = async () => ({ id: '123' });
  const song = { id: 11, mid: 'song-11', title: 'Confirmed song' };
  let songs = [song];
  let clientCalls = 0, publicCalls = 0;
  provider.requestMusicsClient = async (modules) => {
    clientCalls++;
    return { code: 0, [Object.keys(modules)[0]]: { code: 0, data: { songlist: songs } } };
  };
  let publicResponse = { code: 0, cdlist: [{ songlist: [song] }] };
  provider.requestJson = async () => { publicCalls++; return publicResponse; };
  const page = loadingSession => provider.getLikedTrackPage({ loadingSession, limit: 100 });
  assert.equal((await page('confirmed')).tracks[0].sourceTrackId, 'song-11');
  songs = undefined;
  assert.equal((await page('fallback')).tracks[0]?.sourceTrackId, 'song-11');
  assert.equal(publicCalls, 1);
  publicResponse = { code: 1000, cdlist: [{ songlist: [] }] };
  await assert.rejects(page('retry'), { statusCode: 501 });
  const beforeRetry = clientCalls;
  songs = [song];
  assert.equal((await page('retry')).tracks[0]?.sourceTrackId, 'song-11');
  assert.equal(clientCalls, beforeRetry + 1);
  songs = [];
  const beforeEmpty = publicCalls;
  const empty = await page('empty');
  assert.deepEqual(empty.tracks, []);
  assert.equal(empty.nextOffset, null);
  assert.equal(publicCalls, beforeEmpty, 'an explicit empty client list needs no fallback');
});

test('QQ liked public pages advance past a fully filtered window and stop on a repeated raw page', async () => {
  const provider = createProvider();
  provider.getLikedPlaylist = async () => ({ id: '123' });
  provider.requestMusicsClient = async () => { throw new Error('client unavailable'); };
  const invalid = [{ id: 7, mid: 's7' }, { id: 8, mid: 's8' }];
  let repeat = false;
  provider.requestJson = async (_url, params) => ({ cdlist: [{ songlist: repeat || params.song_begin === '0'
    ? invalid : [{ id: 9, mid: 'tail', title: 'Tail' }] }] });
  const read = (offset, loadingSession) => provider.getLikedTrackPage({ limit: 2, offset, loadingSession });
  const first = await read(0, 'one');
  assert.equal(first.tracks.length, 0);
  const tail = await read(first.nextOffset, 'one');
  assert.deepEqual(tail.tracks.map(track => track.sourceSongId), [9]);
  assert.equal(tail.nextOffset, null);
  repeat = true;
  await read(0, 'two');
  await assert.rejects(read(2, 'two'));
});

test('QQ public favorites finish on distinct identities and reject a missing or repeated tail', async () => {
  const provider = createProvider();
  provider.getLikedPlaylist = async () => ({ id: '123' });
  provider.requestMusicsClient = async () => { throw new Error('client unavailable'); };
  const song = id => ({ id, mid: `m${id}`, title: `Song ${id}` });
  const first = [song(1), song(2)];
  let total = 2;
  let tail;
  provider.requestJson = async (_url, { song_begin }) => ({
    cdlist: [{ total_song_num: total, songlist: song_begin === '0' ? first : tail }],
  });
  const page = (loadingSession, offset) => provider.getLikedTrackPage({ loadingSession, limit: 2, offset });
  assert.equal((await page('full', 0)).nextOffset, null);

  total = 3;
  const start = await page('overlap', 0);
  tail = [song(2), song(3)];
  const end = await page('overlap', start.nextOffset);
  assert.deepEqual(end.tracks.map(t => t.sourceSongId), [3]);
  assert.equal(end.nextOffset, null);
  for (const [session, rows] of [['repeated', first], ['missing', undefined]]) {
    const { nextOffset } = await page(session, 0);
    tail = rows;
    await assert.rejects(page(session, nextOffset));
  }
});

function createProvider() {
  return new QQMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => COOKIE,
  });
}

test('QQ membership checks raw numeric IDs and mids and retries the client after a fallback', async () => {
  const provider = createProvider();
  let clientCalls = 0, publicCalls = 0;
  provider.requestMusicsClient = async (modules) => {
    if (++clientCalls === 1) throw new Error('temporary failure');
    return { code: 0, [Object.keys(modules)[0]]: { code: 0, data: { songlist: [{ SongMid: 'client-mid' }] } } };
  };
  provider.requestJson = async () => { publicCalls++; return { cdlist: [{ songlist: [{ songid: 123 }] }] }; };
  assert.equal(await provider.playlistContainsTrack('1', { sourceSongId: 123 }), true);
  assert.equal(await provider.playlistContainsTrack('2', { sourceTrackId: 'client-mid' }), true);
  assert.deepEqual([clientCalls, publicCalls], [2, 1]);
  provider.requestMusicsClient = async () => { throw new Error('client unavailable'); };
  for (const response of [{ code: 1000, cdlist: [{ songlist: [] }] }, { code: 0, cdlist: [{}] }]) {
    provider.requestJson = async () => response;
    await assert.rejects(provider.playlistContainsTrack('1', { sourceSongId: 123 }), { statusCode: 501 });
  }
  provider.requestJson = async () => ({ code: 0, cdlist: [{ songlist: [] }] });
  assert.equal(await provider.playlistContainsTrack('1', { sourceSongId: 123 }), false);
});

test('QQ playlist directories fall back on missing arrays and reject failed web reads', async (t) => {
  for (const [method, clientField, webField] of [
    ['getCreatedPlaylists', 'v_playlist', 'disslist'],
    ['getCollectedPlaylists', 'v_list', 'cdlist'],
  ]) {
    await t.test(method, async () => {
      const provider = createProvider();
      let clientRows;
      provider.requestMusicsClient = async (modules) => ({
        code: 0, [Object.keys(modules)[0]]: { code: 0, data: { [clientField]: clientRows } },
      });
      let webResponse = { code: 0, data: { [webField]: [{ tid: 123, dirId: 1, dirName: 'Recovered' }] } };
      let webCalls = 0;
      provider.requestJson = async () => { webCalls++; return webResponse; };
      assert.equal((await provider[method]())[0]?.id, '123');
      assert.equal(webCalls, 1);
      clientRows = [];
      assert.deepEqual(await provider[method](), []);
      assert.equal(webCalls, 1, 'an explicit empty client directory needs no fallback');
      clientRows = undefined;
      for (webResponse of [{ code: 1000, data: { [webField]: [] } }, { code: 0, data: {} }]) {
        await assert.rejects(provider[method](), { statusCode: 501 });
      }
      webResponse = { code: 0, data: { [webField]: [] } };
      assert.deepEqual(await provider[method](), []);
    });
  }
});

test('QQ requests keep their signed identity and Cookie on one credential snapshot', async (t) => {
  let captured;
  t.mock.method(global, 'fetch', async (url, options) => {
    captured = { url: new URL(url), options };
    return new Response(JSON.stringify({ code: 0,
      'music.musicasset.PlaylistDetailWrite.AddSonglist': { code: 0, data: { retCode: 0, result: {} } },
    }));
  });
  const requests = [
    (client) => client.requestPlaylistWrite('AddSonglist', { dirId: 1, tid: 42, dirName: 'test' }, [{ songId: 1 }]),
    (client) => client.requestMusicsClient(),
    (client) => client.requestQQEncryptedVkey(),
    (client) => client.requestMusicu(),
  ];
  for (const request of requests) {
    let reads = 0;
    const client = new QQMusicClient({
      getCookieHeader: async () => reads++ === 0 ? COOKIE : COOKIE.replace('123456', '654321'),
    });
    await request(client);
    const body = captured.options.body || captured.url.searchParams.get('data');
    assert.equal(JSON.parse(body).comm.uin, '123456');
    assert.equal(captured.options.headers.Cookie, COOKIE);
    assert.equal(reads, 1);
    if (captured.url.searchParams.has('sign')) assert.equal(captured.url.searchParams.get('sign'), zzcSign(body));
  }
});

test('QQ liked removal resolves the UI alias through the current account playlist', async () => {
  const provider = createProvider();
  const liked = { id: '987654', tid: '987654', dirId: '201', title: '我喜欢' };
  const custom = { id: '17', tid: '17', dirId: '7', title: '我喜欢的民谣' };
  let reads = 0;
  const writes = [];
  provider.getCreatedPlaylists = async (options) => {
    assert.equal(options.includeLiked, true);
    reads++;
    return [custom, liked];
  };
  provider.requestPlaylistWrite = async (...args) => { writes.push(args); return { ok: true }; };
  const payload = { platform: 'qq', playlist: { id: 'liked' }, tracks: [{ sourceSongId: 123 }] };
  await writeMusicPlaylistTracks({ get: () => provider }, payload, 'remove');
  assert.deepEqual(writes[0], ['DelSonglist', { dirId: 201, tid: 987654, dirName: '我喜欢' }, [{ songId: 123, songType: 0 }], COOKIE]);
  await provider.removeTracksFromPlaylist({ id: '42', tid: '42', dirId: '2', title: '自建' }, payload.tracks);
  assert.equal(reads, 1, 'ordinary playlist targets do not read the liked list');
  assert.equal(writes[1][1].tid, 42);
  await assert.rejects(provider.removeTracksFromPlaylist({ id: 'liked' }, [{ sourceTrackId: 'mid-only' }]), /songId/);
  assert.equal(reads, 1);
  const loggedOut = new QQMusicProvider({ getAuthState: () => ({ loggedIn: false }), getCookieHeader: () => '' });
  await assert.rejects(loggedOut.removeTracksFromPlaylist({ id: 'liked' }, payload.tracks), /登录/);
  provider.getCreatedPlaylists = async () => [custom];
  await assert.rejects(provider.removeTracksFromPlaylist({ id: 'liked' }, payload.tracks), /没有.*我喜欢/);
  assert.equal(writes.length, 2);
});

test('QQ stops a liked detail read or write if the account switches during playlist lookup', async (t) => {
  let cookie, loginReads = 0, identityChecks = 0;
  const provider = new QQMusicProvider({
    getRequestSession() { loginReads++; return { state: { loggedIn: true }, cookieHeader: cookie }; },
    getCookieHeader() { identityChecks++; return cookie; },
  });
  const key = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin';
  const lookup = t.mock.method(globalThis, 'fetch', async (_url, { headers, body }) => {
    assert.equal(headers.Cookie, COOKIE);
    assert.equal(JSON.parse(body)[key].param.uin, '123456');
    cookie = COOKIE.replace('123456', '654321');
    return Response.json({ code: 0, [key]: { code: 0, data: { v_playlist: [{ tid: 123, dirId: 201, dirName: '我喜欢' }] } } });
  });
  for (const operation of [
    () => provider.getLikedTracks({ loadingSession: 'first-page' }),
    () => provider.removeTracksFromPlaylist({ id: 'liked' }, [{ sourceSongId: 42 }]),
  ]) {
    cookie = COOKIE;
    await assert.rejects(operation(), { statusCode: 501 });
  }
  assert.equal(lookup.mock.callCount(), 2);
  assert.equal(loginReads, 2);
  assert.equal(identityChecks, 2);
});

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

test('QQ created playlists fall back with the refreshed credentials of the same account', async (t) => {
  let cookie = COOKIE;
  let reads = 0;
  const provider = new QQMusicProvider({
    getSessionState: () => ({ loggedIn: true }),
    getCookieHeader() { reads++; return cookie; },
  });
  let call = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    call += 1;
    if (call === 1) {
      assert.equal(options.headers.Cookie, COOKIE);
      cookie = COOKIE.replace('test-key', 'refreshed-key');
      return new Response(
        JSON.stringify({
          code: 2000,
          'music.musicasset.PlaylistBaseRead.GetPlaylistByUin': { code: 2000 },
        }),
        { status: 200 },
      );
    }
    assert.equal(options.headers.Cookie, cookie);
    assert.equal(url.searchParams.get('loginUin'), '123456');
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
  });

  const playlists = await provider.getCreatedPlaylists({ limit: 50, includeLiked: false });
  assert.equal(call, 2);
  assert.equal(reads, 2);
  assert.equal(playlists[0].title, '网页回退歌单');
});

test('QQ stops a pending playlist fallback after a switch and the next request uses the new account', async (t) => {
  let cookie = COOKIE;
  const provider = new QQMusicProvider({
    getSessionState: () => ({ loggedIn: true }),
    getCookieHeader: () => cookie,
  });
  const callKey = 'music.musicasset.PlaylistBaseRead.GetPlaylistByUin';
  const sent = [];
  t.mock.method(global, 'fetch', async (_url, { headers, body }) => {
    const request = JSON.parse(body);
    sent.push([headers.Cookie, request.comm.uin, request[callKey].param.uin]);
    if (sent.length === 1) {
      cookie = COOKIE.replace('123456', '654321');
      return new Response('', { status: 503 });
    }
    return Response.json({ code: 0, [callKey]: { code: 0, data: { v_playlist: [] } } });
  });
  await assert.rejects(provider.getCreatedPlaylists(), { statusCode: 501 });
  assert.equal(sent.length, 1);
  await provider.getCreatedPlaylists();
  assert.deepEqual(sent, [[COOKIE, '123456', '123456'], [cookie, '654321', '654321']]);
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
