'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUiFixture } = require('../helpers/ui-edit-state-fixture');

const fixture = createUiFixture();
const sceneId = '20000000-0000-4000-8000-000000000001';
const firstId = '20000000-0000-4000-8000-000000000002';
const secondId = '20000000-0000-4000-8000-000000000003';

async function editorFixture(t) {
  const page = await fixture(t, 'libraries');
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.route('**/js/shared/utils.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export const api = async (url, body) => ({ ok: true, data: await window.sceneRequest(url, body) });
    export const copyText = async value => { window.copied = value; };
    export const localOverlayOrigin = () => 'http://lira-ui.test';
    export const readJsonResponse = response => response.json();
  ` }));
  await page.route('**/scene-preview-*', (route) => route.fulfill({ contentType: 'text/html', body: `
    <script>parent.postMessage({type:'component-preview:ready'}, '*');</script>
  ` }));
  for (const file of ['component-preview.css', 'component-workspace.css', 'scene-editor.css', '../components/confirmation-dialog.css']) {
    await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../../public/css/admin', file), 'utf8') });
  }
  await page.evaluate(async ({ sceneId, firstId, secondId }) => {
    let nextId = 10;
    if (!crypto.randomUUID) crypto.randomUUID = () => `20000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
    const { createComponentConfigController } = await import('/js/admin/component-config-controller.js');
    const { registerComponentPreview } = await import('/js/admin/component-preview-registry.js');
    const { openSceneEditor } = await import('/js/admin/scene-editor.js');
    window.writes = [];
    window.defaultWrites = [];
    window.sceneValidations = [];
    window.controllers = {};
    window.sceneRecords = new Map();
    window.sceneRecords.set(sceneId, { revision: 1, publishedVersion: 0, hasPublication: false, document: {
      schemaVersion: 1, id: sceneId, title: '测试场景', canvas: { width: 640, height: 360 }, items: [
        { id: firstId, type: 'clock', name: '时钟 A', x: 32, y: 32, width: 120, height: 80, visible: true, locked: false,
          appearance: { mode: 'shared' } },
        { id: secondId, type: 'clock', name: '时钟 B', x: 256, y: 120, width: 120, height: 80, visible: true, locked: false,
          appearance: { mode: 'independent', config: { label: '独立时钟' } } },
      ],
    } });
    window.sceneRequest = async (input, body) => {
      const url = new URL(input, location.origin);
      const action = url.pathname.split('/').at(-1);
      if (action === 'list') return [...window.sceneRecords.values()];
      if (action === 'document') return structuredClone(window.sceneRecords.get(url.searchParams.get('id')));
      if (action === 'source') return { id: url.searchParams.get('id'), token: 'synthetic-scene-capability' };
      if (action === 'validate') {
        window.sceneValidations.push(structuredClone(body.document));
        if (window.failTemplateValidation) throw new Error('组件外观配置无效');
        const document = structuredClone(body.document);
        if (window.normalizedImportTitle) document.title = window.normalizedImportTitle;
        return document;
      }
      window.writes.push({ action, body: structuredClone(body) });
      if (action === 'create') {
        const id = crypto.randomUUID();
        const dto = { document: { schemaVersion: 1, id, ...body, items: [] }, revision: 1, publishedVersion: 0, hasPublication: false };
        window.sceneRecords.set(id, dto); return structuredClone(dto);
      }
      if (action === 'rotate') return { id: body.id, token: 'replacement-capability' };
      if (action === 'save' && window.holdSave) await new Promise((resolve) => { window.finishSave = resolve; });
      if (action === 'publish' && window.holdPublish) await new Promise((resolve) => { window.finishPublish = resolve; });
      if (action === 'publish' && window.failDefaultSync) {
        const error = new Error('共享默认配置同步中，请稍后重试发布。'); error.status = 503; throw error;
      }
      if (window.failConflict) { const error = new Error('stale'); error.status = 409; throw error; }
      const record = window.sceneRecords.get(body.id);
      if (action === 'save') { record.document = structuredClone(body.document); record.revision++; }
      if (action === 'publish') { record.publishedVersion++; record.hasPublication = true; }
      return structuredClone(record);
    };
    window.fetch = async (url) => ({ ok: true, json: async () => ({ ok: true, data: await window.sceneRequest(url) }) });
    for (const id of ['danmaku', 'clock', 'queue', 'overtime']) {
      const controller = createComponentConfigController({ initial: { label: '默认时钟' }, persist: async (draft) => {
        window.defaultWrites.push({ id, draft }); return draft;
      } });
      window.controllers[id] = controller;
      registerComponentPreview(id, () => ({ id, title: id, controller, size: () => [120, 80], url: `/scene-preview-${id}`,
        projectConfig: (draft) => ({ label: draft.label }),
        createPanel(host, target = controller) {
          const input = document.createElement('input'); input.setAttribute('aria-label', `${id}标签`);
          input.addEventListener('input', () => target.edit({ label: input.value })); host.append(input);
          return { dispose: target.subscribe(({ draft }) => { input.value = draft.label || ''; }) };
        },
      }));
    }
    window.openEditor = openSceneEditor;
    window.editor = openSceneEditor();
  }, { sceneId, firstId, secondId });
  await page.getByRole('textbox', { name: '场景名称', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.scene-editor-toolbar input').value === '测试场景');
  return page;
}

async function choose(page, name, modifiers) {
  await page.locator('.scene-editor-layers').getByRole('button', { name, exact: true }).click({ modifiers });
}

test('scene instances edit independently, shared defaults save separately, and close/reopen retains the draft', async (t) => {
  const page = await editorFixture(t);
  assert.equal(await page.locator('iframe').count(), 2);
  await choose(page, '时钟 B');
  await page.getByRole('textbox', { name: 'clock标签' }).fill('只改 B');
  assert.equal(await page.evaluate(() => window.controllers.clock.getState().draft.label), '默认时钟');
  await choose(page, '时钟 A');
  await page.getByRole('textbox', { name: 'clock标签' }).fill('新默认');
  await page.getByRole('button', { name: '单独保存组件默认配置' }).click();
  assert.equal(await page.evaluate(() => window.defaultWrites.length), 1);
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.getByRole('button', { name: '复制当前外观为独立配置' }).click();
  await page.getByRole('textbox', { name: 'clock标签' }).fill('只改 A');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  assert.equal(await page.locator('iframe').count(), 0);
  await page.evaluate(() => window.openEditor());
  await choose(page, '时钟 B');
  assert.equal(await page.getByRole('textbox', { name: 'clock标签' }).inputValue(), '只改 B');
  await page.getByRole('button', { name: '保存场景草稿' }).click();
  await page.waitForFunction(() => window.writes.length === 1);
  assert.deepEqual(await page.evaluate(() => window.writes[0].body.document.items.map((item) => item.appearance.config.label)), ['只改 A', '只改 B']);
});

test('scene save freezes its submission, preserves concurrent edits and history, and a conflict prevents overwrite', async (t) => {
  const page = await editorFixture(t);
  const name = page.getByRole('textbox', { name: '场景名称', exact: true });
  await name.fill('本次提交'); await name.press('Tab');
  await page.evaluate(() => { window.holdSave = true; });
  await page.getByRole('button', { name: '保存场景草稿' }).click();
  await page.waitForFunction(() => !!window.finishSave);
  await name.fill('提交后的修改'); await name.press('Tab');
  await page.evaluate(() => { window.holdSave = false; window.finishSave(); });
  await page.waitForFunction(() => document.querySelector('footer [role="status"]').textContent.includes('期间的新修改'));
  assert.equal(await name.inputValue(), '提交后的修改');
  assert.equal(await page.evaluate(() => window.writes[0].body.document.title), '本次提交');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await name.inputValue(), '本次提交');
  assert.equal(await page.getByRole('button', { name: '保存场景草稿' }).isDisabled(), true);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await page.evaluate(() => { window.failConflict = true; });
  await page.getByRole('button', { name: '保存场景草稿' }).click();
  await page.waitForFunction(() => document.querySelector('footer [role="status"]').textContent.includes('版本冲突'));
  assert.equal(await name.inputValue(), '提交后的修改');
  assert.equal(await page.getByRole('button', { name: '保存场景草稿' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: '发布整套（固定当前外观）' }).isDisabled(), true);
});

