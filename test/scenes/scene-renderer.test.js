'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { servePageOrAsset } = require('../../src/server/http-utils');
const { getClockConfig } = require('../../src/server/clock-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { createLayout } = require('../../src/shared/danmaku-layout');
const { createSceneComponentPorts } = require('../../src/server/scene-components');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { randomUUID } = require('node:crypto');

test('real polling keeps removed queue data until the replacement successfully commits', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  const created = fixture.service.create({ title: 'retained output', canvas: { width: 1920, height: 1080 } });
  const item = type => ({ id: randomUUID(), type, name: type, x: 0, y: 0, width: 400, height: 300,
    visible: true, locked: false, appearance: { mode: 'independent', config: fixture.configs[type] } });
  let saved = fixture.service.save({ id: created.document.id, expectedRevision: 1,
    document: { ...created.document, items: [item('queue')] } });
  fixture.service.publish({ id: created.document.id, expectedRevision: saved.revision });
  const { id, token } = fixture.service.getSource(created.document.id);
  const url = `${fixture.origin}/scene?id=${id}#token=${token}`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.frameLocator('.scene-version:not(.is-staging) iframe').getByText('合成实时歌曲').waitFor();
  const old = page.frames().find(frame => new URL(frame.url()).pathname === '/queue');
  await page.route('**/clock?*', route => route.abort());
  saved = fixture.service.save({ id, expectedRevision: saved.revision, document: { ...saved.document, items: [item('clock')] } });
  fixture.service.publish({ id, expectedRevision: saved.revision });
  await page.waitForFunction(() => document.querySelector('#sceneStatus').textContent.includes('新版准备失败'));
  fixture.runtime.queue.waiting[0].song_name = 'removed type still live';
  await old.getByText('removed type still live').waitFor();
  await page.unroute('**/clock?*');
  await page.waitForFunction(() => document.querySelector('.scene-version:not(.is-staging) iframe')?.title === 'clock', null, { timeout: 15000 });
  assert.equal(old.isDetached(), true);
  fixture.service.rotate(id);
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
});

test('real source prepares complete versions, keeps prior output on failure and sends real data without child credentials', async (t) => {
  const settings = { ...DEFAULT_SETTINGS, overlayQueueStyle: 'classic' };
  const runtime = { settings, queue: { current: null, waiting: [{ id: 1, song_name: '真实队列歌曲', requester: '观众' }] },
    superChats: [], overtime: { revision: 1, enabled: true, status: 'paused', effectiveRemainingMs: 120000,
      initialSeconds: 120, serverNowMs: Date.now(), rules: [], settlements: [], background: { path: '', fit: 'cover' } } };
  const ports = createSceneComponentPorts({ getState: () => runtime, cloud: {} });
  const item = (type, index, config) => ({ id: `instance-${index}`, type, name: type, x: index * 210, y: 0,
    width: 210, height: 360, visible: true, locked: false, appearance: { mode: 'independent', config } });
  const clockConfig = { ...getClockConfig(settings), style: 'digital' };
  let version = 1;
  let document = { schemaVersion: 1, id: 'fixture', title: 'Fixture', canvas: { width: 1050, height: 600 }, items: [
    item('clock', 0, clockConfig), item('clock', 1, { ...clockConfig, style: 'peach' }),
    item('queue', 2, ports.getDefaultConfig('queue')), item('overtime', 3, ports.getDefaultConfig('overtime')),
    item('danmaku', 4, { style: 'signal', fullscreenDurationSeconds: 6, styleOptions: {}, layout: createLayout() }),
  ] };
  let cloudEpoch = 'first';
  let cloudCursor = 0;
  let liveStatus = 1;
  let revoked = false;
  const events = [];
  const childApi = [];
  const errors = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/scene/output') {
      res.setHeader('Access-Control-Allow-Origin', 'null');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (revoked) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false }));
      }
      assert.equal(req.headers.authorization, 'Bearer synthetic-source-secret');
      const reset = url.searchParams.get('epoch') !== cloudEpoch;
      const cursor = Number(url.searchParams.get('cursor'));
      const data = ports.getDisplayData(['queue', 'overtime'], {});
      data.danmaku = { epoch: cloudEpoch, nextCursor: cloudCursor, status: 'connected', reset, gap: false,
        state: { liveStatus, liveSessionId: liveStatus ? 'live' : null, confirmationMessage: '直播已连接' },
        events: reset ? [] : events.filter((entry) => entry.cursor > cursor).map((entry) => entry.event) };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, data: { sceneId: 'fixture', version,
        document: Number(url.searchParams.get('version')) === version ? null : document, data } }));
    }
    if (url.pathname.startsWith('/api/')) childApi.push(url.pathname);
    servePageOrAsset(path.resolve(__dirname, '../../public'), req, res, url, 'synthetic-admin');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1050, height: 600 } });
  page.on('pageerror', (error) => errors.push(error.message));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/scene?id=fixture`)).status, 200);
  await page.goto(`${origin}/scene?id=fixture#token=synthetic-source-secret`);
  await page.waitForFunction(() => document.querySelectorAll('.scene-version:not(.is-staging) iframe').length === 5);
  const frames = () => page.frames().filter((frame) => frame.parentFrame());
  assert.equal(frames().length, 5);
  for (const frame of frames()) {
    assert.equal(await frame.evaluate(() => window.__API_TOKEN__), undefined);
    assert.doesNotMatch(frame.url(), /synthetic-source-secret|synthetic-admin/);
  }
  const cloudFrame = () => frames().find((frame) => new URL(frame.url()).pathname === '/danmaku');
  const queueFrame = frames().find((frame) => new URL(frame.url()).pathname === '/queue');
  await queueFrame.getByText('真实队列歌曲').first().waitFor();
  assert.equal(await cloudFrame().locator('#danmakuMessageCount').textContent(), '01');
  events.push({ cursor: ++cloudCursor, event: { type: 'danmaku', liveSessionId: 'live', name: '真实观众', message: '这是直播消息', emotes: [] } });
  await cloudFrame().getByText('这是直播消息').first().waitFor();
  const oldFrames = frames();
  document = structuredClone(document);
  document.items[4].appearance.config.style = 'invalid';
  version = 2;
  await page.waitForFunction(() => document.querySelector('#sceneStatus').textContent.includes('新版准备失败'));
  assert.deepEqual(frames(), oldFrames);
  runtime.queue.waiting[0].song_name = '新版失败后继续更新';
  await queueFrame.getByText('新版失败后继续更新').first().waitFor();
  document.items[4].appearance.config.style = 'signal';
  document.items[0].appearance.config.label = '新版时钟';
  version = 3;
  await page.waitForFunction(() => document.querySelectorAll('.scene-version').length === 1
    && document.querySelectorAll('.scene-version:not(.is-staging) iframe').length === 5);
  await page.waitForFunction(() => document.querySelector('#sceneStatus').textContent === '');
  assert.ok(oldFrames.every((frame) => frame.isDetached()));
  const committedFrames = frames();
  liveStatus = 0;
  cloudEpoch = 'offline';
  await cloudFrame().waitForFunction(() => document.querySelector('#danmakuMessageCount').textContent === '00');
  assert.deepEqual(frames(), committedFrames);
  revoked = true;
  await page.waitForFunction(() => document.querySelectorAll('iframe').length === 0);
  assert.deepEqual(childApi, []);
  assert.deepEqual(errors, []);
});
