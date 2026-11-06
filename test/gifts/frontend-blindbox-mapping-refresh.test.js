'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createBlindboxFixture, flushBlindboxTasks } = require('../helpers/frontend-blindbox-fixture');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('settings form announces the saved room only after a successful save, including an unchanged room', async () => {
  const elements = new Map();
  const documentRef = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {
          addEventListener(type, handler) {
            this[type] = handler;
          },
        });
      }
      return elements.get(id);
    },
  };
  const window = {};
  const [{ createSettingsForm }, { eventBus }] = await loadModuleExports([
    path.join(ROOT_DIR, 'public/js/admin/settings-form.js'),
    path.join(ROOT_DIR, 'public/js/shared/event-bus.js'),
  ],
    { window },
  );
  const saved = [];
  eventBus.on('state:saved', (payload) => saved.push(payload));
  let resolveSave;
  let rejectSave;
  const form = createSettingsForm({
    documentRef,
    value: (id) => (id === 'roomId' ? '123' : ''),
    api: () =>
      new Promise((resolve, reject) => {
        resolveSave = resolve;
        rejectSave = reject;
      }),
    toast() {},
    getState: () => ({ reloadState: async () => {} }),
    initLicenseAccountDevice: async () => {},
    blindboxSettings: { init() {} },
  });
  await form.init();
  const submit = () => elements.get('settingsForm').submit({ preventDefault() {} });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pending = submit();
    assert.equal(saved.length, attempt);
    resolveSave({ ok: true, data: { settings: { roomId: '123' } } });
    await pending;
    assert.equal(saved.length, attempt + 1);
    assert.equal(saved.at(-1).settings.roomId, '123');
  }
  const failed = submit();
  rejectSave(new Error('save failed'));
  await assert.rejects(failed, /save failed/);
  assert.equal(saved.length, 2);
});

test('blind-box mapping skips obsolete room requests and retries a wrong-room response once', async () => {
  const fixture = await createBlindboxFixture({
    roomId: '123',
    loggedIn: true,
  });
  fixture.textarea.value = '[]';
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: 'old', name: '旧盒', rmb: 5, giftCategory: 'blindBox' },
      { id: 'final', name: '最终盒', rmb: 5, giftCategory: 'blindBox' },
      { id: 'output', name: '产物', rmb: 1 },
    ],
    blindBoxes: ['old', 'final'].map((giftId) => ({
      giftId,
      outputGiftIds: ['output'],
    })),
  });
  assert.equal(fixture.refreshRequests.length, 1);

  fixture.dispatchSettings('456');
  fixture.dispatchSettings('789');
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: 'old' }] });
  await flushBlindboxTasks();
  assert.equal(fixture.fetchCalls.filter(({ url }) => url === '/api/overtime/gifts/refresh').length, 2);
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '789', gifts: [{ id: 'final' }] });
  assert.deepEqual(
    [...fixture.container.innerHTML.matchAll(/<span class="bb-chip-name">([^<]+)<\/span>/g)].map(([, name]) => name),
    ['最终盒', '旧盒'],
  );

  fixture.dispatchSettings('999');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: 'stale', gifts: [{ id: 'wrong' }] });
  await flushBlindboxTasks();
  assert.deepEqual(
    [...fixture.container.innerHTML.matchAll(/<span class="bb-chip-name">([^<]+)<\/span>/g)].map(([, name]) => name),
    ['旧盒', '最终盒'],
  );
  assert.equal(fixture.fetchCalls.filter(({ url }) => url === '/api/overtime/gifts/refresh').length, 4);
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '999', gifts: [{ id: 'current' }] });
});

test('blind-box mapping stays alphabetical after a failed refresh and can refresh the next room', async () => {
  const fixture = await createBlindboxFixture({
    roomId: '123',
    loggedIn: true,
  });
  fixture.module.applyOfficialCatalogSnapshot({
    gifts: [
      { id: '100', name: '官方盲盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '200', name: '在售盲盒', rmb: 5, giftCategory: 'blindBox' },
      { id: '101', name: '产物', rmb: 1 },
    ],
    blindBoxes: ['100', '200'].map((giftId) => ({
      giftId,
      outputGiftIds: ['101'],
    })),
  });
  const names = () =>
    [...fixture.container.innerHTML.matchAll(/<span class="bb-chip-name">([^<]+)<\/span>/g)].map(([, name]) => name);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售盲盒', '官方盲盒']);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  fixture.refreshRequests
    .shift()
    .resolve({ ok: false, text: async () => JSON.stringify({ ok: false, error: 'offline' }) });
  await flushBlindboxTasks();
  assert.deepEqual(names(), ['官方盲盒', '在售盲盒']);
  assert.deepEqual(fixture.visibleNames(), []);
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('789');
  await flushBlindboxTasks();
  await fixture.resolveRefresh({ roomId: '789', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售盲盒', '官方盲盒']);
});

test('blind-box advanced editor replaces saved null with an empty state while preserving config and drafts', async () => {
  const textarea = { value: 'null', dataset: {} };
  const elements = {
    blindBoxList: { innerHTML: '', querySelectorAll: () => [] },
    giftBlindBoxCustomConfigV2: textarea,
    blindBoxAdvancedToggle: { hidden: false, textContent: '' },
    blindBoxAdvanced: { hidden: true },
  };
  const window = {
    addEventListener() {},
    AdminApp: {
      utils: { escapeHtml: String, escapeAttr: String, formatMoney: String },
      gifts: { recent: { getBlindBoxIcon: () => null } },
    },
  };
  const { giftBlindbox } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'), {
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById: (id) => elements[id] || null,
    },
    window,
    fetch: () => new Promise(() => {}),
  });
  const { renderBlindBoxList } = giftBlindbox;

  for (const raw of ['null', '[]', '']) {
    textarea.value = raw;
    renderBlindBoxList();
    assert.equal(textarea.value, raw === 'null' ? '' : raw);
    assert.equal(textarea.dataset.dirty, undefined);
  }

  const config = '[{"name":"Custom box","price":5,"outputs":[]}]';
  textarea.value = config;
  renderBlindBoxList();
  assert.equal(textarea.value, config);

  textarea.dataset.dirty = 'true';
  for (const draft of ['', '[]', 'null', '[']) {
    textarea.value = draft;
    renderBlindBoxList();
    assert.equal(textarea.value, draft);
    assert.equal(textarea.dataset.dirty, 'true');
  }

  textarea.dataset.dirty = 'false';
  textarea.value = '{';
  renderBlindBoxList();
  assert.equal(textarea.value, '{');
});