test('multi-selection aligns unlocked instances, drag is one history entry, and lock/visibility/layers persist', async (t) => {
  const page = await editorFixture(t);
  await choose(page, '时钟 A'); await choose(page, '时钟 B', ['Shift']);
  assert.equal(await page.locator('.scene-editor-layer [aria-pressed="true"]').count(), 2);
  await page.getByRole('combobox', { name: '对齐方式' }).selectOption('top');
  await page.getByRole('button', { name: '应用对齐' }).click();
  const first = page.locator(`[data-item-id="${firstId}"]`);
  const second = page.locator(`[data-item-id="${secondId}"]`);
  assert.equal(await second.evaluate((node) => node.style.top), '32px');
  const before = await first.boundingBox();
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 40, before.y + before.height / 2 + 24, { steps: 4 });
  await page.mouse.up();
  const moved = Number.parseFloat(await first.evaluate((node) => node.style.left));
  assert.ok(moved > 32);
  assert.equal(Number.parseFloat(await second.evaluate((node) => node.style.left)) - moved, 224);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await first.evaluate((node) => node.style.left), '32px');
  await page.getByRole('button', { name: '锁定 时钟 B', exact: true }).click();
  await page.getByRole('combobox', { name: '对齐方式' }).selectOption('right');
  await page.getByRole('button', { name: '应用对齐' }).click();
  assert.equal(await first.evaluate((node) => node.style.left), '520px');
  assert.equal(await second.evaluate((node) => node.style.left), '256px');
  await page.getByRole('button', { name: '隐藏 时钟 A', exact: true }).click();
  assert.equal(await page.locator('iframe').count(), 1);
  await page.getByRole('button', { name: '保存场景草稿' }).click();
  await page.waitForFunction(() => window.writes.length === 1);
  const items = await page.evaluate(() => window.writes[0].body.document.items);
  assert.equal(items[0].visible, false); assert.equal(items[1].locked, true);
});

