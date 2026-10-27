'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');
const { getMusicHomeContent, writeMusicPlaylistTracks } = require('../../src/music/lyrics-service');

function createProvider() {
  return new NeteaseMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => 'MUSIC_U=test-token; __csrf=test-csrf',
  });
}

test('NetEase liked pagination resolves its playlist once per load while retaining real pages', async () => {
  const provider = createProvider();
  let lookups = 0;
  const offsets = [];
  provider.getLikedPlaylistId = async () => { lookups++; return '123'; };
  provider.getPlaylistTracks = async (_id, options) => { offsets.push(options.offset); return []; };
  await provider.getLikedTracks({ offset: 0, loadingSession: 'load' });
  await provider.getLikedTracks({ offset: 100, loadingSession: 'load' });
  assert.equal(lookups, 1);
  assert.deepEqual(offsets, [0, 100]);
  await provider.getLikedTracks({ offset: 0, loadingSession: 'refresh' });
  assert.equal(lookups, 2);
});

test('NetEase stream requests read the current account cookie each time and honor upstream rights', async (t) => {
  let cookie = '';
  const requests = [];
  const provider = new NeteaseMusicProvider({ getCookieHeader: () => cookie });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), cookie: options.headers.Cookie || '' });
    const full = options.headers.Cookie === 'MUSIC_U=synthetic-member';
    return Response.json({ code: 200, data: [{
      id: 123, url: `https://example.test/${full ? 'full' : 'trial'}.mp3`,
      expi: 600, level: full ? 'lossless' : 'standard',
      freeTrialInfo: full ? null : { start: 30, end: 60 },
    }] });
  });
  const track = { sourceTrackId: '123', vip: true };
  const anonymous = await provider.resolvePlayableUrl(track, { quality: 'lossless' });
  cookie = 'MUSIC_U=synthetic-member';
  const member = await provider.resolvePlayableUrl(track, { quality: 'lossless' });
  cookie = 'MUSIC_U=synthetic-nonmember';
  const changedAccount = await provider.resolvePlayableUrl(track, { quality: 'lossless' });
  assert.deepEqual(requests.map((request) => request.cookie), ['', 'MUSIC_U=synthetic-member', 'MUSIC_U=synthetic-nonmember']);
  for (const { url } of requests) {
    assert.equal(url.origin, 'https://music.163.com');
    assert.equal(url.pathname, '/api/song/enhance/player/url/v1');
    assert.equal(url.searchParams.get('level'), 'lossless');
  }
  assert.equal(anonymous.trial, true);
  assert.equal(anonymous.quality, 'standard');
  assert.equal(member.trial, false);
  assert.equal(member.quality, 'lossless');
  assert.equal(changedAccount.trial, true);
});

test('Netease provider requests and aligns translated and romanized lyrics', async () => {
  const provider = createProvider();
  let captured;
  provider.requestJson = async (pathname, params) => {
    captured = { pathname, params };
    return {
      lrc: {
        lyric: '[00:19.64]あの日見渡した渚を\n[00:24.50]今も思い出すんだ',
      },
      tlyric: {
        lyric: '[00:19.64]那天所眺望的海岸\n[00:24.50]直至今日仍能想起',
      },
      romalrc: {
        lyric: '[00:19.64]a no hi mi wa ta shi ta na gi sa wo\n[00:24.50]i ma mo o mo i da su n da',
      },
    };
  };

  const result = await provider.getLyrics({ sourceTrackId: '496869422', durationMs: 29000 });

  assert.equal(captured.pathname, '/api/song/lyric/v1');
  assert.equal(captured.params.yv, '0');
  assert.equal(captured.params.yrv, '0');
  assert.equal(result.lines[0].translation, '那天所眺望的海岸');
  assert.equal(result.lines[0].roma, 'a no hi mi wa ta shi ta na gi sa wo');
  assert.equal(result.lines[1].translation, '直至今日仍能想起');
  assert.equal(result.lines[1].roma, 'i ma mo o mo i da su n da');
  assert.equal(result.lines[0].words[0].startMs, 19640);
  assert.equal(result.lines[0].words.at(-1).endMs, 24500);
  assert.equal(result.lines[1].words.at(-1).endMs, 29000);
});

