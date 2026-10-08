'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-defaults');

let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, overrides = {}) {
  const fragment = fs.readFileSync(path.resolve('public/pages/admin/song/song-board.html'), 'utf8');
  const server = await startComponentPreviewServer({ parentHtml: `<!doctype html><html><head>
    <link rel="stylesheet" href="/css/styles-base.css"><link rel="stylesheet" href="/css/components/select-menu.css">
    </head><body>${fragment}<div id="toast"></div></body></html>` });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); await server.close(); assert.deepEqual(errors, []); });
  const url = `${server.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.evaluate(async (settings) => {
    const { createAdminStateRenderer } = await import('/js/admin/state-renderer.js');
    const { display } = await import('/js/admin/display.js');
    const { enhanceSelects } = await import('/js/shared/select-menu.js');
    const { loadThemeConfig, theme } = await import('/js/shared/theme.js');
    const { renderPresetCards } = await import('/js/admin/theme-preset-cards.js');
    await loadThemeConfig();
    renderPresetCards('songBoardPresets', theme.songBoardThemePresets, theme.songBoardPresetLabels, theme.songBoardPresetSwatches);
    const render = createAdminStateRenderer({ renderGifts() {}, renderQueueStyle() {} });
    window.emitSettings = settings => render({ state: { settings }, changedKeys: ['settings'] });
    window.savedSettings = settings;
    window.writes = [];
    const originalFetch = window.fetch;
    window.fetch = (url, options) => {
      if (url !== '/api/settings') return originalFetch(url, options);
      return new Promise((resolve) => {
        const body = JSON.parse(options.body);
        window.writes.push({ body, finish(ok = true) {
          if (ok) {
            window.savedSettings = { ...window.savedSettings, ...body };
            window.emitSettings(window.savedSettings);
          }
          resolve(new Response(JSON.stringify(ok ? { ok: true, data: { settings: window.savedSettings } }
            : { ok: false, error: '模拟保存失败' }), { status: ok ? 200 : 500 }));
        } });
      });
    };
    window.controller = display.initDisplayForm();
    window.emitSettings(settings);
    enhanceSelects();
  }, { ...DEFAULT_SETTINGS, ...overrides });
  return page;
}

async function choose(page, name, option) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('song board protects paired fields and enhanced selects through old snapshots and serial autosaves', async (t) => {
  const page = await fixture(t);
  await page.locator('#songBoardFontSizeNumber').fill('40');
  await page.waitForFunction(() => window.writes.length === 1);
  await page.locator('#songBoardFontSizeNumber').fill('52');
  await choose(page, '歌曲排序方式', '按歌手');
  await page.evaluate(() => window.emitSettings(window.savedSettings));
  assert.equal(await page.locator('#songBoardFontSize').inputValue(), '52');
  assert.equal(await page.locator('#songBoardFontSizeNumber').inputValue(), '52');
  assert.equal(await page.locator('#songBoardSortMode').inputValue(), 'artist');
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  await page.evaluate(() => window.writes[0].finish());
  await page.waitForFunction(() => window.writes.length === 2);
  assert.deepEqual(await page.evaluate(() => window.writes.map(({ body }) => body)), [
    { songBoardFontSize: '40' }, { songBoardSortMode: 'artist', songBoardFontSize: '52' },
  ]);
  await page.evaluate(() => window.writes[1].finish());
  await page.waitForFunction(() => !window.controller.getState().dirty);
  assert.equal(await page.locator('#songBoardFontSizeNumber').inputValue(), '52');
});

test('standalone theme hydrates every pair and preserves inheritance, custom black and failed edits', async (t) => {
  const pairs = { songBoardThemeOpacity: '0.48', songBoardBackdropBlur: '14', songBoardGlowIntensity: '8',
    songBoardSongFontSize: '72', songBoardTitleFontSize: '80' };
  const page = await fixture(t, { songBoardSyncTheme: 'false', ...pairs });
  for (const [key, value] of Object.entries(pairs)) {
    assert.equal(await page.locator(`#${key}`).inputValue(), value);
    assert.equal(await page.locator(`#${key}Number`).inputValue(), value);
  }
  assert.equal(await page.locator('#songBoardSongColor').isDisabled(), true);
  await page.locator('#songBoardTitle').fill('测试标题');
  await page.waitForFunction(() => window.writes.length === 1);
  assert.equal(await page.evaluate(() => Object.hasOwn(window.writes[0].body, 'songBoardSongColor')), false);
  await page.evaluate(() => window.writes[0].finish(false));
  await page.waitForFunction(() => window.controller.getState().error);
  await page.evaluate(() => window.emitSettings(window.savedSettings));
  assert.equal(await page.locator('#songBoardTitle').inputValue(), '测试标题');
  await page.getByRole('button', { name: '保存展示板', exact: true }).click();
  await page.waitForFunction(() => window.writes.length === 2);
  await page.evaluate(() => window.writes[1].finish());
  await page.waitForFunction(() => !window.controller.getState().dirty);
  await choose(page, '歌名颜色来源', '自定义颜色');
  await page.locator('#songBoardSongColor').fill('#000000');
  await page.waitForFunction(() => window.writes.length === 3);
  assert.equal(await page.evaluate(() => window.writes[2].body.songBoardSongColor), '#000000');
  await page.evaluate(() => window.writes[2].finish());
  await page.waitForFunction(() => !window.controller.getState().dirty);
  await choose(page, '歌名颜色来源', '跟随文字色');
  await page.waitForFunction(() => window.writes.length === 4);
  assert.equal(await page.evaluate(() => window.writes[3].body.songBoardSongColor), '');
  await page.evaluate(() => window.writes[3].finish());
  await page.waitForFunction(() => !window.controller.getState().dirty);
  assert.equal(await page.locator('#songBoardSongColor').isDisabled(), true);
});

test('reset and presets replace the draft, synchronize pairs and save only persisted fields', async (t) => {
  const page = await fixture(t, { songBoardSyncTheme: 'false', songBoardSongColor: '#123456', songBoardBackdropBlur: '20' });
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await page.waitForFunction(() => window.writes.length === 1);
  const patch = await page.evaluate(() => window.writes[0].body);
  assert.equal(patch.songBoardSongColor, '');
  assert.equal(patch.songBoardBackdropBlur, '0');
  assert.equal(Object.keys(patch).some(key => /Number$|Mode$/.test(key)), false);
  assert.equal(await page.locator('#songBoardBackdropBlurNumber').inputValue(), '0');
  await page.evaluate(() => window.writes[0].finish());
  await page.waitForFunction(() => !window.controller.getState().dirty);
  await page.locator('#songBoardPresets [data-theme="pure"]').click();
  await page.waitForFunction(() => window.writes.length === 2);
  assert.equal(await page.locator('#scrollSeconds').inputValue(), '34');
  assert.equal(await page.locator('#scrollSecondsRange').inputValue(), '34');
  assert.equal(Number(await page.locator('#songBoardThemeOpacityNumber').inputValue()), 0);
  assert.equal(await page.locator('#songBoardSongColorMode').inputValue(), 'custom');
  await page.evaluate(() => window.writes[1].finish());
  await page.waitForFunction(() => !window.controller.getState().dirty);
});
