'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { encryptQrc } = require('qrc-decoder');
const {
  buildPowerShellMonitorScript,
  createWeSingCapture,
  findLatestSongEntry,
  loadWeSingLyrics,
  normalizeWeSingCachePath,
} = require('../../src/music/wesing-capture');
const { createFixture, qrcXml } = require('../helpers/wesing-capture-fixture');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { resolveWeSingLyrics } = require('../../src/music/wesing-lyric-resolver');

test('WeSing capture facade preserves focused module exports', () => {
  const facade = require('../../src/music/wesing-capture');
  const engine = require('../../src/music/wesing-capture-engine');
  const cache = require('../../src/music/wesing-cache');
  const monitor = require('../../src/music/wesing-monitor');

  assert.equal(facade.createWeSingCapture, engine.createWeSingCapture);
  assert.equal(facade.loadWeSingLyrics, cache.loadWeSingLyrics);
  assert.equal(facade.buildPowerShellMonitorScript, monitor.buildPowerShellMonitorScript);
});

test('WeSing cache parser reads matching UTF-16LE log and decrypts local word-timed QRC', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const entry = await findLatestSongEntry(fixture.cachePath, '测试歌曲');
  assert.deepEqual(entry, {
    mid: fixture.mid,
    songName: '测试歌曲',
    artist: '测试歌手',
  });

  const result = await loadWeSingLyrics({
    cachePath: fixture.cachePath,
    title: '测试歌曲',
  });
  assert.equal(result.songMid, fixture.mid);
  assert.equal(result.title, '测试歌曲');
  assert.deepEqual(result.artists, ['测试歌手']);
  assert.equal(result.durationMs, 5200, 'QRC SaveTime is a save timestamp, not the song duration');
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].text, '你好');
  assert.deepEqual(result.lines[0].words, [
    { text: '你', startMs: 1000, endMs: 1800 },
    { text: '好', startMs: 1800, endMs: 2800 },
  ]);
});

test('WeSing falls back online instead of using a cached different version of the same title', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.appendFileSync(
    path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-1.log'),
    Buffer.from('\r\nevent "StartKSong" payload {"mid":"new-cover","songname":"测试歌曲","singer":"翻唱歌手"}', 'utf16le'),
  );
  const requests = [];
  const onlineLyrics = { source: 'qq', songMid: 'online-cover', artists: ['翻唱歌手'], lines: [] };
  const { result } = await resolveWeSingLyrics({
    cachePath: fixture.cachePath,
    cacheReady: true,
    title: '测试歌曲',
    durationMs: 240000,
    async resolveFallbackLyrics(input) {
      requests.push(input);
      return onlineLyrics;
    },
  });

  assert.equal(result, onlineLyrics);
  assert.deepEqual(requests, [{ title: '测试歌曲', artist: '翻唱歌手', artists: ['翻唱歌手'], durationMs: 240000 }]);
});

test('WeSing log parser ignores title mismatches and unsafe song IDs', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));

  const logPath = path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-2.log');
  fs.writeFileSync(
    logPath,
    Buffer.from('event "StartKSong" payload {"mid":"..\\..\\secret","songname":"测试歌曲"}', 'utf16le'),
  );
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(logPath, future, future);

  assert.equal(await findLatestSongEntry(fixture.cachePath, '另一首歌'), null);
  assert.equal(await findLatestSongEntry(fixture.cachePath, '测试歌曲'), null);
  assert.equal(await loadWeSingLyrics({ cachePath: fixture.cachePath, logEntry: { mid: '../escape' } }), null);
  assert.throws(() => normalizeWeSingCachePath('relative\\WeSingCache'), /绝对路径/);
  assert.throws(() => normalizeWeSingCachePath('C:\\Temp\\OtherFolder'), /WeSingCache/);
});

test('WeSing recovers the newest song record across a log read boundary', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const logPath = path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-1.log');
  const latest = { mid: 'current-cover', songname: '测试歌曲', singername: '翻唱歌手' };
  const padding = '\r\nordinary log entry'.repeat(3000).slice(0, 100 * 1024 / 2 - 40);
  fs.appendFileSync(logPath, Buffer.from(`\r\nevent "StartKSong" payload ${JSON.stringify(latest)}${padding}`, 'utf16le'));

  assert.deepEqual(await findLatestSongEntry(fixture.cachePath, '测试歌曲'), {
    mid: latest.mid, songName: latest.songname, artist: latest.singername,
  });
  fs.appendFileSync(logPath, Buffer.from('\r\nordinary log entry'.repeat(4000), 'utf16le'));
  assert.equal((await findLatestSongEntry(fixture.cachePath, '测试歌曲')).mid, latest.mid);
});

