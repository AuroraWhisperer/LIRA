'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createWeSingOnlineLyricResolver,
  selectWeSingLyricTrack
} = require('../src/music/wesing-online-lyrics');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');

test('WeSing online lyric matching uses duration to disambiguate same-title songs', () => {
  const selected = selectWeSingLyricTrack('失控', 255000, [
    createTrack('qq:cover', '翻唱歌手', 181000),
    createTrack('qq:original', '井迪', 255000)
  ]);

  assert.equal(selected.id, 'qq:original');
});

test('WeSing online fallback queries both providers and prefers complete word lyrics', async () => {
  const requestedLyrics = [];
  const lyricsService = {
    async searchMusicTracks(_registry, body) {
      return {
        tracks: body.platform === 'qq'
          ? [createTrack('qq:wrong', '翻唱歌手', 181000), createTrack('qq:original', '井迪', 255000)]
          : [createTrack('netease:original', '井迪儿', 255000, 'netease')]
      };
    },
    async getMusicTrackLyrics(_registry, body) {
      requestedLyrics.push(body.track.id);
      const wordTimed = body.track.source === 'qq';
      return {
        source: body.track.source,
        lines: [{
          startMs: 1000,
          endMs: 2000,
          text: '请原谅我的词穷',
          words: wordTimed ? [{ text: '请', startMs: 1000, endMs: 1200 }] : []
        }]
      };
    }
  };
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService,
    preferredPlatform: 'netease'
  });

  const result = await resolve({ title: '失控', durationMs: 255000 });

  assert.equal(result.source, 'qq');
  assert.equal(result.songMid, 'qq:original');
  assert.deepEqual(result.artists, ['井迪']);
  assert.equal(result.lines[0].words.length, 1);
  assert.deepEqual(requestedLyrics.sort(), ['netease:original', 'qq:original']);
});

test('WeSing online fallback does not prefer a nine-line partial timeline over a complete one', async () => {
  const lyricsService = {
    async searchMusicTracks(_registry, body) {
      return {
        tracks: [createTrack(`${body.platform}:original`, '井迪', 255000, body.platform)]
      };
    },
    async getMusicTrackLyrics(_registry, body) {
      const lineCount = body.track.source === 'qq' ? 64 : 9;
      return {
        source: body.track.source,
        lines: Array.from({ length: lineCount }, (_, index) => ({
          startMs: index * 4000,
          endMs: index * 4000 + 3000,
          text: `第 ${index + 1} 行`,
          words: [{ text: '词', startMs: index * 4000, endMs: index * 4000 + 500 }]
        }))
      };
    }
  };
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService,
    preferredPlatform: 'netease'
  });

  const result = await resolve({ title: '失控', durationMs: 255000 });

  assert.equal(result.source, 'qq');
  assert.equal(result.lines.length, 64);
});

test('WeSing online fallback reads source and smart-match preferences for every request', async () => {
  let preferences = { preferredPlatform: 'netease', smartMatch: false };
  const requestedPlatforms = [];
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService: createTrackingLyricsService(requestedPlatforms),
    getPreferences: () => preferences
  });

  await resolve({ title: '失控', durationMs: 255000 });
  assert.deepEqual(requestedPlatforms, ['netease']);

  preferences = { preferredPlatform: 'qq', smartMatch: 'false' };
  requestedPlatforms.length = 0;
  await resolve({ title: '失控', durationMs: 255000 });
  assert.deepEqual(requestedPlatforms, ['qq']);
});

test('WeSing smart lyric matching uses the preferred provider for equal results', async () => {
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService: createTrackingLyricsService([]),
    getPreferences: () => ({ preferredPlatform: 'netease', smartMatch: true })
  });

  const result = await resolve({ title: '失控', durationMs: 255000 });

  assert.equal(result.source, 'netease');
});

test('WeSing smart lyric matching keeps the available provider when the other one fails', async () => {
  const requestedPlatforms = [];
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService: createTrackingLyricsService(requestedPlatforms, { failingPlatform: 'qq' }),
    getPreferences: () => ({ preferredPlatform: 'qq', smartMatch: true })
  });

  const result = await resolve({ title: '失控', durationMs: 255000 });

  assert.deepEqual(requestedPlatforms.sort(), ['netease', 'qq']);
  assert.equal(result.source, 'netease');
});

test('WeSing lyric source rejects unknown stored values by falling back to NetEase', async () => {
  const requestedPlatforms = [];
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService: createTrackingLyricsService(requestedPlatforms),
    getPreferences: () => ({ preferredPlatform: 'https://example.test', smartMatch: false })
  });

  await resolve({ title: '失控', durationMs: 255000 });

  assert.deepEqual(requestedPlatforms, ['netease']);
});

test('WeSing lyric preferences default to NetEase smart matching and are injected dynamically', () => {
  assert.equal(DEFAULT_SETTINGS.weSingLyricSource, 'netease');
  assert.equal(DEFAULT_SETTINGS.weSingSmartLyricMatch, 'true');

  const runtimeSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'server', 'music-runtime.js'),
    'utf8'
  );
  assert.match(runtimeSource, /getPreferences\(\)\s*\{/);
  assert.match(runtimeSource, /const settings = settingsStore\.getSettings\(\)/);
  assert.match(runtimeSource, /preferredPlatform:\s*settings\.weSingLyricSource/);
  assert.match(runtimeSource, /smartMatch:\s*settings\.weSingSmartLyricMatch/);
});

function createTrackingLyricsService(requestedPlatforms, options = {}) {
  return {
    async searchMusicTracks(_registry, body) {
      requestedPlatforms.push(body.platform);
      if (body.platform === options.failingPlatform) throw new Error(`${body.platform} unavailable`);
      return {
        tracks: [createTrack(`${body.platform}:original`, '井迪', 255000, body.platform)]
      };
    },
    async getMusicTrackLyrics(_registry, body) {
      return {
        source: body.track.source,
        lines: [{
          startMs: 1000,
          endMs: 2000,
          text: '请原谅我的词穷',
          words: [{ text: '请', startMs: 1000, endMs: 1200 }]
        }]
      };
    }
  };
}

function createTrack(id, artist, durationMs, source = 'qq') {
  return {
    id,
    sourceTrackId: id,
    sourceSongId: source === 'qq' ? 123 : 0,
    source,
    title: '失控',
    artists: [artist],
    album: '失控',
    durationMs
  };
}
