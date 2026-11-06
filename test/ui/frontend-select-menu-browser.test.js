'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

const openBrowserSession = useSharedBrowser();

test('select options remain reachable across clipping, stacking contexts and dialog edges', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/components/select-menu.css">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px sans-serif; }
      #scroller { position: absolute; top: 220px; right: 8px; width: 180px; height: 100px; overflow: auto; }
      .control { position: relative; z-index: 1; padding-top: 20px; }
      .cover { position: relative; z-index: 2; height: 200px; background: white; }
      dialog { width: 260px; margin: 12px 12px 12px auto; }
      .font-host .lira-select-menu { width: 320px; }
    </style>
    <div id="scroller">
      <div class="control"><select id="duration" aria-label="Duration">
        ${Array.from({ length: 30 }, (_, i) => `<option value="${i}">Duration ${i}</option>`).join('')}
      </select></div>
      <div class="cover"></div>
    </div>
    <dialog><div class="font-host"><select id="font" aria-label="Font" data-select-search>
      <option value="default">Default</option><option value="long">A long font name to find and select</option>
    </select></div><button id="done">Done</button></dialog>
    <script type="module">
      import { enhanceSelects } from '/js/shared/select-menu.js';
      enhanceSelects();
    </script>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(5000);
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.getByRole('button', { name: 'Duration', exact: true }).click();
  const menu = page.getByRole('listbox', { name: 'Duration', exact: true });
  const bounds = await menu.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 480, 'options must stay inside the viewport');
  await page.getByRole('option', { name: 'Duration 29', exact: true }).click();
  assert.equal(await page.locator('#duration').inputValue(), '29', 'clipped and covered options must be selectable');

  // Scrolling into view can queue its event until after the menu has opened.
  await page.locator('#scroller').evaluate(root => {
    root.scrollTop = 10;
    root.querySelector('.lira-select-trigger').click();
  });
  await page.getByRole('option', { name: 'Duration 0', exact: true }).click();
  assert.equal(await page.locator('#duration').inputValue(), '0');

  await page.evaluate(() => document.querySelector('dialog').showModal());
  await page.getByRole('button', { name: 'Font', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Font：搜索', exact: true }).fill('long');
  const fontBounds = await page.locator('.lira-select-searchable').boundingBox();
  assert.ok(fontBounds.x >= 0 && fontBounds.x + fontBounds.width <= 640, 'wide menus must stay reachable at the right edge');
  await page.getByRole('option', { name: 'A long font name to find and select', exact: true }).click();
  assert.equal(await page.locator('#font').inputValue(), 'long', 'dialog menus must remain inside the active focus scope');
});

test('multiselect filters keep the last choice and clear action reachable in a clipped panel', async t => {
  const fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html>
    <link rel="stylesheet" href="/css/components/select-menu.css">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px sans-serif; }
      #panel { position: absolute; top: 260px; right: 8px; width: 220px; height: 120px; overflow: hidden; }
      details { position: relative; z-index: 1; }
      .cover { position: relative; z-index: 2; height: 200px; background: white; }
    </style>
    <div id="panel"><details class="lira-multiselect">
      <summary class="lira-select-trigger">Categories</summary>
      <div class="lira-multiselect-menu">
        <div class="lira-multiselect-options">
          ${Array.from({ length: 30 }, (_, i) => `<label class="lira-multiselect-option"><input type="checkbox">Choice ${i}</label>`).join('')}
        </div>
        <button class="lira-multiselect-clear" disabled>Clear selection</button>
      </div>
    </details><div class="cover"></div></div>
    <script type="module">
      import { bindFilterMenuPopovers, closeFilterMenusOnOutsideClick } from '/js/admin/song-library-filters.js';
      const filters = document.querySelectorAll('details');
      const menu = document.querySelector('.lira-multiselect-menu');
      const clear = menu.querySelector('button');
      menu.addEventListener('change', () => { clear.disabled = !menu.querySelector('input:checked'); });
      clear.addEventListener('click', () => {
        menu.querySelectorAll('input').forEach(input => { input.checked = false; });
        clear.disabled = true;
      });
      bindFilterMenuPopovers(filters);
      document.addEventListener('click', event => closeFilterMenusOnOutsideClick(event, filters));
    </script>` });
  const session = openBrowserSession();
  t.after(async () => { await session.close(); await fixture.close(); });
  const page = await session.newPage({ viewport: { width: 640, height: 480 } });
  page.setDefaultTimeout(5000);
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator('summary').click();
  const last = page.getByRole('checkbox', { name: 'Choice 29', exact: true });
  await last.check();
  assert.equal(await last.isChecked(), true);
  const clear = page.getByRole('button', { name: 'Clear selection', exact: true });
  const bounds = await clear.boundingBox();
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 480, 'selection must not push the clear action out of view');
  await clear.click();
  assert.equal(await last.isChecked(), false);
});
