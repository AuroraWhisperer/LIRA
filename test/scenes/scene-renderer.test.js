'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { useSharedBrowser } = require('../helpers/shared-browser');
const { servePageOrAsset } = require('../../src/server/page-assets');
const { getClockConfig } = require('../../src/server/clock-contract');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { createLayout } = require('../../src/shared/danmaku-layout');
const { createSceneComponentPorts } = require('../../src/server/scene-components');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');
const { createTextBoxDefaults } = require('../../public/js/shared/text-box-config.js');
const { createSceneExtraDefaults } = require('../../public/js/shared/scene-extra-components.js');
const { randomUUID } = require('node:crypto');

const openBrowserSession = useSharedBrowser();
const textBoxItem = (config, x = 0) => ({ id: randomUUID(), type: 'text-box', name: '文本框', x, y: 0, width: 640, height: 180,
  visible: true, locked: false, appearance: { mode: 'independent', config } });

function publishLayer(fixture, type, config) {
  const created = fixture.service.create({ title: type, canvas: { width: 800, height: 600 } });
  const layer = { id: randomUUID(), type, name: type, x: 0, y: 0, width: 800, height: 600,
    visible: true, locked: false, appearance: { mode: 'independent', config } };
  const saved = fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [layer] } });
  fixture.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const { id, token } = fixture.service.getSource(saved.document.id);
  return `${fixture.origin}/scene?id=${id}#token=${token}`;
}

test('ranking output keeps its room and rows during 503 and drops them on revocation', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const now = Date.now();
  const row = { roomId: '88', rank: 1, score: 42, name: '榜单房间' };
  const snapshot = { version: 'rank-1', room: { roomId: row.roomId }, boards: [{ id: 'hot', title: '热门',
    status: 'ready', updatedAt: now, unit: '热度', rows: [row], current: row }] };
  t.mock.method(fixture.liveRankings, 'getSnapshot', () => snapshot);
  const url = publishLayer(fixture, 'live-rankings', createSceneExtraDefaults('live-rankings'));
  const page = await browser.newPage();
  await page.clock.setFixedTime(now);
  let status = 200;
  await page.route('**/api/scene/output?*', route => status === 200 ? route.continue() : route.fulfill({ status, json: { ok: false } }));
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const board = page.frameLocator('iframe[data-component="live-rankings"]');
  const room = board.locator('.ranking-list .ranking-row.is-current');
  await room.getByText(row.name).waitFor();
  const unchanged = await page.waitForResponse(async response => response.url().includes('/api/scene/output?')
    && !Object.hasOwn((await response.json()).data.data, 'live-rankings'));
  assert.equal(unchanged.status(), 200);
  status = 503;
  await board.locator('.ranking-freshness.is-delayed:visible, #rankingStatus:visible:not(:empty)').first().waitFor({ timeout: 4000 });
  assert.equal(await room.isVisible(), true, 'A failed read keeps the last highlighted room visible.');
  assert.match(await board.locator('.ranking-freshness').textContent(), /更新延迟/);
  status = 200;
  await board.locator('.ranking-freshness.is-delayed').waitFor({ state: 'hidden' });
  assert.equal(await room.locator('.ranking-score').textContent(), '42');
  status = 403;
  await page.locator('iframe[data-component="live-rankings"]').waitFor({ state: 'detached' });
});

test('batched cloud event times reach Twitter scene labels and standalone Glass time elements', { timeout: 20000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const saved = await fixture.appearance.read();
  fixture.appearance.save({ ...saved, config: { ...saved.config, style: 'glass' } });
  const sceneUrl = publishLayer(fixture, 'danmaku', { ...fixture.configs.danmaku, style: 'twitter' });
  const scene = await browser.newPage({ timezoneId: 'Asia/Shanghai' });
  const standalone = await browser.newPage({ timezoneId: 'Asia/Shanghai' });
  const received = '2026-11-18T12:45:00.000Z';
  const times = ['2026-11-18T20:41:59.600+08:00', '2026-11-18T12:42:01.500Z'];
  for (const [page, url] of [[scene, sceneUrl], [standalone, `${fixture.origin}/danmaku?source=component`]]) {
    page.setDefaultTimeout(4500);
    await page.clock.setFixedTime(new Date(received));
    assert.equal((await fetch(url)).status, 200);
    await page.goto(url);
  }
  const twitter = scene.frameLocator('iframe[data-component="danmaku"]');
  await twitter.getByText('合成开播确认').first().waitFor();
  await standalone.getByText('合成开播确认').first().waitFor();
  for (const [index, timestamp] of times.entries()) fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live',
    name: '观众', message: `批次消息${index}`, timestamp });
  for (const [index, timestamp] of times.entries()) {
    const text = `批次消息${index}`;
    const tweet = twitter.locator('.twitter-post').filter({ hasText: text });
    const glass = standalone.locator('.glass-item').filter({ hasText: text });
    await tweet.waitFor(); await glass.waitFor();
    assert.deepEqual([await tweet.locator('.twitter-meta').textContent(), await glass.locator('time').getAttribute('datetime')],
      [`@Spectator · ${['20:41', '20:42'][index]}`, new Date(timestamp).toISOString()]);
  }
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '观众', message: '无时间消息' });
  const fallback = standalone.locator('.glass-item').filter({ hasText: '无时间消息' }).locator('time');
  assert.equal(await fallback.getAttribute('datetime'), received);
});

