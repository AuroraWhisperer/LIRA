'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom, createClock } = require('../helpers/toast-dom');

const settle = () => new Promise(setImmediate);
function fixture(extra = {}) {
  const dom = createDom();
  const clock = createClock();
  return { ...dom, clock, load: (file) => loadModuleExports(path.resolve('public/js', file), {
    document: dom.documentRef, window: dom.windowRef, ...clock, ...extra,
  }) };
}

test('component saves report failures, preserve later edits and ignore reset sessions', async () => {
  const f = fixture();
  const { createComponentConfigController } = await f.load('admin/component-config-controller.js');
  const { saveComponentWithFeedback } = await f.load('admin/component-save-feedback.js');
  let write;
  const controller = createComponentConfigController({ initial: { size: 20 }, persist: () => {
    write = Promise.withResolvers();
    return write.promise;
  } });
  await saveComponentWithFeedback(controller, '点歌板主题');
  assert.equal(f.container.children.length, 0, 'unchanged forms stay quiet');
  controller.edit({ size: 24 });
  const failed = saveComponentWithFeedback(controller, '点歌板主题');
  write.reject(new Error('offline'));
  await failed;
  assert.match(f.container.textContent, /offline/);
  assert.equal(controller.getState().saved.size, 20);
  assert.equal(controller.getState().draft.size, 24);
  assert.equal(controller.getState().dirty, true);
  const success = saveComponentWithFeedback(controller, '点歌板主题');
  controller.edit({ size: 28 });
  write.resolve({ size: 24 });
  await success;
  assert.equal(f.container.children.length, 1);
  assert.match(f.container.textContent, /新修改还没保存/);
  f.clock.tick(10000);
  const reset = saveComponentWithFeedback(controller, '点歌板主题');
  controller.reset();
  write.resolve({ size: 28 });
  await reset;
  assert.equal(f.container.children.length, 0, 'a previous session cannot announce success');
});

test('media resume reports a readable error but skips interruptions and handled media errors', async () => {
  const f = fixture();
  const { notifyMediaPlayFailure } = await f.load('shared/media-playback-feedback.js');
  notifyMediaPlayFailure({ name: 'AbortError' }, {});
  notifyMediaPlayFailure(new Error('The play() request was interrupted'), {});
  notifyMediaPlayFailure(new Error('decode error'), { error: { code: 3 } });
  assert.equal(f.container.children.length, 0);
  notifyMediaPlayFailure({ name: 'NotAllowedError' }, {});
  notifyMediaPlayFailure({ name: 'NotAllowedError' }, {});
  assert.equal(f.container.children.length, 1);
  assert.match(f.container.textContent, /暂时无法播放，请再点一次播放/);
});

test('reminder failures notify outside the editor once and announce recovery', async () => {
  const f = fixture({ crypto: { randomUUID: () => 'event-1' } });
  const pending = [];
  f.windowRef.localStorage = { getItem: () => null, setItem() {} };
  f.windowRef.plannerReminders = { sync() {
    const request = Promise.withResolvers();
    pending.push(request);
    return request.promise;
  } };
  const { todo } = await f.load('admin/streamer-planner.js');
  const event = todo.addEvent({ title: '直播', date: '2026-10-05', time: '20:00', reminderTime: '20:00' });
  pending[0].reject(new Error('IPC unavailable'));
  await settle();
  assert.match(f.container.textContent, /提醒没设好/);
  f.clock.tick(10000);
  todo.updateEvent(event.id, { title: '直播改名' });
  pending[1].resolve({ ok: false });
  await settle();
  assert.equal(f.container.children.length, 0, 'repeated failure stays quiet after dismissal');
  todo.updateEvent(event.id, { title: '直播改名2' });
  pending[2].resolve({ ok: true, supported: true });
  await settle();
  assert.match(f.container.textContent, /日程提醒已恢复/);
  f.clock.tick(10000);
  todo.updateEvent(event.id, { title: '旧修改' });
  todo.updateEvent(event.id, { title: '新修改' });
  pending[4].resolve({ ok: true, supported: true });
  await settle();
  pending[3].resolve({ ok: false });
  await settle();
  assert.equal(f.container.children.length, 0, 'late failed requests stay quiet');
});

test('gift effect copy handles clipboard and fallback failures without an unhandled rejection', async () => {
  const f = fixture({ location: { protocol: 'http:', port: '3000' },
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
  const lookup = f.documentRef.getElementById;
  const nodes = new Map();
  f.documentRef.getElementById = (id) => {
    if (id === 'toast') return lookup(id);
    if (!nodes.has(id)) nodes.set(id, f.documentRef.createElement('div'));
    return nodes.get(id);
  };
  f.documentRef.execCommand = () => false;
  const create = f.documentRef.createElement;
  f.documentRef.createElement = (tag) => Object.assign(create(tag), { select() {} });
  const { giftEffects } = await f.load('admin/gift-effects.js');
  giftEffects.init();
  await nodes.get('giftEffectCopyBtn').listeners.get('click')();
  assert.match(f.container.textContent, /网址没复制成功/);
  assert.equal(f.container.children.length, 1);
});
