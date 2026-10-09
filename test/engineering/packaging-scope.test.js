'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const pkg = require('../../package.json');
const lock = require('../../package-lock.json');
const { createPackagedApp } = require('../helpers/packaged-app');

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

test('Moonlit resources stay out of the EXE while shared assets and trusted renderers remain', async () => {
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const projectDir = path.resolve(__dirname, '../..');
  const output = path.join(projectDir, 'tmp/moonlit-packaging-match');
  const matchers = getMainFileMatchers(projectDir, output, value => value, {}, { info: { projectDir,
    buildResourcesDir: path.join(projectDir, pkg.build.directories.buildResources), config: pkg.build,
    debugLogger: { isEnabled: false } } }, output, false);
  const filter = matchers[0].createFilter();
  let count = 0;
  for (const entry of await fs.readdir(path.join(projectDir, 'public'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const relative = path.relative(projectDir, file).replaceAll('\\', '/');
    if (!/^public\/(img|fonts)\//.test(relative) || !/moonlit|moon-fan|clock-moon-serif/.test(relative)) continue;
    count++; assert.equal(filter(file, await fs.stat(file)), false, relative);
  }
  assert.ok(count >= 35);
  for (const relative of ['public/fonts/guard-thanks-serif-400.woff2', 'public/js/overlays/opening-moon-fan.js',
    'public/css/overlays/clock/moonlit-fan.css', 'public/img/overlays/danmaku-previews/transparent.png']) {
    const file = path.join(projectDir, relative); assert.equal(filter(file, await fs.stat(file)), true, relative);
  }
});

test('packaging excludes opening samples and only the converted PNG groups', async () => {
  assert.ok(pkg.build.files.includes('!public/img/overlays/opening/**/*'));
  for (const directory of [
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

test('packaging omits external woodland media and authoring files while retaining its native renderer', async () => {
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const projectDir = path.resolve(__dirname, '../..');
  const output = path.join(projectDir, 'tmp/woodland-packaging-match');
  const matchers = getMainFileMatchers(projectDir, output, value => value, {}, { info: { projectDir,
    buildResourcesDir: path.join(projectDir, pkg.build.directories.buildResources), config: pkg.build,
    debugLogger: { isEnabled: false } } }, output, false);
  const filter = matchers[0].createFilter();
  const artwork = 'public/img/overlays/gift-frame/woodland-bloom';
  const excluded = (await fs.readdir(path.join(projectDir, artwork))).map(name => `${artwork}/${name}`);
  excluded.push('public/img/component-previews/gift-frame-default.webp', 'src/electron/AGENTS.md',
    'public/js/admin/AGENTS.md', 'public/img/overlays/danmaku-comet/provenance.json');
  for (const relative of excluded) {
    const file = path.join(projectDir, relative); assert.equal(filter(file, await fs.stat(file)), false, relative);
  }
  for (const relative of ['public/js/overlays/gift-effects-frame.js', 'public/css/overlays/gift-effects.css',
    'public/img/gift-avatar-placeholder.svg', 'public/fonts/OFL-NotoSerifSC.txt']) {
    const file = path.join(projectDir, relative); assert.equal(filter(file, await fs.stat(file)), true, relative);
  }
});

test('afterPack removes only the default example and tolerates prior cleanup', async (t) => {
  assert.equal(typeof pkg.build.afterPack, 'string');
  const afterPack = require(path.resolve(__dirname, '../..', pkg.build.afterPack));
  const { appOutDir, sourceDir, resourcesDir, archivePath, pack } = await createPackagedApp(t);
  const originalArchive = await fs.readFile(archivePath);
  await fs.writeFile(path.join(resourcesDir, 'default_app.asar'), 'example');
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
  assert.deepEqual(await fs.readFile(archivePath), originalArchive);
  assert.equal(await fs.readFile(path.join(resourcesDir, 'app-update.yml'), 'utf8'), 'updater');
  await afterPack(context);
  assert.deepEqual((await fs.readdir(resourcesDir)).sort(), [
    'app-update.yml',
    'app.asar',
    'client-integrity-manifest.json',
  ]);
  const before = JSON.parse(await fs.readFile(path.join(resourcesDir, 'client-integrity-manifest.json'), 'utf8'));
  await fs.writeFile(path.join(sourceDir, 'signed-resource.txt'), 'final signed resources');
  await pack();
  await require(path.resolve(__dirname, '../..', pkg.build.afterSign))(context);
  const after = JSON.parse(await fs.readFile(path.join(resourcesDir, 'client-integrity-manifest.json'), 'utf8'));
  assert.notEqual(before.files[0].sha256, after.files[0].sha256);
  assert.equal(after.appVersion, pkg.version);
  assert.equal(after.platform, 'win32');
  assert.equal(after.arch, 'x64');
});

test('packaged dependencies resolve hoisted, nested and installed optional packages without dev dependencies', async (t) => {
  const { verifyPackagedDependencies } = require('../../scripts/verify-packaged-dependencies');
  const { archivePath } = await createPackagedApp(t, {
    '': { dependencies: { 'qrc-decoder': '1.0.2', updater: '1' }, devDependencies: { playwright: '1' } },
    'node_modules/qrc-decoder': { dependencies: { pako: '2' }, optionalDependencies: { absent: '1' } },
    'node_modules/pako': { version: '2' },
    'node_modules/updater': { dependencies: { pako: '1' }, optionalDependencies: { helper: '1' } },
    'node_modules/updater/node_modules/pako': { version: '1', dependencies: { nested: '1' } },
    'node_modules/updater/node_modules/nested': { dependencies: { updater: '1' } },
    'node_modules/helper': { dependencies: { pako: '2' } },
  });
  assert.doesNotThrow(() => verifyPackagedDependencies(archivePath));
});

test('packaged dependencies reject missing direct, transitive and installed optional child dependencies', async (t) => {
  const { verifyPackagedDependencies } = require('../../scripts/verify-packaged-dependencies');
  // pako exists in the development checkout; it must not satisfy a packaged dependency.
  assert.ok(require.resolve('pako'));
  for (const [name, packages, owner] of [
    ['direct', { '': { dependencies: { pako: '2' } } }, 'package.json'],
    ['transitive', {
      '': { dependencies: { 'qrc-decoder': '1.0.2' } },
      'node_modules/qrc-decoder': { dependencies: { pako: '2' } },
    }, 'node_modules/qrc-decoder/package.json'],
    ['optional child', {
      '': { optionalDependencies: { 'qrc-decoder': '1.0.2' } },
      'node_modules/qrc-decoder': { dependencies: { pako: '2' } },
    }, 'node_modules/qrc-decoder/package.json'],
  ]) {
    await t.test(name, async (t) => {
      const { archivePath } = await createPackagedApp(t, packages);
      assert.throws(() => verifyPackagedDependencies(archivePath), (error) => {
        assert.match(error.message, /Missing packaged production dependencies/);
        assert.ok(error.message.includes(`${owner} -> pako`), error.message);
        return true;
      });
    });
  }
});

test('afterPack refuses an incomplete production dependency graph before generating its manifest', async (t) => {
  const { appOutDir, resourcesDir } = await createPackagedApp(t, {
    '': { dependencies: { 'qrc-decoder': '1.0.2' } },
    'node_modules/qrc-decoder': { dependencies: { pako: '2' } },
  });
  await assert.rejects(require('../../scripts/after-pack')({
    appOutDir,
    arch: 'x64',
    electronPlatformName: 'win32',
    packager: {
      appInfo: { version: pkg.version },
      getResourcesDir: () => resourcesDir,
    },
  }), /qrc-decoder\/package.json -> pako/);
  await assert.rejects(fs.access(path.join(resourcesDir, 'client-integrity-manifest.json')), { code: 'ENOENT' });
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

test('release builder config transfers only the final installer gate to the publisher', async (t) => {
  const { getConfig } = require('app-builder-lib/out/util/config/config');
  // Keep builder diagnostics on the test runner's channel instead of multipart stdout writes.
  t.mock.method(require('builder-util').log, 'info', (fields, message) => t.diagnostic(`${message}: ${fields.file}`));
  const projectDir = path.resolve(__dirname, '../..');
  const regular = await getConfig(projectDir, null, null);
  const release = await getConfig(projectDir, 'scripts/release-builder-config.js', null);
  assert.equal(regular.artifactBuildCompleted, 'scripts/verify-client-installer.js');
  assert.deepEqual(release, { ...regular, artifactBuildCompleted: null });
});
