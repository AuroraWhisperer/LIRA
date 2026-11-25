'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionClient } = require('../../public/js/shared/interaction-client.js');
const { readAdminFragmentHtml } = require('../helpers/admin-html');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');
const { useSharedBrowser } = require('../helpers/shared-browser');

const openBrowserSession = useSharedBrowser();

test('HTTP/WS revisions preserve newest result and clear across session changes', async () => {
  const pending = [];
  const states = [];
  const hosts = [];
  const client = createInteractionClient({
    onState(state, host) { states.push(state); if (host) hosts.push(host); },
    fetchState: () => new Promise((resolve) => pending.push(resolve)),
  });
  const initial = client.load(true);
  client.receive({ runtimeId: 'one', revision: 2, session: { sessionId: 'new' } });
  client.receive({ runtimeId: 'one', revision: 1, session: { sessionId: 'old' } });
  pending.shift()({ runtimeId: 'one', revision: 1, session: { sessionId: 'old' } });
  await initial;
  assert.equal(states.at(-1).session.sessionId, 'new');
  assert.equal(states.length, 1);
  assert.equal(hosts.length, 0, 'a queued newer public state cannot acquire older host fields');
  client.receive({ runtimeId: 'one', revision: 3, session: null });
  client.receive({ runtimeId: 'one', revision: 2, session: { sessionId: 'new' } });
  assert.equal(states.at(-1).session, null);
  const old = client.load();
  client.reset();
  const fresh = client.load();
  pending.pop()({ runtimeId: 'two', revision: 0, session: null });
  await fresh;
  pending.shift()({ runtimeId: 'one', revision: 99, session: { sessionId: 'old' } });
  await old;
  client.receive({ runtimeId: 'one', revision: 100, session: { sessionId: 'old' } });
  assert.equal(states.at(-1).runtimeId, 'two');
  assert.equal(states.at(-1).session, null);
});

async function hostPage(t) {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><html><body><main id="liveComponentsPage" class="active">'
    + readAdminFragmentHtml('pages/admin/live-components/interactions.html') + '</main></body></html>' });
  const browser = openBrowserSession();
  t.after(async () => { await browser.close(); await fixture.close(); });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const url = `${fixture.origin}/preview-test-host`;
  assert.equal((await fetch(url)).status, 200);
  return { page, url };
}

