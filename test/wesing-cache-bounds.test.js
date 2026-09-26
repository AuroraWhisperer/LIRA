'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { findLatestSongEntry } = require('../src/music/wesing-cache');

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
