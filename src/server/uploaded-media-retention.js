'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pruneManagedFiles, isOwnedDirectory } = require('../shared/file-retention');
const { activeImports } = require('../storage/component-style-files');
const { collectStyleReferences } = require('./component-library-maintenance');
const { AUDIO_EXTENSIONS, CHARACTER_EXTENSIONS } = require('./opening-contract');
const { visitLocalAssetReferences } = require('./local-asset-references');

const DAY_MS = 86400000;
const lastChecks = new Map();
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const mediaKinds = [
  ['scene-text-images', new RegExp(`^(${uuid})\\.(?:png|jpg|gif|webp)$`)],
  ['opening-music', new RegExp(`^opening-\\d+-(${uuid})(\\.[a-z0-9]+)$`), AUDIO_EXTENSIONS],
  ['opening-character', new RegExp(`^opening-character-\\d+-(${uuid})(\\.[a-z0-9]+)$`), CHARACTER_EXTENSIONS],
];

function pruneUploadedMedia(context, now = Date.now()) {
  if (!context.scenes?.visitAssetReferences || !context.componentPreviews?.visitAssetReferences
    || !context.settings?.get || !context.system?.dataDir) return;
  const root = path.resolve(context.system.dataDir);
  const previous = lastChecks.get(root);
  if (previous !== undefined && now >= previous && now - previous < 3600000) return;
  if (lastChecks.size >= 8) lastChecks.delete(lastChecks.keys().next().value);
  lastChecks.set(root, now);
  try {
    const references = new Set();
    visitLocalAssetReferences(context, value => collectStyleReferences(value, references));
    for (const [name, pattern, extensions] of mediaKinds) {
      const directory = path.join(root, name);
      if (!isOwnedDirectory(root, directory)) continue;
      const matches = filename => {
        const match = pattern.exec(filename);
        return Boolean(match && (!extensions || extensions.has(match[2])));
      };
      const keep = new Set(fs.readdirSync(directory).filter(filename => {
        const match = pattern.exec(filename);
        return match && (references.has(match[1]) || activeImports.has(path.join(directory, filename)));
      }));
      pruneManagedFiles(root, directory, { matches, keep, maxAgeMs: 30 * DAY_MS, refreshKept: true, now });
      pruneManagedFiles(root, directory, { matches: filename => filename.endsWith('.tmp')
        && matches(filename.slice(0, -4)), maxAgeMs: DAY_MS, now });
    }
  } catch {
    // Incomplete references, locked indexes and filesystem failures must preserve user media.
    return;
  }
}

module.exports = { pruneUploadedMedia };
