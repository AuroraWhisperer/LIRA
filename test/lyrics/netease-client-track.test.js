'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { parseNeteaseWindowTitle, readNeteaseClientTrack, matchNeteaseRecord } = require('../../src/music/netease-client-track');

const RECORD = { id: 123, name: 'Song - Live', artists: [{ name: 'Artist A' }, { name: 'Artist B' }], duration: 180000 };
const SAMPLE = { windowTitle: 'Song - Live - Artist A/Artist B', durationMs: 179000 };

test('NetEase local record matching requires the full title, artists and compatible duration', () => {
  assert.deepEqual(parseNeteaseWindowTitle(SAMPLE.windowTitle), { title: 'Song - Live', artists: ['Artist A', 'Artist B'] });
  assert.equal(parseNeteaseWindowTitle('网易云音乐'), null);
  assert.equal(parseNeteaseWindowTitle('MediaPlayer - Hidden'), null);
  assert.equal(matchNeteaseRecord(RECORD, SAMPLE).sourceTrackId, '123');
  assert.equal(matchNeteaseRecord(RECORD, { ...SAMPLE, windowTitle: 'Song - Live - Artist A' }), null);
  assert.equal(matchNeteaseRecord(RECORD, { ...SAMPLE, windowTitle: 'Song - Artist A/Artist B' }), null);
  assert.equal(matchNeteaseRecord(RECORD, { ...SAMPLE, durationMs: 210000 }), null);
  assert.equal(matchNeteaseRecord(RECORD, { title: 'Song - Live', artist: 'Artist A / Artist B' }).sourceTrackId, '123');
  assert.equal(matchNeteaseRecord({ ...RECORD, artists: {} }, SAMPLE), null);
});

test('NetEase v3 reads only the latest history row using a read-only connection and never changes the DB', (t) => {
  const localAppData = createScratchDirectory('netease-track-', t);
  const filename = path.join(localAppData, 'NetEase', 'CloudMusic', 'Library', 'webdb.dat');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const writer = new DatabaseSync(filename);
  writer.exec('CREATE TABLE historyTracks (playtime INTEGER, jsonStr TEXT)');
  writer.prepare('INSERT INTO historyTracks VALUES (?, ?)').run(2, JSON.stringify(RECORD));
  writer.prepare('INSERT INTO historyTracks VALUES (?, ?)').run(1, JSON.stringify({ ...RECORD, id: 456 }));
  writer.close();
  const before = fs.readFileSync(filename);
  const options = { localAppData, openDatabase(databasePath, settings) {
    assert.deepEqual(settings, { readOnly: true, timeout: 100 });
    const connection = new DatabaseSync(databasePath, settings);
    assert.throws(() => connection.exec('DELETE FROM historyTracks'), /readonly/);
    return connection;
  } };
  assert.equal(readNeteaseClientTrack(SAMPLE, options).sourceTrackId, '123');
  assert.equal(readNeteaseClientTrack({ windowTitle: 'Other - Artist' }, options), null);
  assert.deepEqual(fs.readFileSync(filename), before);
});

test('NetEase v2 history is a fallback when the DB is unavailable and stale metadata is rejected', (t) => {
  const localAppData = createScratchDirectory('netease-history-', t);
  const filename = path.join(localAppData, 'NetEase', 'CloudMusic', 'webdata', 'file', 'history');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify([{ track: RECORD }]));
  const options = { localAppData, openDatabase() { throw new Error('database unavailable'); } };
  assert.equal(readNeteaseClientTrack(SAMPLE, options).sourceTrackId, '123');
  assert.equal(readNeteaseClientTrack({ windowTitle: 'Old song - Artist' }, options), null);
  fs.writeFileSync(filename, '{');
  assert.equal(readNeteaseClientTrack(SAMPLE, options), null);
});
