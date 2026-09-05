'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

test('Playwright remains available only as a development dependency', () => {
  assert.equal(pkg.dependencies.playwright, undefined);
  assert.ok(pkg.devDependencies.playwright);
  assert.equal(lock.packages[''].dependencies.playwright, undefined);
  assert.equal(lock.packages[''].devDependencies.playwright, pkg.devDependencies.playwright);
  assert.equal(lock.packages['node_modules/playwright'].dev, true);
  assert.equal(lock.packages['node_modules/playwright-core'].dev, true);
});

test('packaging excludes opening samples and only the converted PNG groups', async () => {
  assert.ok(pkg.build.files.includes('!public/img/overlays/opening/**/*'));
  for (const directory of [
    'public/img/overlays/gift-frame/woodland-bloom',
    'public/img/overlays/danmaku-ranked',
    'public/img/overlays/danmaku-guard',
  ]) {
    assert.ok(pkg.build.files.includes(`!${directory}/*.png`));
    const sourceDir = path.resolve(__dirname, '..', directory);
    for (const name of await fs.readdir(sourceDir)) {
      if (!name.endsWith('.png')) continue;
      await fs.access(path.join(sourceDir, `${path.parse(name).name}.webp`));
    }
  }
});

test('afterPack removes only the default example and tolerates prior cleanup', async (t) => {
  assert.equal(typeof pkg.build.afterPack, 'string');
  const afterPack = require(path.resolve(__dirname, '..', pkg.build.afterPack));
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-packaging-scope-'));
  t.after(() => fs.rm(appOutDir, { recursive: true, force: true }));
  const resourcesDir = path.join(appOutDir, 'resources');
  await fs.mkdir(resourcesDir);
  await fs.writeFile(path.join(resourcesDir, 'default_app.asar'), 'example');
  await fs.writeFile(path.join(resourcesDir, 'app.asar'), 'application');
  await fs.writeFile(path.join(resourcesDir, 'app-update.yml'), 'updater');
  const context = {
    appOutDir,
    packager: {
      getResourcesDir(directory) {
        assert.equal(directory, appOutDir);
        return resourcesDir;
      },
    },
  };

  await afterPack(context);
  assert.deepEqual((await fs.readdir(resourcesDir)).sort(), ['app-update.yml', 'app.asar']);
  assert.equal(await fs.readFile(path.join(resourcesDir, 'app.asar'), 'utf8'), 'application');
  assert.equal(await fs.readFile(path.join(resourcesDir, 'app-update.yml'), 'utf8'), 'updater');
  await afterPack(context);
  assert.deepEqual((await fs.readdir(resourcesDir)).sort(), ['app-update.yml', 'app.asar']);
});
