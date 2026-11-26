'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

let browser;
let fixture;
test.before(async () => {
  const fragment = fs.readFileSync(path.resolve(__dirname, '../../public/pages/admin/toolbox/world-clock.html'), 'utf8');
  fixture = await startComponentPreviewServer({ parentHtml: `<!doctype html><html><head>
    <link rel="stylesheet" href="/css/styles-base.css"><link rel="stylesheet" href="/css/admin/toolbox/world-clock.css">
    <style>#otherWorldClockFeature { display: flex; flex-direction: column; height: 650px; width: 1100px; }</style>
    </head><body><main id="otherAssistantPage" class="active">${fragment}</main>
    <button role="tab" id="otherWorldClockFeatureTab" aria-controls="otherWorldClockFeature">世界地图</button>
    <script type="module">import { initWorldClock } from '/js/admin/world-clock/index.js';
    document.getElementById('otherWorldClockFeature').hidden = location.search === '?background'; initWorldClock();</script></body></html>` });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

test('background weather loads the full city directory only when needed and restores the current reading on return', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.clock.install({ time: new Date('2026-10-23T12:30:00Z') });
  let directories = 0;
  let temperature = 14;
  let reads = 0;
  page.on('request', request => { if (request.url().endsWith('/city-catalog.js')) directories++; });
  await page.route('**/world-clock/globe.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export async function createGlobe() { return { setCities() {}, setActive() {}, setSun() {}, focus() {}, destroy() {} }; }' }));
  await page.route('**/api/world-clock/temperature?**', route => {
    reads++;
    return route.fulfill({ json: { ok: true, data: { temperature, condition: '晴', updatedAt: Date.now() } } });
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('admin.worldClock')) localStorage.setItem('admin.worldClock', JSON.stringify({ ids: ['beijing'] }));
  });
  const url = `${fixture.origin}/preview-test-host?background`;
  assert.equal((await fetch(url)).status, 200);
  await Promise.all([page.waitForResponse(r => r.url().includes('/api/world-clock/temperature')), page.goto(url)]);
  assert.equal(directories, 0);
  const show = hidden => page.locator('#otherWorldClockFeature').evaluate((node, value) => { node.hidden = value; }, hidden);
  // Hold the first directory import so the base city's reading must render before Chromium discovers the catalog.
  const firstDirectory = Promise.withResolvers();
  await page.route('**/world-clock/cities.js', route => firstDirectory.resolve(route), { times: 1 });
  await Promise.all([page.waitForRequest('**/world-clock/cities.js'), show(false)]);
  const value = page.locator('.world-clock-temperature');
  await value.filter({ hasText: '14°C' }).waitFor();
  const directoryRoute = await firstDirectory.promise;
  await Promise.all([page.waitForRequest('**/world-clock/city-catalog.js'), directoryRoute.continue()]);
  assert.equal(directories, 1);

  const atlanta = 'ne-1159151489';
  await page.evaluate(id => localStorage.setItem('admin.worldClock', JSON.stringify({ ids: [id] })), atlanta);
  const [savedCity] = await Promise.all([page.waitForRequest(r => r.url().includes('/api/world-clock/temperature')), page.reload()]);
  assert.equal(new URL(savedCity.url()).searchParams.get('latitude'), '33.749');
  assert.equal(directories, 2);
  await show(false);
  await card(page, atlanta).getByText('14°C').waitFor();
  await show(true);
  temperature = 20;
  await Promise.all([page.waitForEvent('requestfinished', r => r.url().includes('/api/world-clock/temperature')), page.clock.fastForward(3600000)]);
  assert.equal(await value.textContent(), '14°C');
  await show(false);
  await value.filter({ hasText: '20°C' }).waitFor();
  assert.equal(reads, 3);
  assert.equal(directories, 2);
});

