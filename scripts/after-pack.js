'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = async function afterPack(context) {
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  await fs.rm(path.join(resourcesDir, 'default_app.asar'), { force: true });
};
