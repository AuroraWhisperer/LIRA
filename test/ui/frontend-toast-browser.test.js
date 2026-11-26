'use strict';

// Real Chromium focus and lifecycle checks for the shared toast stack; the VM
// behaviour tests for the same owner live in frontend-toast.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

test('browser gift toasts reuse safe local artwork and top-layer notifications stay readable', async (t) => {
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 680 }, reducedMotion: 'reduce' });
  let catalogRequests = 0;
  const imageRequests = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.hostname, 'toast.test');
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html data-client-theme="terracotta"><meta charset="utf-8"><link rel="stylesheet" href="/css/styles-base.css"><link rel="stylesheet" href="/css/desktop/palettes.css"><link id="toast-styles" rel="stylesheet" href="/css/admin/toasts.css"><div id="toast" class="toast-stack"></div></html>',
      });
    if (url.pathname === '/api/overtime/gifts/catalog') {
      catalogRequests++;
      return route.fulfill({
        json: {
          ok: true,
          data: {
            gifts: [
              { id: '100', name: '实际礼物', variantId: 'output', imagePath: '/overtime-gift-images/output.webp' },
              { id: '200', name: '心动盲盒', variantId: 'box', imagePath: '/overtime-gift-images/box.webp' },
              { id: '101', name: '图片缺失', variantId: 'missing', imagePath: '/overtime-gift-images/missing.webp' },
              { id: '102', name: '远程图片', variantId: 'remote', imagePath: 'https://remote.test/gift.webp' },
              { id: '103', name: '动态图片', variantId: 'animation', imagePath: '/overtime-gift-images/gift.gif' },
            ],
          },
        },
      });
    }
    if (url.pathname.startsWith('/overtime-gift-images/')) {
      imageRequests.push(url.pathname);
      if (url.pathname === '/overtime-gift-images/output.webp') {
        return route.fulfill({
          contentType: 'image/webp',
          body: fs.readFileSync('public/img/admin/gifts/bilibili-guard-captain.webp'),
        });
      }
      if (url.pathname === '/overtime-gift-images/gift.gif') {
        return route.fulfill({ contentType: 'image/gif',
          body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    const file = path.resolve('public', '.' + url.pathname);
    assert.ok(file.startsWith(path.resolve('public') + path.sep));
    return route.fulfill({
      body: fs.readFileSync(file),
      contentType: file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : file.endsWith('.webp')
          ? 'image/webp'
          : file.endsWith('.svg')
            ? 'image/svg+xml'
            : 'text/javascript; charset=utf-8',
    });
  });
  await page.goto('http://toast.test/');
  await page.evaluate(async () => {
    const { createToastStack } = await import('/js/shared/toast.js');
    const container = document.createElement('div');
    container.id = 'gift-notice-test';
    container.className = 'toast-stack';
    document.body.append(container);
    window.giftStack = createToastStack({ container });
    const { createGiftNotification } = await import('/js/admin/gifts/notification.js');
    const notification = createGiftNotification({
      notify: (options) => {
        window.currentGiftNotice = giftStack.show({ ...options, duration: 0 });
        return currentGiftNotice;
      },
    });
    const { loadGiftArtworkCatalog } = await import('/js/admin/gifts/artwork-catalog.js');
    await loadGiftArtworkCatalog();
    window.giftRecord = {
      id: 1,
      gift_id: '100',
      gift_variant_id: 'output',
      gift_name: '实际礼物',
      num: 1,
      is_blind_box: true,
      blind_box_id: '200',
      blind_box_variant_id: 'box',
      blind_box_name: '心动盲盒',
    };
    window.notifyGift = notification.notifyNewGift;
    notifyGift([]);
    notifyGift([giftRecord]);
  });
  await page.waitForFunction(() => document.querySelector('#gift-notice-test .gift-notify-artwork.is-loaded'));
  const artwork = await page.locator('#gift-notice-test .gift-notify-artwork').evaluate((node) => {
    window.originalGiftImage = node.querySelector('img');
    return {
      source: originalGiftImage.getAttribute('src'),
    };
  });
  assert.equal(artwork.source, '/overtime-gift-images/output.webp');
  await page.evaluate(() => notifyGift([{ ...giftRecord, num: 2 }]));
  assert.equal(await page.evaluate(() => originalGiftImage === document.querySelector('#gift-notice-test img')), true);
  assert.equal(await page.locator('#gift-notice-test .gift-notify-artwork').count(), 1);
  for (const [id, giftId, variantId] of [
    [2, '101', 'missing'],
    [3, '102', 'remote'],
    [5, '999', 'unknown'],
  ]) {
    await page.evaluate(
      ({ id, giftId, variantId }) => {
        currentGiftNotice.close(true);
        notifyGift([{ id, gift_id: giftId, gift_variant_id: variantId, gift_name: '图片回退示例', num: 1 }]);
      },
      { id, giftId, variantId },
    );
    await page.waitForFunction(() => !document.querySelector('#gift-notice-test img'));
  }
  await page.evaluate(() => {
    currentGiftNotice.close(true);
    notifyGift([{ id: 4, gift_id: '103', gift_variant_id: 'animation', gift_name: '动态图片', num: 1 }]);
  });
  await page.waitForFunction(() => document.querySelector('#gift-notice-test .gift-notify-artwork.is-loaded'));
  assert.equal(await page.locator('#gift-notice-test img').getAttribute('src'), '/overtime-gift-images/gift.gif');
  const discarded = await page.evaluate(() => {
    currentGiftNotice.close(true);
    document.getElementById('gift-notice-test').style.top = `${innerHeight - 8}px`;
    notifyGift([{ ...giftRecord, id: 6 }]);
    return {
      connected: currentGiftNotice.node.isConnected,
      artwork: currentGiftNotice.node.querySelectorAll('.gift-notify-artwork').length,
    };
  });
  assert.equal(discarded.connected, false);
  assert.equal(discarded.artwork, 0);
  assert.equal(catalogRequests, 1);
  assert.deepEqual(imageRequests, ['/overtime-gift-images/output.webp', '/overtime-gift-images/missing.webp', '/overtime-gift-images/gift.gif']);
  await page.evaluate(() => {
    giftStack.dispose();
    document.getElementById('gift-notice-test').remove();
  });
  await t.test('top-layer notifications remain above an open panel without stealing focus and release the layer on close', async () => {
    const result = await page.evaluate(async () => {
      const { createToastStack } = await import('/js/shared/toast.js');
      const panel = document.createElement('section');
      panel.setAttribute('popover', 'manual');
      panel.style.cssText = 'inset:0;margin:0;width:100vw;height:100vh;background:white;';
      const trigger = document.createElement('button');
      trigger.textContent = '处理当前歌曲';
      panel.append(trigger);
      document.body.append(panel);
      panel.showPopover();
      trigger.focus();
      const container = document.createElement('div');
      container.className = 'toast-stack';
      document.body.append(container);
      const stack = createToastStack({ container });
      const handle = stack.show({ key: 'audio', title: '电音助手', message: '请选择原声通道。', type: 'error', topLayer: true });
      const onTop = () => {
        const bounds = handle.node.getBoundingClientRect();
        return handle.node.contains(document.elementFromPoint(bounds.left + 10, bounds.top + 10));
      };
      const firstVisible = onTop();
      const focusKept = document.activeElement === trigger;
      panel.hidePopover();
      panel.showPopover();
      handle.update({ message: '原声仍待恢复。' });
      const updateVisible = onTop();
      handle.close(true);
      const released = !container.hasAttribute('popover');
      const panelOpen = panel.matches(':popover-open');
      stack.show({ message: '另一次提示', topLayer: true });
      stack.dispose();
      const disposed = !container.hasAttribute('popover');
      panel.remove();
      container.remove();
      return { firstVisible, focusKept, updateVisible, released, panelOpen, disposed };
    });
    assert.deepEqual(result, { firstVisible: true, focusKept: true, updateVisible: true, released: true, panelOpen: true, disposed: true });
  });
});
