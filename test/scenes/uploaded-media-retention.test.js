'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createScratchDirectory } = require('../helpers/scratch-directory');
const { pruneUploadedMedia } = require('../../src/server/uploaded-media-retention');
const { beginStyleFileUse, endStyleFileUse } = require('../../src/storage/component-style-files');

function fixture(t) {
  const dataDir = createScratchDirectory('uploaded-media-retention-', t);
  const saved = []; const previews = []; const settings = {};
  const context = { system: { dataDir }, settings: { get: () => settings },
    scenes: { visitAssetReferences: visit => saved.forEach(visit) },
    componentPreviews: { visitAssetReferences: visit => previews.forEach(visit) } };
  const now = Date.now();
  function add(directory, name = `${randomUUID()}.png`, age = 60 * 86400000) {
    const root = path.join(dataDir, directory); fs.mkdirSync(root, { recursive: true });
    const file = path.join(root, name); fs.writeFileSync(file, 'fixture');
    fs.utimesSync(file, new Date(now - age), new Date(now - age));
    return file;
  }
  return { dataDir, context, saved, previews, settings, now, add };
}

test('upload retention keeps saved and unsaved references, active backups and recent uploads while reclaiming old orphans', t => {
  const f = fixture(t);
  const saved = f.add('scene-text-images'); f.saved.push({ source: `/scene-text-images/${path.basename(saved)}` });
  const preview = f.add('scene-text-images'); f.previews.push({ text: path.basename(preview) });
  const backup = f.add('scene-text-images'); beginStyleFileUse(backup); t.after(() => endStyleFileUse(backup));
  const current = f.add('opening-music', `opening-123-${randomUUID()}.mp3`); f.settings.openingPixelAudioFile = path.basename(current);
  const recent = f.add('scene-text-images', undefined, 1000);
  const orphan = f.add('scene-text-images');
  const oldMusic = f.add('opening-music', `opening-123-${randomUUID()}.mp3`);
  const unknown = f.add('opening-music', 'user-backup.mp3');
  pruneUploadedMedia(f.context, f.now);
  for (const file of [saved, preview, backup, current, recent, unknown]) assert.equal(fs.existsSync(file), true);
  for (const file of [orphan, oldMusic]) assert.equal(fs.existsSync(file), false);
  // Losing a reference does not immediately expire a file that was just retained.
  f.saved.length = 0;
  pruneUploadedMedia(f.context, f.now + 3600001);
  assert.equal(fs.existsSync(saved), true);
});

test('unreadable scene references or library indexes prevent upload cleanup', t => {
  const f = fixture(t); const orphan = f.add('scene-text-images');
  f.context.scenes.visitAssetReferences = () => { throw new Error('Cannot decrypt another account'); };
  pruneUploadedMedia(f.context, f.now);
  assert.equal(fs.existsSync(orphan), true);
  f.context.scenes.visitAssetReferences = () => {};
  fs.mkdirSync(path.join(f.dataDir, 'component-library'));
  fs.writeFileSync(path.join(f.dataDir, 'component-library/index.json'), '{damaged');
  pruneUploadedMedia(f.context, f.now + 3600001);
  assert.equal(fs.existsSync(orphan), true);
});
