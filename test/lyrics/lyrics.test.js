'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLyricResult, parseWordLyric } = require('../../src/music/lyric-parser');
const { createLyricsService } = require('../../src/music/lyrics-service');
const { musicCacheKey, writeMusicJsonCache } = require('../../src/music/music-cache');
const { resolveMusicStream } = require('../../src/music/stream-resolver');
const { createScratchDirectory } = require('../helpers/scratch-directory');

test('music cache skips eviction sorting below its exact byte limit and evicts oldest files above it', (t) => {
  const directory = createScratchDirectory('music-cache-budget-', t);
  const data = { lines: ['Synthetic lyric'] };
  const oldPath = path.join(directory, 'old.json');
  const recentPath = path.join(directory, 'recent.json');
  const newestPath = path.join(directory, 'newest.json');
  writeMusicJsonCache(directory, 'old', data);
  fs.utimesSync(oldPath, new Date(1000), new Date(1000));

  const originalSort = Array.prototype.sort;
  const sort = t.mock.fn(originalSort);
  Array.prototype.sort = sort;
  try {
    writeMusicJsonCache(directory, 'recent', data);
    assert.equal(sort.mock.callCount(), 0, 'Files that fit the budget need no eviction ordering.');
    assert.equal(fs.existsSync(oldPath), true);
    fs.utimesSync(recentPath, new Date(2000), new Date(2000));
    const oneFileBytes = fs.statSync(recentPath).size;

    writeMusicJsonCache(directory, 'newest', data, oneFileBytes);
    assert.equal(sort.mock.callCount(), 1);
    assert.equal(fs.existsSync(oldPath), false);
    assert.equal(fs.existsSync(recentPath), false);
    assert.equal(fs.statSync(newestPath).size, oneFileBytes);
    assert.equal(fs.readdirSync(directory).length, 1);
  } finally {
    Array.prototype.sort = originalSort;
  }
});

test('parseWordLyric supports QQ QRC suffix timing', () => {
  const lines = parseWordLyric('[1000,1900]jia (1000,900)yi(1900,1000)\n[4000,1000]bing(4000,1000)');

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, 'jia yi');
  assert.deepEqual(
    lines[0].words.map((word) => word.text),
    ['jia ', 'yi'],
  );
  assert.equal(lines[1].text, 'bing');
});

test('parseLyricResult derives base lines from QRC and aligns alternates within 100ms', () => {
  const result = parseLyricResult(
    '',
    '[00:01.05]翻译一\n[00:04.04]翻译二',
    '[1000,1900]甲(1000,900)乙(1900,1000)\n[4000,1000]丙(4000,1000)',
    '[1001,1900]jia (1001,900)yi(1901,1000)\n[4001,1000]bing(4001,1000)',
  );

  assert.deepEqual(
    result.map((line) => ({
      startMs: line.startMs,
      text: line.text,
      translation: line.translation,
      roma: line.roma,
    })),
    [
      { startMs: 1000, text: '甲乙', translation: '翻译一', roma: 'jia yi' },
      { startMs: 4000, text: '丙', translation: '翻译二', roma: 'bing' },
    ],
  );
});

test('lyric and stream provider calls retain QQ numeric source identifiers', async (t) => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-lyrics-service-'));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));

  let lyricTrack;
  let streamTrack;
  const provider = {
    async getLyrics(track) {
      lyricTrack = track;
      return { source: 'qq', sourceTrackId: track.sourceTrackId, lines: [] };
    },
    async resolvePlayableUrl(track) {
      streamTrack = track;
      return {
        source: 'qq',
        sourceTrackId: track.sourceTrackId,
        url: 'https://example.test/song',
      };
    },
  };
  const registry = {
    get(source) {
      assert.equal(source, 'qq');
      return provider;
    },
  };
  const track = {
    id: 'qq:song-mid',
    source: 'qq',
    sourceTrackId: 'song-mid',
    sourceSongId: 563728446,
    sourceSongType: 1,
    title: 'Example Song',
  };
  const lyricsService = createLyricsService({
    apiCacheDir: path.join(cacheRoot, 'api'),
    lyricCacheDir: path.join(cacheRoot, 'lyrics'),
  });

  await lyricsService.getMusicTrackLyrics(registry, { track });
  await resolveMusicStream(registry, track);

  assert.equal(lyricTrack.sourceSongId, 563728446);
  assert.equal(lyricTrack.sourceSongType, 1);
  assert.equal(streamTrack.sourceSongId, 563728446);
  assert.equal(streamTrack.sourceSongType, 1);
});

test('lyric service ignores incomplete v4 lyric cache entries', async (t) => {
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-lyrics-cache-version-'));
  t.after(() => fs.rmSync(cacheRoot, { recursive: true, force: true }));

  const lyricCacheDir = path.join(cacheRoot, 'lyrics');
  const track = {
    id: 'qq:000w1gfs48CBnw',
    source: 'qq',
    sourceTrackId: '000w1gfs48CBnw',
    title: '해볼래 (试试看)',
  };
  const oldCacheKey = musicCacheKey('lyrics-v4', {
    source: 'qq',
    sourceTrackId: '000w1gfs48CBnw',
  });
  writeMusicJsonCache(lyricCacheDir, oldCacheKey, {
    source: 'qq',
    sourceTrackId: '000w1gfs48CBnw',
    lines: [{ startMs: 1000, text: '원문', translation: '', roma: '' }],
  });

  let providerCalls = 0;
  const registry = {
    get() {
      return {
        async getLyrics() {
          providerCalls += 1;
          return {
            source: 'qq',
            sourceTrackId: '000w1gfs48CBnw',
            lines: [
              {
                startMs: 1000,
                text: '원문',
                translation: '中文译',
                roma: 'romanization',
              },
            ],
          };
        },
      };
    },
  };
  const service = createLyricsService({ lyricCacheDir });

  const result = await service.getMusicTrackLyrics(registry, { track });

  assert.equal(providerCalls, 1);
  assert.equal(result.lines[0].translation, '中文译');
  assert.equal(result.lines[0].roma, 'romanization');
});