test('scene output becomes ready when hidden child animation frames are paused', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window.parent !== window) window.requestAnimationFrame = () => 1;
  });
  const created = fixture.service.create({ title: 'Hidden frames', canvas: { width: 1280, height: 720 } });
  const items = ['clock', 'queue'].map((type, index) => ({
    id: randomUUID(), type, name: type, x: index * 600, y: 0, width: 580, height: 400,
    visible: true, locked: false, appearance: { mode: 'independent', config: fixture.configs[type] },
  }));
  const saved = fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items } });
  fixture.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const { id, token } = fixture.service.getSource(saved.document.id);
  const url = `${fixture.origin}/scene?id=${id}#token=${token}`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator('.scene-version:not(.is-staging)').waitFor({ timeout: 5000 });
  assert.equal(await page.locator('.scene-version iframe').count(), 2);
  const queue = page.frames().find(frame => new URL(frame.url()).pathname === '/queue');
  await queue.getByText('合成实时歌曲').first().waitFor();
  assert.deepEqual(errors, []);
});

test('staged media can prepare without playing until the whole new scene is visible', { timeout: 15000 }, async t => {
  const fixture = await startCanvasOutputFixture({ notifications: true });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const url = publishLayer(fixture, 'background', { style: 'none' });
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  const active = page.locator('.scene-version:not(.is-staging)');
  await active.waitFor();
  const { promise, resolve } = Promise.withResolvers();
  t.after(resolve);
  await page.route('**/clock?componentPreview=1&sceneComponent=1', async route => {
    await promise;
    await route.continue();
  });
  const src = `/component-media/${randomUUID()}/${'a'.repeat(64)}.webm`;
  await page.route(`**${src}`, route => route.fulfill({ contentType: 'video/webm',
    path: path.resolve(__dirname, '../fixtures/gift-effect-alpha.webm'), headers: { 'Access-Control-Allow-Origin': '*' } }));
  await page.evaluate(() => window.addEventListener('message', event => {
    if (event.data?.type === 'component-preview:prepared'
      && event.source === document.querySelector('.is-staging iframe[data-component="background"]')?.contentWindow) window.backgroundReady = true;
  }));
  const saved = fixture.service.list()[0];
  const background = saved.document.items[0];
  background.appearance.config = { style: 'none', volume: 0.5,
    mediaStyle: { id: randomUUID(), kind: 'video', width: 640, height: 480, src, volume: 0.5 } };
  const clock = { ...background, id: randomUUID(), type: 'clock', appearance: { mode: 'shared' } };
  const revision = fixture.service.save({ id: saved.document.id, expectedRevision: saved.revision,
    document: { ...saved.document, items: [background, clock] } }).revision;
  fixture.service.publish({ id: saved.document.id, expectedRevision: revision });
  try {
    await page.waitForFunction(() => window.backgroundReady);
    const video = page.frameLocator('.is-staging iframe[data-component=background]').locator('video.component-media-art');
    assert.deepEqual(await video.evaluate(node => [node.paused, node.currentTime]), [true, 0]);
    assert.equal(await active.locator('iframe').count(), 1);
  } finally { resolve(); }
  const video = await active.frameLocator('iframe[data-component=background]').locator('video.component-media-art').elementHandle();
  const frame = await video.ownerFrame();
  await frame.waitForFunction(node => !node.paused && node.currentTime > 0, video);
  assert.equal(await video.evaluate(node => node.volume), 0.5);
});

