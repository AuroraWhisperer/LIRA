'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();

async function workspaceFixture(t) {
  const page = await fixture(t, 'libraries');
  await page.route('**/preview-*', (route) => route.fulfill({ contentType: 'text/html', body: `
    <script>
      window.messages = [];
      addEventListener('message', event => window.messages.push(event.data));
      parent.postMessage({ type: 'component-preview:ready' }, '*');
    </script>` }));
  await page.evaluate(async () => {
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { registerComponentPreview } = await import('/js/admin/component-preview-registry.js');
    const { openComponentWorkspace } = await import('/js/admin/component-workspace.js');
    const { openComponentPreview } = await import('/js/admin/component-preview-dialog.js');
    window.writes = [];
    window.fail = new Set();
    window.holdSaves = new Set();
    window.pendingComponentSaves = [];
    window.controllers = {};
    window.factories = {};
    window.opened = [];
    window.previewClosed = [];
    window.dataStopped = [];
    for (const id of ['danmaku', 'clock', 'queue', 'overtime']) {
      const controller = createComponentConfigController({ initial: { size: 24 }, persist: async (draft) => {
        window.writes.push({ id, draft });
        if (window.holdSaves.has(id)) {
          await new Promise((resolve, reject) => window.pendingComponentSaves.push({ id, resolve, reject }));
        }
        if (window.fail.has(id)) throw new Error('模拟离线');
        return draft;
      } });
      window.controllers[id] = controller;
      const factory = () => ({ id, title: id, controller, url: `/preview-${id}`, size: () => [640, 480],
        onOpen: () => window.opened.push(id), onClose: () => window.previewClosed.push(id),
        onEdit: (change) => controller.edit(change),
        startData: ({ emit }) => { emit({ sample: id }); return () => window.dataStopped.push(id); },
        createPanel: (host) => {
          const input = document.createElement('input');
          input.type = 'number'; input.min = '1'; input.required = true;
          input.setAttribute('aria-label', `${id}字号`);
          input.addEventListener('input', () => controller.edit({ size: Number(input.value) }));
          host.append(input);
          return { dispose: controller.subscribe(({ draft }) => { input.value = String(draft.size); }) };
        },
      });
      window.factories[id] = factory;
      registerComponentPreview(id, factory);
    }
    window.openWorkspace = openComponentWorkspace;
    window.openSingle = (id) => openComponentPreview(window.factories[id]());
    window.workspace = openComponentWorkspace();
  });
  await page.waitForFunction(() => document.querySelectorAll('.component-preview-load-state[hidden]').length === 4);
  return page;
}

test('workspace retains drafts for the browser launcher and disposes all renderers when closed', async (t) => {
  const page = await workspaceFixture(t);
  assert.equal(await page.locator('iframe').count(), 4);
  await page.getByRole('button', { name: /clock已保存配置/ }).click();
  await page.getByRole('spinbutton', { name: 'clock字号' }).fill('36');
  await page.evaluate(() => window.openWorkspace());
  assert.equal(await page.locator('dialog[open]').count(), 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('dialog[open]'));
  assert.equal(await page.locator('iframe').count(), 0);
  assert.deepEqual(await page.evaluate(() => window.previewClosed.sort()), ['clock', 'danmaku', 'overtime', 'queue']);
  assert.deepEqual(await page.evaluate(() => window.dataStopped.sort()), ['clock', 'danmaku', 'overtime', 'queue']);
  await page.evaluate(() => window.openSingle('clock'));
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('iframe').count(), 0);
  assert.equal(await page.evaluate(() => window.pendingSaves[0].body.component), 'clock');
  assert.equal(await page.evaluate(() => window.pendingSaves[0].body.state.draft.size), 36);
  assert.deepEqual(await page.evaluate(() => window.writes), []);
  await page.evaluate(() => window.openWorkspace());
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.locator('iframe').count(), 4);
});

test('workspace validates before any writes and retries only failed components after partial success', async (t) => {
  const page = await workspaceFixture(t);
  await page.getByRole('spinbutton', { name: 'danmaku字号' }).fill('0');
  await page.getByRole('button', { name: /clock已保存配置/ }).click();
  await page.getByRole('spinbutton', { name: 'clock字号' }).fill('32');
  await page.getByRole('button', { name: '保存全部修改', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.writes), []);
  await page.getByRole('spinbutton', { name: 'danmaku字号' }).fill('28');
  await page.evaluate(() => window.fail.add('clock'));
  await page.getByRole('button', { name: '保存全部修改', exact: true }).click();
  await page.waitForFunction(() => window.writes.length === 2 && !window.controllers.clock.getState().saving);
  assert.equal(await page.evaluate(() => window.controllers.clock.getState().dirty), true);
  await page.evaluate(() => { window.fail.clear(); window.controllers.danmaku.edit({ size: 40 }); });
  await page.getByRole('button', { name: '仅重试失败项', exact: true }).click();
  await page.waitForFunction(() => window.writes.length === 3);
  assert.deepEqual(await page.evaluate(() => window.writes.map(({ id }) => id)), ['danmaku', 'clock', 'clock']);
  assert.equal(await page.evaluate(() => window.controllers.danmaku.getState().dirty), true);
});

