'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');
const { getMusicHomeContent, writeMusicPlaylistTracks } = require('../../src/music/music-catalog-service');
const { createMusicProviderRegistry } = require('../../src/music/provider-registry');
const path = require('node:path');
const { loadModuleExports } = require('../helpers/frontend-modules');

function createProvider() {
  return new NeteaseMusicProvider({
    getAuthState: () => ({ loggedIn: true }),
    getCookieHeader: () => 'MUSIC_U=test-token; __csrf=test-csrf',
  });
}

const profilePath = '/api/nuser/account/get';
const listsPath = '/api/user/playlist';
const indexPath = '/api/v6/playlist/detail';
const detailsPath = '/api/song/detail';
const coldLikedPage = [profilePath, listsPath, indexPath, detailsPath];

function createLikedCaller(t, pauseAt = async () => {}, combinedSession = false) {
  let account = 'A';
  const sent = [];
  const registry = createMusicProviderRegistry({
    getRequestSession: combinedSession ? async () => {
      const cookieHeader = account ? `MUSIC_U=${account}` : '';
      await pauseAt('login');
      return { state: { loggedIn: Boolean(cookieHeader) }, cookieHeader };
    } : undefined,
    getCookieHeader: async () => {
      const cookie = account ? `MUSIC_U=${account}` : '';
      await pauseAt('cookie');
      return cookie;
    },
    getSessionState: async () => {
      const loggedIn = Boolean(account);
      await pauseAt('login');
      return { loggedIn };
    },
  });
  t.mock.method(globalThis, 'fetch', async ({ pathname, searchParams }, { headers }) => {
    const cookie = headers.Cookie || '';
    sent.push([pathname, cookie]);
    await pauseAt(pathname);
    if (pathname === profilePath) return Response.json({ profile: { userId: cookie === 'MUSIC_U=A' ? 1 : 2 } });
    if (pathname === listsPath) return Response.json({ playlist: [{ id: searchParams.get('uid'), name: '我喜欢的音乐' }] });
    if (pathname === indexPath) return Response.json({ playlist: { trackIds: searchParams.get('id') === '1' ? [11, 12] : [21, 22] } });
    assert.equal(pathname, detailsPath);
    return Response.json({ songs: JSON.parse(searchParams.get('ids')).map(id => ({ id, name: `Song ${id}` })) });
  });
  async function page(offset, loadingSession = 'same') {
    const { tracks } = await getMusicHomeContent(registry, { platform: 'netease', action: 'liked', limit: 1, offset, loadingSession });
    return tracks.map(track => track.sourceTrackId);
  }
  return { page, sent, switchTo(next) { account = next; } };
}

test('NetEase liked pages reuse discovery and index per load, including after refresh', async t => {
  const { page, sent } = createLikedCaller(t);
  assert.deepEqual(await page(0), ['11']);
  assert.deepEqual(await page(1), ['12']);
  assert.deepEqual(await page(2), []);
  assert.deepEqual(await page(0, 'refresh'), ['11']);
  assert.deepEqual(sent, [...coldLikedPage, detailsPath, ...coldLikedPage.filter(path => path !== profilePath)].map(path => [path, 'MUSIC_U=A']));
});

test('NetEase sessionless liked reads keep a matching cached page and evict it after a switch', async t => {
  const { page, sent, switchTo } = createLikedCaller(t);
  await page(0);
  await page(0, '');
  let start = sent.length;
  assert.deepEqual(await page(1), ['12']);
  assert.deepEqual(sent.slice(start), [[detailsPath, 'MUSIC_U=A']]);
  switchTo('B');
  assert.deepEqual(await page(0, ''), ['21']);
  switchTo('A');
  start = sent.length;
  assert.deepEqual(await page(1), ['12']);
  assert.deepEqual(sent.slice(start), coldLikedPage.map(path => [path, 'MUSIC_U=A']));
});

