'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');
const { createDom, createClock } = require('./helpers/toast-dom');

async function setup(height = 900) {
  const dom = createDom();
  dom.windowRef.innerHeight = height;
  const clock = createClock();
  const { createToastStack } = await loadModuleExports(path.resolve('public/js/shared/toast.js'));
  const stack = createToastStack({
    container: dom.container,
    document: dom.documentRef,
    window: dom.windowRef,
    ...clock,
  });
  return { ...dom, clock, stack };
}

test('a new state replaces content and resets its lifetime without duplicating its node', async () => {
  const { stack, clock, container } = await setup();
  const first = stack.show({ key: 'health', title: '通过', type: 'success', duration: 1000 });
  clock.tick(800);
  const latest = stack.show({ key: 'health', title: '失败', type: 'error', update: true });
  assert.equal(first.node, latest.node);
  assert.match(latest.node.textContent, /失败/);
  clock.tick(1200);
  assert.equal(container.children.length, 1);
  latest.update({ title: '恢复', type: 'success', duration: 1000 });
  clock.tick(999);
  assert.equal(latest.node.isConnected, true);
  clock.tick(181);
  assert.equal(latest.node.isConnected, false);
});

test('duplicate events do not add cards; rapid eviction clears only the owning gift key', async () => {
  for (const count of [8, 10, 20]) {
    const { stack, container, clock } = await setup();
    const options = (index) => ({ key: `gift:${index}`, className: 'gift-notify-toast', message: String(index) });
    for (let index = 0; index < count; index++) stack.show(options(index));
    clock.tick(180);
    assert.equal(container.children.length, 6);
    const stillVisible = stack.show(options(count - 3));
    assert.equal(container.children.length, 6);
    assert.equal(stillVisible.node.isConnected, true);
    stack.dispose();
  }
});

test('closing is idempotent and old exit callbacks cannot remove a recreated key', async () => {
  const { stack, clock } = await setup();
  const old = stack.show({ key: 'same', message: '旧' });
  old.close();
  old.close();
  const current = stack.show({ key: 'same', message: '新' });
  clock.tick(180);
  assert.equal(old.node.isConnected, false);
  assert.equal(current.node.isConnected, true);
  assert.equal(stack.show({ key: 'same' }).node, current.node);
});

test('hover and focus pause independently; action fires once and restores valid focus', async () => {
  const { stack, clock, documentRef } = await setup();
  const trigger = documentRef.createElement('button');
  documentRef.body.append(trigger);
  trigger.focus();
  let calls = 0;
  const handle = stack.show({ key: 'login', message: '登录', onClick: () => calls++ });
  clock.tick(1000);
  handle.node.fire('mouseenter');
  const action = handle.node.children[1];
  action.focus();
  stack.show({ key: 'later', message: '另一操作已完成' });
  assert.equal(documentRef.activeElement, action);
  clock.tick(9000);
  handle.node.fire('mouseleave');
  clock.tick(9000);
  assert.equal(handle.node.isConnected, true);
  action.fire('click');
  action.fire('click');
  assert.equal(calls, 1);
  assert.equal(documentRef.activeElement, trigger);
  clock.tick(180);
  assert.equal(handle.node.isConnected, false);
});

test('persistent progress starts expiry only on completion, including failure', async () => {
  for (const type of ['success', 'error']) {
    const { stack, clock } = await setup();
    const handle = stack.show({ key: 'delete', duration: 0, message: '正在删除' });
    clock.tick(60000);
    assert.equal(handle.node.isConnected, true);
    handle.update({ message: '完成', duration: 2600, type });
    clock.tick(type === 'error' ? 5999 : 2599);
    assert.equal(handle.node.isConnected, true);
    clock.tick(181);
    assert.equal(handle.node.isConnected, false);
  }
});

test('toasts omit close controls for every status and retain only requested actions', async () => {
  const { stack } = await setup();
  for (const type of ['info', 'success', 'warning', 'error']) {
    const handle = stack.show({ key: 'notice', message: '通知内容', type, update: true });
    assert.equal(
      handle.node.children.some((node) => node.className === 'toast-close'),
      false,
    );
    assert.equal(handle.node.children.filter((node) => node.tagName === 'button' && !node.hidden).length, 0);
    handle.update({ onClick() {}, actionLabel: '查看详情' });
    const buttons = handle.node.children.filter((node) => node.tagName === 'button' && !node.hidden);
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].textContent, '查看详情');
  }
});

