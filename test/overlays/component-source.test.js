'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startCanvasOutputFixture } = require('../helpers/canvas-output-fixture');

test('standalone component sources load saved styles and live data without a canvas or editor', { timeout: 30000 }, async t => {
  const fixture = await startCanvasOutputFixture();
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  fixture.runtime.settings.clockLabel = '独立时钟';
  fixture.runtime.settings.clockStyle = 'flip';
  const pages = {};
  for (const type of ['clock', 'queue', 'overtime', 'danmaku']) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    pages[type] = page;
    page.on('pageerror', error => errors.push(error.message));
    const url = `${fixture.origin}/${type}${type === 'danmaku' ? '?source=component' : ''}`;
    assert.equal((await fetch(url)).status, 200);
    await page.goto(url);
    assert.equal(await page.evaluate(() => window.liraLicense), undefined);
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
  }
  await pages.clock.waitForFunction(() => document.documentElement.dataset.clockStyle === 'flip');
  await pages.queue.getByText('合成实时歌曲').waitFor();
  await pages.overtime.getByText('00:02:00', { exact: true }).waitFor();
  await pages.danmaku.waitForFunction(() => document.body.dataset.style === 'signal' && document.body.classList.contains('has-layout'));
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '独立观众', message: '独立组件的实时弹幕' });
  await pages.danmaku.getByText('独立组件的实时弹幕').waitFor();
  const state = await fetch(`${fixture.origin}/api/danmaku/display`, { headers: { Authorization: `Bearer ${fixture.token}` } }).then(r => r.json());
  fixture.updateCloud({ type: 'overlay-settings', ...state.data.config, style: 'bubble' });
  await pages.danmaku.waitForFunction(() => document.body.dataset.style === 'bubble');
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '独立观众', message: '保存样式后继续接收' });
  await pages.danmaku.getByText('保存样式后继续接收').waitFor();
  await pages.danmaku.reload();
  await pages.danmaku.waitForFunction(() => document.body.dataset.style === 'bubble');
  fixture.runtime.settings.clockStyle = 'peach';
  fixture.runtime.queue.waiting[0].song_name = '更新后的独立队列';
  fixture.runtime.overtime = { ...fixture.runtime.overtime, revision: 2, effectiveRemainingMs: 180000 };
  fixture.broadcast();
  await pages.clock.waitForFunction(() => document.documentElement.dataset.clockStyle === 'peach');
  await pages.queue.getByText('更新后的独立队列').waitFor();
  await pages.overtime.getByText('00:03:00', { exact: true }).waitFor();
  fixture.updateCloud({ type: 'danmaku', liveSessionId: 'synthetic-live', name: '独立观众', message: '刷新后仍能接收' });
  await pages.danmaku.getByText('刷新后仍能接收').waitFor();
  fixture.updateCloud(null, 'offline');
  await pages.danmaku.getByText('等待直播数据', { exact: true }).waitFor({ state: 'attached' });
  assert.equal(await pages.danmaku.getByText('刷新后仍能接收').count(), 0);
  assert.deepEqual(fixture.service.list(), []);
});