test('publication and explicit source copy never render scene credentials; default reset closes stale editor', async (t) => {
  const page = await editorFixture(t);
  assert.equal(await page.getByRole('button', { name: '复制场景来源' }).isDisabled(), true);
  await page.getByRole('button', { name: '发布整套（固定当前外观）' }).click();
  await page.waitForFunction(() => window.writes.length === 1);
  assert.deepEqual(await page.evaluate(() => window.writes[0]), { action: 'publish', body: {
    id: sceneId, expectedRevision: 1, expectedDefaults: { clock: { label: '默认时钟' } },
  } });
  await page.getByRole('button', { name: '复制场景来源' }).click();
  await page.waitForFunction(() => !!window.copied);
  assert.match(await page.evaluate(() => window.copied), /\/scene\?id=.*#token=synthetic-scene-capability$/);
  assert.equal(await page.evaluate(() => document.documentElement.outerHTML.includes('synthetic-scene-capability')), false);
  await page.evaluate(() => window.controllers.clock.reset());
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('iframe').count(), 0);
});

test('template import requires each binding, offers local resources only, and creates a new unsaved scene', async (t) => {
  const page = await editorFixture(t);
  await page.evaluate(() => { window.normalizedImportTitle = '已校验的模板'; });
  const template = await page.evaluate(({ sceneId }) => {
    const document = structuredClone(window.sceneRecords.get(sceneId).document);
    document.title = '导入的模板';
    document.items[1].appearance.config.fontFamily = 'DefinitelyMissingFont';
    return JSON.stringify(document);
  }, { sceneId });
  await page.locator('.scene-editor input[type="file"]').setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(template) });
  const panel = page.getByRole('region', { name: '模板资源重新绑定' });
  await panel.waitFor({ state: 'visible' });
  await panel.getByRole('button', { name: '确认绑定并创建新场景' }).click();
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  assert.match(await page.locator('footer [role="status"]').textContent(), /明确确认/);
  assert.equal(await panel.locator('select option[value="DefinitelyMissingFont"]').count(), 0);
  await panel.getByRole('combobox').selectOption('sans-serif');
  for (const checkbox of await panel.getByRole('checkbox').all()) await checkbox.check();
  await panel.getByRole('button', { name: '确认绑定并创建新场景' }).click();
  await page.waitForFunction(() => document.querySelector('.scene-editor-toolbar input').value === '已校验的模板');
  assert.equal(await page.getByRole('button', { name: '发布整套（固定当前外观）' }).isDisabled(), true);
  await page.getByRole('button', { name: '保存场景草稿' }).click();
  await page.waitForFunction(() => window.writes.length === 2);
  const saved = await page.evaluate(() => window.writes[1].body.document);
  assert.notEqual(saved.id, sceneId);
  assert.notEqual(saved.items[0].id, firstId);
  assert.notEqual(saved.items[1].id, secondId);
  assert.equal(saved.items[1].appearance.config.fontFamily, 'sans-serif');
  assert.equal(saved.title, '已校验的模板');
  assert.equal(await page.evaluate(() => window.sceneValidations.length), 1);
  assert.equal(Object.hasOwn(saved, 'publishedVersion'), false);
});

