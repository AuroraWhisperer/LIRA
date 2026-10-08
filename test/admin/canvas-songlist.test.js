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
      const title = await field.locator(`option[value="${value}"]`).textContent();
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
  const renderedStyle = async (selector, key, expected) => {
    await frame.waitForFunction(({ selector, key, expected }) => {
      const node = document.querySelector(selector);
      return node && getComputedStyle(node)[key] === expected;
    }, { selector, key, expected });
  };
  assert.equal(await page.locator('[data-component-parameter="songBoardThemePrimary"]').count(), 0);
  await edit('songBoardSyncTheme', 'false');
  await edit('songBoardTitle', '我的展示板');
  await frame.getByText('我的展示板', { exact: true }).waitFor();
  await edit('songBoardSortMode', 'category');
  await edit('category', '不存在的分类');
  await frame.locator('.song-group-title').filter({ hasText: '不存在的分类' }).first().waitFor();
  await frame.locator('.song-card').first().waitFor();
  await edit('category', '流行');
  await frame.locator('.song-card').first().waitFor();
  for (const [sort, heading] of [['artist', '示例歌手'], ['category', '流行'], ['language', '国语'], ['initial', 'S']]) {
    await edit('songBoardSortMode', sort);
    await frame.locator('.song-group-title').filter({ hasText: heading }).first().waitFor();
  }
  await edit('songBoardSortMode', 'length');
  await frame.waitForFunction(() => !document.querySelector('.song-group-title'));
  for (const speed of ['10', '15']) {
    await edit('scrollSeconds', speed);
    const distance = await frame.evaluate(async () => {
      const edge = document.querySelector('.song-scroll-window').getBoundingClientRect().top;
      const node = [...document.querySelectorAll('.song-card')].find(card => card.getBoundingClientRect().bottom > edge);
      const top = node.getBoundingClientRect().top;
      await new Promise(resolve => setTimeout(resolve, 200));
      return top - node.getBoundingClientRect().top;
    });
    assert.ok(distance > 0, `speed ${speed} must keep moving`);
  }
  await edit('songBoardFontFamily', 'Arial');
  await frame.waitForFunction(() => getComputedStyle(document.querySelector('.song-card')).fontFamily.startsWith('Arial'));
  for (const weight of ['400', '800']) {
    await edit('songBoardFontWeight', weight);
    await renderedStyle('.song-card strong', 'fontWeight', weight);
  }
  await edit('songBoardSongFontSize', '36');
  await renderedStyle('.song-card strong', 'fontSize', '36px');
  await edit('songBoardTitleFontSize', '30');
  await renderedStyle('#songBoardTitle', 'fontSize', '30px');
  await edit('songBoardSongColor', '#123456');
  await renderedStyle('.song-card strong', 'color', 'rgb(18, 52, 86)');
  await edit('songBoardThemeText', '#654321');
  await renderedStyle('.overlay-panel', 'color', 'rgb(101, 67, 33)');
  await edit('songBoardThemeAccent', '#00aaff');
  await edit('songBoardSortMode', 'category');
  await renderedStyle('.song-group-title', 'color', 'rgb(0, 170, 255)');
  await edit('songBoardThemeBackground', '#abcdef');
  await edit('songBoardThemeOpacity', '0.5');
  await renderedStyle('.overlay-panel', 'backgroundColor', 'rgba(171, 205, 239, 0.5)');
  await edit('songBoardThemeRadius', '24');
  await renderedStyle('.overlay-panel', 'borderRadius', '24px');
  await page.getByRole('button', { name: '保存并应用', exact: true }).click();
  await page.locator('.preview-canvas-status').filter({ hasText: '已保存并应用' }).waitFor();
  const saved = fixture.service.list()[0];
  const config = saved.document.items[0].appearance.config;
  assert.equal(config.category, '流行');
  assert.equal(fixture.runtime.settings.scrollSeconds, '15');
  assert.equal(fixture.runtime.settings.songBoardFontWeight, '800');
  const source = fixture.service.getSource(saved.document.id);
  const outputUrl = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(outputUrl)).status, 200);
  const output = await browser.newPage();
  output.on('pageerror', error => errors.push(error.message));
  await output.goto(outputUrl);
  const rendered = output.frameLocator('.scene-version:not(.is-staging) iframe');
  await rendered.getByText('我的展示板', { exact: true }).waitFor();
  await rendered.getByText('真实歌曲', { exact: true }).waitFor();
  assert.deepEqual(await rendered.locator('.song-card strong').evaluate(node => {
    const style = getComputedStyle(node);
    return { size: style.fontSize, weight: style.fontWeight, color: style.color };
  }), { size: '36px', weight: '800', color: 'rgb(18, 52, 86)' });
});