test('a failed city directory preserves saved cities, base weather and pagehide cleanup', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.clock.install();
  const saved = { ids: ['beijing', 'ne-1159151489'], selectedId: 'ne-1159151489', customOrder: true };
  await page.addInitScript(value => {
    if (!localStorage.getItem('admin.worldClock')) localStorage.setItem('admin.worldClock', JSON.stringify(value));
  }, saved);
  await page.route('**/world-clock/globe.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export async function createGlobe() { return { setCities() {}, setActive() {}, setSun() {}, focus() {}, destroy() {} }; }' }));
  await page.route('**/world-clock/cities.js', route => route.abort());
  let weatherReads = 0;
  await page.route('**/api/world-clock/temperature?**', route => {
    weatherReads++;
    return route.fulfill({ json: { ok: true, data: { temperature: 14, condition: '晴', updatedAt: Date.now() } } });
  });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await Promise.all([page.waitForEvent('requestfailed', r => r.url().endsWith('/world-clock/cities.js')), page.goto(url)]);
  await card(page, 'beijing').getByText('14°C').waitFor();
  await page.locator('[data-world-clock-format="12"]').click();
  assert.deepEqual((await savedOrder(page)).ids, saved.ids);
  assert.equal(weatherReads, 1);
  await Promise.all([page.waitForResponse(r => r.url().includes('/api/world-clock/temperature')), page.clock.fastForward(3600000)]);
  assert.equal(weatherReads, 2);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await page.clock.fastForward(3600000);
  assert.equal(weatherReads, 2);
  await page.unroute('**/world-clock/cities.js');
  await page.reload();
  await card(page, saved.selectedId).getByText('14°C').waitFor();
  assert.deepEqual(errors, []);
});

async function openClock(t, saved, setupPage) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  if (setupPage) await setupPage(page);
  await page.route('**/js/admin/world-clock/globe.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export async function createGlobe() { return { setCities() {}, setActive() {}, setSun() {}, focus() {}, destroy() {} }; }' }));
  await page.route('**/js/admin/world-clock/temperature.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export function createTemperatureController() { return { get() {}, start() {}, refreshCity() {}, refreshCities() {}, destroy() {} }; }' }));
  await page.addInitScript(value => {
    if (!localStorage.getItem('admin.worldClock')) localStorage.setItem('admin.worldClock', JSON.stringify(value));
  }, saved);
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  // The extended directory replaces the initial cards. Start drag and menu actions on the final rows.
  const directory = Promise.withResolvers();
  await page.route('**/world-clock/cities.js', route => directory.resolve(route), { times: 1 });
  await page.goto(url);
  const initialCard = await page.locator('[data-world-clock-city]').first().elementHandle();
  await (await directory.promise).continue();
  await page.waitForFunction(card => !card.isConnected, initialCard);
  await initialCard.dispose();
  return page;
}
const order = page => page.locator('[data-world-clock="list"] [data-world-clock-city]').evaluateAll(cards => cards.map(card => card.dataset.worldClockCity));
const savedOrder = page => page.evaluate(() => JSON.parse(localStorage.getItem('admin.worldClock')));
const card = (page, id) => page.locator(`[data-world-clock-city="${id}"]`);

test('the focused Beijing button exposes its ticking local time, date and weather', async t => {
  const page = await openClock(t, { ids: ['beijing'] });
  const button = card(page, 'beijing').getByRole('button');
  await button.focus();
  await page.clock.pauseAt(new Date('2026-10-23T12:05:00Z'));
  await page.clock.runFor(1000);
  const snapshot = await button.ariaSnapshot();
  assert.match(snapshot, /button ".*北京.*20:05:01.*10月23日.*星期五.*暂无天气/);
});

test('an unavailable 8K map loads the bundled day and night maps and enables globe controls', async t => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const maps = [];
  let bundledDayAvailable = true;
  await page.route('**/img/admin/world-clock/earth-*', route => {
    const file = new URL(route.request().url()).pathname.split('/').at(-1);
    maps.push(file);
    const missing = file === 'earth-day-8k.png' || (file === 'earth-day.jpg' && !bundledDayAvailable);
    return missing ? route.fulfill({ status: 404, body: '' }) : route.continue();
  });
  await page.route('**/api/world-clock/temperature?**', route => route.fulfill({ json: { ok: true, data: { temperature: 14 } } }));
  await page.addInitScript(() => {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (key) {
      return key === this.MAX_TEXTURE_SIZE ? 8192 : getParameter.call(this, key);
    };
  });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator('[data-world-clock="zoom-in"]:enabled').click({ timeout: 10000 });
  assert.deepEqual(maps.sort(), ['earth-day-8k.png', 'earth-day.jpg', 'earth-night.jpg']);
  bundledDayAvailable = false;
  maps.length = 0;
  await page.reload();
  await page.locator('[data-world-clock="message"]').filter({ hasText: '加载失败' }).waitFor();
  assert.ok(await page.locator('[data-world-clock="zoom-in"]').isDisabled());
  assert.deepEqual(maps.sort(), ['earth-day-8k.png', 'earth-day.jpg', 'earth-night.jpg']);
});

async function drag(page, from, to, release = true) {
  const source = await card(page, from).boundingBox();
  const target = await card(page, to).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  if (release) await page.mouse.up();
}

