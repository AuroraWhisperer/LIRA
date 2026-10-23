'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { mapQQSong } = require('../../src/music/providers/qq-provider-utils');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { matchMusicTrackCandidates } = require('../../src/music/lyrics-service');
const { scoreTrackMatch } = require('../../src/music/song-matcher');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('a one-letter title typo selects the related song instead of an unrelated prefixed title', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'born me down',
    candidates: [
      { id: 'prefixed', title: '二后生挖眼睛 Burn Me Down', artists: ['茂哥'], album: '专辑' },
      { id: 'unrelated', title: 'Another Song', album: '专辑' },
      { id: 'wanted', title: 'Burn Me Down', artists: ['hanji'], album: '专辑' },
    ],
  });
  assert.deepEqual(results.map(({ track }) => track.id), ['wanted']);
  assert.equal(results[0].autoAccept, false);
  assert.match(results[0].reasons.join('；'), /字母/);
});

test('matching artist, duration and album cannot substitute for a related song title', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'born me down', artist: '歌手', durationMs: 180000,
    candidates: [{ title: 'Another Song', artists: ['歌手'], album: '专辑', durationMs: 180000 }],
  });
  assert.deepEqual(results, []);
});

test('a guessed title still requires confirmation when the artist and duration match', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'born me down', artist: '歌手', durationMs: 180000,
    candidates: [{ title: 'Burn Me Down', artists: ['歌手'], album: '专辑', durationMs: 180000 }],
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].autoAccept, false);
});

test('equal title matches retain provider relevance order', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'born me down',
    candidates: [
      { id: 'first', title: 'Burn Me Down', album: '专辑' },
      { id: 'second', title: 'Bore Me Down', album: '专辑' },
    ],
  });
  assert.deepEqual(results.map(({ track }) => track.id), ['first', 'second']);
});

test('title typo tolerance does not accept short names, Chinese substitutions or multiple errors', () => {
  for (const [songName, title] of [['Love', 'Live'], ['夏天的故事', '冬天的故事'], ['borm me down', 'Burn Me Down']]) {
    assert.deepEqual(matchMusicTrackCandidates({ songName, candidates: [{ title }] }).results, [], `${songName} / ${title}`);
  }
});

test('normalized title matches rank above typo suggestions', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'burn me down',
    candidates: [
      { id: 'typo', title: 'Born Me Down', album: '专辑' },
      { id: 'normalized', title: 'Burn Me Down', album: '专辑' },
    ],
  });
  assert.deepEqual(results.map(({ track }) => track.id), ['normalized', 'typo']);
  assert.ok(results[0].score > results[1].score);
});

test('title formatting and artist case do not outrank the requested singer', () => {
  for (const songName of ['burn me down', 'Ｂｕｒｎ　Ｍｅ　Ｄｏｗｎ', 'Burn-Me-Down']) {
    const { results } = matchMusicTrackCandidates({
      songName, artist: 'HANJI',
      candidates: [
        { id: 'other-artist', title: songName, artists: ['其他歌手'], album: '专辑' },
        { id: 'wanted', title: 'Burn Me Down', artists: ['hanji'], album: '专辑' },
      ],
    });
    assert.equal(results[0].track.id, 'wanted', songName);
    assert.equal(results[0].autoAccept, true, songName);
  }
});

test('version keywords do not penalize ordinary words containing the same letters', () => {
  for (const title of ['Alive', 'Discover', 'Adjective']) {
    const { results } = matchMusicTrackCandidates({
      songName: title, artist: '歌手', candidates: [{ title, artists: ['歌手'], album: title }],
    });
    assert.equal(results[0].score, 90, title);
    assert.equal(results[0].autoAccept, true, title);
  }
});

test('meaningful parenthetical title words are retained when matching songs', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'Run (To You)',
    candidates: [{ id: 'other', title: 'Run (Away)' }, { id: 'wanted', title: 'Run (To You)' }],
  });
  assert.deepEqual(results.map(({ track }) => track.id), ['wanted']);
});

test('an explicitly requested rendition excludes incompatible versions without penalizing the request', () => {
  for (const version of ['Live', 'DJ Remix', '伴奏', 'Cover', 'Sped Up']) {
    const title = `Song (${version})`;
    const { results } = matchMusicTrackCandidates({
      songName: title, artist: '歌手',
      candidates: [
        { id: 'studio', title: 'Song', artists: ['歌手'], album: '专辑' },
        { id: 'wanted', title, artists: ['歌手'], album: title },
      ],
    });
    assert.deepEqual(results.map(({ track }) => track.id), ['wanted'], version);
    assert.equal(results[0].autoAccept, true, version);
  }
});

test('unspecified renditions still favor the original over live and remix candidates', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'Song', artist: '歌手',
    candidates: [
      { id: 'live', title: 'Song (Live)', artists: ['歌手'], album: '专辑' },
      { id: 'remix', title: 'Song (Remix)', artists: ['歌手'], album: '专辑' },
      { id: 'original', title: 'Song', artists: ['歌手'], album: '专辑' },
    ],
  });
  assert.deepEqual(results.map(({ track }) => track.id), ['original', 'live', 'remix']);
  assert.equal(results[0].autoAccept, true);
  assert.ok(results.slice(1).every(result => !result.autoAccept));
});

