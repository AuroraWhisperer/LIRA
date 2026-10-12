'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { mapQQSong } = require('../../src/music/providers/qq-provider-utils');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { matchMusicTrackCandidates } = require('../../src/music/lyrics-service');
const { loadModuleExports } = require('../helpers/frontend-modules');

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
