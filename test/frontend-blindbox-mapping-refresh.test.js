'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createBlindboxFixture,
  flushBlindboxTasks,
} = require('./helpers/frontend-blindbox-fixture');
const { loadModuleExports, response } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

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
  const { createSettingsForm } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-form.js'),
    { window },
  );
  const saved = [];
  window.AdminApp?.eventBus?.on('state:saved', (payload) =>
    saved.push(payload),
  );
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
  const submit = () =>
    elements.get('settingsForm').submit({ preventDefault() {} });
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
  assert.equal(
    fixture.fetchCalls.filter(
      ({ url }) => url === '/api/overtime/gifts/refresh',
    ).length,
    2,
  );
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: '789', gifts: [{ id: 'final' }] });
  assert.deepEqual(
    [
      ...fixture.container.innerHTML.matchAll(
        /<span class="bb-chip-name">([^<]+)<\/span>/g,
      ),
    ].map(([, name]) => name),
    ['最终盒', '旧盒'],
  );

  fixture.dispatchSettings('999');
  await flushBlindboxTasks();
  assert.equal(fixture.refreshRequests.length, 1);
  await fixture.resolveRefresh({ roomId: 'stale', gifts: [{ id: 'wrong' }] });
  await flushBlindboxTasks();
  assert.deepEqual(
    [
      ...fixture.container.innerHTML.matchAll(
        /<span class="bb-chip-name">([^<]+)<\/span>/g,
      ),
    ].map(([, name]) => name),
    ['旧盒', '最终盒'],
  );
  assert.equal(
    fixture.fetchCalls.filter(
      ({ url }) => url === '/api/overtime/gifts/refresh',
    ).length,
    4,
  );
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
    [
      ...fixture.container.innerHTML.matchAll(
        /<span class="bb-chip-name">([^<]+)<\/span>/g,
      ),
    ].map(([, name]) => name);
  await fixture.resolveRefresh({ roomId: '123', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售盲盒', '官方盲盒']);

  fixture.dispatchSettings('456');
  await flushBlindboxTasks();
  fixture.refreshRequests
    .shift()
    .resolve(response({ ok: false, error: 'offline' }));
  await flushBlindboxTasks();
  assert.deepEqual(names(), ['官方盲盒', '在售盲盒']);
  assert.deepEqual(fixture.visibleNames(), []);
  assert.match(fixture.container.innerHTML, /暂未获取到当前直播间可送的盲盒/);
  assert.equal(fixture.refreshRequests.length, 0);

  fixture.dispatchSettings('789');
  await flushBlindboxTasks();
  await fixture.resolveRefresh({ roomId: '789', gifts: [{ id: '200' }] });
  assert.deepEqual(names(), ['在售盲盒', '官方盲盒']);
});