test('artist or duration conflicts and unavailable tracks require confirmation even above the score threshold', () => {
  for (const scenario of [
    { track: { artists: ['其他歌手'] }, reason: /歌手.*确认/ },
    { track: { durationMs: 300000 }, reason: /时长.*确认/ },
    { track: { playable: false }, reason: /不可播.*确认/ },
  ]) {
    const { results, threshold } = matchMusicTrackCandidates({
      songName: 'Burn Me Down', artist: 'hanji', durationMs: 151000,
      candidates: [{ title: 'Burn Me Down', artists: ['hanji'], album: '专辑', durationMs: 151000, ...scenario.track }],
    });
    assert.equal(results.length, 1);
    assert.ok(results[0].score >= threshold);
    assert.equal(results[0].autoAccept, false);
    assert.match(results[0].reasons.join('；'), scenario.reason);
  }
});

test('equally relevant playable tracks precede tracks flagged as unavailable', () => {
  const { results } = matchMusicTrackCandidates({
    songName: 'Song', artist: '歌手',
    candidates: [
      { id: 'unavailable', title: 'Song', artists: ['歌手'], album: '专辑', playable: false },
      { id: 'available', title: 'Song', artists: ['歌手'], album: '专辑', playable: true },
    ],
  });
  assert.deepEqual(results.map(({ track }) => track.id), ['available', 'unavailable']);
  assert.equal(results[0].autoAccept, true);
  assert.equal(results[1].autoAccept, false);
});

test('the exported single-track scorer normalizes its own request', () => {
  const match = scoreTrackMatch({ title: 'burn me down', artist: 'HANJI' }, {
    title: 'Burn Me Down', artists: ['hanji'], album: '专辑',
  });
  assert.ok(match);
  assert.equal(match.autoAccept, true);
  assert.equal(match.track.title, 'Burn Me Down');
});

test('import skips unrelated platform results and leaves an empty match available for retry', async () => {
  let fallbackAvailable = false;
  const searched = [];
  const { MatchService } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/services/match-service.js'), {
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      let data;
      if (url === '/api/music/search') {
        searched.push(body.platform);
        data = { tracks: [{ id: body.platform, source: body.platform, sourceTrackId: body.platform,
          title: body.platform === 'netease' && fallbackAvailable ? 'Burn Me Down' : '中文前缀 Burn Me Down', album: '专辑' }] };
      } else {
        data = matchMusicTrackCandidates(body);
      }
      return new Response(JSON.stringify({ ok: true, data }));
    },
  });
  const state = { pendingRequests: [], importedSongRequestKeys: [] };
  const service = new MatchService({ state });
  const { ImportService } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/services/import-service.js'));
  const importer = new ImportService({ matchService: service });
  const item = { id: 1, song_name: 'born me down' };
  const skipped = await importer.processQueueItem(item, ['qq', 'netease']);
  assert.equal(skipped.type, 'skipped');
  assert.equal(state.pendingRequests.length, 0);
  assert.equal(state.importedSongRequestKeys.length, 0);
  fallbackAvailable = true;
  const retried = await importer.processQueueItem(item, ['qq', 'netease']);
  assert.equal(retried.type, 'pending');
  assert.equal(state.pendingRequests.length, 1);
  assert.equal(state.pendingRequests[0].track.title, 'Burn Me Down');
  assert.equal(state.pendingRequests[0].track.source, 'netease');
  assert.deepEqual(searched, ['qq', 'netease', 'qq', 'netease']);
});

for (const artist of ['歌手', '']) {
  test(`matched QQ tracks retain provider metadata for ${artist ? 'automatic' : 'pending'} acceptance`, async () => {
    const candidate = mapQQSong({
      id: 123, mid: 'song-mid', type: 1, title: '歌曲',
      singer: [{ name: '歌手' }], file: { media_mid: 'media-mid' },
      album: { mid: 'album-mid', title: '专辑' }, interval: 180, pay: { pay_play: 1 },
    });
    const { MatchService } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/services/match-service.js'), {
      fetch: async (url, options) => {
        const data = url === '/api/music/search'
          ? { tracks: [{ ...candidate, id: 'other', sourceTrackId: 'other', title: '另一首歌' }, candidate] }
          : matchMusicTrackCandidates(JSON.parse(options.body));
        return new Response(JSON.stringify({ ok: true, data }));
      },
    });
    const match = await new MatchService().matchQueueItem({ song_name: '歌曲', artist }, ['qq']);
    assert.equal(match.autoAccept, Boolean(artist));
    for (const key of ['id', 'sourceTrackId', 'sourceMediaId', 'sourceSongId', 'sourceSongType', 'sourceAlbumId', 'coverUrl', 'vip']) {
      assert.equal(match.track[key], candidate[key], key);
    }
    const provider = new QQMusicProvider({ getAuthState: () => ({ loggedIn: true }), getCookieHeader: () => 'qqmusic_uin=123; qqmusic_key=synthetic' });
    let params;
    provider.requestMusicu = async (body) => {
      params = body.req_0.param;
      return { req_0: { data: { midurlinfo: [{ filename: 'M500media-mid.mp3', purl: 'M500media-mid.mp3' }], sip: ['https://example.test/'] } } };
    };
    await provider.resolvePlayableUrl(match.track);
    assert.deepEqual(params.songmid, ['song-mid']);
    assert.deepEqual(params.filename, ['M500media-mid.mp3']);
    assert.deepEqual(params.songtype, [1]);
    const { canAddTrackToPlaylist } = await loadModuleExports(path.resolve(__dirname, '../../public/js/playback/utils.js'));
    assert.equal(canAddTrackToPlaylist(match.track), true);
  });
}
