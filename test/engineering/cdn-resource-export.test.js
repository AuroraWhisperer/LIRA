'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const yauzl = require('yauzl');
const { collectCdnResources, exportCdnResources } = require('../../scripts/export-cdn-resources');
const { isLegacyResource, createResourcePackages, packagePath } = require('../../src/resources/resource-packages');
const { fonts } = require('../../src/fonts/catalog.json');

async function resourceFixture(t) {
  const scratch = path.resolve(__dirname, '../../tmp/cdn-export-tests');
  await fs.mkdir(scratch, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratch, 'export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const publicDir = path.join(directory, 'public');
  for (const file of require('../../src/resources/catalog.json').files) {
    const filename = path.join(publicDir, file.path);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, file.path);
  }
  return { directory, publicDir };
}

test('unrelated font binaries and large artwork cannot silently enter the CDN inventory', async t => {
  const { publicDir } = await resourceFixture(t);
  await fs.writeFile(path.join(publicDir, 'fonts/unregistered.woff2'), 'unused font');
  await fs.writeFile(path.join(publicDir, 'img/unreferenced.png'), Buffer.alloc(10 * 1024 * 1024 + 1));
  const actual = collectCdnResources(publicDir);
  assert.equal(actual.some(file => file.path === 'fonts/unregistered.woff2'), false);
  assert.equal(actual.some(file => file.path === 'img/unreferenced.png'), false);
});

test('an export fails when a declared shared resource is absent', async t => {
  const { publicDir } = await resourceFixture(t);
  await fs.unlink(path.join(publicDir, 'img/admin/world-clock/earth-day-8k.png'));
  assert.throws(() => collectCdnResources(publicDir), { code: 'ENOENT' });
});

test('the baseline inventory includes complete fonts and large images while tiny title subsets stay bundled', () => {
  const actual = collectCdnResources(path.resolve(__dirname, '../../public'));
  assert.deepEqual(actual, require('../../src/resources/catalog.json').files);
  for (const name of ['clock-moon-serif-400.woff2', 'guard-thanks-serif-400.woff2'])
    assert.equal(actual.some(file => file.path === `fonts/${name}`), false, name);
  assert.ok(actual.some(file => file.path.startsWith('fonts/')));
  assert.ok(actual.some(file => file.path.startsWith('img/')));
  const packages = createResourcePackages(actual);
  for (const label of ['Nunito', 'Gowun Dodum', 'Noto Sans', 'Noto Serif Tibetan'])
    assert.ok(packages.some(resource => resource.label === label), label);
  assert.equal(packages.some(resource => ['lyric-fallbacks', 'style-fonts'].includes(resource.id)), false);
});

test('startup inventory covers shared fonts and never duplicates imported style imagery', () => {
  const { COMPONENT_RESOURCE_PRESETS } = require('../../public/js/shared/component-resource-style.js');
  const startup = require('../../src/resources/catalog.json').files.filter(file => !isLegacyResource(file.path));
  const sharedFonts = new Set(fonts.flatMap(font => font.bundled.map(file => `fonts/${file.path}`)));
  assert.deepEqual(new Set(startup.filter(file => file.path.startsWith('fonts/')).map(file => file.path)), sharedFonts);
  const importedImages = new Set(Object.values(COMPONENT_RESOURCE_PRESETS).flatMap(preset =>
    [...preset.resources, ...(preset.optionalResources || [])].filter(name => name.startsWith('/img/'))));
  for (const file of startup) assert.equal(importedImages.has(`/${file.path}`), false,
    `${file.path} belongs to an imported style, not every client startup`);
  assert.ok(startup.some(file => file.path === 'img/admin/world-clock/earth-day-8k.png'));
});

test('export preserves named packages and legacy inventory without old staging files', async t => {
  const { directory } = await resourceFixture(t);
  await fs.writeFile(path.join(directory, 'public/fonts/OFL.txt'), 'font license');
  const oldOutput = path.join(directory, 'tmp/cdn-resources/upload/resources');
  for (const name of ['licenses/OFL.txt', 'objects/old.woff2']) {
    await fs.mkdir(path.dirname(path.join(oldOutput, name)), { recursive: true });
    await fs.writeFile(path.join(oldOutput, name), 'previous export');
  }
  const result = exportCdnResources({ rootDir: directory });
  assert.equal(result.fonts, new Set(fonts.flatMap(font => font.bundled.map(file => file.path))).size);
  assert.equal(result.images, 4, 'The export retains three images required by released clients.');
  assert.equal(result.downloads, fonts.length + 4);
  assert.equal(result.startupDownloads, fonts.length + 1);
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.version, 2);
  const legacyPackages = manifest.packages.filter(resource => resource.id.startsWith('img/overlays/guard-nautical/'));
  assert.equal(legacyPackages.length, 3);
  assert.equal(result.compatibilityDownloadBytes, legacyPackages.reduce((sum, resource) => sum + resource.size, 0));
  assert.equal(result.startupDownloadBytes + result.compatibilityDownloadBytes,
    manifest.packages.reduce((sum, resource) => sum + resource.size, 0));
  const definitions = new Map(createResourcePackages(manifest.files).map(resource => [resource.id, resource]));
  for (const resource of manifest.packages) {
    const definition = definitions.get(resource.id);
    const filename = `resources/${packagePath({ ...definition, sha256: resource.sha256 })}`;
    const bytes = await fs.readFile(path.join(result.uploadDirectory, filename));
    assert.equal(bytes.length, resource.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256);
    if (definition.archive) {
      assert.match(filename, /^resources\/fonts\/.+-[a-f0-9]{12}\.zip$/);
      const fontZip = await yauzl.fromBufferPromise(bytes, { lazyEntries: true });
      const members = [];
      try {
        for await (const entry of fontZip.eachEntry()) {
          const chunks = [];
          for await (const chunk of await fontZip.openReadStreamPromise(entry)) chunks.push(chunk);
          assert.deepEqual(Buffer.concat(chunks), await fs.readFile(path.join(directory, 'public', entry.fileName)));
          members.push(entry.fileName);
        }
      } finally { fontZip.close(); }
      assert.deepEqual(members, resource.files);
    } else assert.match(filename, /^resources\/images\/.+-[a-f0-9]{12}\.(png|webp)$/);
  }
  await assert.rejects(fs.access(path.join(oldOutput, 'licenses')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(oldOutput, 'objects')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(directory, 'public/fonts/OFL.txt'), 'utf8'), 'font license');
  const zip = await yauzl.fromBufferPromise(await fs.readFile(result.archivePath), { lazyEntries: true });
  const names = [];
  try { for await (const entry of zip.eachEntry()) names.push(entry.fileName); } finally { zip.close(); }
  assert.equal(names.length, result.downloads + 1);
  assert.ok(names.includes('resources/manifest.json'));
  assert.equal(names.some(name => name.startsWith('resources/licenses/')), false);
});
