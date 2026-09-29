'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const pkg = require('../../package.json');
const lock = require('../../package-lock.json');

test('the runtime window icon survives electron-builder buildResources exclusions', async () => {
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const projectDir = path.resolve(__dirname, '../..');
  const output = path.join(os.tmpdir(), 'lira-icon-matcher-output');
  const matchers = getMainFileMatchers(
    projectDir,
    output,
    (value) => value,
    {},
    {
      info: {
        projectDir,
        buildResourcesDir: path.join(projectDir, pkg.build.directories.buildResources),
        config: pkg.build,
        debugLogger: { isEnabled: false },
      },
    },
    output,
    false,
  );
  const filter = matchers[0].createFilter();
  for (const relative of ['build', 'build/icon.png']) {
    const filename = path.join(projectDir, relative);
    assert.equal(filter(filename, await fs.stat(filename)), true, relative);
  }
  const sourceImage = path.join(projectDir, 'build/icon-source.png');
  assert.equal(filter(sourceImage, await fs.stat(sourceImage)), false);
});

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
    const sourceDir = path.resolve(__dirname, '../..', directory);
    for (const name of await fs.readdir(sourceDir)) {
      if (!name.endsWith('.png')) continue;
      await fs.access(path.join(sourceDir, `${path.parse(name).name}.webp`));
    }
  }
});

test('afterPack removes only the default example and tolerates prior cleanup', async (t) => {
  assert.equal(typeof pkg.build.afterPack, 'string');
  const afterPack = require(path.resolve(__dirname, '../..', pkg.build.afterPack));
  const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-packaging-scope-'));
  t.after(() => fs.rm(appOutDir, { recursive: true, force: true }));
  const resourcesDir = path.join(appOutDir, 'resources');
  await fs.mkdir(resourcesDir);
  await fs.writeFile(path.join(resourcesDir, 'default_app.asar'), 'example');
  await fs.writeFile(path.join(resourcesDir, 'app.asar'), 'application');
  await fs.writeFile(path.join(resourcesDir, 'app-update.yml'), 'updater');
  const context = {
    appOutDir,
    arch: 'x64',
    electronPlatformName: 'win32',
    packager: {
      appInfo: { version: pkg.version },
      getResourcesDir(directory) {
        assert.equal(directory, appOutDir);
        return resourcesDir;
      },
    },
  };

  await afterPack(context);
  assert.deepEqual((await fs.readdir(resourcesDir)).sort(), [
    'app-update.yml',
    'app.asar',
    'client-integrity-manifest.json',
  ]);
  assert.equal(await fs.readFile(path.join(resourcesDir, 'app.asar'), 'utf8'), 'application');
  assert.equal(await fs.readFile(path.join(resourcesDir, 'app-update.yml'), 'utf8'), 'updater');
  await afterPack(context);
  assert.deepEqual((await fs.readdir(resourcesDir)).sort(), [
    'app-update.yml',
    'app.asar',
    'client-integrity-manifest.json',
  ]);
  const before = JSON.parse(await fs.readFile(path.join(resourcesDir, 'client-integrity-manifest.json'), 'utf8'));
  await fs.writeFile(path.join(resourcesDir, 'app.asar'), 'final signed resources');
  await require(path.resolve(__dirname, '../..', pkg.build.afterSign))(context);
  const after = JSON.parse(await fs.readFile(path.join(resourcesDir, 'client-integrity-manifest.json'), 'utf8'));
  assert.notEqual(before.files[0].sha256, after.files[0].sha256);
  assert.equal(after.appVersion, pkg.version);
  assert.equal(after.platform, 'win32');
  assert.equal(after.arch, 'x64');
});

test('all Windows build commands disable direct publishing and share the final installer gate', async () => {
  assert.match(pkg.scripts['dist:win'], /--publish never/);
  assert.match(pkg.scripts['dist:win:local'], /--publish never/);
  assert.equal(pkg.build.artifactBuildCompleted, 'scripts/verify-client-installer.js');
  const afterPack = require('../../scripts/after-pack');
  await assert.rejects(
    afterPack({ packager: { info: { options: { publish: 'always' } } } }),
    /Direct builder publishing is disabled/,
  );
});