test('NetEase liked reads keep their initial account across login and playlist discovery', async t => {
  for (const [stage, next, restore] of [['cookie', 'B'], ['login', 'B'], [profilePath, 'B'], [listsPath, ''], [profilePath, 'B', true]]) {
    await t.test(`${stage} -> ${next || 'logout'}${restore ? ' -> A' : ''}`, async t => {
      const started = Promise.withResolvers();
      const release = Promise.withResolvers();
      let paused = false;
      const { page, sent, switchTo } = createLikedCaller(t, async point => {
        if (!paused && point === stage) {
          paused = true;
          started.resolve();
          await release.promise;
        }
      }, true);
      const oldPage = page(0);
      await started.promise;
      const initial = stage === listsPath ? [profilePath, listsPath] : stage === profilePath ? [profilePath] : [];
      assert.deepEqual(sent, initial.map(path => [path, 'MUSIC_U=A']));
      switchTo(next);
      if (next) {
        assert.deepEqual(await page(0), ['21']);
        assert.deepEqual(sent.slice(initial.length), coldLikedPage.map(path => [path, 'MUSIC_U=B']));
      } else {
        await assert.rejects(page(0));
        assert.equal(sent.length, initial.length);
      }
      if (restore) {
        switchTo('A');
        assert.deepEqual(await page(0), ['11']);
        assert.deepEqual(sent.slice(-4), coldLikedPage.map(path => [path, 'MUSIC_U=A']));
      }
      const beforeRelease = sent.length;
      release.resolve();
      await assert.rejects(oldPage, error => error.code === 'NETEASE_PLAYLIST_ACCOUNT_CHANGED');
      assert.equal(sent.length, beforeRelease);
      if (next) {
        assert.deepEqual(await page(1), [restore ? '12' : '22']);
        assert.deepEqual(sent.slice(beforeRelease), [[detailsPath, `MUSIC_U=${restore ? 'A' : next}`]]);
      }
    });
  }
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
    assert.equal(url.searchParams.get('encodeType'), 'flac');
  }
  assert.equal(anonymous.trial, true);
  assert.equal(anonymous.requestedQuality, 'lossless');
  assert.equal(anonymous.quality, 'standard');
  assert.equal(member.trial, false);
  assert.equal(member.requestedQuality, 'lossless');
  assert.equal(member.quality, 'lossless');
  assert.equal(changedAccount.trial, true);
});

test('NetEase liked pages slice one track-ID snapshot and read details in its order', async () => {
  const provider = createProvider();
  const requests = [];
  provider.getLikedPlaylistId = async () => '123';
  provider.requestJson = async (pathname, params) => {
    requests.push({ pathname, params });
    if (pathname === '/api/v6/playlist/detail') {
      return { playlist: { trackCount: 205, trackIds: Array.from({ length: 205 }, (_, index) => ({ id: index + 1 })),
        tracks: [{ id: 1, name: 'Repeated first page' }] } };
    }
    assert.equal(pathname, '/api/song/detail');
    return { songs: JSON.parse(params.ids).reverse().map(id => ({
      id, name: `Song ${id}`, artists: [{ img1v1Url: 'https://example.test/artist.jpg' }],
    })) };
  };
  const pages = [];
  for (const offset of [0, 100, 200, 300]) {
    pages.push(await provider.getLikedTracks({ limit: 100, offset, loadingSession: 'current-load' }));
  }
  assert.deepEqual(pages.map(page => page.length), [100, 100, 5, 0]);
  assert.equal(pages[0][0].coverUrl, 'https://example.test/artist.jpg');
  assert.deepEqual(pages.flat().map(track => track.sourceTrackId), Array.from({ length: 205 }, (_, index) => String(index + 1)));
  assert.equal(requests.filter(request => request.pathname === '/api/v6/playlist/detail').length, 1);
  assert.deepEqual(requests[0].params, { id: '123', n: '0', s: '0' });
  assert.equal(requests.filter(request => request.pathname === '/api/song/detail').length, 3);
  await provider.getLikedTracks({ limit: 100, loadingSession: 'fresh-load' });
  assert.equal(requests.filter(request => request.pathname === '/api/v6/playlist/detail').length, 2);
});

test('NetEase embedded liked pages only wait for a network slot when they need artwork', async () => {
  const provider = createProvider();
  provider.getLikedPlaylistId = async () => '1';
  const held = Promise.withResolvers();
  const cover = 'https://example.test/album';
  let coverReads = 0;
  provider.requestJson = async (pathname, { id }) => {
    if (pathname === '/api/song/detail') {
      coverReads++;
      return { songs: [{ id: 3, al: { picUrl: cover } }] };
    }
    if (id === '1') return { playlist: { tracks: [
      { id: 1, name: 'First', al: { picUrl: cover } }, { id: 2, name: 'Second', al: { picUrl: cover } },
      { id: 3, name: 'Third' },
    ] } };
    await held.promise;
    return { playlist: { trackIds: [] } };
  };
  const page = offset => provider.getLikedTracks({ loadingSession: 'one', limit: 1, offset });
  await page(0);
  const busy = Promise.all(['2', '3', '4', '5', '6', '7'].map(id => provider.getPlaylistTracks(id)));
  let cachedId;
  const cached = page(1).then(([track]) => { cachedId = track.sourceTrackId; });
  const missingCover = page(2);
  await new Promise(resolve => setImmediate(resolve));
  const idWhileBusy = cachedId;
  const coverReadsWhileBusy = coverReads;
  held.resolve();
  const [, , [enriched]] = await Promise.all([busy, cached, missingCover]);
  assert.equal(idWhileBusy, '2');
  assert.equal(coverReadsWhileBusy, 0);
  assert.equal(enriched.coverUrl, cover);
});