test('completing an action restores focus past notices without actions', async () => {
  const { stack, documentRef } = await setup();
  const trigger = documentRef.createElement('button');
  documentRef.body.append(trigger);
  trigger.focus();
  stack.show({ key: 'background', message: '正在更新礼物图片', duration: 0 });
  const result = stack.show({ key: 'result', message: '查看详情', onClick() {} });
  result.node.children[1].focus();
  result.node.children[1].fire('click');
  assert.equal(documentRef.activeElement, trigger);
});

test('short notices avoid repeated status headings and updates preserve explicit content', async () => {
  const { stack, documentRef } = await setup();
  for (const [type, label] of Object.entries({ info: '提示', success: '成功', warning: '注意', error: '错误' })) {
    const handle = stack.show({ key: 'result', type, message: '设置已保存', update: true });
    const content = handle.node.children[0];
    assert.equal(content.textContent, '设置已保存');
    assert.equal(content.classList.contains('toast-content-compact'), true);
    assert.equal(content.children[0].getAttribute('aria-hidden'), 'true');
    assert.equal(documentRef.body.children[1].textContent, `${label}：设置已保存`);
    handle.update({ title: '接口检查通过', message: '音乐服务连接正常' });
    assert.equal(content.classList.contains('toast-content-compact'), false);
    assert.deepEqual(
      content.children.map((node) => node.textContent),
      ['接口检查通过', '音乐服务连接正常'],
    );
    handle.update({ message: '' });
    assert.equal(content.children.length, 1);
  }
});

test('closing a focused action moves focus to the next visible action', async () => {
  const { stack, documentRef } = await setup();
  stack.show({ key: 'background', message: '正在更新礼物图片', duration: 0 });
  const next = stack.show({ key: 'next', message: '前往更新页面', onClick() {} });
  const current = stack.show({ key: 'current', message: '登录', onClick() {} });
  current.node.children[1].focus();
  current.close(true);
  assert.equal(documentRef.activeElement, next.node.children[1]);
});

test('small windows retain errors, enforce height and queue system results until they can be read', async () => {
  const { stack, clock, container, windowRef } = await setup(400);
  for (let i = 0; i < 6; i++) stack.show({ key: `gift:${i}`, message: '礼物', className: 'gift-notify-toast' });
  const error = stack.show({ key: 'error', message: '保存失败', type: 'error' });
  for (let i = 0; i < 5; i++) stack.show({ key: `save:${i}`, message: '已保存', duration: 1000 });
  assert.equal(error.node.hidden, false);
  const visible = container.children.filter((node) => !node.hidden);
  assert.ok(visible.length <= 3);
  assert.ok(visible.every((node) => node.getBoundingClientRect().bottom < windowRef.innerHeight));
  clock.tick(5000);
  assert.equal(container.children.filter((node) => !node.hidden).length, 1);
  clock.tick(1180);
  assert.equal(container.children.length, 0);
});

test('gifts do not interrupt status announcements and reduce mode removes synchronously', async () => {
  const { stack, documentRef, windowRef } = await setup();
  stack.show({ key: 'result', message: '已保存', type: 'success' });
  const announcer = documentRef.body.children[1];
  const message = announcer.textContent;
  const gift = stack.show({ key: 'gift:1', message: '礼物', className: 'gift-notify-toast' });
  assert.equal(announcer.textContent, message);
  windowRef.matchMedia = () => ({ matches: true });
  gift.close();
  assert.equal(gift.node.isConnected, false);
  stack.dispose();
  assert.equal(documentRef.body.children.length, 1);
});

test('API errors remain automatic by default and callers can own contextual feedback', async () => {
  const { documentRef, windowRef, container } = createDom();
  const clock = createClock();
  const { api } = await loadModuleExports(path.resolve('public/js/shared/utils.js'), {
    document: documentRef,
    window: windowRef,
    ...clock,
    fetch: async () => ({ status: 500, text: async () => JSON.stringify({ ok: false, error: '网络故障' }) }),
  });
  await assert.rejects(api('/api/settings', {}, { notifyError: false }), /网络故障/);
  assert.equal(container.children.length, 0);
  await assert.rejects(api('/api/settings', {}), /网络故障/);
  assert.equal(container.children.length, 1);
  assert.match(container.children[0].className, /toast-error/);
});