test('Netease lyrics retain YRC timing and spaces when LRC timestamps differ', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    lrc: { lyric: '[00:01.40]Hello world\n[00:04.50]下一句' },
    tlyric: { lyric: '[00:01.40]旧译文' },
    yrc: { lyric: '[1000,2000](1000,700,0)Hello (1700,1300,0)world\n[4000,1000](4000,1000,0)下一句' },
    ytlrc: { lyric: '[00:01.00]你好世界' },
    yromalrc: { lyric: '[00:04.00]xia yi ju' },
  });
  const result = await provider.getLyrics({ sourceTrackId: '123', durationMs: 10000 });
  assert.equal(result.lines[0].startMs, 1000);
  assert.equal(result.lines[0].endMs, 3000);
  assert.equal(result.lines[0].text, 'Hello world');
  assert.equal(result.lines[0].translation, '你好世界');
  assert.deepEqual(result.lines[0].words, [
    { startMs: 1000, endMs: 1700, text: 'Hello ' },
    { startMs: 1700, endMs: 3000, text: 'world' },
  ]);
  assert.equal(result.lines[1].roma, 'xia yi ju');
});

test('Netease LRC-only lyrics get continuous estimated words, including an unknown final duration', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    lrc: { lyric: '[00:01.00]你，好 world!\n[00:05.00]最后' },
    yrc: { lyric: 'invalid' },
  });
  const { lines } = await provider.getLyrics({ sourceTrackId: '123' });
  assert.deepEqual(lines[0].words.map((word) => word.text), ['你，', '好 ', 'world!']);
  assert.equal(lines[0].words[0].startMs, 1000);
  assert.equal(lines[0].words.at(-1).endMs, 5000);
  for (const line of lines) {
    assert.equal(line.words.map((word) => word.text).join(''), line.text);
    for (let index = 0; index < line.words.length; index++) {
      const word = line.words[index];
      assert.ok(word.endMs > word.startMs);
      if (index > 0) assert.equal(word.startMs, line.words[index - 1].endMs);
    }
  }
  assert.ok(lines[1].endMs > 5000);
  assert.ok(lines[1].endMs <= 13000);
});

test('Netease provider resolves a full stream with the current account rights', async () => {
  const provider = createProvider();
  let captured;
  provider.requestJson = async (pathname, params) => {
    captured = { pathname, params };
    return {
      code: 200,
      data: [
        {
          id: 461011,
          url: 'https://cdn.test/full.mp3',
          code: 200,
          expi: 1200,
          level: 'standard',
          type: 'mp3',
          freeTrialInfo: null,
        },
      ],
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

test('Netease provider forwards a selected lossless level', async () => {
  const provider = createProvider();
  let captured;
  provider.requestJson = async (pathname, params) => {
    captured = { pathname, params };
    return {
      code: 200,
      data: [
        {
          id: 461011,
          url: 'https://cdn.test/lossless.flac',
          code: 200,
          level: 'lossless',
          type: 'flac',
        },
      ],
    };
  };

  const stream = await provider.resolvePlayableUrl({ sourceTrackId: '461011' }, { quality: 'lossless' });

  assert.equal(captured.params.level, 'lossless');
  assert.equal(captured.params.encodeType, 'flac');
  assert.equal(stream.requestedQuality, 'lossless');
  assert.equal(stream.quality, 'lossless');
});

test('Netease provider preserves an official trial stream for a non-VIP account', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    code: 200,
    data: [
      {
        id: 461011,
        url: 'http://cdn.test/trial.mp3',
        code: 200,
        expi: 600,
        freeTrialInfo: { start: 30, end: 60 },
      },
    ],
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
    data: [{ id: 461011, url: null, code: -110, freeTrialInfo: null }],
  });

  await assert.rejects(provider.resolvePlayableUrl({ sourceTrackId: '461011' }), /无法播放或试听/);
});

test('Netease provider rejects unsafe upstream stream protocols', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    code: 200,
    data: [{ id: 461011, url: 'javascript:alert(1)', code: 200 }],
  });

  await assert.rejects(provider.resolvePlayableUrl({ sourceTrackId: '461011' }), /地址无效/);
});

