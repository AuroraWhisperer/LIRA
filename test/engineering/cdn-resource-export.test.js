'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');
const yauzl = require('yauzl');
const { collectCdnResources, exportCdnResources } = require('../../scripts/export-cdn-resources');
const { createResourcePackages, packagePath } = require('../../src/resources/resource-packages');

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

test('export merges font files into named ZIPs and keeps images independent without old staging files', async t => {
  const scratch = path.resolve(__dirname, '../../tmp/cdn-export-tests');
  await fs.mkdir(scratch, { recursive: true });
  const directory = await fs.mkdtemp(path.join(scratch, 'export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'public/fonts'), { recursive: true });
  await fs.mkdir(path.join(directory, 'public/img'), { recursive: true });
  await fs.writeFile(path.join(directory, 'public/fonts/test.woff2'), 'font bytes');
  await fs.writeFile(path.join(directory, 'public/fonts/OFL.txt'), 'font license');
  await fs.writeFile(path.join(directory, 'public/img/large.png'), Buffer.alloc(10 * 1024 * 1024 + 1, 7));
  await fs.writeFile(path.join(directory, 'public/img/threshold.png'), Buffer.alloc(10 * 1024 * 1024, 1));
  const oldOutput = path.join(directory, 'tmp/cdn-resources/upload/resources');
  for (const name of ['licenses/OFL.txt', 'objects/old.woff2']) {
    await fs.mkdir(path.dirname(path.join(oldOutput, name)), { recursive: true });
    await fs.writeFile(path.join(oldOutput, name), 'previous export');
  }
  const result = exportCdnResources({ rootDir: directory });
  assert.equal(result.fonts, 1);
  assert.equal(result.images, 1);
  assert.equal(result.downloads, 2);
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, 'utf8'));
  assert.equal(manifest.version, 2);
  const definitions = new Map(createResourcePackages(manifest.files).map(resource => [resource.id, resource]));
  for (const resource of manifest.packages) {
    const definition = definitions.get(resource.id);
    const filename = `resources/${packagePath({ ...definition, sha256: resource.sha256 })}`;
    const bytes = await fs.readFile(path.join(result.uploadDirectory, filename));
    assert.equal(bytes.length, resource.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), resource.sha256);
    if (definition.archive) {
      assert.match(filename, /^resources\/fonts\/直播组件专用字体-[a-f0-9]{12}\.zip$/);
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
    } else assert.match(filename, /^resources\/images\/large-[a-f0-9]{12}\.png$/);
  }
  await assert.rejects(fs.access(path.join(oldOutput, 'licenses')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(oldOutput, 'objects')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(directory, 'public/fonts/OFL.txt'), 'utf8'), 'font license');
  const zip = await yauzl.fromBufferPromise(await fs.readFile(result.archivePath), { lazyEntries: true });
  const names = [];
  try { for await (const entry of zip.eachEntry()) names.push(entry.fileName); } finally { zip.close(); }
  assert.equal(names.length, 3);
  assert.ok(names.includes('resources/manifest.json'));
  assert.equal(names.some(name => name.startsWith('resources/licenses/')), false);
});