test('NetEase playlist loading rejects incomplete indices and missing song details', async () => {
  const provider = createProvider();
  for (const playlist of [{ trackCount: 200, tracks: [{ id: 1 }] }, { trackCount: 200, trackIds: [] }]) {
    provider.requestJson = async () => ({ playlist });
    await assert.rejects(provider.getPlaylistTracks('123'), /完整曲目索引/);
  }
  provider.requestJson = async pathname => pathname === '/api/v6/playlist/detail'
    ? { playlist: { trackCount: 2, trackIds: [{ id: 1 }, { id: 2 }] } }
    : { songs: [{ id: 1, name: 'First' }] };
  await assert.rejects(provider.getPlaylistTracks('123'), /加载未完成/);
});

test('NetEase playlist opens fetch each distinct detail ID once and restore duplicate positions', async () => {
  const provider = createProvider();
  const unique = Array.from({ length: 100 }, (_, i) => i + 1);
  const ids = [...unique, 1, 99];
  const batches = [];
  provider.requestJson = async (pathname, params) => {
    if (pathname === '/api/v6/playlist/detail') {
      return { playlist: { trackIds: ids, tracks: [{ id: 1, name: 'Old title', fee: 0, status: 0 }] } };
    }
    const batch = JSON.parse(params.ids);
    batches.push(batch);
    return { songs: batch.toReversed().map(id => ({ id, name: `Current ${id}`, fee: 4, status: -1 })) };
  };
  const tracks = await provider.getPlaylistTracks('123');
  assert.deepEqual(tracks.map(track => track.sourceTrackId), ids.map(String));
  assert.equal(tracks[100].title, 'Current 1');
  assert.equal(tracks[100].vip, true);
  assert.equal(tracks[100].playable, false);
  assert.deepEqual(batches, [unique.map(String)]);
});

test('NetEase concurrent playlist opens share the upstream read limit', async () => {
  const provider = createProvider();
  const ids = Array.from({ length: 301 }, (_, index) => index + 1);
  let active = 0;
  let peak = 0;
  provider.requestJson = async (pathname, params) => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    if (pathname === '/api/v6/playlist/detail') return { playlist: { trackIds: ids } };
    return { songs: JSON.parse(params.ids).map(id => ({ id, name: `Song ${id}` })) };
  };
  await provider.getPlaylistTracks('1');
  assert.equal(peak, 2);
  await Promise.all(Array.from({ length: 9 }, (_, i) => provider.getPlaylistTracks(String(i + 1))));
  assert.ok(peak <= 6, `peak upstream reads: ${peak}`);
});

test('NetEase drops queued and in-flight playlist reads when the account switches', async (t) => {
  let cookie = 'MUSIC_U=synthetic-A';
  const provider = new NeteaseMusicProvider({ getCookieHeader: () => cookie });
  const gate = Promise.withResolvers();
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    sent.push(url.searchParams.get('id'));
    await gate.promise;
    return Response.json({ playlist: { tracks: [{
      id: 42, name: options.headers.Cookie === 'MUSIC_U=synthetic-B' ? 'For B' : 'For A',
      album: { picUrl: 'https://example.test/art' },
    }] } });
  });
  const reads = Promise.allSettled(Array.from({ length: 7 }, (_, i) => provider.getPlaylistTracks(String(i + 1))));
  await new Promise(resolve => setImmediate(resolve));
  cookie = 'MUSIC_U=synthetic-B';
  gate.resolve();
  const results = await reads;
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === 'NETEASE_PLAYLIST_ACCOUNT_CHANGED'));
  assert.equal(sent.length, 6);
  assert.ok(!sent.includes('7'));
  const tracks = await provider.getPlaylistTracks('7');
  assert.equal(tracks[0].title, 'For B');
});