test('visible host polls apply session and host fields in one render and resume on return', async t => {
  const { page, url } = await hostPage(t);
  await page.clock.install({ time: new Date('2026-11-24T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-11-24T12:00:01Z'));
  await page.goto(url);
  await page.evaluate(async () => {
    const session = { sessionId: 's', phase: 'collecting', kind: 'poll', connected: true, endsAt: Date.now() + 60000,
      options: [{ text: 'A', votes: 1, percentage: 100 }, { text: 'B', votes: 0, percentage: 0 }] };
    window.counts = { reads: 0, renders: 0 };
    window.fetch = async path => {
      const data = path === '/api/interactions/host-state'
        ? { runtimeId: 'r', revision: 1, participants: ++counts.reads, session }
        : { settings: {} };
      return { ok: true, json: async () => ({ ok: true, data }) };
    };
    const status = document.getElementById('interactionHostStatus');
    const observer = new MutationObserver(records => { counts.renders += records.length; });
    observer.observe(status, { childList: true });
    document.getElementById('livePollFeature').hidden = false;
    (await import('/js/admin/interactions.js')).initInteractions();
  });
  const counts = () => page.evaluate(() => ({ ...window.counts }));
  const initial = await counts();
  for (let i = 0; i < 10; i++) await page.clock.fastForward(1000);
  const after = await counts();
  assert.deepEqual([after.reads - initial.reads, after.renders - initial.renders], [10, 10]);
  assert.match(await page.locator('#interactionHostStatus').textContent(), /11 人/);
  await page.evaluate(() => {
    document.getElementById('liveComponentsPage').classList.remove('active');
    window.dispatchEvent(new CustomEvent('app:interaction-update', { detail: { runtimeId: 'r', revision: 1, session: null } }));
  });
  await page.clock.fastForward(5000);
  assert.deepEqual(await counts(), after, 'a hidden panel neither polls nor renders socket updates');
  await page.evaluate(() => document.getElementById('liveComponentsPage').classList.add('active'));
  assert.equal((await counts()).reads, after.reads + 1);
  await page.clock.fastForward(900);
  await page.evaluate(() => window.dispatchEvent(new Event('app:game-update')));
  await page.clock.fastForward(100);
  assert.equal((await counts()).reads, after.reads + 2, 'the game refresh replaces the imminent timer read');
});

test('cancel clears the same session despite interruption and never clears a replacement session', { timeout: 20000 }, async t => {
  const { page, url } = await hostPage(t);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let state = { runtimeId: 'synthetic', revision: 1, ready: true, participants: 2,
    session: { sessionId: 'interrupted', kind: 'poll', phase: 'interrupted', participants: 2,
      options: [{ text: '1', votes: 2, percentage: 100 }, { text: '2', votes: 0, percentage: 0 }] } };
  const clears = [];
  let hostReads = 0;
  await page.route('**/api/interactions/**', route => {
    if (route.request().url().endsWith('/host-state')) hostReads++;
    if (route.request().url().endsWith('/clear')) {
      clears.push(route.request().postDataJSON());
      state = { ...state, revision: state.revision + 1, session: null, participants: 0 };
    }
    return route.fulfill({ json: { ok: true, data: state } });
  });
  await page.route('**/api/state', route => route.fulfill({ json: { ok: true, data: { settings: {} } } }));
  await page.goto(url);
  await page.evaluate(async () => {
    document.getElementById('livePollFeature').hidden = false;
    const { initInteractions } = await import('/js/admin/interactions.js'); initInteractions();
  });
  await page.locator('#interactionHostStatus').filter({ hasText: '接收已中断' }).waitFor();
  await page.getByRole('button', { name: '取消本场', exact: true }).click();
  await page.getByRole('dialog', { name: '取消本场互动？' }).getByRole('button', { name: '取消本场', exact: true }).click();
  await page.locator('#interactionResults').waitFor({ state: 'hidden' });
  assert.deepEqual(clears, [{ sessionId: 'interrupted' }]);

  state = { ...state, revision: 3, participants: 1, session: { sessionId: 'changing', kind: 'poll', phase: 'collecting',
    participants: 1, connected: true, endsAt: Date.now() + 60000,
    options: [{ text: '1', votes: 1, percentage: 100 }, { text: '2', votes: 0, percentage: 0 }] } };
  await page.evaluate(state => window.dispatchEvent(new CustomEvent('app:interaction-update', { detail: state })), state);
  await page.getByRole('button', { name: '取消本场', exact: true }).click();
  await page.getByRole('dialog', { name: '取消本场互动？' }).waitFor();
  state = { ...state, revision: 4, session: { ...state.session, phase: 'interrupted' } };
  await page.evaluate(state => window.dispatchEvent(new CustomEvent('app:interaction-update', { detail: state })), state);
  await page.getByRole('dialog', { name: '取消本场互动？' }).getByRole('button', { name: '取消本场', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  await page.locator('#interactionResults').waitFor({ state: 'hidden' });
  assert.deepEqual(clears, [{ sessionId: 'interrupted' }, { sessionId: 'changing' }],
    'an interruption does not invalidate cancellation of the same session');

  state = { ...state, revision: 6, participants: 1, session: { sessionId: 'old', kind: 'rating', phase: 'collecting', participants: 1 } };
  await page.evaluate(state => {
    document.getElementById('livePollFeature').hidden = true;
    document.getElementById('liveRatingFeature').hidden = false;
    window.dispatchEvent(new CustomEvent('app:interaction-update', { detail: state }));
  }, state);
  await page.getByRole('button', { name: '取消本场', exact: true }).click();
  await page.getByRole('dialog', { name: '取消本场互动？' }).waitFor();
  state = { ...state, revision: 7, session: { ...state.session, sessionId: 'replacement' } };
  await page.evaluate(state => window.dispatchEvent(new CustomEvent('app:interaction-update', { detail: state })), state);
  await page.getByRole('dialog', { name: '取消本场互动？' }).getByRole('button', { name: '取消本场', exact: true }).click();
  await page.locator('.lira-confirm-backdrop').waitFor({ state: 'detached' });
  assert.equal(clears.length, 2, 'confirmation for the old session does not clear its replacement');
  assert.equal(await page.locator('#interactionResults').isVisible(), true);
  await page.clock.install();
  await page.evaluate(async () => {
    const { eventBus } = await import('/js/shared/event-bus.js');
    eventBus.emit('app:shutdown');
    eventBus.emit('ws:connected');
  });
  const stopped = hostReads;
  assert.ok(stopped > 0);
  await page.clock.runFor(2000);
  assert.equal(hostReads, stopped);
  assert.deepEqual(errors, []);
});