test('Netease search and health reject upstream failures despite a local login cookie', async (t) => {
  const cases = [
    { data: { code: 301, msg: '需要登录' }, message: /code=301，需要登录/ },
    { data: { code: 405, message: '操作频繁' }, message: /code=405，操作频繁/ },
    { data: {}, message: /网易云音乐搜索失败/ },
    { data: { code: 200 }, message: /网易云音乐搜索响应缺少歌曲结果/ },
  ];
  let response;
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const provider = createProvider();

  for (const { data, message } of cases) {
    response = data;
    await assert.rejects(provider.searchTracks('晴天'), message);
    const health = await provider.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.status, 'api-error');
    assert.equal(health.auth.loggedIn, true);
    assert.match(health.message, message);
  }
});

test('Netease search accepts an explicit empty result without requesting artwork', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    code: 200,
    result: { songCount: 0 },
  }));

  assert.deepEqual(await createProvider().searchTracks('No matches'), []);
  assert.equal(fetch.mock.callCount(), 1);
});

test('Netease search enriches result artwork with one batched song-detail request', async () => {
  const provider = createProvider();
  const requests = [];
  provider.requestJson = async (pathname, params) => {
    requests.push({ pathname, params });
    if (pathname === '/api/search/get/web') {
      return {
        code: 200,
        result: {
          songs: [
            {
              id: 11,
              name: 'A',
              album: { id: 1, name: 'Old' },
              artists: [{ name: 'Singer', img1v1Url: 'https://artist.test/a.jpg' }],
            },
            {
              id: 22,
              name: 'B',
              album: { id: 2, name: 'Other' },
              artists: [
                {
                  name: 'Second singer',
                  img1v1Url: 'https://artist.test/b.jpg',
                },
              ],
            },
          ],
        },
      };
    }
    return {
      songs: [
        { id: 22, album: { picUrl: 'https://album.test/b.jpg' } },
        { id: 11, album: { picUrl: 'https://album.test/a.jpg' } },
      ],
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
  provider.requestJson = async (pathname) =>
    pathname === '/api/search/get/web'
      ? {
          code: 200,
          result: {
            songs: [
              {
                id: 11,
                name: 'A',
                album: { id: 1, name: 'Old' },
                artists: [{ name: 'Singer', img1v1Url: 'https://artist.test/a.jpg' }],
              },
            ],
          },
        }
      : Promise.reject(new Error('HTTP 500'));

  const tracks = await provider.searchTracks('A');

  assert.equal(tracks[0].coverUrl, 'https://artist.test/a.jpg');
});

test('Netease track lists enrich every missing album cover', async (t) => {
  const listSongs = [
    {
      id: 11,
      name: 'Already complete',
      album: {
        id: 1,
        name: 'First',
        picUrl: 'https://album.test/existing.jpg',
      },
      artists: [{ name: 'Singer A' }],
    },
    {
      id: 22,
      name: 'Needs artwork',
      album: { id: 2, name: 'Second' },
      artists: [{ name: 'Singer B' }],
    },
  ];

  const cases = [
    {
      name: 'daily recommendations',
      listPath: '/api/v1/discovery/recommend/songs',
      listPayload: { recommend: listSongs },
      load: (provider) => provider.getDailyTracks({ limit: 20 }),
    },
    {
      name: 'radio',
      listPath: '/api/personalized/newsong',
      listPayload: { result: listSongs.map((song) => ({ song })) },
      load: (provider) => provider.getRadioTracks({ limit: 20 }),
    },
    {
      name: 'playlist tracks',
      listPath: '/api/v6/playlist/detail',
      listPayload: { playlist: { tracks: listSongs } },
      load: (provider) => provider.getPlaylistTracks('123456', { limit: 20 }),
    },
    {
      name: 'recent tracks',
      listPath: '/api/play-record',
      listPayload: { weekData: listSongs.map((song) => ({ song })) },
      load: (provider) => provider.getRecentTracks({ limit: 20 }),
      needsProfile: true,
    },
  ];

  for (const item of cases) {
    await t.test(item.name, async () => {
      const provider = createProvider();
      const detailRequests = [];
      provider.requestJson = async (pathname, params) => {
        if (pathname === '/api/nuser/account/get' && item.needsProfile) {
          return { profile: { userId: 42, nickname: 'Tester' } };
        }
        if (pathname === item.listPath) return item.listPayload;
        if (pathname === '/api/song/detail') {
          detailRequests.push(params.ids);
          return {
            songs: [{ id: 22, album: { picUrl: 'https://album.test/enriched.jpg' } }],
          };
        }
        throw new Error(`Unexpected request: ${pathname}`);
      };

      const tracks = await item.load(provider);

      assert.deepEqual(detailRequests, ['[22]']);
      assert.equal(tracks[0].coverUrl, 'https://album.test/existing.jpg');
      assert.equal(tracks[1].coverUrl, 'https://album.test/enriched.jpg');
    });
  }
});

test('Netease artwork enrichment batches large lists and preserves successful batches', async () => {
  const provider = createProvider();
  const songs = Array.from({ length: 101 }, (_, index) => ({
    id: index + 1,
    name: `Song ${index + 1}`,
    album: { id: index + 1, name: `Album ${index + 1}` },
    artists: [{ name: 'Singer' }],
  }));
  const detailRequests = [];
  provider.requestJson = async (pathname, params) => {
    if (pathname === '/api/v6/playlist/detail') return { playlist: { tracks: songs } };
    if (pathname === '/api/song/detail') {
      const ids = JSON.parse(params.ids);
      detailRequests.push(ids);
      if (ids.includes(101)) throw new Error('HTTP 500');
      return {
        songs: ids.map((id) => ({
          id,
          album: { picUrl: `https://album.test/${id}.jpg` },
        })),
      };
    }
    throw new Error(`Unexpected request: ${pathname}`);
  };

  const tracks = await provider.getPlaylistTracks('123456', { limit: 101 });

  assert.equal(detailRequests.length, 2);
  assert.equal(detailRequests[0].length, 100);
  assert.deepEqual(detailRequests[1], [101]);
  assert.equal(tracks[0].coverUrl, 'https://album.test/1.jpg');
  assert.equal(tracks[99].coverUrl, 'https://album.test/100.jpg');
  assert.equal(tracks[100].coverUrl, '');
});

test('Netease provider writes numeric tracks to a playlist', async () => {
  const provider = createProvider();
  let captured;
  provider.requestWeapiJson = async (pathname, payload) => {
    captured = { pathname, payload };
    return { code: 200 };
  };

  const result = await provider.addTracksToPlaylist({ id: '123456', title: '我的歌单' }, [{ sourceTrackId: '789012' }]);

  assert.equal(captured.pathname, '/weapi/playlist/manipulate/tracks');
  assert.equal(captured.payload.op, 'add');
  assert.equal(captured.payload.pid, '123456');
  assert.equal(captured.payload.trackIds, '["789012"]');
  assert.equal(captured.payload.tracks, '[{"type":3,"id":"789012"}]');
  assert.equal(result.songlist[0].existed, 0);
});

test('Netease provider reports an existing track without treating it as a failure', async () => {
  const provider = createProvider();
  provider.requestWeapiJson = async () => ({
    code: 502,
    message: '歌单中歌曲重复',
  });

  const result = await provider.addTracksToPlaylist({ id: '123456', title: '我喜欢的音乐' }, [
    { sourceTrackId: '789012' },
  ]);

  assert.equal(result.songlist[0].existed, 1);
});

test('Netease provider checks the complete playlist track id list', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    playlist: { trackIds: [{ id: 123 }, { id: 789012 }] },
  });

  assert.equal(await provider.playlistContainsTrack('123456', { sourceTrackId: '789012' }), true);
  assert.equal(await provider.playlistContainsTrack('123456', { sourceTrackId: '345678' }), false);
});