test('NetEase stops an indexed read at a failed or incomplete pair of detail batches', async () => {
  const provider = createProvider();
  const ids = Array.from({ length: 401 }, (_, index) => index + 1);
  const upstreamError = new Error('HTTP 503');
  for (const missing of [false, true]) {
    let reads = 0;
    let inFlight = 0;
    provider.requestJson = async (pathname, params) => {
      if (pathname === '/api/v6/playlist/detail') return { playlist: { trackIds: ids } };
      const batch = JSON.parse(params.ids);
      reads++;
      if (batch[0] === '1') {
        if (!missing) throw upstreamError;
        return { songs: batch.slice(1).map(id => ({ id, name: `Song ${id}` })) };
      }
      inFlight++;
      await new Promise(resolve => setImmediate(resolve));
      inFlight--;
      return { songs: batch.map(id => ({ id, name: `Song ${id}` })) };
    };
    await assert.rejects(provider.getPlaylistTracks('1'), error => missing ? error.statusCode === 501 : error === upstreamError);
    assert.equal(reads, 2);
    assert.equal(inFlight, 0);
  }
});

test('NetEase admits a queued playlist when the first detail batch fails and its sibling is still pending', async () => {
  const provider = createProvider();
  const first = Promise.withResolvers();
  const others = Promise.withResolvers();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  let queuedIndexRead = false;
  provider.requestJson = async (pathname, params) => {
    if (pathname === '/api/song/detail') {
      const ids = JSON.parse(params.ids);
      if (ids[0] === '1') return first.promise;
      await others.promise;
      return { songs: ids.map(id => ({ id, name: `Song ${id}` })) };
    }
    if (params.id === '1') return { playlist: { trackIds: Array.from({ length: 200 }, (_, i) => i + 1) } };
    if (params.id === '6') queuedIndexRead = true;
    else await others.promise;
    return { playlist: { trackIds: [] } };
  };
  const failed = assert.rejects(provider.getPlaylistTracks('1'), /upstream failure/);
  await tick(); // Both detail batches are in flight before the other opens.
  const opens = Promise.all(['2', '3', '4', '5', '6'].map(id => provider.getPlaylistTracks(id)));
  await tick();
  const wasQueued = !queuedIndexRead;
  first.reject(new Error('upstream failure'));
  await tick();
  const admitted = queuedIndexRead;
  others.resolve();
  await Promise.all([failed, opens]);
  assert.ok(wasQueued && admitted, 'the next index should use the freed slot before the sibling finishes');
});

