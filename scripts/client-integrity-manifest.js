'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  MANIFEST_NAME,
  SCOPE,
  MAX_FILES,
  MAX_MANIFEST_BYTES,
  validatePath,
  validateManifest,
  readRaw,
  failure,
} = require('../src/electron/resource-integrity-files');

async function generateManifest({ resourcesDir, appVersion, platform, arch }) {
  const files = ['app.asar'];
  async function walk(relative) {
    const directory = path.join(resourcesDir, relative);
    const stat = await fs.promises.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure('PATH_UNSAFE');
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      validatePath(child);
      if (entry.isSymbolicLink()) throw failure('PATH_UNSAFE');
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
      else throw failure('PATH_UNSAFE');
      if (files.length > MAX_FILES) throw failure('MANIFEST_INVALID');
    }
  }
  try {
    await fs.promises.lstat(path.join(resourcesDir, 'app.asar.unpacked'));
    await walk('app.asar.unpacked');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (fs.existsSync(path.join(resourcesDir, 'app.asar.unpacked'))) throw error;
  }
  const manifest = { schemaVersion: 1, appVersion, platform, arch, scope: SCOPE, algorithm: 'sha256', files: [] };
  for (const relative of files.sort()) {
    const { size, sha256 } = await readRaw(fs, resourcesDir, relative);
    manifest.files.push({ path: relative, size, sha256 });
  }
  validateManifest(manifest, { appVersion, platform, arch });
  const content = JSON.stringify(manifest, null, 2) + String.fromCharCode(10);
  if (Buffer.byteLength(content) > MAX_MANIFEST_BYTES) throw failure('MANIFEST_INVALID');
  const filename = path.join(resourcesDir, MANIFEST_NAME);
  try {
    const stat = await fs.promises.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) throw failure('PATH_UNSAFE');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fs.promises.writeFile(filename, content);
  return manifest;
}

async function generatePackagedManifest(context) {
  const { Arch } = require('builder-util');
  return generateManifest({
    resourcesDir: context.packager.getResourcesDir(context.appOutDir),
    appVersion: context.packager.appInfo.version,
    platform: context.electronPlatformName,
    arch: typeof context.arch === 'string' ? context.arch : Arch[context.arch],
  });
}

module.exports = { generateManifest, generatePackagedManifest };