test('invalid imported component config fails server validation before creation or changing the active draft', async (t) => {
  const page = await editorFixture(t);
  const name = page.getByRole('textbox', { name: '场景名称', exact: true });
  await name.fill('原有的未保存草稿'); await name.press('Tab');
  const template = await page.evaluate(({ sceneId }) => {
    window.failTemplateValidation = true;
    const document = structuredClone(window.sceneRecords.get(sceneId).document);
    document.items[1].appearance.config.style = 'invalid-clock-style';
    return JSON.stringify(document);
  }, { sceneId });
  await page.locator('.scene-editor input[type="file"]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(template) });
  const panel = page.getByRole('region', { name: '模板资源重新绑定' });
  await panel.waitFor({ state: 'visible' });
  for (const checkbox of await panel.getByRole('checkbox').all()) await checkbox.check();
  await panel.getByRole('button', { name: '确认绑定并创建新场景' }).click();
  await page.waitForFunction(() => document.querySelector('footer [role="status"]').textContent.includes('组件外观配置无效'));
  assert.equal(await page.evaluate(() => window.sceneValidations.length), 1);
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  assert.equal(await page.evaluate(() => window.sceneRecords.size), 1);
  assert.equal(await name.inputValue(), '原有的未保存草稿');
  assert.equal(await page.getByRole('combobox', { name: '选择场景', exact: true }).inputValue(), sceneId);
  await panel.getByRole('button', { name: '取消导入' }).click();
  assert.equal(await page.getByRole('button', { name: '保存场景草稿' }).isDisabled(), false);
});

test('duplicate, layer order and deletion are undoable, and unfinished shared defaults block publication', async (t) => {
  const page = await editorFixture(t);
  await choose(page, '时钟 A');
  await page.getByRole('textbox', { name: 'clock标签' }).fill('尚未保存的默认');
  assert.equal(await page.getByRole('button', { name: '发布整套（固定当前外观）' }).isDisabled(), true);
  await page.getByRole('button', { name: '单独保存组件默认配置' }).click();
  assert.equal(await page.getByRole('button', { name: '发布整套（固定当前外观）' }).isDisabled(), false);
  await page.getByRole('button', { name: '复制实例' }).click();
  assert.equal(await page.locator('iframe').count(), 3);
  await page.getByRole('button', { name: '下移一层' }).click();
  await page.getByRole('button', { name: '保存场景草稿' }).click();
  await page.waitForFunction(() => window.writes.length === 1);
  assert.deepEqual(await page.evaluate(() => window.writes[0].body.document.items.map((item) => item.name)), ['时钟 A', '时钟 A 副本', '时钟 B']);
  await page.getByRole('button', { name: '删除实例' }).click();
  assert.equal(await page.locator('iframe').count(), 2);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await page.locator('iframe').count(), 3);
});