test('playlist write service routes Netease writes to its provider', async () => {
  const provider = createProvider();
  provider.requestWeapiJson = async () => ({ code: 200 });
  const registry = {
    get: (platform) => {
      assert.equal(platform, 'netease');
      return provider;
    },
  };

  const result = await writeMusicPlaylistTracks(
    registry,
    {
      platform: 'netease',
      playlist: { id: '123456', title: '我的歌单' },
      tracks: [{ sourceTrackId: '789012' }],
    },
    'add',
  );

  assert.equal(result.source, 'netease');
  assert.equal(result.result.songlist[0].songId, '789012');
});

test('Netease liked removal resolves the logged-in users actual playlist ID', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  provider.getUserPlaylists = async (uid) => {
    assert.equal(uid, '42');
    return [{ id: '123456', title: '我喜欢的音乐' }];
  };
  let request;
  provider.requestWeapiJson = async (pathname, params) => {
    request = { pathname, params };
    return { code: 200 };
  };

  const result = await writeMusicPlaylistTracks(
    { get: () => provider },
    {
      platform: 'netease',
      playlist: { id: 'liked' },
      tracks: [{ sourceTrackId: '789012' }],
    },
    'remove',
  );
  assert.equal(request.params.pid, '123456');
  assert.equal(request.params.op, 'del');
  assert.equal(request.params.trackIds, '["789012"]');
  assert.equal(result.result.playlistId, '123456');
});

