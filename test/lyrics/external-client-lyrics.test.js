'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createExternalClientLyricResolver } = require('../../src/music/external-client-lyrics');

for (const platform of ['qq', 'netease']) {
  test(`${platform} external lyrics never search or fetch a different provider`, async () => {
    const calls = [];
    const resolver = createExternalClientLyricResolver({
      platform, getRegistry: () => ({}), lyricsService: {
        async searchMusicTracks(_registry, input) {
          calls.push(input.platform);
          return { tracks: [
            { source: platform === 'qq' ? 'netease' : 'qq', title: 'Song', artists: ['Artist'] },
            { source: platform, sourceTrackId: '123', title: 'Song', artists: ['Artist'], durationMs: 120000 },
          ] };
        },
        async getMusicTrackLyrics(_registry, { track }) {
          calls.push(track.source);
          return { source: platform, lines: [{ startMs: 0, text: 'Synthetic lyric' }] };
        },
      },
    });
    assert.equal((await resolver({ title: 'Song', artists: ['Artist'] })).source, platform);
    assert.deepEqual(calls, [platform, platform]);
  });
}

test('verified NetEase ID avoids search and an empty result cannot borrow another version', async () => {
  let fetched;
  const resolver = createExternalClientLyricResolver({ platform: 'netease', getRegistry: () => ({}), lyricsService: {
    searchMusicTracks: () => assert.fail('exact client ID must avoid fuzzy lookup'),
    async getMusicTrackLyrics(_registry, { track }) { fetched = track; return { source: 'netease', lines: [] }; },
  } });
  assert.equal(await resolver({ sourceTrackId: '123', title: 'Song', artists: ['Artist'] }), null);
  assert.equal(fetched.sourceTrackId, '123');
  assert.equal(fetched.source, 'netease');
});

test('a provider failure is reported instead of fetching another platform', async () => {
  const resolver = createExternalClientLyricResolver({ platform: 'qq', getRegistry: () => ({}), lyricsService: {
    async searchMusicTracks(_registry, { platform }) { assert.equal(platform, 'qq'); throw new Error('QQ unavailable'); },
    getMusicTrackLyrics: () => assert.fail('must not fetch after failed identity lookup'),
  } });
  await assert.rejects(resolver({ title: 'Song' }), /QQ unavailable/);
});

test('known artists and duration reject a different singer or recording of the same title', async () => {
  let candidates = [{ source: 'qq', title: 'Song', artists: ['Wrong Artist'], durationMs: 120000 }];
  const resolver = createExternalClientLyricResolver({ platform: 'qq', getRegistry: () => ({}), lyricsService: {
    searchMusicTracks: async () => ({ tracks: candidates }),
    getMusicTrackLyrics: () => assert.fail('a different recording must not be used'),
  } });
  assert.equal(await resolver({ title: 'Song', artists: ['Artist'], durationMs: 120000 }), null);
  candidates = [{ source: 'qq', title: 'Song', artists: ['Artist'], durationMs: 180000 }];
  assert.equal(await resolver({ title: 'Song', artists: ['Artist'], durationMs: 120000 }), null);
});

test('an exact live duet is retained and uses the closest matching duration', async () => {
  let fetched;
  const resolver = createExternalClientLyricResolver({ platform: 'qq', getRegistry: () => ({}), lyricsService: {
    searchMusicTracks: async () => ({ tracks: [
      { source: 'qq', sourceTrackId: 'farther', title: 'Song (Live)', artists: ['First', 'Second'], durationMs: 124000 },
      { source: 'qq', sourceTrackId: 'exact', title: 'Song (Live)', artists: ['Second', 'First'], durationMs: 120000 },
    ] }),
    async getMusicTrackLyrics(_registry, { track }) {
      fetched = track;
      return { source: 'qq', lines: [{ startMs: 0, text: 'Live duet lyric' }] };
    },
  } });
  assert.ok(await resolver({ title: 'Song (Live)', artists: ['first / second'], durationMs: 120000 }));
  assert.equal(fetched.sourceTrackId, 'exact');
});
