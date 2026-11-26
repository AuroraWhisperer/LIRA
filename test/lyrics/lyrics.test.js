'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { parseLyricResult, parseWordLyric } = require('../../src/music/lyric-parser');
const { createLyricsService } = require('../../src/music/lyrics-service');
const { createExternalClientLyricResolver } = require('../../src/music/external-client-lyrics');
const { NeteaseMusicProvider } = require('../../src/music/providers/netease-provider');
const { QQMusicProvider } = require('../../src/music/providers/qq-provider');
const { musicCacheKey, writeMusicJsonCache, clearMusicCache, getMusicCacheStats } = require('../../src/music/music-cache');
const { resolveMusicStream } = require('../../src/music/stream-resolver');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { loadModuleExports } = require('../helpers/frontend-modules');

test('music cache reconciles external additions within its byte budget', (t) => {
  const directory = createScratchDirectory('music-cache-inventory-', t);
  for (let i = 0; i < 100; i++) fs.writeFileSync(path.join(directory, `${i}.json`), '{}');
  for (let i = 0; i < 20; i++) writeMusicJsonCache(directory, `new-${i}`, { text: 'lyric' });
  fs.writeFileSync(path.join(directory, 'external.json'), 'x'.repeat(10000));
  writeMusicJsonCache(directory, 'last', { text: 'last' }, 500);
  const bytes = fs.readdirSync(directory).reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
  assert.ok(bytes <= 500);
});

test('music cache reconciles file events and closes watchers on clear without stale callback interference', (t) => {
  const api = createScratchDirectory('music-cache-events-', t);
  const lyrics = createScratchDirectory('music-cache-clear-', t);
  const watchers = [];
  t.mock.method(fs, 'watch', (_directory, options, callback) => {
    assert.equal(options.persistent, false);
    const watcher = { callback, closed: false, on(_event, handler) { this.error = handler; }, close() { this.closed = true; } };
    watchers.push(watcher);
    return watcher;
  });
  writeMusicJsonCache(api, 'external', { text: 'short' });
  const first = watchers[0];
  fs.writeFileSync(path.join(api, 'external.json'), 'x'.repeat(10000));
  first.callback('change', 'external.json');
  writeMusicJsonCache(api, 'fresh', { text: 'new' }, 500);
  assert.equal(first.closed, true, 'budget reconciliation closes its old watcher');
  assert.ok(getMusicCacheStats(api, lyrics).totalBytes <= 500);
  writeMusicJsonCache(api, 'fresh', { text: 'newer' });
  const current = watchers.at(-1);
  first.error(new Error('late callback'));
  assert.equal(current.closed, false);
  writeMusicJsonCache(lyrics, 'lyric', { text: 'lyric' });
  clearMusicCache(api, lyrics);
  assert.ok(watchers.every(watcher => watcher.closed));
  assert.equal(getMusicCacheStats(api, lyrics).totalBytes, 0);
});

