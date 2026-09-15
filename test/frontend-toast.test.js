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
  const stack = createToastStack({ container: dom.container, document: dom.documentRef, window: dom.windowRef, ...clock });
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
  old.close(); old.close();
  const current = stack.show({ key: 'same', message: '新' });
  clock.tick(180);
  assert.equal(old.node.isConnected, false);
  assert.equal(current.node.isConnected, true);
  assert.equal(stack.show({ key: 'same' }).node, current.node);
});

test('hover and focus pause independently; action fires once and restores valid focus', async () => {
  const { stack, clock, documentRef } = await setup();
  const trigger = documentRef.createElement('button');
  documentRef.body.append(trigger); trigger.focus();
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
  action.fire('click'); action.fire('click');
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

test('closing another toast restores focus past a background notice without a close button', async () => {
  const { stack, documentRef } = await setup();
  const trigger = documentRef.createElement('button');
  documentRef.body.append(trigger);
  trigger.focus();
  stack.show({ key: 'background', message: '正在更新礼物图片', duration: 0, dismissible: false });
  const result = stack.show({ key: 'result', message: '已保存' });
  result.node.children[2].focus();
  result.node.children[2].fire('click');
  assert.equal(documentRef.activeElement, trigger);
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
    document: documentRef, window: windowRef, ...clock,
    fetch: async () => ({ status: 500, text: async () => JSON.stringify({ ok: false, error: '网络故障' }) }),
  });
  await assert.rejects(api('/api/settings', {}, { notifyError: false }), /网络故障/);
  assert.equal(container.children.length, 0);
  await assert.rejects(api('/api/settings', {}), /网络故障/);
  assert.equal(container.children.length, 1);
  assert.match(container.children[0].className, /toast-error/);
});

test('browser preserves toast focus, hides the catalog close button and keeps audit results within bounds', async (t) => {
  const fs = require('node:fs');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.hostname, 'toast.test');
    if (url.pathname === '/') return route.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/css/admin/toasts/system.css"><div id="toast" class="toast-stack"></div>',
    });
    const file = path.resolve('public', '.' + url.pathname);
    assert.ok(file.startsWith(path.resolve('public') + path.sep));
    return route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' });
  });
  await page.goto('http://toast.test/');
  await page.evaluate(async () => {
    const { showStackedToast } = await import('/js/shared/toast.js');
    const first = showStackedToast({ key: 'login', message: '登录', duration: 0, onClick: () => { window.clicked = true; } });
    first.node.querySelector('.toast-action').focus();
    showStackedToast({ key: 'later', message: '保存失败', type: 'error' });
  });
  assert.equal(await page.locator('.toast-action:focus').count(), 1);
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => window.clicked), true);
  await page.addStyleTag({ content: fs.readFileSync('public/css/styles-base.css', 'utf8') });
  await page.addStyleTag({ content: fs.readFileSync('public/css/admin/toasts/gifts.css', 'utf8') });
  await page.evaluate(async () => {
    const { createGiftCatalogUpdateToast } = await import('/js/admin/gifts/catalog-update-toast.js');
    window.catalogToast = createGiftCatalogUpdateToast();
    catalogToast.handleState({ status: 'updating', phase: 'images', total: 100, completed: 40, available: 40 });
  });
  const catalog = await page.locator('.gift-catalog-update-toast').evaluate((node) => ({
    closeDisplay: getComputedStyle(node.querySelector('.toast-close')).display,
    paddingRight: getComputedStyle(node).paddingRight,
    progressHeight: getComputedStyle(node.querySelector('progress')).height,
    overflow: node.scrollWidth > node.clientWidth,
  }));
  assert.equal(catalog.closeDisplay, 'none');
  assert.equal(catalog.paddingRight, '18px');
  assert.equal(catalog.progressHeight, '4px');
  assert.equal(catalog.overflow, false);
  await page.evaluate(() => catalogToast.dispose());
  await page.evaluate(async () => {
    document.querySelector('link').href = '/css/gift-audit.css';
    document.getElementById('toast').remove();
    const { showToast } = await import('/js/gift-audit/view.js');
    window.auditNode = showToast('第一次', 'ok').node;
    showToast('第二次', 'warn');
    window.lastAuditNode = showToast('第三次 ' + 'a'.repeat(300), 'ok').node;
  });
  await page.waitForFunction(() => document.querySelector('link').sheet?.cssRules.length > 10);
  const audit = await page.evaluate(() => ({
    same: auditNode === lastAuditNode,
    count: document.querySelectorAll('.audit-toast-stack .toast').length,
    bottom: lastAuditNode.getBoundingClientRect().bottom,
    overflow: lastAuditNode.scrollWidth > lastAuditNode.clientWidth,
    iconWidth: lastAuditNode.querySelector('.toast-kind svg').getBoundingClientRect().width,
  }));
  assert.equal(audit.same, true);
  assert.equal(audit.count, 1);
  assert.equal(audit.overflow, false);
  assert.equal(audit.iconWidth, 16);
  assert.ok(audit.bottom < 664);
});
