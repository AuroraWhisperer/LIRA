'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
const { createPackage, extractFile } = require('@electron/asar');
const { createPackagedApp } = require('../helpers/packaged-app');
const { launchElectron } = require('../helpers/shared-electron');
const { fonts } = require('../../src/fonts/catalog.json');
const pkg = require('../../package.json');
const { exportCdnResources } = require('../../scripts/export-cdn-resources');

test('an ASAR bundles tiny title subsets, downloads shared fonts once, renders them and reopens offline', { timeout: 60000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  let app;
  t.after(() => app?.close());
  const { appOutDir, sourceDir } = await createPackagedApp(t);
  const installDir = path.join(appOutDir, '自定义安装 LIRA');
  const resources = path.join(installDir, 'resources');
  await fs.mkdir(resources, { recursive: true });
  const matchers = getMainFileMatchers(root, appOutDir, value => value, {}, { info: {
    projectDir: root, buildResourcesDir: path.join(root, pkg.build.directories.buildResources),
    config: pkg.build, debugLogger: { isEnabled: false },
  } }, appOutDir, false);
  const filter = matchers[0].createFilter();
  for (const relative of ['public/fonts', 'public/js/shared', 'public/js/admin/font-library-toast.js',
    'public/css/styles-base.css', 'public/css/shared', 'public/css/lyrics', 'public/css/admin/toasts']) {
    await fs.cp(path.join(root, relative), path.join(sourceDir, relative), {
      recursive: true, filter: async file => filter(file, await fs.stat(file)),
    });
  }
  const archive = path.join(resources, 'app.asar');
  await createPackage(sourceDir, archive);
  for (const name of ['clock-moon-serif-400.woff2', 'guard-thanks-serif-400.woff2'])
    assert.deepEqual(extractFile(archive, path.join('public/fonts', name)), await fs.readFile(path.join(root, 'public/fonts', name)));
  const cwd = path.join(appOutDir, 'unrelated-working-directory');
  await fs.mkdir(cwd);
  exportCdnResources({ outputDir: path.join(appOutDir, 'cdn') });
  app = await launchElectron({ cwd, args: [path.join(root, 'test/fixtures/bundled-fonts.cjs'), appOutDir, archive], timeout: 15000 });
  let page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.waitForFunction(() => document.getElementById('toast').textContent.includes('正在下载字体和图片'));
  await page.waitForFunction(count => document.querySelectorAll('[data-font-id]').length === count, fonts.length);
  await page.waitForFunction(() => document.getElementById('map').naturalWidth === 8192);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const renderedFamilies = new Set();
  for (const font of fonts) {
    await page.getByRole('combobox', { name: '字体', exact: true }).selectOption(`"${font.family}"`);
    await page.evaluate(() => document.fonts.ready);
    const { root: document } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: document.nodeId, selector: '#sample > span' });
    const { fonts: rendered } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(rendered.length && rendered.every(face => face.isCustomFont), `${font.id}: ${JSON.stringify(rendered)}`);
    renderedFamilies.add(rendered.map(face => face.familyName).join(','));
  }
  assert.equal(renderedFamilies.size, fonts.length, 'Every choice uses a different font, not a common fallback.');
  const result = await app.evaluate(() => ({ ...global.cdnResourcesTest }));
  assert.equal(result.state.status, 'ready');
  const packages = require('../../src/resources/catalog.json').packages;
  assert.equal(result.state.total, packages.length);
  assert.equal(result.downloads, packages.length);
  assert.equal(result.checks, 1);
  assert.deepEqual(result.externalRequests, []);
  assert.equal(result.publicDir, path.join(archive, 'public'));
  await assert.rejects(fs.access(path.join(appOutDir, 'data/cache/fonts')), { code: 'ENOENT' });
  await fs.access(path.join(appOutDir, 'data/cache/resources/index.json'));
  assert.deepEqual(errors, []);
  await app.close();
  app = await launchElectron({ cwd, args: [path.join(root, 'test/fixtures/bundled-fonts.cjs'), appOutDir, archive, 'offline'], timeout: 15000 });
  page = await app.firstWindow();
  await page.waitForFunction(count => document.querySelectorAll('[data-font-id]').length === count, fonts.length);
  await page.waitForFunction(() => document.getElementById('map').naturalWidth === 8192);
  const cached = await app.evaluate(() => ({ ...global.cdnResourcesTest }));
  assert.equal(cached.state.status, 'ready');
  assert.equal(cached.state.total, 0);
  assert.equal(cached.checks, 1);
  assert.equal(cached.downloads, 0);
  assert.equal(await page.locator('#toast').textContent(), '');
});
