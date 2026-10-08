'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { getMusicDir } = require('../../src/server/opening-media-store');
const { resolveOpeningMediaSlot, saveOpeningMedia } = require('../../src/server/opening-service');

test('failed opening media publication removes the temporary file before any settings write', t => {
  const dataDir = createScratchDirectory('opening-failed-save-', t);
  const failure = new Error('rename failed');
  t.mock.method(fs, 'renameSync', () => { throw failure; });
  const context = {
    system: { dataDir },
    settings: { set() { assert.fail('Failed media must not be selected'); } },
    broadcastSnapshot() { assert.fail('Failed media must not be published'); },
  };
  assert.throws(() => saveOpeningMedia(context, resolveOpeningMediaSlot('music', 'classic'), {
    name: 'opening.mp3', extension: '.mp3', content: Buffer.from('music'),
  }), error => error === failure);
  assert.deepEqual(fs.readdirSync(getMusicDir(dataDir)), []);
});
