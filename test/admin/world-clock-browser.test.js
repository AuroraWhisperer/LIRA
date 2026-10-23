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
    <script type="module">import { initWorldClock } from '/js/admin/world-clock/index.js';
    document.getElementById('otherWorldClockFeature').hidden = false; initWorldClock();</script></body></html>` });
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await fixture?.close(); });

async function openClock(t, saved) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await page.route('**/js/admin/world-clock/globe.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export async function createGlobe() { return { setCities() {}, setActive() {}, setSun() {}, focus() {}, destroy() {} }; }' }));
  await page.route('**/js/admin/world-clock/temperature.js', route => route.fulfill({ contentType: 'text/javascript',
    body: 'export function createTemperatureController() { return { get() {}, start() {}, refreshCity() {}, destroy() {} }; }' }));
  await page.addInitScript(value => {
    if (!localStorage.getItem('admin.worldClock')) localStorage.setItem('admin.worldClock', JSON.stringify(value));
  }, saved);
  await page.clock.install({ time: new Date('2026-10-23T12:00:00Z') });
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  await page.goto(url);
  await page.locator('[data-world-clock-city]').first().waitFor();
  return page;
}
const order = page => page.locator('[data-world-clock="list"] [data-world-clock-city]').evaluateAll(cards => cards.map(card => card.dataset.worldClockCity));
const savedOrder = page => page.evaluate(() => JSON.parse(localStorage.getItem('admin.worldClock')));
const card = (page, id) => page.locator(`[data-world-clock-city="${id}"]`);
async function drag(page, from, to, release = true) {
  const source = await card(page, from).boundingBox();
  const target = await card(page, to).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  if (release) await page.mouse.up();
}

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
  assert.match(await page.locator('[data-world-clock="order-status"]').textContent(), /纽约已移至第 3 位/);
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
  assert.equal(await page.locator('.world-clock-city-ghost, .is-dragging').count(), 0);
  assert.deepEqual(await savedOrder(page), saved);
});

test('switching context-menu targets and removing after reorder uses the city ID', async t => {
  const page = await openClock(t, { ids: ['new-york', 'london', 'beijing', 'tokyo'], selectedId: 'beijing' });
  await drag(page, 'london', 'new-york');
  await card(page, 'london').locator('button').click({ button: 'right' });
  await card(page, 'new-york').locator('button').click({ button: 'right' });
  const menu = page.locator('[data-world-clock="city-menu"]');
  assert.equal(await menu.getAttribute('aria-label'), '纽约操作');
  const target = await card(page, 'new-york').locator('button').boundingBox();
  const popup = await menu.boundingBox();
  assert.ok(Math.abs(popup.y - target.y) < 1);
  assert.ok(Math.abs(popup.x - target.x - target.width - 8) < 1);
  assert.equal(await card(page, 'london').locator('button').getAttribute('aria-expanded'), 'false');
  await page.getByRole('menuitem', { name: '从列表移除纽约' }).click();
  assert.deepEqual(await order(page), ['london', 'beijing', 'tokyo']);
  assert.equal((await savedOrder(page)).selectedId, 'beijing');
  assert.equal(await page.locator('.is-menu-open').count(), 0);
});

test('starfield pauses with the map and honors reduced motion without hiding the stars', async t => {
  const page = await openClock(t, { ids: ['beijing'] });
  const space = page.locator('[data-world-clock="space"]');
  const isRunning = () => space.evaluate(node => {
    const animations = node.getAnimations({ subtree: true });
    return animations.length > 0 && animations.every(animation => animation.playState === 'running');
  });
  await page.waitForFunction(() => document.querySelector('[data-world-clock="space"]').classList.contains('is-active'));
  assert.equal(await isRunning(), true);
  assert.equal(await space.getAttribute('aria-hidden'), 'true');
  assert.equal(await space.evaluate(node => getComputedStyle(node).pointerEvents), 'none');

  await page.locator('[data-world-clock="add"]').click();
  assert.equal(await isRunning(), false);
  assert.ok(await space.evaluate(node => node.getAnimations({ subtree: true }).every(animation => animation.playState === 'paused')));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-world-clock="space"]').classList.contains('is-active'), undefined, { polling: 50 });
  assert.equal(await isRunning(), true);

  await page.evaluate(() => document.getElementById('otherWorldClockFeature').hidden = true);
  assert.equal(await isRunning(), false);
  await page.evaluate(() => document.getElementById('otherWorldClockFeature').hidden = false);
  await page.waitForFunction(() => document.querySelector('[data-world-clock="space"]').classList.contains('is-active'));
  assert.equal(await isRunning(), true);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await space.evaluate(node => node.getAnimations({ subtree: true }).length), 0);
  assert.notEqual(await page.locator('.world-clock-stars-far').evaluate(node => getComputedStyle(node).backgroundImage), 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await isRunning(), true);
});