function trackFormattedZones(page) {
  return page.route('**/world-clock/time.js', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export * from './time.js?original';
      import { clockAt as original } from './time.js?original';
      export function clockAt(...args) { (window.formattedZones ||= []).push(args[0]); return original(...args); }`,
  }));
}

async function openClockWithPendingDirectory(t, saved) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await trackFormattedZones(page);
  await page.addInitScript(value => localStorage.setItem('admin.worldClock', JSON.stringify(value)), saved);
  const directory = Promise.withResolvers();
  await page.route('**/world-clock/cities.js', route => directory.resolve(route));
  await page.route('**/world-clock/globe.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export async function createGlobe() { return { setCities(cities) { window.markers = cities.map(c => c.id); }, setSun() {}, setActive() {}, focus() {}, destroy() {} }; }' }));
  await page.route('**/api/world-clock/temperature?**', route => route.fulfill({ json: { ok: true, data: { temperature: 14 } } }));
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  async function finishDirectory() {
    const held = await directory.promise;
    await Promise.all([page.waitForResponse(r => r.url().includes('latitude=33.749')), held.continue()]);
  }
  return { page, finishDirectory };
}

test('a hidden directory completion restores mixed saved cities on return and leaves focus on navigation', async t => {
  const ids = ['beijing', 'ne-1159151489'];
  const { page, finishDirectory } = await openClockWithPendingDirectory(t, { ids, customOrder: true });
  assert.deepEqual(await order(page), ['beijing']);
  const panel = page.locator('#otherWorldClockFeature');
  const tab = page.getByRole('tab', { name: '世界地图' });
  await card(page, 'beijing').getByRole('button').focus();
  await tab.focus();
  await panel.evaluate(node => { node.hidden = true; });
  await finishDirectory();
  const formatted = await panel.evaluate(async node => {
    window.formattedZones = [];
    node.hidden = false;
    await Promise.resolve();
    return window.formattedZones;
  });
  assert.deepEqual(await order(page), ids);
  assert.deepEqual(await page.evaluate(() => window.markers), ids);
  assert.equal(formatted.filter(zone => zone === 'America/New_York').length, 1);
  assert.ok(await tab.evaluate(node => node === document.activeElement));
});

test('a hidden directory completion restores keyboard focus to the original unselected city', async t => {
  const saved = { ids: ['beijing', 'london', 'ne-1159151489'], selectedId: 'beijing', customOrder: true };
  const { page, finishDirectory } = await openClockWithPendingDirectory(t, saved);
  const london = card(page, 'london').getByRole('button');
  const setDocumentHidden = hidden => page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  await london.focus();
  await setDocumentHidden(true);
  await finishDirectory();
  assert.deepEqual(await order(page), ['beijing', 'london']);
  assert.ok(await london.evaluate(node => node === document.activeElement));

  await setDocumentHidden(false);
  assert.deepEqual(await order(page), saved.ids);
  assert.ok(await london.evaluate(node => node === document.activeElement));
  assert.equal(await london.getAttribute('aria-pressed'), 'false');
  assert.equal(await card(page, 'beijing').getByRole('button').getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await savedOrder(page), saved);
  await page.keyboard.press('Shift+F10');
  assert.ok(await page.getByRole('menuitem', { name: '从列表移除伦敦' }).isVisible());
});

test('clock ticks format only displayed rows or an open detail', async t => {
  const page = await openClock(t, null, trackFormattedZones);
  await page.clock.pauseAt(new Date('2026-10-23T12:05:00Z'));
  await card(page, 'tokyo').getByRole('button').click();
  await page.locator('[data-world-clock="filter"]').fill('no-such-city');
  assert.deepEqual(await order(page), []);
  await page.evaluate(() => { window.formattedZones = []; });
  await page.clock.runFor(1000);
  assert.deepEqual(await page.evaluate(() => window.formattedZones), []);
  await page.locator('[data-world-clock="details"]').evaluate(node => { node.hidden = false; });
  await page.clock.runFor(1000);
  assert.deepEqual(await page.evaluate(() => window.formattedZones), ['Asia/Tokyo']);
});

test('drag order survives ticking and reload; new cities append and can also move', async t => {
  const page = await openClock(t, { ids: ['tokyo', 'beijing', 'new-york', 'london'], selectedId: 'beijing', format: '12' });
  assert.deepEqual(await order(page), ['new-york', 'london', 'beijing', 'tokyo']);
  await drag(page, 'london', 'new-york');
  const expected = ['london', 'new-york', 'beijing', 'tokyo'];
  assert.deepEqual(await order(page), expected);
  await page.clock.runFor(2000);
  assert.deepEqual(await order(page), expected);
  assert.deepEqual(await savedOrder(page), { ids: expected, selectedId: 'beijing', format: '12', customOrder: true });
  await page.reload();
  await card(page, 'london').waitFor();
  assert.deepEqual(await order(page), expected);
  await page.locator('[data-world-clock="add"]').click();
  await page.locator('[data-world-clock="search"]').fill('上海');
  await page.getByRole('button', { name: '添加上海', exact: true }).click();
  assert.deepEqual(await order(page), [...expected, 'shanghai']);
  await drag(page, 'shanghai', 'new-york');
  assert.deepEqual((await savedOrder(page)).ids, ['london', 'shanghai', 'new-york', 'beijing', 'tokyo']);
});

test('city search paginates, ticks with the page clock and resets after adding a city', async t => {
  const page = await openClock(t, { ids: ['beijing'], selectedId: 'beijing', format: '12' });
  const add = page.locator('[data-world-clock="add"]');
  const search = page.locator('[data-world-clock="search"]');
  const cities = page.locator('.world-clock-catalog-city');
  await add.click();
  await search.fill('中国');
  await page.clock.runFor(100);
  const firstPage = await cities.count();
  assert.ok(firstPage > 0);
  const time = cities.first().locator('time');
  const before = await time.textContent();
  await page.clock.runFor(60000);
  assert.notEqual(await time.textContent(), before, 'the existing page tick updates catalog times');
  await page.locator('[data-world-clock="more"]').click();
  assert.ok(await cities.count() > firstPage);
  const displayed = await cities.locator('time').evaluateAll(nodes => nodes.map(node => node.dataset.worldClockCatalogTime));
  assert.equal(new Set(displayed).size, displayed.length, 'pagination does not repeat cities');
  assert.equal(await cities.nth(firstPage).evaluate(node => node === document.activeElement), true);
  await search.fill('上海');
  await page.getByRole('button', { name: '添加上海', exact: true }).click();
  assert.equal((await savedOrder(page)).ids.filter(id => id === 'shanghai').length, 1);
  await add.click();
  assert.equal(await search.inputValue(), '');
  assert.equal(await cities.count(), 0);
  await search.fill('上海');
  await page.clock.runFor(100);
  assert.equal(await page.getByRole('button', { name: '添加上海', exact: true }).count(), 0);
});

test('filtered reorder preserves hidden cities and keyboard moves use the same saved order', async t => {
  const page = await openClock(t, { ids: ['los-angeles', 'london', 'dallas', 'beijing', 'new-york', 'tokyo'], customOrder: true });
  const filter = page.locator('[data-world-clock="filter"]');
  await filter.fill('美国');
  await drag(page, 'new-york', 'los-angeles');
  assert.deepEqual((await savedOrder(page)).ids, ['new-york', 'london', 'los-angeles', 'beijing', 'dallas', 'tokyo']);
  await card(page, 'new-york').locator('button').press('Alt+ArrowDown');
  assert.deepEqual((await savedOrder(page)).ids, ['los-angeles', 'london', 'new-york', 'beijing', 'dallas', 'tokyo']);
  await filter.fill('');
  assert.deepEqual(await order(page), (await savedOrder(page)).ids);
});

test('Escape and dropping outside cancel without saving or accidentally selecting a city', async t => {
  const ids = ['new-york', 'london', 'beijing', 'tokyo'];
  const saved = { ids, selectedId: 'beijing' };
  const page = await openClock(t, saved);
  await drag(page, 'london', 'new-york', false);
  await page.clock.runFor(2000);
  assert.deepEqual(await order(page), ['london', 'new-york', 'beijing', 'tokyo']);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.deepEqual(await order(page), ids);
  assert.deepEqual(await savedOrder(page), saved);
  await drag(page, 'london', 'new-york', false);
  await page.mouse.move(1000, 100);
  await page.mouse.up();
  assert.deepEqual(await order(page), ids);
  assert.deepEqual(await savedOrder(page), saved);
});

test('switching context-menu targets and removing after reorder uses the city ID', async t => {
  const page = await openClock(t, { ids: ['new-york', 'london', 'beijing', 'tokyo'], selectedId: 'beijing' });
  await drag(page, 'london', 'new-york');
  await card(page, 'london').locator('button').click({ button: 'right' });
  await card(page, 'new-york').locator('button').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '从列表移除纽约' }).click();
  assert.deepEqual(await order(page), ['london', 'beijing', 'tokyo']);
  assert.equal((await savedOrder(page)).selectedId, 'beijing');
});