test('published layers are clipped at all four canvas edges in a letterboxed source', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const created = fixture.service.create({ title: 'partial overflow', canvas: { width: 800, height: 600 } });
  const items = [[-120, -80], [680, -80], [-120, 520], [680, 520]].map(([x, y]) => ({
    id: randomUUID(), type: 'clock', name: 'clock', x, y, width: 320, height: 180,
    visible: true, locked: false, appearance: { mode: 'independent', config: fixture.configs.clock },
  }));
  const saved = fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items } });
  fixture.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const { id, token } = fixture.service.getSource(saved.document.id);
  const url = `${fixture.origin}/scene?id=${id}#token=${token}`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator('.scene-version:not(.is-staging)').waitFor();
  const visible = await page.evaluate(() => new Promise(resolve => {
    const root = document.querySelector('.scene-version:not(.is-staging)');
    const frames = [...root.querySelectorAll('iframe')];
    const observer = new IntersectionObserver(entries => {
      if (entries.length !== frames.length) return;
      const canvas = root.getBoundingClientRect();
      const result = entries.map(entry => {
        const full = entry.boundingClientRect;
        const clipped = entry.intersectionRect;
        return { width: clipped.width, height: clipped.height,
          expectedWidth: Math.min(full.right, canvas.right) - Math.max(full.left, canvas.left),
          expectedHeight: Math.min(full.bottom, canvas.bottom) - Math.max(full.top, canvas.top),
          fullyVisible: clipped.width === full.width && clipped.height === full.height };
      });
      observer.disconnect();
      resolve(result);
    });
    frames.forEach(frame => observer.observe(frame));
  }));
  assert.equal(visible.length, 4);
  for (const area of visible) {
    assert.equal(area.fullyVisible, false);
    assert.ok(area.width > 0 && area.height > 0);
    assert.ok(Math.abs(area.width - area.expectedWidth) < 1);
    assert.ok(Math.abs(area.height - area.expectedHeight) < 1);
  }
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
    if (url.pathname === '/api/scene/events') {
      res.setHeader('Access-Control-Allow-Origin', 'null');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      assert.equal(req.headers.authorization, 'Bearer synthetic-source-secret');
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false }));
    }
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
  const browser = openBrowserSession();
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

test('published text boxes use isolated configs and the shared renderer in sandboxed scene output', { timeout: 30000 }, async (t) => {
  const fixture = await startCanvasOutputFixture();
  t.after(() => fixture.close());
  const browser = openBrowserSession();
  t.after(() => browser.close());
  const page = await browser.newPage();
  const first = createTextBoxDefaults();
  first.nodes = [{ type: 'text', text: '<b>literal</b> 😀\n第二行', bold: true, italic: true, stroke: true, shadow: true, color: '#00ff00', fontSize: 48 },
    { type: 'gift', name: '舰长', src: '/img/admin/gifts/bilibili-guard-captain.webp', giftId: '1' }];
  const second = createTextBoxDefaults();
  second.nodes = [{ type: 'text', text: '独立的第二个文本框' }];
  const created = fixture.service.create({ title: 'text boxes', canvas: { width: 1920, height: 1080 } });
  const saved = fixture.service.save({ id: created.document.id, expectedRevision: created.revision,
    document: { ...created.document, items: [textBoxItem(first), textBoxItem(second, 700)] } });
  fixture.service.publish({ id: saved.document.id, expectedRevision: saved.revision });
  const source = fixture.service.getSource(saved.document.id);
  const shell = await fetch(`${fixture.origin}/text-box?componentPreview=1&sceneComponent=1`);
  assert.equal(shell.status, 200);
  assert.equal(shell.headers.get('content-security-policy'), 'sandbox allow-scripts');
  assert.doesNotMatch(await shell.text(), /ov1:|__LIRA_OVERLAY/);
  const url = `${fixture.origin}/scene?id=${source.id}#token=${source.token}`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator('.scene-version:not(.is-staging) iframe').first().waitFor();
  const frames = page.frames().filter(frame => new URL(frame.url()).pathname === '/text-box');
  assert.equal(frames.length, 2);
  assert.equal(await frames[0].locator('#textBox').textContent(), first.nodes[0].text);
  assert.equal(await frames[0].locator('#textBox b').count(), 0);
  assert.equal(await frames[1].locator('#textBox').textContent(), second.nodes[0].text);
  const styles = await frames[0].locator('#textBox > span').first().evaluate(span => ({
    bold: span.style.fontWeight, italic: span.style.fontStyle, size: span.style.fontSize, color: span.style.color,
  }));
  assert.deepEqual(styles, { bold: '700', italic: 'italic', size: '48px', color: 'rgb(0, 255, 0)' });
  const effects = frame => frame.locator('#textBox > span').first().evaluate(span => ({
    stroke: getComputedStyle(span).webkitTextStrokeWidth, shadow: getComputedStyle(span).textShadow,
  }));
  const chosen = await effects(frames[0]);
  assert.notEqual(chosen.stroke, '0px');
  assert.notEqual(chosen.shadow, 'none');
  assert.deepEqual(await effects(frames[1]), { stroke: '0px', shadow: 'none' });
  assert.equal(await frames[0].locator('.text-box-token img').getAttribute('src'), first.nodes[1].src);
});