test('Netease liked removal fails without writing to an arbitrary playlist', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  provider.getUserPlaylists = async () => [{ id: '123456', title: 'Daily Mix' }];
  provider.requestWeapiJson = async () => assert.fail('must not write without liked playlist');
  await assert.rejects(
    provider.removeTracksFromPlaylist({ id: 'liked' }, [{ sourceTrackId: '789012' }]),
    /没有从网易云音乐读取到.*我喜欢/,
  );
});

test('created playlist content marks only playlists without the track as available', async () => {
  const provider = {
    async getCreatedPlaylists() {
      return [
        { id: '1', title: '我喜欢的音乐' },
        { id: '2', title: '我的歌单' },
      ];
    },
    async getPlaylistTracks(playlistId) {
      return playlistId === '1' ? [{ sourceTrackId: '789012' }] : [{ sourceTrackId: '345678' }];
    },
  };
  const result = await getMusicHomeContent(
    { get: () => provider },
    {
      platform: 'netease',
      action: 'created-playlists',
      track: { source: 'netease', sourceTrackId: '789012' },
    },
  );

  assert.equal(result.playlists[0].containsTrack, true);
  assert.equal(result.playlists[1].containsTrack, false);
});

test('Netease liked tracks reject instead of falling back to an arbitrary playlist', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  provider.getUserPlaylists = async () => [
    { id: 'first', title: 'Favorites' },
    { id: 'second', title: 'Daily Mix' },
  ];
  provider.getPlaylistTracks = async (playlistId) => [{ sourceTrackId: playlistId }];

  await assert.rejects(provider.getLikedTracks({ limit: 20 }), /我喜欢/);
});