test('blind-box JSON draft survives state refresh and a failed save', async () => {
  const draft = '[{"name":"未保存草稿"}]';
  const textarea = {
    value: draft,
    dataset: { preserveDirty: 'true', dirty: 'true' },
    closest: () => null,
    addEventListener() {},
  };
  const document = {
    activeElement: null,
    getElementById: (id) => (id === 'giftBlindBoxCustomConfigV2' ? textarea : null),
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const window = { AdminApp: {} };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'), {
    document,
    window,
  });
  const forms = new FormsService();
  forms.fillForm({ giftBlindBoxCustomConfigV2: '[]' });
  assert.equal(textarea.value, draft);

  const elements = new Map();
  const makeElement = (value = '') => {
    const listeners = new Map();
    return {
      value,
      checked: false,
      dataset: {},
      hidden: false,
      textContent: '',
      href: '',
      options: [],
      children: [],
      classList: { add() {} },
      append() {},
      replaceChildren() {},
      querySelector: () => null,
      getAttribute(name) {
        return this[name];
      },
      setAttribute(name, value) {
        this[name] = value;
      },
      addEventListener: (type, handler) => listeners.set(type, handler),
      listeners,
    };
  };
  for (const id of [
    'blindBoxAddBtn',
    'blindBoxList',
    'blindBoxListToggle',
    'blindBoxAdvancedToggle',
    'giftBlindBoxSaveBtn',
    'blindboxOverlayTitle',
    'blindboxOverlayTop',
    'blindboxWinnersOnly',
    'blindboxHeartBoxOnly',
    'blindboxPreviewBtn',
    'giftBlindBoxCustomConfigV2',
    'importBtn',
    'blindBoxAdvanced',
    'blindboxOverlayUrl',
    'blindboxAppearanceFields',
  ])
    elements.set(id, makeElement());
  const editable = elements.get('giftBlindBoxCustomConfigV2');
  editable.value = 'null';
  elements.get('blindBoxAdvanced').hidden = true;
  const { createBlindboxSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
    // The appearance font picker builds its options through the global document.
    { document: { createElement: () => makeElement(), fonts: [] } },
  );
  const savedConfigs = [];
  let saveGate = null;
  const settings = createBlindboxSettings({
    documentRef: { getElementById: (id) => elements.get(id) || null, createElement: () => makeElement() },
    locationRef: {},
    value: (id) => elements.get(id)?.value || '',
    toast() {},
    saveSettings: async (config) => {
      savedConfigs.push(config);
      if (!saveGate) throw new Error('offline');
      await saveGate.promise;
    },
    getGifts: () => ({ renderBlindBoxList() {} }),
    getState: () => null,
    getImports: () => null,
    localOverlayOrigin: () => 'http://127.0.0.1:3000',
  });
  settings.init();

  editable.value = '';
  await elements.get('giftBlindBoxSaveBtn').listeners.get('click')();
  assert.equal(savedConfigs.length, 0, 'saving the untouched empty state must not replace legacy config');
  assert.equal(editable.dataset.dirty, undefined);
  editable.value = draft;
  editable.listeners.get('input')();
  await assert.rejects(elements.get('giftBlindBoxSaveBtn').listeners.get('click')(), /offline/);
  assert.equal(editable.value, draft);
  assert.equal(editable.dataset.dirty, 'true');
  editable.value = '';
  editable.listeners.get('input')();
  await assert.rejects(elements.get('giftBlindBoxSaveBtn').listeners.get('click')(), /offline/);
  assert.equal(savedConfigs.at(-1).giftBlindBoxCustomConfigV2, '[]');

  saveGate = Promise.withResolvers();
  editable.value = '[{"name":"submitted"}]';
  const saving = elements.get('giftBlindBoxSaveBtn').listeners.get('click')();
  editable.value = '[{"name":"newer draft"}]';
  editable.listeners.get('input')();
  saveGate.resolve();
  await saving;
  assert.equal(editable.dataset.dirty, 'true', 'a late success must not release newer draft protection');
  assert.equal(editable.value, '[{"name":"newer draft"}]');
  await elements.get('giftBlindBoxSaveBtn').listeners.get('click')();
  assert.equal(editable.dataset.dirty, 'false', 'an unchanged successful submission releases protection');
});
