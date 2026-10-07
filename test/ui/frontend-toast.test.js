'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

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