test('music cache keeps files within its byte limit and evicts the oldest files above it', (t) => {
  const directory = createScratchDirectory('music-cache-budget-', t);
  const data = { lines: ['Synthetic lyric'] };
  const oldPath = path.join(directory, 'old.json');
  const recentPath = path.join(directory, 'recent.json');
  const newestPath = path.join(directory, 'newest.json');
  writeMusicJsonCache(directory, 'old', data);
  fs.utimesSync(oldPath, new Date(1000), new Date(1000));
  writeMusicJsonCache(directory, 'recent', data);
  assert.equal(fs.existsSync(oldPath), true);
  fs.utimesSync(recentPath, new Date(2000), new Date(2000));
  const oneFileBytes = fs.statSync(recentPath).size;
  writeMusicJsonCache(directory, 'newest', data, oneFileBytes);
  assert.equal(fs.existsSync(oldPath), false);
  assert.equal(fs.existsSync(recentPath), false);
  assert.equal(fs.statSync(newestPath).size, oneFileBytes);
  assert.equal(fs.readdirSync(directory).length, 1);
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

test('QQ suffix timing keeps literal parentheses and their word interval', () => {
  const [line] = parseWordLyric('[200,700]one (200,200)(aside) (400,200)end(600,300)');
  assert.equal(line.text, 'one (aside) end');
  assert.deepEqual(line.words[1], { text: '(aside) ', startMs: 400, endMs: 600 });
});

test('word lyric fallback finishes for long missing or malformed timing markers', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { parseWordLyric, parseLyricResult } = require(${JSON.stringify(require.resolve('../../src/music/lyric-parser'))});
    const missing = '[1000,2000]' + 'x'.repeat(256 * 1024);
    assert.equal(parseWordLyric(missing).length, 0);
    assert.equal(parseWordLyric('[1000,2000]' + 'text(1,invalid)'.repeat(16000)).length, 0);
    assert.equal(parseLyricResult('[00:01]original', missing)[0].translation, '');
  `], { encoding: 'utf8', timeout: 3000, windowsHide: true });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('lyric expansion keeps ordinary repeated lines and rejects excessive expanded output', () => {
  const normal = parseLyricResult('[00:01][00:02]chorus');
  assert.equal(normal.length, 2);
  assert.equal(normal[1].text, 'chorus');
  const overText = '[00:01]'.repeat(512) + 'x'.repeat(4096);
  assert.throws(() => parseLyricResult(overText), { code: 'LYRIC_EXPANSION_LIMIT', statusCode: 400 });
  const overLines = '[00:01]x\n'.repeat(4097);
  assert.throws(() => parseLyricResult(overLines), { code: 'LYRIC_EXPANSION_LIMIT' });
  assert.throws(() => parseLyricResult('[00:01]'.repeat(512) + 'x', '[00:01]' + '译'.repeat(4096)),
    { code: 'LYRIC_EXPANSION_LIMIT' });
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

test('rounded LRC rows only take words from their own nearby QRC row', () => {
  const lines = parseLyricResult('[00:01.230]甲\n[00:01.231]甲\n[00:02.23]乙\n[00:03.23]丙', '',
    '[1234,100]甲(1234,100)\n[2234,100]别(2234,100)\n[3434,100]丙(3434,100)');
  assert.deepEqual(lines.map(line => line.words.map(word => word.startMs)), [[], [1234], [], []]);
  const limits = parseLyricResult('[00:01]甲\n[00:02]乙', '', '[1100,50]甲(1100,50)\n[2101,50]乙(2101,50)');
  assert.deepEqual(limits.map(line => line.words.length), [1, 0]);
});

test('rounded word timing stays empty when either direction has equidistant rows', () => {
  const lines = parseLyricResult('[00:01]甲\n[00:01.980]乙\n[00:02.020]乙', '',
    '[980,50]甲(980,50)\n[1020,50]甲(1020,50)\n[2000,50]乙(2000,50)');
  assert.deepEqual(lines.map(line => line.words.length), [0, 0, 0]);
});

test('simultaneous lyric rows keep their own words at exact and rounded times', () => {
  const qrc = '[1000,200]左(1000,200)\n[1000,150]右(1050,100)';
  for (const stamp of ['01.000', '00.996']) {
    const lines = parseLyricResult(`[00:${stamp}]右\n[00:${stamp}]左\n[00:${stamp}]合`, '', qrc);
    const words = Object.fromEntries(lines.map(line => [line.text, line.words.map(word => word.startMs)]));
    assert.deepEqual(words, { 右: [1050], 左: [1000], 合: [] });
  }
  const wordsOnly = parseLyricResult('', '', qrc);
  assert.deepEqual(wordsOnly.map(line => line.words[0].text), ['左', '右']);
  const indistinguishable = parseLyricResult('[00:01]同', '', '[1000,200]同(1000,200)\n[1000,150]同(1050,100)');
  assert.deepEqual(indistinguishable[0].words, []);
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
    lyricCacheDir: path.join(cacheRoot, 'lyrics'),
  });

  await lyricsService.getMusicTrackLyrics(registry, { track });
  await resolveMusicStream(registry, track);

  assert.equal(lyricTrack.sourceSongId, 563728446);
  assert.equal(lyricTrack.sourceSongType, 1);
  assert.equal(streamTrack.sourceSongId, 563728446);
  assert.equal(streamTrack.sourceSongType, 1);
});

test('concurrent lyric misses share only the current account request and leave failures retryable', async (t) => {
  const lyricCacheDir = createScratchDirectory('lyrics-in-flight-', t);
  const service = createLyricsService({ lyricCacheDir });
  const track = { source: 'qq', sourceTrackId: 'mid', sourceSongId: 123, title: 'Test song' };
  let revision = 1, revisionReads = 0;
  const pending = [];
  const provider = { getLyrics() {
    const request = Promise.withResolvers();
    pending.push(request);
    return request.promise;
  } };
  const registry = { get: () => provider, getAuthorizationRevision: () => { revisionReads++; return revision; } };
  const fetch = () => service.getMusicTrackLyrics(registry, { track });
  const old = [fetch(), fetch()];
  await t.waitFor(() => assert.deepEqual([pending.length, revisionReads], [1, 2]));
  revision++;
  const current = fetch();
  await t.waitFor(() => assert.equal(pending.length, 2));
  pending[0].resolve({ lines: [{ text: 'old' }] });
  const [first, shared] = await Promise.all(old);
  shared.lines[0].text = '';
  assert.equal(first.lines[0].text, 'old');
  pending[1].reject(new Error('retry'));
  await assert.rejects(current, /retry/);
  const retry = fetch();
  await t.waitFor(() => assert.equal(pending.length, 3));
  pending[2].resolve({ lines: [] });
  assert.equal((await retry).lines.length, 0);
  const last = fetch();
  await t.waitFor(() => assert.equal(pending.length, 4));
  pending[3].resolve({ lines: [{ text: 'current' }] });
  await last;
  assert.equal((await fetch()).lines[0].text, 'current');
  assert.equal(pending.length, 4);
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

test('both providers replace obsolete cached word timing once', async (t) => {
  const lyricCacheDir = createScratchDirectory('netease-word-cache-', t);
  const service = createLyricsService({ lyricCacheDir });
  for (const source of ['qq', 'netease']) {
    const track = { id: `${source}:123`, source, sourceTrackId: '123', title: 'Synthetic song' };
    const oldVersions = source === 'netease' ? ['lyrics-v6'] : ['lyrics-v5', 'lyrics-v6'];
    for (const version of oldVersions) {
      writeMusicJsonCache(lyricCacheDir, musicCacheKey(version, { source, sourceTrackId: '123' }), {
        source, sourceTrackId: '123', lines: [{ startMs: 1000, text: '示例', words: [] }],
      });
    }
    let calls = 0;
    const registry = { get: () => ({ getLyrics: async () => {
      calls++;
      return { source, sourceTrackId: '123', lines: [{ startMs: 1000, text: '示例', words: [
        { startMs: 1000, endMs: 1500, text: '示' }, { startMs: 1500, endMs: 2000, text: '例' },
      ] }] };
    } }) };
    const first = await service.getMusicTrackLyrics(registry, { track });
    const second = await service.getMusicTrackLyrics(registry, { track });
    assert.equal(calls, 1);
    assert.equal(first.lines[0].words.length, 2);
    assert.deepEqual(second.lines, first.lines);
  }
});

function seedLegacyLyrics(directory, version, { source, sourceTrackId }, lines) {
  const key = musicCacheKey(version, { source, sourceTrackId });
  writeMusicJsonCache(directory, key, { source, sourceTrackId, lines });
  return path.join(directory, `${key}.json`);
}

test('QQ keeps offline v5 text until a fresh QRC can resolve simultaneous parts', async (t) => {
  const directory = createScratchDirectory('lyrics-qq-upgrade-', t);
  const service = createLyricsService({ lyricCacheDir: directory });
  const track = { source: 'qq', sourceTrackId: 'mid', sourceSongId: 12, title: '合成对唱' };
  // The v5 timestamp index attached the right part's words to both rows.
  const wrongWords = [{ startMs: 1050, endMs: 1170, text: '右' }];
  seedLegacyLyrics(directory, 'lyrics-v5', track, [
    { startMs: 1000, text: '右', words: wrongWords },
    { startMs: 1000, text: '左', words: wrongWords },
  ]);
  const provider = new QQMusicProvider();
  const registry = { get: () => provider };
  const read = () => service.getMusicTrackLyrics(registry, { track });
  const offline = Object.assign(new Error('connection unavailable'), { code: 'ENETUNREACH' });
  provider.requestMusicu = async () => { throw offline; };
  provider.requestJson = async () => { throw offline; };
  const fallback = await read();
  assert.equal(fallback.cached, true);
  assert.deepEqual(fallback.lines.map(line => [line.startMs, line.text, line.words]), [[1000, '右', []], [1000, '左', []]]);

  // Even with the rich endpoint offline, denial or cancellation on the legacy endpoint must reach the caller.
  for (const error of [new Error('HTTP 403'), new DOMException('cancelled', 'AbortError')]) {
    provider.requestJson = async () => { throw error; };
    await assert.rejects(read());
  }
  const b64 = text => Buffer.from(text).toString('base64');
  let onlineReads = 0;
  provider.requestMusicu = async () => {
    onlineReads++;
    return { code: 0, req_0: { code: 0, data: { lyric: b64('[00:01]左\n[00:01]右'),
      qrc: b64('[1000,200]左(1000,200)\n[1000,170]右(1050,120)') } } };
  };
  const fresh = await read();
  assert.deepEqual(Object.fromEntries(fresh.lines.map(line => [line.text, line.words[0].startMs])), { 左: 1000, 右: 1050 });
  assert.equal((await read()).cached, true);
  assert.equal(onlineReads, 1);
});

test('QQ reads v6 as plain text ahead of v5 while v6 is fresh', async (t) => {
  const directory = createScratchDirectory('lyrics-qq-v6-upgrade-', t);
  const track = { source: 'qq', sourceTrackId: 'mid', sourceSongId: 12, title: '合成曲' };
  // v6 picked the later of two QRC rows at 980 and 1020 ms for the 1000 ms LRC row.
  const v6 = seedLegacyLyrics(directory, 'lyrics-v6', track, [
    { startMs: 1000, endMs: 60000, text: '同', translation: 'Start', roma: 'qi dian',
      words: [{ startMs: 1020, endMs: 1070, text: '同' }] },
    { startMs: 60000, text: '尾声', words: [{ startMs: 60020, endMs: 60370, text: '尾' },
      { startMs: 60370, endMs: 60700, text: '声' }] },
  ]);
  const service = createLyricsService({ lyricCacheDir: directory });
  const provider = new QQMusicProvider();
  const fail = async () => { throw Object.assign(new Error('connection unavailable'), { code: 'ENETUNREACH' }); };
  provider.requestMusicu = fail;
  provider.requestJson = fail;
  const registry = { get: () => provider };
  const read = () => service.getMusicTrackLyrics(registry, { track });
  const now = Math.ceil(fs.statSync(v6).mtimeMs);
  t.mock.method(Date, 'now', () => now);
  const v6Only = await read();
  assert.deepEqual(v6Only.lines.map(line => [line.startMs, line.text, line.words]), [[1000, '同', []], [60000, '尾声', []]]);
  seedLegacyLyrics(directory, 'lyrics-v5', track, [{ startMs: 500, text: '早期正文', words: [] }]);
  assert.equal((await read()).lines[0].text, '同');
  const expired = new Date(now - 31 * 86400000);
  fs.utimesSync(v6, expired, expired);
  assert.equal((await read()).lines[0].text, '早期正文');
});

test('NetEase v6 offline text follows each caller’s duration and yields to fresh YRC', async (t) => {
  const directory = createScratchDirectory('lyrics-netease-upgrade-', t);
  const service = createLyricsService({ lyricCacheDir: directory });
  const track = { id: 'netease:123', source: 'netease', sourceTrackId: '123', title: '合成曲', durationMs: 90000 };
  seedLegacyLyrics(directory, 'lyrics-v6', track, [
    { startMs: 1000, endMs: 60000, text: '起点', translation: 'Start', roma: 'qi dian',
      words: [{ text: '起', startMs: 1000, endMs: 30500 }, { text: '点', startMs: 30500, endMs: 60000 }] },
    { startMs: 60000, endMs: 61000, text: '尾声',
      words: [{ text: '尾', startMs: 60000, endMs: 60500 }, { text: '声', startMs: 60500, endMs: 61000 }] },
  ]);
  const provider = new NeteaseMusicProvider();
  const registry = { get: () => provider };
  const { LyricService } = await loadModuleExports(
    path.resolve(__dirname, '../../public/js/playback/services/lyric-service.js'),
    { fetch: async (_url, options) => {
      const data = await service.getMusicTrackLyrics(registry, JSON.parse(options.body));
      return Response.json({ ok: true, data });
    } },
  );
  const player = new LyricService();
  provider.requestJson = async () => {
    throw new TypeError('fetch failed', { cause: Object.assign(new Error('connection unavailable'), { code: 'ENETUNREACH' }) });
  };
  const longerTrack = { ...track, durationMs: 93000 };
  for (const caller of [track, longerTrack]) {
    const result = await player.loadLyrics(caller);
    caller.lyrics = result;
    assert.equal(result.cached, true);
    assert.deepEqual(result.lines.map(line => [line.startMs, line.text]), [[1000, '起点'], [60000, '尾声']]);
    assert.deepEqual([result.lines[0].translation, result.lines[0].roma], ['Start', 'qi dian']);
    assert.equal(result.lines.at(-1).endMs, caller.durationMs);
    assert.ok(result.lines.every(line => line.words.length === 0));
  }
  let onlineReads = 0;
  provider.requestJson = async () => {
    onlineReads++;
    return { yrc: { lyric: '[60000,1700](60040,750,0)新(60810,890,0)词' } };
  };
  const fresh = await player.loadLyrics(track);
  assert.equal(fresh.lines[0].text, '新词');
  assert.deepEqual(fresh.lines[0].words.map(word => word.startMs), [60040, 60810]);
  assert.equal((await player.loadLyrics(longerTrack)).lines[0].endMs, 61700);
  assert.equal(onlineReads, 1);
});

test('legacy lyrics respect authorization changes, authoritative empty results and the disk TTL', async (t) => {
  const directory = createScratchDirectory('lyrics-upgrade-boundary-', t);
  const service = createLyricsService({ lyricCacheDir: directory });
  const track = { source: 'netease', sourceTrackId: '123', title: '合成曲' };
  const file = seedLegacyLyrics(directory, 'lyrics-v6', track, [{ startMs: 1000, text: '正文', words: [] }]);
  const offline = Object.assign(new Error('connection unavailable'), { code: 'ENETUNREACH' });
  let revision = 1;
  const provider = new NeteaseMusicProvider();
  const registry = { get: () => provider, getAuthorizationRevision: () => revision };
  const read = () => service.getMusicTrackLyrics(registry, { track });
  provider.requestJson = async () => { revision++; throw offline; };
  await assert.rejects(read(), error => error === offline);
  provider.requestJson = async () => ({ lrc: { lyric: '' } });
  assert.deepEqual((await read()).lines, []);
  const afterTtl = fs.statSync(file).mtimeMs + 31 * 86400000;
  t.mock.method(Date, 'now', () => afterTtl);
  provider.requestJson = async () => { throw offline; };
  await assert.rejects(read(), error => error === offline);
});

test('a NetEase LRC cache warmed without duration cannot shorten an external player’s final line', async (t) => {
  const lyricsService = createLyricsService({ lyricCacheDir: createScratchDirectory('lyrics-duration-', t) });
  const provider = new NeteaseMusicProvider();
  const response = Promise.withResolvers();
  let reads = 0;
  provider.requestJson = async () => {
    if (++reads > 1) throw new Error('offline');
    return response.promise;
  };
  let revisionReads = 0;
  const registry = { get: () => provider, getAuthorizationRevision: () => { revisionReads++; return 1; } };
  const track = { source: 'netease', sourceTrackId: '123', title: '合成曲' };
  const resolve = createExternalClientLyricResolver({ platform: 'netease', getRegistry: () => registry, lyricsService,
    catalogService: { searchMusicTracks: async () => ({ tracks: [track] }) } });
  const requests = Promise.all([lyricsService.getMusicTrackLyrics(registry, { track }), resolve({ ...track, durationMs: 90000 })]);
  await t.waitFor(() => assert.equal(revisionReads, 2));
  response.resolve({ lrc: { lyric: '[00:00]开头\n[01:00]最后一句' } });
  const [early, corrected] = await requests;
  assert.equal(early.lines[0].words.at(-1).endMs, 60000);
  assert.equal(early.lines.at(-1).words.at(-1).endMs, 61200);
  const lastWord = corrected.lines.at(-1).words.at(-1);
  assert.deepEqual([lastWord.startMs, lastWord.endMs], [82500, 90000]);
  const warm = await resolve({ title: track.title, durationMs: 90000 });
  assert.equal(warm.cached, true);
  assert.equal(warm.lines.at(-1).words.at(-1).endMs, 90000);
  assert.equal(reads, 1);
});
