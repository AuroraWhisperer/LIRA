'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  markerForKey,
  parseArguments,
  parseStartKSongLine,
  readRunningCachePath,
  summarizeSample
} = require('../scripts/inspect-wesing-playback');

test('WeSing diagnostic parses cache, output, and duration options', () => {
  const result = parseArguments([
    '--cache', 'C:\\Music\\WeSingCache',
    '--output', 'D:\\Logs\\wesing.jsonl',
    '--duration', '90'
  ], {
    environment: { APPDATA: 'C:\\Users\\Tester\\AppData\\Roaming' },
    projectRoot: 'D:\\Work\\Live',
    now: new Date('2026-08-13T10:00:00.000Z')
  });

  assert.equal(result.cachePath, path.resolve('C:\\Music\\WeSingCache'));
  assert.equal(result.outputPath, path.resolve('D:\\Logs\\wesing.jsonl'));
  assert.equal(result.durationMs, 90000);
  assert.equal(result.help, false);
  assert.equal(result.cachePathFromArgument, true);
});

test('WeSing diagnostic rejects invalid duration and unknown options', () => {
  assert.throws(() => parseArguments(['--duration', '0']), /1 到 3600/);
  assert.throws(() => parseArguments(['--unknown']), /未知参数/);
});

test('WeSing diagnostic maps operation markers', () => {
  assert.equal(markerForKey('2'), '点击暂停');
  assert.equal(markerForKey('5'), '重新进入同一首歌 K 歌');
  assert.equal(markerForKey('x'), null);
});

test('WeSing diagnostic reads the configured cache path from the running local app', async () => {
  const requests = [];
  const files = new Map([
    ['D:\\Work\\Live\\data\\.server-runtime.json', '{"port":3000,"host":"127.0.0.1"}'],
    ['D:\\Work\\Live\\data\\.session-token', 'local-token']
  ]);
  const cachePath = await readRunningCachePath({
    projectRoot: 'D:\\Work\\Live',
    environment: {},
    async readFile(filePath) {
      return files.get(filePath);
    },
    async fetchImpl(url, options) {
      requests.push({ url, authorization: options.headers.Authorization });
      return {
        ok: true,
        async json() {
          return { data: { cachePath: 'D:\\WeSingCache' } };
        }
      };
    }
  });

  assert.equal(cachePath, 'D:\\WeSingCache');
  assert.deepEqual(requests, [{
    url: 'http://127.0.0.1:3000/api/music/wesing/status',
    authorization: 'Bearer local-token'
  }]);
});

test('WeSing diagnostic extracts StartKSong identity from native log rows', () => {
  const parsed = parseStartKSongLine(
    'event "StartKSong" payload {"mid":"0042","songname":"失眠飞行"}'
  );
  assert.deepEqual(parsed, { mid: '0042', songName: '失眠飞行' });
  assert.equal(parseStartKSongLine('ordinary row'), null);
});

test('WeSing diagnostic summarizes samples without copying UIA controls', () => {
  const summary = summarizeSample({
    detected: true,
    title: '全民K歌 - 失眠飞行',
    currentSec: -1,
    totalSec: -1,
    audioActive: true,
    audioPeak: 0.125,
    windowHandle: 123,
    processIds: [10, 11],
    controls: [{ name: '暂停' }]
  });

  assert.equal(summary.audioPeak, 0.125);
  assert.equal(summary.windowHandle, 123);
  assert.equal(summary.controlCount, 1);
  assert.equal('controls' in summary, false);
  assert.equal(summarizeSample(null).detected, false);
});
