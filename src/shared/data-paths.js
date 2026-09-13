'use strict';

const path = require('node:path');

function resolveDataPaths(dataDir) {
  const root = path.resolve(dataDir);
  const cacheDir = path.join(root, 'cache');
  return {
    dataDir: root,
    browserDir: path.join(root, 'browser'),
    cacheDir,
    musicApiCacheDir: path.join(cacheDir, 'music-api-cache'),
    musicLyricsCacheDir: path.join(cacheDir, 'music-lyrics-cache'),
    giftImagesDir: path.join(cacheDir, 'overtime-gift-images'),
    giftCatalogPath: path.join(cacheDir, 'overtime-gift-catalog-v2.json'),
    giftAssetsStatePath: path.join(
      cacheDir,
      'overtime-gift-assets-state-v2.json',
    ),
    logDir: path.join(path.dirname(root), 'logs'),
    updatesDir: path.join(path.dirname(root), 'updates'),
  };
}

module.exports = { resolveDataPaths };
