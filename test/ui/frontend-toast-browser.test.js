'use strict';

// Real Chromium layout and focus checks for the shared toast stack; the VM
// behaviour tests for the same owner live in frontend-toast.test.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { chromium } = require('playwright');

test('browser keeps toast variants free of close controls, aligns content and preserves action focus', async (t) => {
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
    const { showStackedToast } = await import('/js/shared/toast.js');
    const first = showStackedToast({
      key: 'login',
      message: '登录',
      duration: 0,
      onClick: () => {
        window.clicked = true;
      },
    });
    first.node.querySelector('.toast-action').focus();
    showStackedToast({ key: 'later', message: '保存失败', type: 'error' });
  });
  assert.equal(await page.locator('.toast-action:focus').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.clicked), true);
  for (const [className, hasAction] of [
    ['', false],
    ['xiaomi-ai-test-toast xiaomi-ai-test-toast-good', false],
    ['xiaomi-ai-test-toast xiaomi-ai-test-toast-warn', false],
    ['playback-login-toast', true],
    ['playback-empty-queue-toast', false],
    ['playback-health-toast-good', false],
    ['playback-health-toast-warn', false],
    ['music-cookie-refreshed-toast', false],
    ['admin-live-refresh-toast', false],
    ['desktop-update-toast', true],
    ['desktop-update-toast desktop-update-toast-good', true],
    ...['', 'gift-guard', 'gift-free', 'gift-blind-box', 'gift-premium'].map((variant) => [
      `gift-notify-toast ${variant}`,
      false,
    ]),
  ]) {
    const layout = await page.evaluate(
      async ({ className, hasAction }) => {
        const { showStackedToast } = await import('/js/shared/toast.js');
        const handle = showStackedToast({
          key: 'layout',
          className,
          title: '通知标题',
          message: '通知说明 '.repeat(12),
          html: className.includes('gift-notify')
            ? '<strong><span class="gift-notify-name">星空下的梦幻浪漫纪念礼物 x999</span><span class="gift-price-badge">¥128,000.00</span></strong><span>名字稍长的观众也完整显示 · 来自心动盲盒</span>'
            : undefined,
          duration: 0,
          onClick: hasAction ? () => {} : undefined,
        });
        const node = handle.node;
        const content = node.querySelector('.toast-content');
        const action = node.querySelector('.toast-action');
        const tokenColor = (token) => {
          const probe = document.createElement('i');
          probe.style.color = `var(${token})`;
          document.body.append(probe);
          const color = getComputedStyle(probe).color;
          probe.remove();
          return color;
        };
        const result = {
          mutedColor: tokenColor('--color-toast-secondary'),
          textColor: tokenColor('--color-toast-text'),
          closeCount: node.querySelectorAll('.toast-close').length,
          hidden: node.hidden,
          titleSize: getComputedStyle(content.querySelector('strong')).fontSize,
          bodySize: getComputedStyle(content.querySelector(':scope > span')).fontSize,
          bodyColor: getComputedStyle(content.querySelector(':scope > span')).color,
          badgeColor: content.querySelector('.gift-price-badge')
            ? getComputedStyle(content.querySelector('.gift-price-badge')).color
            : null,
          overflow: node.scrollWidth > node.clientWidth || content.scrollWidth > content.clientWidth,
          actionGap: action.getBoundingClientRect().top - content.getBoundingClientRect().bottom,
        };
        handle.close(true);
        return result;
      },
      { className, hasAction },
    );
    assert.equal(layout.closeCount, 0, className);
    assert.equal(layout.hidden, false, className);
    assert.equal(layout.bodyColor, layout.mutedColor, className);
    if (className.includes('gift-notify')) {
      assert.equal(layout.badgeColor, layout.textColor, className);
    }
    assert.ok(Number.parseFloat(layout.titleSize) >= 12, className);
    assert.ok(Number.parseFloat(layout.bodySize) >= 12, className);
    assert.equal(layout.overflow, false, className);
    if (hasAction) {
      assert.ok(layout.actionGap >= 0, className);
    }
  }
  for (const type of ['info', 'success', 'warning', 'error']) {
    const compact = await page.evaluate(async (type) => {
      const { showStackedToast } = await import('/js/shared/toast.js');
      const handle = showStackedToast({ key: 'compact', type, message: '设置已保存', duration: 0 });
      const content = handle.node.querySelector('.toast-content');
      const icon = content.querySelector('svg').getBoundingClientRect();
      const message = content.querySelector('.toast-message');
      const result = {
        text: content.textContent,
        iconWidth: icon.width,
        fontSize: getComputedStyle(message).fontSize,
        gap: message.getBoundingClientRect().left - icon.right,
      };
      handle.close(true);
      return result;
    }, type);
    assert.equal(compact.text, '设置已保存');
    assert.ok(compact.gap >= 0);
    assert.ok(Number.parseFloat(compact.fontSize) >= 12);
    assert.ok(compact.iconWidth > 0);
  }
  const themed = await page.evaluate(async () => {
    const { showStackedToast } = await import('/js/shared/toast.js');
    const handle = showStackedToast({ key: 'theme-switch', message: '配色已应用', actionLabel: '查看', onClick: () => {}, duration: 0 });
    const probe = document.createElement('i');
    document.body.append(probe);
    const tokenColor = token => {
      if (!getComputedStyle(probe).getPropertyValue(token).trim()) throw new Error(`Missing theme token: ${token}`);
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const colors = ['terracotta', 'neutral', 'classic', 'clear-jade', 'black-silver'].map((theme) => {
      document.documentElement.dataset.clientTheme = theme;
      const style = getComputedStyle(handle.node);
      const actionStyle = getComputedStyle(handle.node.querySelector('.toast-action'));
      return { theme, background: style.backgroundImage, text: style.color,
        actionText: actionStyle.color, actionFill: actionStyle.backgroundColor,
        expected: {
          background: ['--color-toast-start', '--color-toast-mid', '--color-toast-end'].map(tokenColor),
          text: tokenColor('--color-toast-text'), actionText: tokenColor('--color-toast-on-accent'),
          actionFill: tokenColor('--color-toast-accent'),
        } };
    });
    const connected = handle.node.isConnected;
    probe.remove();
    handle.close(true);
    return { colors, connected };
  });
  assert.equal(themed.connected, true);
  for (const { theme, background, text, actionText, actionFill, expected } of themed.colors) {
    assert.ok(expected.background.every(color => background.includes(color)), `${theme}: background follows theme tokens`);
    assert.equal(text, expected.text, `${theme}: toast text follows the theme`);
    assert.equal(actionText, expected.actionText, `${theme}: action text follows the theme`);
    assert.equal(actionFill, expected.actionFill, `${theme}: action fill follows the theme`);
  }
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
    const { giftRecent } = await import('/js/admin/gifts/recent.js');
    await giftRecent.loadGiftArtworkCatalog();
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
    const bounds = originalGiftImage.getBoundingClientRect();
    return {
      source: originalGiftImage.getAttribute('src'),
      width: bounds.width,
      height: bounds.height,
      fit: getComputedStyle(originalGiftImage).objectFit,
      decoding: originalGiftImage.decoding,
      textGap: node.parentNode.querySelector('.toast-content').getBoundingClientRect().left - bounds.right,
    };
  });
  assert.equal(artwork.source, '/overtime-gift-images/output.webp');
  assert.equal(artwork.fit, 'contain');
  assert.equal(artwork.decoding, 'async');
  assert.ok(artwork.textGap >= 0);
  assert.ok(artwork.width > 0 && artwork.height > 0);
  await page.evaluate(() => notifyGift([{ ...giftRecord, num: 2 }]));
  assert.equal(await page.evaluate(() => originalGiftImage === document.querySelector('#gift-notice-test img')), true);
  assert.equal(await page.locator('#gift-notice-test .gift-notify-artwork').count(), 1);
  for (const [id, giftId, variantId] of [
    [2, '101', 'missing'],
    [3, '102', 'remote'],
    [4, '103', 'animation'],
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
    const fallback = await page.locator('#gift-notice-test .gift-notify-artwork').evaluate((node) => ({
      background: getComputedStyle(node).backgroundImage,
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
    }));
    assert.match(fallback.background, /gift-toast-fallback\.svg/);
    assert.ok(fallback.width > 0 && fallback.height > 0);
  }
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
  assert.deepEqual(imageRequests, ['/overtime-gift-images/output.webp', '/overtime-gift-images/missing.webp']);
  await page.evaluate(() => {
    giftStack.dispose();
    document.getElementById('gift-notice-test').remove();
  });
  await page.evaluate(async () => {
    const { createGiftCatalogUpdateToast } = await import('/js/admin/gifts/catalog-update-toast.js');
    window.catalogToast = createGiftCatalogUpdateToast();
    catalogToast.handleState({ status: 'updating', phase: 'images', total: 100, completed: 40, available: 40 });
  });
  const catalog = await page.locator('.gift-catalog-update-toast').evaluate((node) => ({
    closeCount: node.querySelectorAll('.toast-close').length,
    progressHeight: getComputedStyle(node.querySelector('progress')).height,
    countSize: getComputedStyle(node.querySelector('.toast-message')).fontSize,
    overflow: node.scrollWidth > node.clientWidth,
  }));
  assert.equal(catalog.closeCount, 0);
  assert.equal(catalog.overflow, false);
  assert.ok(Number.parseFloat(catalog.progressHeight) > 0);
  assert.ok(Number.parseFloat(catalog.countSize) >= 12);
  await page.evaluate(() => catalogToast.dispose());
  await page.evaluate(async () => {
    document.getElementById('toast-styles').href = '/css/gift-audit.css';
    document.getElementById('toast').remove();
    const { showToast } = await import('/js/gift-audit/view.js');
    window.auditNode = showToast('第一次', 'ok').node;
    showToast('第二次', 'warn');
    window.lastAuditNode = showToast('第三次 ' + 'a'.repeat(300), 'ok').node;
  });
  await page.waitForFunction(() => document.getElementById('toast-styles').sheet?.href.endsWith('/css/gift-audit.css'));
  const audit = await page.evaluate(() => ({
    same: auditNode === lastAuditNode,
    count: document.querySelectorAll('.audit-toast-stack .toast').length,
    bottom: lastAuditNode.getBoundingClientRect().bottom,
    overflow: lastAuditNode.scrollWidth > lastAuditNode.clientWidth,
    iconWidth: lastAuditNode.querySelector('.toast-symbol svg').getBoundingClientRect().width,
    closeCount: lastAuditNode.querySelectorAll('.toast-close').length,
  }));
  assert.equal(audit.same, true);
  assert.equal(audit.count, 1);
  assert.equal(audit.overflow, false);
  assert.equal(audit.closeCount, 0);
  assert.ok(audit.bottom <= page.viewportSize().height);
  assert.ok(audit.iconWidth > 0);
});
