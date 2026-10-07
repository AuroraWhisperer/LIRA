'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createWeSingOnlineLyricResolver, selectWeSingLyricTrack } = require('../../src/music/wesing-online-lyrics');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');

test('WeSing online lyric matching uses duration to disambiguate same-title songs', () => {
  const selected = selectWeSingLyricTrack('失控', 255000, [
    createTrack('qq:cover', '翻唱歌手', 181000),
    createTrack('qq:original', '井迪', 255000),
  ]);

  assert.equal(selected.id, 'qq:original');
});

test('WeSing online lyric matching uses the WeSing artist to disambiguate covers', async () => {
  const requests = [];
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    platforms: ['qq'],
    lyricsService: {
      async searchMusicTracks(_registry, body) {
        requests.push(body);
        return {
          tracks: [
            createTrack('qq:cover', '翻唱歌手', 255000, 'qq', '同名歌曲'),
            createTrack('qq:original', '正确歌手', 255000, 'qq', '同名歌曲'),
          ],
        };
      },
      async getMusicTrackLyrics() {
        return {
          source: 'qq',
          lines: [{ startMs: 0, endMs: 1000, text: '歌词' }],
        };
      },
    },
    smartMatch: false,
    preferredPlatform: 'qq',
  });

  const result = await resolve({
    title: '同名歌曲',
    artist: '正确歌手',
    durationMs: 255000,
  });

  assert.equal(requests[0].keyword, '同名歌曲 正确歌手');
  assert.equal(result.songMid, 'qq:original');
});

test('WeSing online fallback queries both providers and prefers complete word lyrics', async () => {
  const requestedLyrics = [];
  const lyricsService = {
    async searchMusicTracks(_registry, body) {
      return {
        tracks:
          body.platform === 'qq'
            ? [createTrack('qq:wrong', '翻唱歌手', 181000), createTrack('qq:original', '井迪', 255000)]
            : [createTrack('netease:original', '井迪儿', 255000, 'netease')],
      };
    },
    async getMusicTrackLyrics(_registry, body) {
      requestedLyrics.push(body.track.id);
      const wordTimed = body.track.source === 'qq';
      return {
        source: body.track.source,
        lines: [
          {
            startMs: 1000,
            endMs: 2000,
            text: '请原谅我的词穷',
            words: wordTimed ? [{ text: '请', startMs: 1000, endMs: 1200 }] : [],
          },
        ],
      };
    },
  };
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService,
    preferredPlatform: 'netease',
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
        tracks: [createTrack(`${body.platform}:original`, '井迪', 255000, body.platform)],
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
          words: [{ text: '词', startMs: index * 4000, endMs: index * 4000 + 500 }],
        })),
      };
    },
  };
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService,
    preferredPlatform: 'netease',
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
    getPreferences: () => preferences,
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
    getPreferences: () => ({ preferredPlatform: 'netease', smartMatch: true }),
  });

  const result = await resolve({ title: '失控', durationMs: 255000 });

  assert.equal(result.source, 'netease');
});

test('WeSing smart lyric matching keeps the available provider when the other one fails', async () => {
  const requestedPlatforms = [];
  const resolve = createWeSingOnlineLyricResolver({
    registry: {},
    lyricsService: createTrackingLyricsService(requestedPlatforms, {
      failingPlatform: 'qq',
    }),
    getPreferences: () => ({ preferredPlatform: 'qq', smartMatch: true }),
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
    getPreferences: () => ({
      preferredPlatform: 'https://example.test',
      smartMatch: false,
    }),
  });

  await resolve({ title: '失控', durationMs: 255000 });

  assert.deepEqual(requestedPlatforms, ['netease']);
});

function loadRuntimeCapturingResolver() {
  const Module = require('node:module');
  const originalLoad = Module._load;
  const runtimePath = require.resolve('../../src/server/music-runtime');
  const captured = [];
  try {
    Module._load = function (request, parent, isMain) {
      const loaded = originalLoad.call(this, request, parent, isMain);
      if (request === '../music/wesing-online-lyrics' && parent?.filename === runtimePath) {
        return {
          ...loaded,
          createWeSingOnlineLyricResolver(options) {
            captured.push(options);
            return loaded.createWeSingOnlineLyricResolver(options);
          },
        };
      }
      return loaded;
    };
    delete require.cache[runtimePath];
    return { ...require(runtimePath), captured };
  } finally {
    delete require.cache[runtimePath];
    Module._load = originalLoad;
  }
}

test('WeSing lyric preferences default to NetEase smart matching and are read from current settings', (t) => {
  assert.equal(DEFAULT_SETTINGS.weSingLyricSource, 'netease');
  assert.equal(DEFAULT_SETTINGS.weSingSmartLyricMatch, 'true');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-wesing-preferences-'));
  const { buildMusicRuntime, captured } = loadRuntimeCapturingResolver();
  let settings = { weSingCachePath: '', weSingLyricOffsetMs: '0', weSingLyricSource: 'netease', weSingSmartLyricMatch: 'true' };
  const runtime = buildMusicRuntime({
    dataDir: { apiCacheDir: path.join(dir, 'api'), lyricCacheDir: path.join(dir, 'lyrics') },
    runtimeOptions: { weSingPlatform: 'linux' },
    settingsStore: { getSettings: () => settings, setSetting() {} },
    webSocketHub: { broadcast() {} },
  });
  t.after(() => {
    runtime.weSingCapture.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.equal(captured.length, 1);
  assert.deepEqual({ ...captured[0].getPreferences() }, { preferredPlatform: 'netease', smartMatch: 'true' });
  settings = { ...settings, weSingLyricSource: 'qq', weSingSmartLyricMatch: 'false' };
  assert.deepEqual(
    { ...captured[0].getPreferences() },
    { preferredPlatform: 'qq', smartMatch: 'false' },
    'changed settings apply to the next lyric request without rebuilding the runtime',
  );
});

function createTrackingLyricsService(requestedPlatforms, options = {}) {
  return {
    async searchMusicTracks(_registry, body) {
      requestedPlatforms.push(body.platform);
      if (body.platform === options.failingPlatform) throw new Error(`${body.platform} unavailable`);
      return {
        tracks: [createTrack(`${body.platform}:original`, '井迪', 255000, body.platform)],
      };
    },
    async getMusicTrackLyrics(_registry, body) {
      return {
        source: body.track.source,
        lines: [
          {
            startMs: 1000,
            endMs: 2000,
            text: '请原谅我的词穷',
            words: [{ text: '请', startMs: 1000, endMs: 1200 }],
          },
        ],
      };
    },
  };
}

function createTrack(id, artist, durationMs, source = 'qq', title = '失控') {
  return {
    id,
    sourceTrackId: id,
    sourceSongId: source === 'qq' ? 123 : 0,
    source,
    title,
    artists: [artist],
    album: '失控',
    durationMs,
  };
}
