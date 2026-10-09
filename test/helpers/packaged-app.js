'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createPackage, uncache } = require('@electron/asar');

async function createPackagedApp(t, packages = { '': { name: 'fixture', version: '1.0.0' } }) {
  const scratchDir = path.resolve(__dirname, '../../tmp');
  await fs.mkdir(scratchDir, { recursive: true });
  const appOutDir = await fs.mkdtemp(path.join(scratchDir, 'packaged-app-'));
  t.after(() => fs.rm(appOutDir, { recursive: true, force: true }));
  const sourceDir = path.join(appOutDir, 'source');
  const resourcesDir = path.join(appOutDir, 'resources');
  const archivePath = path.join(resourcesDir, 'app.asar');
  await fs.mkdir(resourcesDir);
  for (const [relative, manifest] of Object.entries(packages)) {
    const directory = path.join(sourceDir, relative);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify(manifest));
  }
  async function pack() {
    await createPackage(sourceDir, archivePath);
    uncache(archivePath);
  }
  await pack();
  return { appOutDir, sourceDir, resourcesDir, archivePath, pack };
}

module.exports = { createPackagedApp };
