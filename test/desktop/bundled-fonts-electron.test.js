'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
const { createPackage } = require('@electron/asar');
const { createPackagedApp } = require('../helpers/packaged-app');
const { launchElectron } = require('../helpers/shared-electron');
const { fonts } = require('../../src/fonts/catalog.json');
const pkg = require('../../package.json');

test('all shared fonts render offline from ASAR in a custom installation path without a font cache', { timeout: 45000 }, async t => {
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
  for (const relative of ['public/fonts', 'public/js/shared', 'public/css/shared', 'public/css/lyrics']) {
    await fs.cp(path.join(root, relative), path.join(sourceDir, relative), {
      recursive: true, filter: async file => filter(file, await fs.stat(file)),
    });
  }
  const archive = path.join(resources, 'app.asar');
  await createPackage(sourceDir, archive);
  const cwd = path.join(appOutDir, 'unrelated-working-directory');
  await fs.mkdir(cwd);
  app = await launchElectron({ cwd, args: [path.join(root, 'test/fixtures/bundled-fonts.cjs'), appOutDir, archive], timeout: 15000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.waitForFunction(() => document.querySelectorAll('[data-font-id]').length === 8);
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
  assert.equal(renderedFamilies.size, 8, 'Every choice uses a different font, not a common fallback.');
  const result = await app.evaluate(() => global.bundledFontsTest);
  assert.equal(result.state.status, 'ready');
  assert.equal(result.state.total, 0);
  assert.equal(result.downloads, 0);
  assert.deepEqual(result.externalRequests, []);
  assert.equal(result.publicDir, path.join(archive, 'public'));
  await assert.rejects(fs.access(path.join(appOutDir, 'data/cache/fonts')), { code: 'ENOENT' });
  assert.deepEqual(errors, []);
});