test('each iframe receives only its own config and data and rejects forged edit messages', async (t) => {
  const page = await workspaceFixture(t);
  const clock = page.frames().find((frame) => frame.url().endsWith('/preview-clock'));
  await clock.waitForFunction(() => window.messages.some((message) => message.type === 'component-preview:data'));
  assert.deepEqual(await clock.evaluate(() => window.messages.find((message) => message.type === 'component-preview:data').data), { sample: 'clock' });
  await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="clock展示预览"]');
    for (const event of [
      { source: window, origin: 'null' },
      { source: frame.contentWindow, origin: location.origin },
    ]) window.dispatchEvent(new MessageEvent('message', { ...event, data: { type: 'component-preview:edit', change: { size: 99 } } }));
  });
  assert.equal(await page.evaluate(() => window.controllers.clock.getState().draft.size), 24);
  await clock.evaluate(() => parent.postMessage({ type: 'component-preview:edit', change: { size: 42 } }, '*'));
  await page.waitForFunction(() => window.controllers.clock.getState().draft.size === 42);
  assert.equal(await page.evaluate(() => window.controllers.queue.getState().draft.size), 24);
});

test('closing during save preserves failures and retry uses only the reopened parameter panels', async (t) => {
  const page = await workspaceFixture(t);
  await page.evaluate(() => {
    window.holdSaves.add('clock');
    window.controllers.clock.edit({ size: 32 });
    window.controllers.danmaku.edit({ size: 28 });
  });
  await page.getByRole('button', { name: '保存全部修改', exact: true }).click();
  await page.waitForFunction(() => window.pendingComponentSaves.length === 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => { window.workspace = window.openWorkspace(); });
  await page.evaluate(() => {
    window.holdSaves.clear();
    window.pendingComponentSaves[0].reject(new Error('保存期间关闭后的失败'));
  });
  const retry = page.getByRole('button', { name: '仅重试失败项', exact: true });
  await retry.waitFor({ state: 'visible' });
  await page.evaluate(() => window.controllers.danmaku.edit({ size: 40 }));
  await page.getByRole('button', { name: /clock保存失败/ }).click();
  const input = page.getByRole('spinbutton', { name: 'clock字号' });
  await input.evaluate((field) => field.setCustomValidity('请检查新面板'));
  await retry.click();
  assert.equal(await page.evaluate(() => window.writes.length), 2);
  await input.evaluate((field) => field.setCustomValidity(''));
  await retry.click();
  await page.waitForFunction(() => window.writes.length === 3 && !window.controllers.clock.getState().dirty);
  assert.deepEqual(await page.evaluate(() => window.writes.map(({ id }) => id)), ['danmaku', 'clock', 'clock']);
  assert.equal(await page.evaluate(() => window.controllers.danmaku.getState().dirty), true);
});

test('account reset removes old failures and retry cannot save the new account draft', async (t) => {
  const page = await workspaceFixture(t);
  await page.evaluate(() => {
    window.fail.add('danmaku');
    window.controllers.danmaku.edit({ size: 28 });
  });
  await page.getByRole('button', { name: '保存全部修改', exact: true }).click();
  const retry = page.getByRole('button', { name: '仅重试失败项', exact: true, includeHidden: true });
  await retry.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => {
    window.controllers.danmaku.reset({ size: 48 });
    window.controllers.danmaku.receive({ size: 48 });
    window.controllers.danmaku.edit({ size: 52 });
    window.fail.clear();
    window.workspace = window.openWorkspace();
  });
  assert.equal(await retry.isHidden(), true);
  assert.equal(await page.getByRole('button', { name: /danmaku有未保存修改/ }).count(), 1);
  await retry.evaluate((button) => button.click());
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  assert.equal(await page.evaluate(() => window.controllers.danmaku.getState().dirty), true);
  await page.getByRole('button', { name: '保存当前组件', exact: true }).click();
  await page.waitForFunction(() => window.writes.length === 2 && !window.controllers.danmaku.getState().dirty);
  assert.deepEqual(await page.evaluate(() => window.writes[1]), { id: 'danmaku', draft: { size: 52 } });
});

test('replacing a controller creates a fresh batch session and ignores the old pending result', async (t) => {
  const page = await workspaceFixture(t);
  await page.evaluate(() => {
    window.holdSaves.add('clock');
    window.controllers.clock.edit({ size: 28 });
  });
  await page.getByRole('button', { name: '保存全部修改', exact: true }).click();
  await page.waitForFunction(() => window.pendingComponentSaves.length === 1);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(async () => {
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { registerComponentPreview } = await import('/js/admin/component-preview-registry.js');
    const controller = createComponentConfigController({ initial: { size: 48 }, persist: async (draft) => {
      window.writes.push({ id: 'replacement-clock', draft });
      return draft;
    } });
    window.controllers.clock = controller;
    const previous = window.factories.clock;
    window.factories.clock = () => ({ ...previous(), controller, createPanel: () => ({ dispose() {} }) });
    registerComponentPreview('clock', window.factories.clock);
    controller.edit({ size: 52 });
    window.workspace = window.openWorkspace();
    window.pendingComponentSaves[0].reject(new Error('已释放会话的迟到失败'));
  });
  assert.equal(await page.getByRole('button', { name: '仅重试失败项', exact: true }).isHidden(), true);
  await page.getByRole('button', { name: '保存全部修改', exact: true }).click();
  await page.waitForFunction(() => window.writes.length === 2 && !window.controllers.clock.getState().dirty);
  assert.deepEqual(await page.evaluate(() => window.writes[1]), { id: 'replacement-clock', draft: { size: 52 } });
});