test('WeSing does not reuse an older matching title after a different song starts', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  fs.appendFileSync(path.join(fixture.cachePath, 'Log', 'WeSing', 'WeSing-1.log'),
    Buffer.from('\r\nevent "StartKSong" payload {"mid":"next-song","songname":"下一首歌"}', 'utf16le'));
  assert.equal(await findLatestSongEntry(fixture.cachePath, '测试歌曲'), null);
  assert.deepEqual(await findLatestSongEntry(fixture.cachePath, '下一首歌'), {
    mid: 'next-song', songName: '下一首歌',
  });
});

test('WeSing does not choose between same-title cached renditions without a song ID', async (t) => {
  const fixture = createFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.equal((await loadWeSingLyrics({ cachePath: fixture.cachePath, title: '测试歌曲', logEntry: null })).songMid, fixture.mid);
  const directory = path.join(fixture.cachePath, 'WeSingDL', 'Res', 'another-cover');
  fs.mkdirSync(directory);
  const content = '[ti:测试歌曲]\n[ar:翻唱歌手]\n[1000,1000]翻(1000,500)唱(1500,500)';
  fs.writeFileSync(path.join(directory, 'another-cover.qrc'), Buffer.from(encryptQrc(qrcXml(content)), 'hex'));
  assert.equal(await loadWeSingLyrics({ cachePath: fixture.cachePath, title: '测试歌曲', logEntry: null }), null);
});

test('WeSing cache configuration rejects a missing directory without creating it', async (t) => {
  const root = createScratchDirectory('wesing-missing-cache-');
  const cachePath = path.join(root, 'Tencent', 'WeSing', 'WeSingCache');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const capture = createWeSingCapture({ platform: 'win32' });
  await assert.rejects(capture.setCachePath(cachePath), /未找到全民 K 歌缓存文件/);
  assert.equal(capture.getStatus().cachePath, '');
  assert.equal(fs.existsSync(cachePath), false);
});

test('WeSing serializes directory saves and recovers after an invalid path', async (t) => {
  const root = createScratchDirectory('wesing-order-');
  const firstPath = path.join(root, 'A', 'WeSingCache');
  const lastPath = path.join(root, 'B', 'WeSingCache');
  const pending = Promise.withResolvers();
  for (const directory of [firstPath, lastPath]) {
    fs.mkdirSync(path.join(directory, 'Log', 'WeSing'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'Log', 'WeSing', 'test.log'), 'synthetic cache');
  }
  const readdir = fs.promises.readdir.bind(fs.promises);
  t.mock.method(fs.promises, 'readdir', async (directory, options) => {
    if (directory === path.join(firstPath, 'Log', 'WeSing')) await pending.promise;
    return readdir(directory, options);
  });
  const saved = [];
  const capture = createWeSingCapture({ platform: 'win32', saveCachePath: (value) => saved.push(value) });
  t.after(() => {
    capture.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const first = capture.setCachePath(firstPath);
  const last = capture.setCachePath(lastPath);
  await new Promise(setImmediate);
  assert.deepEqual(saved, []);
  pending.resolve();
  await Promise.all([first, last]);
  assert.deepEqual(saved, [firstPath, lastPath]);
  assert.equal(capture.getStatus().cachePath, lastPath);
  assert.equal(fs.statSync(lastPath).isDirectory(), true);
  await assert.rejects(capture.setCachePath('relative-path'), /绝对路径/);
  assert.equal(capture.getStatus().cachePath, lastPath);
  assert.equal(saved.at(-1), lastPath);
  await capture.setCachePath(firstPath);
  assert.equal(capture.getStatus().cachePath, firstPath);
  assert.equal(saved.at(-1), firstPath);
});

test('WeSing activation keeps monitoring without creating a missing cache directory', async (t) => {
  const root = createScratchDirectory('wesing-initial-cache-');
  const cachePath = path.join(root, 'Tencent', 'WeSing', 'WeSingCache');
  let monitorStarted = false;
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const capture = createWeSingCapture({
    cachePath,
    platform: 'win32',
    monitorFactory() {
      return {
        start() {
          monitorStarted = true;
        },
        stop() {},
      };
    },
  });
  t.after(() => capture.stop());

  const status = await capture.setActive(true);

  assert.equal(status.active, true);
  assert.equal(monitorStarted, true);
  assert.equal(status.cacheReady, false);
  assert.equal(fs.existsSync(cachePath), false);
});

test('unchanged WeSing configuration preserves listeners and does not reset capture state', async (t) => {
  const fixture = createFixture();
  let starts = 0;
  let stops = 0;
  let watchers = 0;
  let closed = 0;
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    monitorFactory: () => ({
      start() {
        starts += 1;
      },
      stop() {
        stops += 1;
      },
    }),
    watchFactory: () => {
      watchers += 1;
      return {
        close() {
          closed += 1;
        },
      };
    },
  });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  await capture.setActive(true);
  const before = capture.getStatus();
  await capture.setCachePath(fixture.cachePath);
  await capture.setLyricOffsetMs(0);
  assert.deepEqual(capture.getStatus(), before);
  assert.deepEqual({ starts, stops, watchers, closed }, { starts: 1, stops: 0, watchers: 1, closed: 0 });
});