test('NetEase full liked loading displays and caches every page beyond the repeated upstream first page', async () => {
  const provider = createProvider();
  provider.getLikedPlaylistId = async () => '123';
  const ids = Array.from({ length: 205 }, (_, index) => index + 1);
  provider.requestJson = async (pathname, params) => pathname === '/api/v6/playlist/detail'
    ? { playlist: { trackCount: ids.length, trackIds: ids.map(id => ({ id })), tracks: ids.slice(0, 100).map(id => ({ id })) } }
    : { songs: JSON.parse(params.ids).map(id => ({ id, name: `Song ${id}`, album: { picUrl: 'https://example.test/cover.jpg' } })) };
  const cache = new Map();
  const { ContentLoader } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/content/loader.js'), {
    fetch: async (url, options) => {
      assert.equal(url, '/api/music/home');
      const data = await getMusicHomeContent({ get: () => provider }, JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
  });
  const loader = new ContentLoader({ state: { selectedSource: 'netease' }, cacheManager: cache });
  const result = await loader.loadHomeContent('liked');
  assert.equal(result.items.length, 205);
  assert.deepEqual(Array.from(result.items, track => track.sourceTrackId), ids.map(String));
  assert.equal(cache.get('netease:liked').items.length, 205);
  assert.equal(result.stale, undefined);
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

test('Netease lyrics retain YRC timing, spaces and literal parentheses when LRC timestamps differ', async () => {
  const provider = createProvider();
  provider.requestJson = async () => ({
    lrc: { lyric: '[00:01.40]Hello world\n[00:04.50]下一句' },
    tlyric: { lyric: '[00:01.40]旧译文' },
    yrc: { lyric: '[1000,2000](1000,700,0)Hello (echo) (1700,1300,0)(world)\n[4000,1000](4000,1000,0)下一句' },
    ytlrc: { lyric: '[00:01.00]你好世界' },
    yromalrc: { lyric: '[00:04.00]xia yi ju' },
  });
  const result = await provider.getLyrics({ sourceTrackId: '123', durationMs: 10000 });
  assert.equal(result.lines[0].startMs, 1000);
  assert.equal(result.lines[0].endMs, 3000);
  assert.equal(result.lines[0].text, 'Hello (echo) (world)');
  assert.equal(result.lines[0].translation, '你好世界');
  assert.deepEqual(result.lines[0].words, [
    { startMs: 1000, endMs: 1700, text: 'Hello (echo) ' },
    { startMs: 1700, endMs: 3000, text: '(world)' },
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
  const upstreamFailure = { code: 301, result: { songs: [] } };
  let response;
  t.mock.method(globalThis, 'fetch', async () => Response.json(response));
  const provider = createProvider();

  for (const data of [upstreamFailure, {}, { code: 200 }]) {
    response = data;
    await assert.rejects(provider.searchTracks('晴天'), Error);
  }
  response = upstreamFailure;
  const health = await provider.healthCheck();
  assert.equal(health.ok, false);
  assert.equal(health.status, 'api-error');
  assert.equal(health.auth.loggedIn, true);
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

  requests.length = 0;
  const lyricCandidates = await provider.searchTracks('A', { includeCovers: false });
  assert.equal(lyricCandidates[0].sourceTrackId, tracks[0].sourceTrackId);
  assert.deepEqual(requests.map(request => request.pathname), ['/api/search/get/web']);
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

test('NetEase membership uses complete embedded tracks and retries a truncated playlist', async () => {
  const provider = createProvider();
  const tracks = [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }];
  let reads = 0;
  provider.requestJson = async (pathname) => {
    assert.equal(pathname, '/api/v6/playlist/detail');
    reads++;
    return { playlist: { trackCount: 2, tracks } };
  };
  assert.equal(await provider.playlistContainsTrack('1', { id: 'netease:2' }), true);
  assert.equal(reads, 1);
  tracks.pop();
  await assert.rejects(provider.playlistContainsTrack('1', { id: 'netease:2' }), /完整曲目索引/);
  assert.equal(reads, 3);
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

test('NetEase removal receipts reuse the first 50 account rows before owner and invalid-row filtering', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  const ordinary = { id: 99, name: '喜欢翻唱', creator: { userId: 42 } };
  let rows = [{ id: 77, name: '喜欢的音乐', creator: { userId: 8 } }, ordinary];
  let listReads = 0;
  provider.requestJson = async (pathname, { limit }) => {
    assert.equal(pathname, listsPath);
    listReads++;
    return { playlist: rows.slice(0, Number(limit)) };
  };
  provider.requestWeapiJson = async () => ({ code: 200 });
  const remove = id => provider.removeTracksFromPlaylist({ id }, [{ sourceTrackId: '101' }]);
  const created = await provider.getCreatedPlaylists({ limit: 100 });
  assert.deepEqual(created.map(row => row.id), ['99']);
  assert.equal((await remove('99')).isLikedPlaylist, false);
  assert.equal((await remove('77')).isLikedPlaylist, true);
  assert.equal(listReads, 1);

  rows = Array.from({ length: 50 }, () => null).concat(ordinary);
  await provider.getCreatedPlaylists({ limit: 100 });
  assert.equal((await remove('99')).isLikedPlaylist, false, 'the 51st raw row is outside liked discovery');
  assert.equal(listReads, 2);
});

test('a cold numeric removal confirms its target even when favorite discovery is unavailable', async () => {
  const provider = createProvider();
  let writes = 0;
  provider.requestWeapiJson = async () => { writes++; return { code: 200 }; };
  provider.getLikedPlaylistId = async () => { throw new Error('discovery offline'); };
  const receipt = await provider.removeTracksFromPlaylist({ id: '99' }, [{ sourceTrackId: '101' }]);
  assert.equal(receipt.playlistId, '99');
  assert.equal(receipt.isLikedPlaylist, undefined);
  assert.equal(writes, 1);
});

test('collected playlists cross the mixed-directory boundary and reject incomplete reads', async () => {
  const provider = createProvider();
  provider.getUserProfile = async () => ({ userId: '42' });
  const first = Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: `Mine ${i}`, creator: { userId: 42 } }));
  const favorite = { id: 501, name: 'Collected', creator: { userId: 99 } };
  let nextPage;
  const offsets = [];
  provider.requestJson = async (_url, { offset, limit }) => {
    offsets.push(Number(offset));
    assert.equal(limit, '500');
    return offset === '0' ? { playlist: first, more: true } : nextPage;
  };
  const read = () => provider.getCollectedPlaylists({ limit: 5000 });
  for (nextPage of [{ playlist: first, more: true }, { playlist: [], more: true }, {}]) {
    await assert.rejects(read());
    assert.deepEqual(offsets.splice(0), [0, 500]);
  }
  nextPage = { playlist: [favorite], more: false };
  assert.deepEqual((await read()).map(row => row.id), ['501']);
  assert.deepEqual(offsets, [0, 500]);
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