test('browser keeps toast variants free of close controls, aligns content and preserves action focus', async (t) => {
  const fs = require('node:fs');
  const { chromium } = require('playwright');
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
        body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/styles-base.css"><link id="toast-styles" rel="stylesheet" href="/css/admin/toasts.css"><div id="toast" class="toast-stack"></div>',
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
        const result = {
          closeCount: node.querySelectorAll('.toast-close').length,
          hidden: node.hidden,
          paddingRight: getComputedStyle(node).paddingRight,
          background: getComputedStyle(node).backgroundImage,
          titleSize: getComputedStyle(content.querySelector('strong')).fontSize,
          bodySize: getComputedStyle(content.querySelector(':scope > span')).fontSize,
          bodyColor: getComputedStyle(content.querySelector(':scope > span')).color,
          badgeColor: content.querySelector('.gift-price-badge')
            ? getComputedStyle(content.querySelector('.gift-price-badge')).color
            : null,
          badgeSize: content.querySelector('.gift-price-badge')
            ? getComputedStyle(content.querySelector('.gift-price-badge')).fontSize
            : null,
          overflow: node.scrollWidth > node.clientWidth || content.scrollWidth > content.clientWidth,
          actionOffset: action.getBoundingClientRect().left - content.getBoundingClientRect().left,
          actionGap: action.getBoundingClientRect().top - content.getBoundingClientRect().bottom,
        };
        handle.close(true);
        return result;
      },
      { className, hasAction },
    );
    assert.equal(layout.closeCount, 0, className);
    assert.equal(layout.hidden, false, className);
    assert.equal(layout.paddingRight, '16px', className);
    assert.equal(
      layout.background,
      'linear-gradient(125deg, rgb(224, 228, 245) 0%, rgb(211, 216, 239) 45%, rgb(200, 206, 232) 100%)',
      className,
    );
    assert.equal(layout.titleSize, '15px', className);
    assert.equal(layout.bodySize, className.includes('gift-notify') ? '13px' : '14px', className);
    assert.equal(layout.bodyColor, 'rgb(72, 81, 108)', className);
    if (className.includes('gift-notify')) {
      assert.equal(layout.badgeColor, 'rgb(48, 54, 83)', className);
      assert.equal(layout.badgeSize, '13px', className);
    }
    assert.equal(layout.overflow, false, className);
    if (hasAction) {
      assert.equal(layout.actionOffset, 0, className);
      assert.equal(layout.actionGap, 8, className);
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
        height: handle.node.getBoundingClientRect().height,
        iconWidth: icon.width,
        fontSize: getComputedStyle(message).fontSize,
        gap: message.getBoundingClientRect().left - icon.right,
        topOffset: icon.top - message.getBoundingClientRect().top,
      };
      handle.close(true);
      return result;
    }, type);
    assert.equal(compact.text, '设置已保存');
    assert.ok(compact.height < 60);
    assert.equal(compact.iconWidth, 18);
    assert.equal(compact.fontSize, '14px');
    assert.equal(compact.gap, 8);
    assert.equal(compact.topOffset, 2);
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
    await AdminApp.gifts.recent.loadGiftArtworkCatalog();
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
      background: getComputedStyle(node).backgroundImage,
      textGap: node.parentNode.querySelector('.toast-content').getBoundingClientRect().left - bounds.right,
    };
  });
  assert.equal(artwork.source, '/overtime-gift-images/output.webp');
  assert.equal(artwork.width, 40);
  assert.equal(artwork.height, 40);
  assert.equal(artwork.fit, 'contain');
  assert.equal(artwork.decoding, 'async');
  assert.equal(artwork.background, 'none');
  assert.equal(artwork.textGap, 12);
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
    assert.equal(fallback.width, 40);
    assert.equal(fallback.height, 40);
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
    paddingRight: getComputedStyle(node).paddingRight,
    progressHeight: getComputedStyle(node.querySelector('progress')).height,
    countSize: getComputedStyle(node.querySelector('.toast-message')).fontSize,
    overflow: node.scrollWidth > node.clientWidth,
  }));
  assert.equal(catalog.closeCount, 0);
  assert.equal(catalog.paddingRight, '16px');
  assert.equal(catalog.progressHeight, '4px');
  assert.equal(catalog.countSize, '13px');
  assert.equal(catalog.overflow, false);
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
    paddingRight: getComputedStyle(lastAuditNode).paddingRight,
  }));
  assert.equal(audit.same, true);
  assert.equal(audit.count, 1);
  assert.equal(audit.overflow, false);
  assert.equal(audit.iconWidth, 18);
  assert.equal(audit.closeCount, 0);
  assert.equal(audit.paddingRight, '16px');
  assert.ok(audit.bottom < 664);
});
