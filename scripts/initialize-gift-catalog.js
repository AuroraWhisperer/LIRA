'use strict';

const path = require('node:path');
const {
  createRemoteGiftCatalogCache,
} = require('../src/bilibili/gift/remote-catalog-cache');
const {
  createRemoteGiftImageCache,
} = require('../src/bilibili/gift/remote-gift-image-cache');
const {
  createGiftCatalogInitializer,
} = require('../src/bilibili/gift/gift-catalog-initializer');
const {
  createRemoteLicenseClient,
} = require('../src/electron/license/remote-license-client');

async function run(options = {}) {
  const dataDir = path.resolve(
    options.dataDir ||
      process.argv[2] ||
      process.env.LIRA_DATA_DIR ||
      path.join(__dirname, '..', 'data'),
  );
  const remote = createRemoteLicenseClient({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });
  const catalog = createRemoteGiftCatalogCache({
    dataDir,
    imageBaseUrl: remote.baseUrl,
    fetchRemote: ({ etag }) => remote.getGiftCatalog(etag),
    logger: options.logger,
  });
  const imageCache = createRemoteGiftImageCache({
    dataDir,
    imageBaseUrl: remote.baseUrl,
    fetch: options.fetchImpl,
    logger: options.logger,
  });
  const initializer = createGiftCatalogInitializer({
    dataDir,
    catalog,
    imageCache,
    logger: options.logger,
  });

  let lastLine = '';
  const unsubscribe = initializer.onStateChanged((state) => {
    const line = formatProgress(state);
    if (line === lastLine) return;
    lastLine = line;
    options.onProgress?.(state);
    if (!options.quiet) process.stdout.write(`\r${line.padEnd(76)}`);
  });
  try {
    const result = await initializer.initialize({
      force: true,
      reason: 'script',
    });
    if (!options.quiet) process.stdout.write('\n');
    return result;
  } finally {
    unsubscribe();
    catalog.stop();
  }
}

function formatProgress(state = {}) {
  if (state.phase === 'catalog') return 'Gift catalog: downloading metadata...';
  if (state.phase === 'images')
    return `Gift images: ${state.completed}/${state.total} (${state.percent}%)`;
  if (state.status === 'ready')
    return `Gift catalog ready: ${state.available}/${state.total} images available`;
  return `Gift catalog initialization failed: ${state.error || 'unknown error'}`;
}

if (require.main === module) {
  run().catch((error) => {
    process.stderr.write(
      `Gift catalog initialization failed: ${error?.message || error}\n`,
    );
    process.exitCode = 1;
  });
}

module.exports = { formatProgress, run };