test('blind-box advanced editor replaces saved null with an empty state while preserving config, drafts, and expansion', async () => {
  const textarea = { value: 'null', dataset: {} };
  const toggle = { hidden: false, textContent: '高级 ▾' };
  const advanced = { hidden: true };
  const elements = {
    blindBoxList: { innerHTML: '', querySelectorAll: () => [] },
    giftBlindBoxCustomConfigV2: textarea,
    blindBoxAdvancedToggle: toggle,
    blindBoxAdvanced: advanced,
  };
  const window = {
    addEventListener() {},
    AdminApp: {
      utils: { escapeHtml: String, escapeAttr: String, formatMoney: String },
      gifts: { recent: { getBlindBoxIcon: () => null } },
    },
  };
  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    {
      document: {
        readyState: 'loading',
        addEventListener() {},
        getElementById: (id) => elements[id] || null,
      },
      window,
      fetch: () => new Promise(() => {}),
    },
  );
  const { renderBlindBoxList } = window.AdminApp.gifts.blindbox;

  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, true);

  for (const raw of ['null', '[]', '']) {
    textarea.value = raw;
    toggle.hidden = false;
    toggle.textContent = '高级 ▴';
    advanced.hidden = false;
    renderBlindBoxList();
    assert.equal(toggle.hidden, false);
    assert.equal(advanced.hidden, false);
    assert.equal(toggle.textContent, '高级 ▴');
    assert.equal(textarea.value, raw === 'null' ? '' : raw);
    assert.equal(textarea.dataset.dirty, undefined);
  }

  const config = '[{"name":"Custom box","price":5,"outputs":[]}]';
  advanced.hidden = true;
  toggle.textContent = '高级 ▾';
  textarea.value = config;
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, true);
  assert.equal(textarea.value, config);

  advanced.hidden = false;
  textarea.dataset.dirty = 'true';
  for (const draft of ['', '[]', 'null', '[']) {
    textarea.value = draft;
    renderBlindBoxList();
    assert.equal(toggle.hidden, false);
    assert.equal(advanced.hidden, false);
    assert.equal(textarea.value, draft);
    assert.equal(textarea.dataset.dirty, 'true');
  }

  textarea.value = '[]';
  textarea.dataset.dirty = 'false';
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, false);
  assert.equal(textarea.value, '[]');

  textarea.value = config;
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(advanced.hidden, false);

  textarea.value = '{';
  renderBlindBoxList();
  assert.equal(toggle.hidden, false);
  assert.equal(textarea.value, '{');

  const page = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'gifts', 'page.html'),
    'utf8',
  );
  assert.doesNotMatch(page, /id="blindBoxAdvancedToggle"[^>]*\bhidden\b/);
  assert.match(page, /id="blindBoxAdvanced"[^>]*\bhidden\b/);
  assert.doesNotMatch(page, /id="blindBoxAddBtn"[^>]*\bhidden\b/);
  assert.match(page, /placeholder="暂无自定义配置/);
  assert.match(page, /官方盲盒映射自动同步，无需填写/);
  assert.match(
    page,
    /id="blindBoxListToggle"[^>]*aria-expanded="false"[^>]*aria-controls="blindBoxList"/,
  );
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
    getElementById: (id) =>
      id === 'giftBlindBoxCustomConfigV2' ? textarea : null,
    querySelectorAll: () => [],
  };
  const window = { AdminApp: {} };
  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    { document, window },
  );
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
    'blindboxCopyUrlBtn',
    'giftBlindBoxCustomConfigV2',
    'importBtn',
    'blindBoxAdvanced',
    'blindboxOverlayUrl',
    'blindboxLiveLink',
  ])
    elements.set(id, makeElement());
  const editable = elements.get('giftBlindBoxCustomConfigV2');
  editable.value = 'null';
  const advanced = elements.get('blindBoxAdvanced');
  advanced.hidden = true;
  const { createBlindboxSettings } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'settings-blindbox.js'),
  );
  const savedConfigs = [];
  let listRenders = 0;
  const settings = createBlindboxSettings({
    documentRef: { getElementById: (id) => elements.get(id) || null },
    navigatorRef: { clipboard: { writeText: async () => {} } },
    promptRef() {},
    locationRef: {},
    value: (id) => elements.get(id)?.value || '',
    toast() {},
    saveSettings: async (config) => {
      savedConfigs.push(config);
      throw new Error('offline');
    },
    getGifts: () => ({
      renderBlindBoxList() {
        listRenders += 1;
      },
    }),
    getState: () => null,
    getImports: () => null,
    localOverlayOrigin: () => 'http://127.0.0.1:3000',
  });
  settings.init();
  const listToggle = elements.get('blindBoxListToggle');
  listToggle.listeners.get('click')();
  assert.equal(listToggle.getAttribute('aria-expanded'), 'true');
  listToggle.listeners.get('click')();
  assert.equal(listToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(listRenders, 2);

  editable.value = '';
  await elements.get('giftBlindBoxSaveBtn').listeners.get('click')();
  assert.equal(
    savedConfigs.length,
    0,
    'saving the untouched empty state must not replace legacy config',
  );
  assert.equal(editable.dataset.dirty, undefined);
  const toggle = elements.get('blindBoxAdvancedToggle');
  toggle.listeners.get('click')();
  assert.equal(advanced.hidden, false);
  assert.equal(toggle.textContent, '高级 ▴');
  toggle.listeners.get('click')();
  assert.equal(advanced.hidden, true);
  assert.equal(toggle.textContent, '高级 ▾');
  toggle.listeners.get('click')();
  assert.equal(advanced.hidden, false);
  editable.value = draft;
  editable.listeners.get('input')();
  await assert.rejects(
    elements.get('giftBlindBoxSaveBtn').listeners.get('click')(),
    /offline/,
  );
  assert.equal(editable.value, draft);
  assert.equal(editable.dataset.dirty, 'true');
  editable.value = '';
  editable.listeners.get('input')();
  await assert.rejects(
    elements.get('giftBlindBoxSaveBtn').listeners.get('click')(),
    /offline/,
  );
  assert.equal(savedConfigs.at(-1).giftBlindBoxCustomConfigV2, '[]');
});
