'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture, openCanvasDesktop } = require('../helpers/canvas-output-fixture');

test('song board parameters reach the canvas renderer and persist into the live source', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture({ extraContext: { songs: { list: () => [
    { id: 1, name: '真实歌曲', artist: '真实歌手', category_name: '流行', name_initial: 'Z', language: '国语' },
  ] } } });
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  desktop.setDefaultTimeout(5000);
  page.setDefaultTimeout(5000);
  const errors = [];
  for (const target of [page, desktop]) target.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  const url = await openCanvasDesktop(desktop, fixture);
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: '添加组件', exact: true }).click();
  await page.locator('[data-category="songlist"]').click();
  await page.locator('[data-picker-style="default"]').click();
  const frame = await page.locator('.scene-editor-item.is-selected iframe').elementHandle().then(handle => handle.contentFrame());
  await frame.locator('.song-card').first().waitFor();
  const edit = async (key, value) => {
    const field = page.locator(`[data-component-parameter="${key}"]`);
    const kind = await field.evaluate(input => input.tagName === 'SELECT' ? 'select' : input.type);
    const shared = Object.hasOwn(fixture.runtime.settings, key);
    const saved = shared ? page.waitForResponse(response => response.url().includes('/api/component-preview/appearance?')
      && response.request().postDataJSON()?.patch?.[key] === value).catch(error => ({ error })) : null;
    if (kind === 'select') {
      const title = await field.evaluate((select, value) => Array.from(select.options).find(option => option.value === value).textContent, value);
      const trigger = field.locator('..').getByRole('button').first();
      if (await trigger.count()) {
        await trigger.click();
        await page.getByRole('option', { name: title, exact: true }).click();
      } else await field.selectOption(value);
    }
    else if (kind === 'checkbox') await field.setChecked(value === 'true');
    else if (kind === 'color') {
      const inherit = field.locator('..').locator('input[type="checkbox"]');
      if (await inherit.count()) await inherit.uncheck();
      await field.evaluate((input, value) => {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    }
    else { await field.fill(value); await field.press('Tab'); }
    if (shared) {
      const response = await saved;
      if (response.error) throw new Error(`Shared save failed: ${key}=${value}, saved=${fixture.runtime.settings[key]}, input=${await field.inputValue()}`, { cause: response.error });
      assert.equal(response.status(), 200, JSON.stringify(await response.json()));
      assert.equal(fixture.runtime.settings[key], value);
    } else await desktop.waitForFunction(({ key, value }) =>
      window.controllers.canvas.getState().draft.document.items[0]?.appearance.config[key] === value, { key, value });
  };
  await edit('songBoardSyncTheme', 'false');
  await edit('songBoardTitle', '我的展示板');
  await frame.getByText('我的展示板', { exact: true }).waitFor();
  await edit('category', '流行');
  await edit('songBoardSortMode', 'category');
  await frame.locator('.song-group-title').filter({ hasText: '流行' }).first().waitFor();
  await edit('scrollSeconds', '15');
  await edit('songBoardFontWeight', '400');
  await edit('songBoardSongFontSize', '36');
  await edit('songBoardSongColor', '#123456');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const config = saved.document.items[0].appearance.config;
  assert.equal(config.category, '流行');
  assert.equal(fixture.runtime.settings.scrollSeconds, '15');
  assert.equal(fixture.runtime.settings.songBoardFontWeight, '400');
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await browser.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const rendered = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await rendered.getByText('我的展示板', { exact: true }).waitFor();
  await rendered.getByText('真实歌曲', { exact: true }).waitFor();
  // Resolve and read in one browser task; font relayout can replace the title node.
  assert.deepEqual(await rendered.locator('.song-card strong').evaluateAll(([node]) => {
    const style = getComputedStyle(node);
    return { size: style.fontSize, weight: style.fontWeight, color: style.color };
  }), { size: '36px', weight: '400', color: 'rgb(18, 52, 86)' });
});
