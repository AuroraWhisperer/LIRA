'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');

async function fixture(t, types = ['queue']) {
  const runtime = await startCanvasOutputFixture({ notifications: true });
  t.after(() => runtime.close());
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  const item = type => ({ id: randomUUID(), type, name: type, x: 0, y: 0, width: 640, height: 400,
    visible: true, locked: false, appearance: { mode: 'independent', config: runtime.configs[type] } });
  const created = runtime.service.create({ title: 'Synthetic live updates', canvas: { width: 1280, height: 720 } });
  const saved = runtime.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: types.map(item) } });
  runtime.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const source = runtime.service.getSource(saved.document.id);
  const url = `${runtime.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(url)).status, 200);
  return { ...runtime, page, saved, source, url, item };
}

function responseFor(pathname, version) {
  return response => {
    const url = new URL(response.url());
    return url.pathname === pathname && response.status() === 200
      && url.searchParams.get('version') === String(version);
  };
}

async function openSubscribed(f) {
  const subscription = f.page.waitForResponse(responseFor('/api/scene/events', 1));
  const activeRead = f.page.waitForResponse(responseFor('/api/scene/output', 1));
  await f.page.goto(f.url);
  await subscription;
  await (await activeRead).finished();
  await f.page.frameLocator('iframe[title="queue"]').getByText('合成实时歌曲').waitFor();
}

test('scene notifications update live queue and cloud data without idle polling or frame reloads', { timeout: 20000 }, async t => {
  const f = await fixture(t, ['queue', 'danmaku']);
  const reads = [];
  f.page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/scene/output') reads.push(request);
  });
  await openSubscribed(f);
  // Settle the ready/commit reads before observing longer than the old poll interval.
  await f.page.waitForTimeout(250);
  const baseline = reads.length;
  await f.page.waitForTimeout(1600);
  assert.equal(reads.length, baseline, 'a healthy idle stream does not poll every 750ms');
  const frames = f.page.frames().filter(frame => frame.parentFrame());
  const queue = frames.find(frame => new URL(frame.url()).pathname === '/queue');
  const cloud = frames.find(frame => new URL(frame.url()).pathname === '/danmaku');
  const updateRead = f.page.waitForResponse(responseFor('/api/scene/output', 1));
  f.runtime.queue.waiting[0].song_name = '通知刷新后的歌曲';
  f.notify({ types: ['queue'] });
  assert.equal(f.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '合成观众',
    message: '通知推送的实时弹幕', emotes: [] }), true);
  await updateRead;
  await queue.getByText('通知刷新后的歌曲').waitFor();
  await cloud.getByText('通知推送的实时弹幕').waitFor();
  assert.deepEqual(f.page.frames().filter(frame => frame.parentFrame()), frames);
  assert.equal(reads.length, baseline + 1, 'simultaneous component notifications share one output read');
  assert.equal(new URL(reads.at(-1).url()).searchParams.has('projection'), true);
});

test('notification subscriptions retain failed-publication consumers then advance and revoke with the renderer', { timeout: 25000 }, async t => {
  const f = await fixture(t);
  await openSubscribed(f);
  const old = f.page.frames().find(frame => new URL(frame.url()).pathname === '/queue');
  await f.page.route('**/clock?*', route => route.fulfill({ contentType: 'text/html',
    body: '<script>parent.postMessage({ type: "component-preview:status" }, "*");</script>' }));
  const next = f.service.save({ id: f.source.id, expectedRevision: f.saved.revision,
    document: { ...f.saved.document, items: [f.item('clock')] } });
  f.service.publish({ id: f.source.id, expectedRevision: next.revision });
  await f.page.waitForFunction(() => document.getElementById('sceneStatus').textContent.includes('新版准备失败'));
  const retainedRead = f.page.waitForResponse(responseFor('/api/scene/output', 1));
  f.runtime.queue.waiting[0].song_name = '旧版仍收到通知';
  f.notify({ types: ['queue'] });
  await retainedRead;
  await old.getByText('旧版仍收到通知').waitFor();
  await f.page.locator('.scene-version.is-staging').waitFor({ state: 'detached' });
  await f.page.unroute('**/clock?*');
  const committed = f.page.waitForResponse(responseFor('/api/scene/events', 2));
  f.notify({ id: f.source.id });
  await committed;
  await f.page.frameLocator('.scene-version:not(.is-staging) iframe').locator('#clockCard').waitFor();
  assert.equal(old.isDetached(), true);
  f.service.rotate(f.source.id);
  await f.page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  assert.equal(await f.page.locator('#sceneStatus').isVisible(), true);
});

test('a missing notification endpoint keeps output live and reconnects when it becomes available', { timeout: 20000 }, async t => {
  const f = await fixture(t);
  let available = false;
  await f.page.route('**/api/scene/events?*', route => available ? route.continue()
    : route.fulfill({ status: 404, contentType: 'application/json', body: '{"ok":false}' }));
  await f.page.goto(f.url);
  const queue = f.page.frameLocator('iframe[title="queue"]');
  await queue.getByText('合成实时歌曲').waitFor();
  f.runtime.queue.waiting[0].song_name = '回退轮询仍更新';
  await queue.getByText('回退轮询仍更新').waitFor();
  const connected = f.page.waitForResponse(responseFor('/api/scene/events', 1));
  available = true;
  await connected;
  f.runtime.queue.waiting[0].song_name = '通知恢复后的歌曲';
  f.notify({ types: ['queue'] });
  await queue.getByText('通知恢复后的歌曲').waitFor();
});
