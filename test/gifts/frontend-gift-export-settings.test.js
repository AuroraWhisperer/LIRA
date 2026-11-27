'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');
const { exportLayout } = require('../../src/electron/gift-export-controller');

const fixture = createUiFixture();
const historyHtml = fs.readFileSync(path.resolve('public/pages/admin/gifts/history.html'), 'utf8');

async function openExport(t, count = 2) {
  const page = await fixture(t, 'gift-display');
  await page.exposeFunction('planGiftFiles', exportLayout);
  await page.setContent(historyHtml);
  await page.evaluate(async (count) => {
    const drawer = document.getElementById('giftHistoryDrawer');
    drawer.inert = false;
    drawer.setAttribute('aria-hidden', 'false');
    const items = Array.from({ length: count }, (_, index) => index + 1).map((num) => ({
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
    window.exportDefaults = { mode: 'combined', background: 'transparent', sortBy: 'time', rowGap: 16, mergeAcrossDates: false, root: 'Pictures/LIRA', styleSource: 'follow' };
    const rolling = { tailStyle: 'slant', textureStyle: 'solid', thresholds: [3000, 10000, 100000], sheen: true };
    let task;
    let batch = 0;
    const describe = async () => {
      const cards = task.mergeAcrossDates ? items.slice(0, -1) : items;
      return {
        ...task,
        snapshot: { ...task.snapshot, items: task.sortBy === 'amount' ? cards.toReversed() : cards, selectedCount: items.length },
        files: await window.planGiftFiles(cards.length, task.mode, task.rowGap),
      };
    };
    window.giftExport = {
      async prepare() {
        task = {
          ...window.exportDefaults,
          id: String(++batch),
          directory: window.exportDefaults.root + '/batch',
          snapshot: { items, config: window.exportDefaults.styleSource === 'custom' ? window.customStyle : rolling, catalog: [] },
        };
        return { ok: true, data: await describe() };
      },
      async configure(options) {
        window.exportCalls.push(options);
        if (window.failConfigure) return { ok: false, error: '导出预览已失效，请重新打开。' };
        if (window.delayConfigure)
          await new Promise((resolve) => {
            window.finishConfigure = resolve;
          });
        if (options.directoryAction === 'choose' && window.cancelPicker) return { ok: true, data: await describe() };
        task.mergeAcrossDates = options.mergeAcrossDates ?? task.mergeAcrossDates;
        task.sortBy = options.sortBy ?? task.sortBy;
        task.rowGap = options.rowGap ?? task.rowGap;
        task.styleSource = options.styleSource ?? task.styleSource;
        if (task.styleSource === 'custom') window.customStyle = options.customStyle ?? window.customStyle ?? rolling;
        task.snapshot.config = task.styleSource === 'custom' ? window.customStyle : rolling;
        task.mode = options.mode;
        task.background = options.background;
        if (options.directoryAction)
          task.root = options.directoryAction === 'choose' ? 'Chosen/Gifts' : 'Pictures/LIRA';
        if (options.remember) Object.assign(window.exportDefaults, { root: task.root, styleSource: task.styleSource });
        task.directory = task.root + (task.attempted ? '/retry-batch' : '/batch');
        task.attempted = false;
        return { ok: true, data: await describe() };
      },
      async settings(options) {
        Object.assign(window.exportDefaults, options);
        return { ok: true, data: window.exportDefaults };
      },
      async save(id, roomGuard) {
        window.savedExportId = id;
        window.savedStyle = task.snapshot.config;
        window.savedRoomGuard = roomGuard;
        task.attempted = true;
        if (window.exportFailure) return window.exportFailure;
        return { ok: true, saved: (await describe()).files.length };
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
    await window.preview.open({ eventIds: items.map(item => item.eventId) });
  }, count);
  return page;
}

test('history export settings update the current preview and remember the next export', async (t) => {
  const page = await openExport(t);
  const visibleCards = () => page.locator('#giftExportPreview .gift-banner').evaluateAll(
    nodes => nodes.map(node => node.dataset.eventId),
  );
  assert.deepEqual(await visibleCards(), ['1', '2']);
  assert.equal(await page.locator('#giftExportPreview .gift-banner').first().getAttribute('data-sheen'), 'false');
  await page.getByRole('radio', { name: '按金额' }).check();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.deepEqual(await visibleCards(), ['2', '1']);
  await page.getByRole('radio', { name: '每条一张' }).check();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.deepEqual(await visibleCards(), ['2']);
  await page.locator('#giftExportNext').click();
  assert.deepEqual(await visibleCards(), ['1']);
  await page.locator('#giftExportPrev').click();
  assert.deepEqual(await visibleCards(), ['2']);
  await page.getByRole('switch', { name: '合并同种礼物' }).setChecked(true);
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportNext').isDisabled(), true);
  await page.getByRole('radio', { name: '白色' }).check();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  await page.locator('#giftExportChoose').click();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportDirectory').textContent(), 'batch');
  assert.equal(await page.locator('#giftExportDirectory').getAttribute('title'), 'Chosen/Gifts/batch');
  await page.evaluate(async () => {
    const { stateService } = await import('/js/admin/state.js');
    stateService.applySnapshot({ roomGuard: { roomId: '123', count: 1001 } });
  });
  await page.locator('#giftExportSave').click();
  assert.equal(await page.locator('#giftExportSave').isDisabled(), true);
  assert.equal(await page.evaluate(() => window.savedExportId), '1');
  assert.equal(await page.evaluate(() => window.savedRoomGuard?.count), 1001);
  await page.locator('#giftExportBack').click();
  await page.evaluate(() => window.preview.open({ eventIds: ['1', '2'] }));
  assert.equal(await page.getByRole('switch', { name: '合并同种礼物' }).isChecked(), true);
  assert.equal(await page.getByRole('radio', { name: '每条一张' }).isChecked(), true);
  assert.equal(await page.getByRole('radio', { name: '白色' }).isChecked(), true);
  assert.equal(await page.getByRole('radio', { name: '按金额' }).isChecked(), true);
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Chosen/Gifts');
  await page.locator('#giftExportDefault').click();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.locator('#giftExportSettingsDirectory').textContent(), 'Pictures/LIRA');
});

test('custom style edits update the current preview and commit valid tier boundaries before saving', async t => {
  const page = await openExport(t);
  const ready = () => page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  await page.getByRole('radio', { name: '每条一张' }).check();
  await ready();
  await page.locator('#giftExportNext').click();
  const banner = page.locator('#giftExportPreview .gift-banner');
  await page.evaluate(() => { window.previewCard = document.querySelector('#giftExportPreview .gift-banner'); });
  await page.getByRole('radio', { name: '自定义' }).check();
  await ready();
  await page.locator('#giftExportTail').selectOption('ribbon');
  await ready();
  assert.equal(await banner.getAttribute('data-tail-style'), 'ribbon');
  assert.equal(await banner.evaluate(node => node === window.previewCard), true);
  await page.locator('#giftExportTiers summary').click();
  const amount = page.getByRole('spinbutton', { name: '紫蓝起始金额（元）' });
  const save = page.locator('#giftExportSave');
  await amount.fill('101');
  assert.equal(await save.isDisabled(), true);
  assert.equal(await page.locator('#giftExportTierError').isVisible(), true);
  const color = () => banner.evaluate(node => node.style.getPropertyValue('--gift-start'));
  const before = await color();
  await amount.fill('4.00');
  assert.notEqual(await color(), before);
  await page.evaluate(() => { window.delayConfigure = true; });
  await save.click();
  await page.waitForFunction(() => typeof window.finishConfigure === 'function');
  assert.equal(await page.evaluate(() => window.savedExportId), undefined);
  await page.evaluate(() => { window.delayConfigure = false; window.finishConfigure(); });
  await page.waitForFunction(() => window.savedStyle?.thresholds[0] === 400);
  await page.getByRole('radio', { name: '跟随滚动礼物' }).check();
  await ready();
  assert.equal(await banner.getAttribute('data-tail-style'), 'slant');
  assert.equal(await color(), before);
  await page.getByRole('radio', { name: '自定义' }).check();
  await ready();
  assert.equal(await banner.getAttribute('data-tail-style'), 'ribbon');
  assert.equal(await page.locator('#giftExportTiers').evaluate(node => node.open), false);
  await page.locator('#giftExportTiers summary').click();
  assert.equal(await amount.inputValue(), '4');
});

test('multi-card spacing previews locally and updates the next export batch on release', async t => {
  const page = await openExport(t, 51);
  const slider = page.getByRole('slider', { name: '词条间距' });
  const reset = page.getByRole('button', { name: '重置词条间距' });
  const merge = page.getByRole('switch', { name: '合并同种礼物' });
  const ready = () => page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  const gap = () => page.locator('#giftExportPreview').evaluate(el => el.style.rowGap);
  assert.equal(await slider.isEnabled(), true);
  await page.locator('#giftExportSave').click();
  await page.waitForFunction(() => document.getElementById('giftExportStatus').dataset.state === 'success');
  const calls = await page.evaluate(() => window.exportCalls.length);
  await slider.evaluate(el => {
    el.value = 32;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  assert.equal(await gap(), '16px');
  assert.equal(await page.evaluate(() => window.exportCalls.length), calls);
  await slider.dispatchEvent('change');
  await ready();
  assert.equal(await page.evaluate(() => window.exportDefaults.rowGap), 32);
  assert.equal(await page.locator('#giftExportPreview .gift-banner').count(), 50);
  assert.match(await page.locator('#giftExportFiles').textContent(), /8768 px/);
  await page.locator('#giftExportNext').click();
  await page.waitForFunction(() => document.getElementById('giftExportPreview').children.length === 1);
  assert.match(await page.locator('#giftExportFiles').textContent(), /144 px/);
  assert.equal(await slider.isDisabled(), true);
  assert.equal(await reset.isDisabled(), true);
  const directory = page.locator('#giftExportDirectory');
  assert.equal(await directory.textContent(), 'retry-batch');
  assert.equal(await directory.getAttribute('title'), 'Pictures/LIRA/retry-batch');
  await merge.check();
  await ready();
  assert.equal(await slider.isEnabled(), true);
  assert.equal(await gap(), '16px');
  await reset.click();
  await ready();
  assert.equal(await slider.inputValue(), '16');
  assert.equal(await gap(), '8px');
  assert.equal(await page.evaluate(() => window.exportDefaults.rowGap), 16);
  await page.getByRole('radio', { name: '每条一张' }).check();
  await ready();
  assert.equal(await slider.isDisabled(), true);
});

test('failed settings restore the current format and pending settings cannot export or reopen a closed preview', async (t) => {
  const page = await openExport(t);
  await page.evaluate(() => {
    window.failConfigure = true;
  });
  await page.getByRole('radio', { name: '每条一张' }).click();
  await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
  assert.equal(await page.getByRole('radio', { name: '拼成长图' }).isChecked(), true);
  await page.evaluate(() => {
    window.failConfigure = false;
    window.delayConfigure = true;
  });
  await page.getByRole('radio', { name: '每条一张' }).check();
  assert.equal(await page.getByRole('radio', { name: '每条一张' }).isDisabled(), true);
  assert.equal(await page.locator('#giftExportSave').isDisabled(), true);
  await page.locator('#giftExportBack').click();
  await page.evaluate(() => window.finishConfigure());
  assert.equal(await page.locator('#giftExportPanel').isHidden(), true);
  assert.equal(await page.evaluate(() => window.exportDefaults.mode), 'combined');
});

test('failed gift exports can retry in a new batch while keeping the original saved files', async (t) => {
  const page = await openExport(t);
  await page.evaluate(() => {
    window.exportFailure = { ok: false, saved: 1, error: '图片生成失败' };
    window.cancelPicker = true;
  });
  async function cancelFolder() {
    const status = page.locator('#giftExportStatus');
    const previous = await status.textContent();
    await page.locator('#giftExportChoose').click();
    await page.waitForFunction(() => !document.getElementById('giftExportSettingsFields').disabled);
    assert.equal(await status.textContent(), previous);
    assert.equal(await page.locator('#giftExportOpenFolder').isVisible(), true);
  }
  await page.locator('#giftExportSave').click();
  await page.getByRole('button', { name: '重新导出', exact: true }).waitFor();
  await cancelFolder();
  assert.equal(await page.locator('#giftExportSave').isEnabled(), true);
  await page.evaluate(() => { window.exportFailure = null; });
  await page.locator('#giftExportSave').click();
  await page.waitForFunction(() => document.getElementById('giftExportStatus').dataset.state === 'success');
  assert.deepEqual(await page.evaluate(() => window.exportCalls), [
    { id: '1', mode: 'combined', background: 'transparent', directoryAction: 'choose', remember: true },
    { id: '1', mode: 'combined', background: 'transparent' },
  ]);
  await cancelFolder();
  assert.equal(await page.locator('#giftExportDirectory').textContent(), 'retry-batch');
  assert.equal(await page.locator('#giftExportDirectory').getAttribute('title'), 'Pictures/LIRA/retry-batch');
  assert.equal(await page.locator('#giftExportSave').isDisabled(), true);
});