test('Escape cancels a gesture to its starting document without closing the editor', async (t) => {
  const page = await editorFixture(t);
  await choose(page, '时钟 A');
  const first = page.locator(`[data-item-id="${firstId}"]`);
  const before = await first.boundingBox();
  await page.mouse.move(before.x + 20, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + 80, before.y + 50, { steps: 3 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await first.evaluate((node) => node.style.left), '32px');
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
});

test('resize handles follow zoom, update the inspector, and keep one undo entry per completed gesture', async (t) => {
  const page = await editorFixture(t);
  await choose(page, '时钟 A');
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('50');
  const item = page.locator(`.scene-editor-item[data-item-id="${firstId}"]`);
  const drag = async () => {
    const handle = await item.locator('[data-resize="se"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 24, handle.y + handle.height / 2 + 16, { steps: 4 });
  };
  await drag();
  await page.mouse.up();
  assert.equal(await page.getByRole('spinbutton', { name: '宽度', exact: true }).inputValue(), '168');
  assert.equal(await page.getByRole('spinbutton', { name: '高度（自动）', exact: true }).inputValue(), '112');
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  assert.equal(await item.evaluate(node => node.style.width), '120px');
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
  await drag();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await item.evaluate(node => node.style.width), '120px');
  assert.equal(await page.locator('dialog[open]').count(), 1);
  assert.equal(await page.getByRole('button', { name: '撤销', exact: true }).isDisabled(), true);
  await drag();
  await page.mouse.up();
  assert.equal(await item.evaluate(node => node.style.width), '168px');
});

test('publication preflight rejects every unsettled shared default state and ignores unrelated defaults', async (t) => {
  const page = await editorFixture(t);
  const publish = page.getByRole('button', { name: '发布整套（固定当前外观）' });
  await page.evaluate(() => {
    const read = window.controllers.clock.getState;
    window.blockingDefault = {};
    window.controllers.clock.getState = () => ({ ...read(), ...window.blockingDefault });
    window.controllers.queue.edit({ label: 'Unrelated default draft' });
  });
  assert.equal(await publish.isDisabled(), false);
  for (const override of [{ loaded: false }, { loading: true }, { saving: true }, { dirty: true }, { conflict: true }, { error: '读取失败' }]) {
    await page.evaluate((override) => {
      window.blockingDefault = override;
      window.controllers.clock.edit({});
    }, override);
    assert.equal(await publish.isDisabled(), true, JSON.stringify(override));
    assert.match(await page.locator('footer [role="status"]').textContent(), /clock的共享默认配置尚未就绪/);
    await publish.evaluate((button) => { button.disabled = false; button.click(); });
    assert.equal(await page.evaluate(() => window.writes.length), 0);
    await page.evaluate(() => { window.blockingDefault = {}; window.controllers.clock.edit({}); });
    assert.equal(await publish.isDisabled(), false);
  }
  await choose(page, '时钟 A');
  await page.getByRole('textbox', { name: 'clock标签' }).fill('放弃前的默认草稿');
  assert.equal(await publish.isDisabled(), true);
  await page.getByRole('button', { name: '放弃默认配置修改' }).click();
  assert.equal(await publish.isDisabled(), false);
  assert.equal(await page.getByRole('textbox', { name: 'clock标签' }).inputValue(), '默认时钟');
  await publish.click();
  assert.equal(await page.evaluate(() => window.writes.length), 1);
});

test('shared-default edits during an in-flight publication remain dirty and block another publication', async (t) => {
  const page = await editorFixture(t);
  await choose(page, '时钟 A');
  const publish = page.getByRole('button', { name: '发布整套（固定当前外观）' });
  await page.evaluate(() => { window.holdPublish = true; });
  await publish.click();
  await page.waitForFunction(() => !!window.finishPublish);
  await page.getByRole('textbox', { name: 'clock标签' }).fill('发布期间的新默认草稿');
  await page.evaluate(() => { window.holdPublish = false; window.finishPublish(); });
  await page.waitForFunction(() => document.querySelector('footer [role="status"]').textContent.includes('已发布版本 1'));
  assert.equal(await publish.isDisabled(), true);
  assert.match(await page.locator('footer [role="status"]').textContent(), /共享默认配置尚未就绪.*单独保存或放弃/);
  assert.equal(await page.getByRole('textbox', { name: 'clock标签' }).inputValue(), '发布期间的新默认草稿');
  assert.equal(await page.evaluate(() => window.controllers.clock.getState().dirty), true);
  assert.equal(await page.evaluate(() => window.defaultWrites.length), 0);
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  assert.deepEqual(await page.evaluate(() => window.writes[0].body.expectedDefaults), { clock: { label: '默认时钟' } });
  await page.getByRole('button', { name: '单独保存组件默认配置' }).click();
  assert.equal(await publish.isDisabled(), false);
  assert.equal(await page.evaluate(() => window.writes.length), 1);
});

test('publication snapshots projected saved defaults and permits retry after a cache synchronization failure', async (t) => {
  const page = await editorFixture(t);
  await page.evaluate(async () => {
    window.controllers.clock.edit({ label: '已确认默认', uiOnly: 'not-a-renderer-setting' });
    await window.controllers.clock.save();
    window.failDefaultSync = true;
  });
  const publish = page.getByRole('button', { name: '发布整套（固定当前外观）' });
  await publish.click();
  await page.waitForFunction(() => document.querySelector('footer [role="status"]').textContent.includes('同步中'));
  assert.deepEqual(await page.evaluate(() => window.writes[0].body.expectedDefaults), { clock: { label: '已确认默认' } });
  assert.equal(await publish.isDisabled(), false);
  assert.equal(await page.getByRole('button', { name: '复制场景来源' }).isDisabled(), true);
  await page.evaluate(() => { window.failDefaultSync = false; });
  await publish.click();
  await page.waitForFunction(() => document.querySelector('footer [role="status"]').textContent.includes('已发布版本 1'));
  assert.deepEqual(await page.evaluate(() => window.writes[1].body), {
    id: sceneId, expectedRevision: 1, expectedDefaults: { clock: { label: '已确认默认' } },
  });
});

test('fit mode contains a 1920px logical canvas without horizontal overflow', async (t) => {
  const page = await editorFixture(t);
  await page.getByRole('spinbutton', { name: '画布宽', exact: true }).fill('1920');
  await page.getByRole('spinbutton', { name: '画布宽', exact: true }).press('Tab');
  await page.getByRole('spinbutton', { name: '画布高', exact: true }).fill('1080');
  await page.getByRole('spinbutton', { name: '画布高', exact: true }).press('Tab');
  const viewport = page.locator('.scene-editor-viewport');
  const overflow = () => viewport.evaluate((node) => node.scrollWidth - node.clientWidth);
  assert.equal(await overflow(), 0);
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('100');
  assert.ok(await overflow() > 0);
  await page.getByRole('combobox', { name: '画布缩放' }).selectOption('fit');
  assert.equal(await overflow(), 0);
});

test('shared confirmation dialogs cancel or confirm draft reload and source rotation', async (t) => {
  const page = await editorFixture(t);
  const name = page.getByRole('textbox', { name: '场景名称', exact: true });
  await name.fill('待保留的草稿'); await name.press('Tab');
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  let prompt = page.getByRole('dialog', { name: '重新载入场景', exact: true });
  await prompt.getByRole('button', { name: '取消', exact: true }).click();
  await prompt.waitFor({ state: 'hidden' });
  assert.equal(await name.inputValue(), '待保留的草稿');
  assert.equal(await page.locator('dialog:modal').count(), 1);
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await prompt.getByRole('button', { name: '放弃修改并重新载入' }).click();
  await page.waitForFunction(() => document.querySelector('.scene-editor-toolbar input').value === '测试场景');
  await page.getByRole('button', { name: '发布整套（固定当前外观）' }).click();
  await page.getByRole('button', { name: '停用旧来源', exact: true }).click();
  prompt = page.getByRole('dialog', { name: '停用旧场景来源', exact: true });
  await prompt.getByRole('button', { name: '取消', exact: true }).click();
  await prompt.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.writes.filter((entry) => entry.action === 'rotate').length), 0);
  await page.getByRole('button', { name: '停用旧来源', exact: true }).click();
  await prompt.getByRole('button', { name: '停用旧来源', exact: true }).click();
  await page.waitForFunction(() => window.writes.some((entry) => entry.action === 'rotate'));
  assert.deepEqual(await page.evaluate(() => window.writes.filter((entry) => entry.action === 'rotate')), [{ action: 'rotate', body: { id: sceneId } }]);
  assert.equal(await page.locator('dialog:modal').count(), 1);
});

test('template export downloads a real JSON file containing the current display draft', async (t) => {
  const page = await editorFixture(t);
  const scratchRoot = path.resolve(__dirname, '../../tmp');
  fs.mkdirSync(scratchRoot, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(scratchRoot, 'scene-template-export-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const name = page.getByRole('textbox', { name: '场景名称', exact: true });
  await name.fill('尚未保存的导出草稿'); await name.press('Tab');
  const expected = await page.evaluate(({ sceneId }) => ({
    ...structuredClone(window.sceneRecords.get(sceneId).document), title: '尚未保存的导出草稿',
  }), { sceneId });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '导出模板', exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'lira-scene.json');
  const target = path.join(scratch, 'lira-scene.json');
  await download.saveAs(target);
  assert.equal(await download.failure(), null);
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(Buffer.byteLength(text) > 0);
  assert.deepEqual(JSON.parse(text), expected);
  assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['canvas', 'id', 'items', 'schemaVersion', 'title']);
  assert.equal(await page.evaluate(() => window.writes.length), 0);
});
