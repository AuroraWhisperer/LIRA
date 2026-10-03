'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { chromium } = require('playwright');
const { startComponentPreviewServer } = require('../helpers/component-preview-server');

test('preview retries retain drafts, serialize mutations and publish once after a lost response', { timeout: 30000 }, async (t) => {
  const fixture = await startComponentPreviewServer({ parentHtml: '<!doctype html><body></body>' });
  const browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage();
  const page = await browser.newPage();
  const errors = [];
  const commands = [];
  let failExchange = false;
  let failedExchanges = 0;
  let offline = false;
  let loseAction = '';
  let lostResponses = 0;
  let browserRequests = 0;
  t.after(async () => { await browser.close(); await fixture.close(); assert.deepEqual(errors, []); });
  for (const target of [desktop, page]) target.on('pageerror', error => errors.push(error.message));
  await desktop.route('**/api/component-preview', async route => {
    if (failExchange && route.request().postDataJSON().action === 'exchange') {
      failedExchanges++;
      await route.fulfill({ status: 503, json: { ok: false, error: '暂时不可用' } });
    } else await route.continue({ headers: { ...route.request().headers(), Authorization: `Bearer ${fixture.token}` } });
  });
  assert.equal((await fetch(`${fixture.origin}/preview-test-host`)).status, 200);
  await desktop.goto(`${fixture.origin}/preview-test-host`);
  await desktop.evaluate(async () => {
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    const { setComponentPreviewPreparation } = await import('/js/admin/component-preview-registry.js');
    window.writes = [];
    window.publications = 0;
    window.controller = createComponentConfigController({ initial: { label: 'saved' }, persist: async draft => {
      window.writes.push(draft.label);
      return draft;
    } });
    window.canvas = createComponentConfigController({ initial: { document: {} }, persist: async draft => draft });
    window.open = url => { window.previewUrl = url; };
    setComponentPreviewPreparation(() => ({ id: 'canvas', controller: window.canvas,
      async publish() {
        await window.controller.save();
        window.publications++;
        return { publishedVersion: window.publications };
      } }));
    window.handle = openComponentPreview({ id: 'clock', controller: window.controller });
  });
  await desktop.waitForFunction(() => window.previewUrl);
  const url = await desktop.evaluate(() => window.previewUrl);
  await page.route('**/api/component-preview', async route => {
    const command = route.request().postDataJSON();
    browserRequests++;
    if (command.commandId) commands.push(command);
    if (offline) { await route.abort('connectionfailed'); return; }
    if (command.action === loseAction) {
      loseAction = '';
      await route.fetch();
      lostResponses++;
      await route.abort('connectionfailed');
    } else await route.continue();
  });
  await page.goto(`${fixture.origin}/preview-test-host`);
  await page.evaluate(async url => {
    const { createBrowserPreviewConnection } = await import('/js/admin/component-preview-remote.js');
    const { readComponentPreviewLink } = await import('/js/admin/component-preview-link.js');
    const { links } = await readComponentPreviewLink(new URL(url), new AbortController().signal);
    window.clock = createBrowserPreviewConnection(links.find(({ component }) => component === 'clock'));
    window.canvas = createBrowserPreviewConnection(links.find(({ component }) => component === 'canvas'));
    await Promise.all([window.clock.start(), window.canvas.start()]);
  }, url);

  failExchange = true;
  await page.evaluate(() => { void window.clock.controller.edit({ label: 'pending desktop' }); });
  await page.waitForTimeout(1300);
  assert.ok(failedExchanges >= 2, 'Desktop transport failures must be retried without revocation.');
  assert.equal(await page.evaluate(() => window.clock.controller.getState().draft.label), 'pending desktop');
  assert.equal(await page.evaluate(() => window.clock.controller.getState().loaded), true);
  failExchange = false;
  await desktop.waitForFunction(() => window.controller.getState().draft.label === 'pending desktop');

  offline = true;
  await page.evaluate(() => { void window.clock.controller.edit({ label: 'offline first' }); });
  await page.waitForFunction(() => window.clock.controller.getState().error?.includes('自动重连'));
  await page.evaluate(() => { void window.clock.controller.edit({ label: 'offline later' }); });
  assert.equal(await page.evaluate(() => window.clock.controller.getState().draft.label), 'offline later');
  assert.equal(await page.evaluate(() => window.clock.controller.getState().loaded), true);
  offline = false;
  loseAction = 'edit';
  await desktop.waitForFunction(() => window.controller.getState().draft.label === 'offline later');
  await page.evaluate(() => window.clock.controller.flush());
  assert.equal(await page.evaluate(() => window.clock.controller.getState().error || ''), '');
  const edits = commands.filter(command => command.action === 'edit');
  const repeated = edits.filter(command => command.change.label === 'offline first');
  assert.ok(repeated.length >= 3, 'Cover offline failure, accepted lost response and replay.');
  assert.equal(new Set(repeated.map(command => command.commandId)).size, 1);
  assert.equal(edits.at(-1).change.label, 'offline later');

  loseAction = 'publish';
  const publication = await page.evaluate(() => window.canvas.execute('publish'));
  assert.equal(publication.publishedVersion, 1);
  assert.equal(await desktop.evaluate(() => window.publications), 1);
  assert.deepEqual(await desktop.evaluate(() => window.writes), ['offline later']);
  assert.equal(lostResponses, 2);

  await desktop.evaluate(() => window.handle.close());
  await page.waitForFunction(() => !window.clock.controller.getState().loaded && !window.canvas.controller.getState().loaded);
  const stoppedRequests = browserRequests;
  await page.waitForTimeout(1200);
  assert.equal(browserRequests, stoppedRequests, 'Revoked capabilities must stop retrying.');
  assert.equal(await page.evaluate(() => window.clock.controller.getState().draft.label), 'offline later');

  const { data: session } = await fixture.post({ action: 'open', component: 'clock',
    state: { draft: { label: 'saved' }, saved: { label: 'saved' }, loaded: true, generation: 0 } });
  await page.evaluate(async session => {
    const { createBrowserPreviewConnection } = await import('/js/admin/component-preview-remote.js');
    window.retrying = createBrowserPreviewConnection({ ...session, component: 'clock' });
    await window.retrying.start();
  }, session);
  offline = true;
  await page.evaluate(() => { window.editing = window.retrying.controller.edit({ label: 'retained on close' }); });
  await page.waitForFunction(() => window.retrying.controller.getState().error?.includes('自动重连'));
  await page.evaluate(async () => { window.retrying.close(); await window.editing; });
  assert.equal(await page.evaluate(() => window.retrying.controller.getState().draft.label), 'retained on close');
  await page.waitForTimeout(100);
  const closedRequests = browserRequests;
  await page.waitForTimeout(1200);
  assert.equal(browserRequests, closedRequests, 'Closing during retry cancels pending timers and requests.');
});
