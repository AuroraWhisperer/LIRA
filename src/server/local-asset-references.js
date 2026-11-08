'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isOwnedDirectory } = require('../shared/file-retention');
const { createComponentStyleStore } = require('../storage/component-style-store');
const { activeImports } = require('../storage/component-style-files');

function visitLocalAssetReferences(context, visit) {
  if (!context.scenes?.visitAssetReferences || !context.componentPreviews?.visitAssetReferences || !context.settings?.get) {
    throw new Error('Asset references are not ready');
  }
  const root = path.resolve(context.system.dataDir);
  const libraryRoot = path.join(root, 'component-library');
  if ([...activeImports.keys()].some(file => file.startsWith(libraryRoot + path.sep))) {
    throw new Error('Asset import or backup is in progress');
  }
  context.scenes.visitAssetReferences(visit);
  context.componentPreviews.visitAssetReferences(visit);
  visit(context.settings.get());
  if (fs.existsSync(libraryRoot)) {
    if (!isOwnedDirectory(root, libraryRoot)) throw new Error('Unsafe asset library directory');
    visit(createComponentStyleStore(root).read().packages);
  }
}

module.exports = { visitLocalAssetReferences };
