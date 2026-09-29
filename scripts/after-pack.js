'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { generatePackagedManifest } = require('./client-integrity-manifest');

module.exports = async function afterPack(context) {
  const publish = context.packager.info?.options?.publish;
  if (publish && publish !== 'never')
    throw new Error(
      'Direct builder publishing is disabled. Use npm run release:win to verify installers before uploading.',
    );
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  await fs.rm(path.join(resourcesDir, 'default_app.asar'), { force: true });
  await generatePackagedManifest(context);
};