test('configuring the initial cache directory still refreshes its readiness', async (t) => {
  const fixture = createFixture();
  const capture = createWeSingCapture({ cachePath: fixture.cachePath, platform: 'win32' });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  assert.equal(capture.getStatus().cacheReady, false);
  assert.equal((await capture.setCachePath(fixture.cachePath)).cacheReady, true);
});

test('a prepared cache directory that disappears is reported unavailable without restarting the monitor', async (t) => {
  const fixture = createFixture();
  let starts = 0;
  let stops = 0;
  const capture = createWeSingCapture({
    cachePath: fixture.cachePath,
    platform: 'win32',
    monitorFactory: () => ({
      start() {
        starts += 1;
      },
      stop() {
        stops += 1;
      },
    }),
    watchFactory: () => ({ close() {} }),
  });
  t.after(() => {
    capture.stop();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });
  await capture.setActive(true);
  const cachePath = path.join(fixture.root, 'missing', 'WeSingCache');
  const logDir = path.join(cachePath, 'Log', 'WeSing');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'test.log'), 'synthetic cache');
  const prepared = await capture.prepareConfiguration({ cachePath });
  fs.rmSync(cachePath, { recursive: true });
  const status = await prepared.apply();
  assert.equal(status.cachePath, cachePath);
  assert.equal(status.cacheReady, false);
  assert.equal(status.active, true);
  assert.deepEqual({ starts, stops }, { starts: 1, stops: 0 });
});

for (const size of [2 ** 31 + 102400, 3 * 2 ** 30, 2 ** 32, 2 ** 32 + 11, 2 ** 33 + 1]) {
  test(`WeSing reads only the UTF-16 tail of a ${size}-byte log`, async (t) => {
    const cachePath = path.join(os.tmpdir(), 'synthetic-large-log', 'WeSingCache');
    const logPath = path.join(cachePath, 'Log', 'WeSing', 'WeSing-large.log');
    const tail = Buffer.from('event "StartKSong" payload {"mid":"large-log","songname":"测试歌曲"}', 'utf16le');
    const allocate = Buffer.alloc;
    let closed = false;
    let reads = 0;
    t.mock.method(fs.promises, 'readdir', async () => [{ name: 'WeSing-large.log', isFile: () => true }]);
    t.mock.method(fs.promises, 'stat', async (file) => {
      assert.equal(file, logPath);
      return { mtimeMs: 1, size };
    });
    t.mock.method(fs.promises, 'open', async (file, flags) => {
      assert.equal(file, logPath);
      assert.equal(flags, 'r');
      return {
        async read(buffer, offset, length, position) {
          reads += 1;
          assert.equal(offset, 0);
          assert.equal(position % 2, 0, 'UTF-16 read starts on a code-unit boundary');
          assert.ok(position >= size - 102401);
          assert.equal(position + length, size);
          tail.copy(buffer);
          return { bytesRead: tail.length };
        },
        async close() {
          closed = true;
        },
      };
    });
    // Intercept the allocation so the failing baseline cannot allocate GiB of memory.
    t.mock.method(Buffer, 'alloc', (length, ...args) => {
      assert.ok(length <= 102401, `tail attempted ${length} bytes`);
      return allocate(length, ...args);
    });
    const entry = await findLatestSongEntry(cachePath, '测试歌曲');
    assert.deepEqual(entry, { mid: 'large-log', songName: '测试歌曲' });
    assert.equal(reads, 1);
    assert.equal(closed, true);
  });
}

test('WeSing bounds backward scanning when a large log has no song record', async (t) => {
  const cachePath = path.join(os.tmpdir(), 'synthetic-missing-record', 'WeSingCache');
  const size = 2 ** 33 + 1;
  let bytes = 0;
  let previousStart = size;
  let closed = false;
  t.mock.method(fs.promises, 'readdir', async () => [{ name: 'WeSing.log', isFile: () => true }]);
  t.mock.method(fs.promises, 'stat', async () => ({ mtimeMs: 1, size }));
  t.mock.method(fs.promises, 'open', async () => ({
    async read(buffer, offset, length, position) {
      assert.equal(position % 2, 0);
      assert.equal(position + length, previousStart);
      assert.ok(length <= 102401);
      previousStart = position;
      bytes += length;
      buffer.fill(Buffer.from('ordinary log entry\r\n', 'utf16le'));
      return { bytesRead: length };
    },
    async close() { closed = true; },
  }));
  assert.equal(await findLatestSongEntry(cachePath, '测试歌曲'), null);
  assert.ok(bytes > 102400 && bytes <= 4 * 1024 * 1024 + 1);
  assert.equal(closed, true);
});
