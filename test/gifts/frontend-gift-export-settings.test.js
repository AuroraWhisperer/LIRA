'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();
const historyHtml = fs.readFileSync(path.resolve('public/pages/admin/gifts/history.html'), 'utf8');

async function openExport(t) {
  const page = await fixture(t, 'gift-display');
  await page.setContent(historyHtml);
  await page.evaluate(async () => {
    const drawer = document.getElementById('giftHistoryDrawer');
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    const items = [1, 2].map((num) => ({
      eventId: String(num),
      gift: {
        giftId: 'sample',
        giftName: '礼物',
        userName: '测试观众',
        unitPrice: 2,
        num,
      },
    }));
    window.exportCalls = [];
    window.exportDefaults = { mode: 'combined', background: 'transparent', root: 'Pictures/LIRA' };
    let task;
    let batch = 0;
    const describe = () => ({
      ...task,
      files: Array.from({ length: task.mode === 'combined' ? 1 : 2 }, (_, index) => ({
        fileName: '礼物_' + (index + 1) + '.png',
      })),
    });
    window.giftExport = {
      async prepare() {
        task = {
          ...window.exportDefaults,
          id: String(++batch),
          directory: window.exportDefaults.root + '/batch',
          snapshot: { items, config: { thresholds: [3000, 10000, 100000] }, catalog: [] },
        };
        return { ok: true, data: describe() };
      },
      async configure(options) {
        window.exportCalls.push(options);
        if (window.failConfigure) return { ok: false, error: '导出预览已失效，请重新打开。' };
        if (window.delayConfigure)
          await new Promise((resolve) => {
            window.finishConfigure = resolve;
          });
        task.mode = options.mode;
        task.background = options.background;
        if (options.directoryAction)
          task.root = options.directoryAction === 'choose' ? 'Chosen/Gifts' : 'Pictures/LIRA';
        if (options.remember) window.exportDefaults.root = task.root;
        task.directory = task.root + (task.attempted ? '/retry-batch' : '/batch');
        task.attempted = false;
        return { ok: true, data: describe() };
      },
      async settings(options) {
        Object.assign(window.exportDefaults, options);
        return { ok: true, data: window.exportDefaults };
      },
      async save(id) {
        window.savedExportId = id;
        task.attempted = true;
        if (window.exportFailure) return window.exportFailure;
        return { ok: true, saved: describe().files.length };
      },
      onProgress() {
        return () => {};
      },
      cancel() {},
    };
    const { createGiftExportPreview } = await import('/js/admin/gifts/export-preview.js');
    window.preview = createGiftExportPreview({
      showPane(pane) {
        document.querySelectorAll('[data-gift-pane]').forEach((node) => {
          node.hidden = node.dataset.giftPane !== pane;
        });
      },
    });
    await window.preview.open({ eventIds: ['1', '2'] });
  });
  return page;
}

test('history export settings update the current preview and remember the next export', async (t) => {
  const page = await openExport(t);
  assert.equal(await page.locator('#giftHistoryExport').count(), 1);
  assert.equal(await page.locator('#giftDisplaySettings, #giftExportRemember').count(), 0);
  assert.equal(await page.locator('#giftExportPreview .gift-banner').count(), 2);
  await page.locator('#giftExportMode').selectOption('separate');
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportPreview .gift-banner').count(), 1);
  assert.equal(await page.locator('#giftExportPage').textContent(), '1 / 2');
  await page.locator('#giftExportNext').click();
  assert.equal(await page.locator('#giftExportPage').textContent(), '2 / 2');
  await page.locator('#giftExportBackground').selectOption('white');
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(
    await page.locator('#giftExportPreview').evaluate((node) => node.style.background),
    'rgb(255, 255, 255)',
  );
  await page.locator('#giftExportChoose').click();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Chosen/Gifts');
  assert.equal(await page.locator('#giftExportDirectory').textContent(), 'Chosen/Gifts/batch');
  await page.locator('#giftExportSave').click();
  assert.equal(await page.locator('#giftExportSave').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.savedExportId), '1');
  await page.locator('#giftExportBack').click();
  await page.evaluate(() => window.preview.open({ eventIds: ['1', '2'] }));
  assert.equal(await page.locator('#giftExportMode').inputValue(), 'separate');
  assert.equal(await page.locator('#giftExportBackground').inputValue(), 'white');
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Chosen/Gifts');
  await page.locator('#giftExportDefault').click();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Pictures/LIRA');
  assert.equal(await page.locator('#giftExportSave').isEnabled(), true);
});

test('failed settings restore the current format and pending settings cannot export or reopen a closed preview', async (t) => {
  const page = await openExport(t);
  await page.evaluate(() => {
    window.failConfigure = true;
  });
  await page.locator('#giftExportMode').selectOption('separate');
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportMode').inputValue(), 'combined');
  assert.equal(await page.locator('#giftExportPreview .gift-banner').count(), 2);
  assert.match(await page.locator('#giftExportStatus').textContent(), /已失效/);
  await page.evaluate(() => {
    window.failConfigure = false;
    window.delayConfigure = true;
  });
  await page.locator('#giftExportMode').selectOption('separate');
  assert.equal(await page.locator('#giftExportMode').isDisabled(), true);
  assert.equal(await page.locator('#giftExportSave').isDisabled(), true);
  await page.locator('#giftExportBack').click();
  await page.evaluate(() => window.finishConfigure());
  assert.equal(await page.locator('#giftExportPanel').isHidden(), true);
  assert.equal(await page.evaluate(() => window.exportDefaults.mode), 'combined');
});

test('failed gift exports can retry in a new batch while keeping the original saved files', async (t) => {
  const page = await openExport(t);
  await page.evaluate(() => { window.exportFailure = { ok: false, saved: 1, error: '图片生成失败' }; });
  await page.locator('#giftExportSave').click();
  await page.getByRole('button', { name: '重新导出', exact: true }).waitFor();
  assert.equal(await page.locator('#giftExportSave').isEnabled(), true);
  assert.equal(await page.locator('#giftExportOpenFolder').isVisible(), true);
  assert.match(await page.locator('#giftExportStatus').textContent(), /已保存 1 张，文件已保留/);
  assert.match(await page.locator('#giftExportStatus').textContent(), /新文件夹/);
  await page.evaluate(() => { window.exportFailure = null; });
  await page.locator('#giftExportSave').click();
  await page.waitForFunction(() => document.getElementById('giftExportStatus').dataset.state === 'success');
  assert.deepEqual(await page.evaluate(() => window.exportCalls), [{ id: '1', mode: 'combined', background: 'transparent' }]);
  assert.equal(await page.locator('#giftExportDirectory').textContent(), 'Pictures/LIRA/retry-batch');
  assert.equal(await page.locator('#giftExportSave').isDisabled(), true);
});
