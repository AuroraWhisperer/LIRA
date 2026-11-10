'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { SCENE_TYPES } = require('../../src/shared/scene-component-types');

const adminPath = path.join(__dirname, '../../public/js/admin');
const plain = (value) => JSON.parse(JSON.stringify(value));

function createNode() {
  const fields = new Map();
  const handlers = new Map();
  return { fields, handlers, children: [], dataset: {}, value: '',
    getElementById(id) {
      if (!fields.has(id)) fields.set(id, createNode());
      return fields.get(id);
    },
    addEventListener(name, handler) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(handler);
    },
    fire(name) { return Promise.all((handlers.get(name) || []).map(handler => handler())); },
    append(...children) { this.children.push(...children); },
    querySelectorAll() { return []; },
    querySelector(selector) { return this.getElementById(selector); },
    closest() { return this; },
    setAttribute(name, value) { this[name] = value; },
    getAttribute(name) { return this[name]; },
    removeAttribute(name) { delete this[name]; },
    remove() {},
  };
}

async function loadOwner(filename, overrides = {}) {
  const document = createNode();
  document.createElement = createNode;
  const opened = [];
  const bindings = [];
  const { normalizeRangeValue } = await loadModuleExports(path.resolve(adminPath, '../shared/utils.js'));
  const { subscribeComponentFields } = await loadModuleExports(path.resolve(adminPath, '../shared/component-parameter-fields.js'), { queueMicrotask });
  const replacements = {
    '../shared/copy-url.js': { bindCopyUrl: () => () => {} },
    '../shared/utils.js': { api: async () => { throw new Error('Unexpected business write'); },
      localOverlayOrigin: () => 'http://127.0.0.1:3000', copyText() {}, toast() {}, value() {}, setValue() {}, normalizeRangeValue,
      showConfirmationDialog: async () => { throw new Error('Unexpected confirmation'); } },
    './component-preview-dialog.js': { openComponentPreview(options) {
      opened.push(options);
      return { close() { options.onClose?.(); } };
    } },
    './component-preview-panel.js': { cloneComponentPanel: createNode, subscribeComponentFields,
      componentField: (root, id) => root.getElementById(id), componentFieldLabel: () => '参数',
      syncComponentFieldValue: (input, value) => { input.value = String(value); } },
    '../shared/component-style-parameter-view.js': { mountStyleParameters: () => ({ dispose() {} }) },
    './state.js': { stateService: { getAppState: () => ({ settings: {} }) } },
    './queue.js': { applyAdminQueueFontPreview() {} },
    './theme-style-view.js': { setOverlayStyle() {} },
    './theme-preset-cards.js': { renderPresetCards() {} },
    './queue-theme-view.js': { bindQueueTheme: (root, controller) => {
      bindings.push({ root, controller });
      return { dispose() {} };
    } },
    './danmaku-parameter-view.js': { bindDanmakuParameters: () => ({ dispose() {} }) },
    './danmaku-style-library.js': { bindDanmakuStyleLibrary() {} },
    './authorized-account.js': { observeAuthorizedAccount() {} },
    ...overrides,
  };
  const stubs = new Map(Object.entries(replacements).map(([name, exports]) => [path.resolve(adminPath, name), exports]));
  const context = vm.createContext({ console, document, URL, AbortController, TextEncoder, structuredClone,
    crypto: require('node:crypto'), location: new URL('http://127.0.0.1:3000/admin'),
    window: { addEventListener() {}, liraLicense: {} },
    fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: {} }) }) });
  const modules = new Map();
  function load(file) {
    if (modules.has(file)) return modules.get(file);
    const exports = stubs.get(file);
    const module = exports ? new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context, identifier: file })
      : new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
    modules.set(file, module);
    return module;
  }
  const owner = load(path.join(adminPath, filename));
  await owner.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  await owner.evaluate();
  return { owner: owner.namespace, document, opened, bindings,
    registry: modules.get(path.join(adminPath, 'component-preview-registry.js')).namespace };
}

test('registry rejects unknown types and lazily creates ordered descriptions with shared controllers', async () => {
  const registry = await loadModuleExports(path.join(adminPath, 'component-preview-registry.js'));
  assert.equal(registry.getComponentPreviews().length, 0);
  let calls = 0;
  const controllers = new Map();
  for (const id of [...SCENE_TYPES].reverse()) {
    const controller = {};
    controllers.set(id, controller);
    const factory = () => { calls++; return { id, controller }; };
    registry.registerComponentPreview(id, factory);
    registry.registerComponentPreview(id, factory);
  }
  for (const id of ['canvas', 'unknown', 'constructor', '__proto__']) {
    assert.throws(() => registry.registerComponentPreview(id, () => ({ id })));
  }
  assert.equal(calls, 0);
  const first = registry.getComponentPreviews();
  const second = registry.getComponentPreviews();
  assert.deepEqual(plain(first.map(({ id }) => id)), SCENE_TYPES);
  assert.equal(calls, SCENE_TYPES.length * 2);
  first.forEach((description, index) => {
    assert.notEqual(description, second[index]);
    assert.equal(description.controller, controllers.get(description.id));
    assert.equal(description.controller, second[index].controller);
  });
});

test('now playing widgets add separate saved appearances to the canvas without standalone relay sessions', async () => {
  const notices = [];
  const writes = [];
  const nativePreview = (_type, { controller } = {}) => ({ id: 'now-playing', sceneOnly: true, controller,
    size: require('../../public/js/shared/now-playing-appearance.js').nowPlayingSize, createPanel: () => ({ dispose() {} }) });
  const fixture = await loadOwner('now-playing.js', {
    '../shared/utils.js': { api: async (url, config) => { writes.push(url); return { data: config }; },
      copyText() {}, localOverlayOrigin: () => 'http://127.0.0.1:3000', toast: message => notices.push(message) },
    '../shared/now-playing-renderer.js': { createNowPlayingRenderer: () => ({ updateConfig() {}, updateState() {}, dispose() {} }) },
    './scene-extra-preview.js': { createSceneExtraPreview: nativePreview },
    './component-preview-definitions.js': { COMPONENT_PREVIEW_DEFINITIONS: { 'now-playing': { createPreview: nativePreview } } },
    './component-style-library.js': { mountComponentStyleLibrary() {}, openComponentStyleLibrary() {} },
    './component-library-manager.js': { openComponentLibraryManager() {} },
    './component-style-api.js': { loadComponentStyleCss() {}, requestComponentStyles() {} },
    './component-resource-settings-panel.js': { mountResourceStyleSettings() {} },
    './component-preview-surface.js': { previewElement: createNode },
    './gift-frame.js': { renderGiftFrameStyleState() {} },
  });
  for (const id of ['nowPlayingPreview', 'nowPlayingTextPreview']) {
    Object.assign(fixture.document.getElementById(id), { style: {}, parentElement: { classList: { toggle() {} } } });
  }
  let scene = { schemaVersion: 1, id: '11111111-1111-4111-8111-111111111111', title: '直播场景',
    canvas: { width: 1920, height: 1080 }, items: [] };
  fixture.registry.setComponentPreviewPreparation(() => ({ id: 'canvas', controller: {
    getState: () => ({ loaded: true, draft: { document: structuredClone(scene) } }),
    edit: ({ document }) => { scene = plain(document); },
  } }));
  const controller = fixture.owner.initNowPlaying();
  controller.receive(controller.getState().draft);
  controller.edit({ style: 'cover', nowPlayingLayout: 'vertical', nowPlayingShowArtist: false });
  const root = fixture.document.getElementById('nowPlayingPage');
  await root.querySelector('[data-now-playing-canvas="record"]').fire('click');
  await root.querySelector('[data-now-playing-canvas="text"]').fire('click');
  assert.deepEqual(notices, []);
  assert.deepEqual(writes, ['/api/now-playing/config']);
  assert.equal(fixture.registry.getComponentPreviews().length, 0);
  assert.equal(scene.items.length, 2);
  const item = scene.items[0];
  assert.equal(item.type, 'now-playing');
  assert.equal(item.appearance.mode, 'independent');
  assert.equal(item.appearance.config.style, 'cover');
  assert.equal(item.appearance.config.nowPlayingPart, 'record');
  assert.equal(scene.items[1].appearance.config.nowPlayingPart, 'text');
  assert.equal(item.appearance.config.nowPlayingLayout, 'vertical');
  assert.equal(item.appearance.config.nowPlayingShowArtist, false);
  assert.equal(item.width, 120);
  assert.equal(scene.items[1].width, 360);
  assert.equal(fixture.opened[0].selectedItemId, item.id);
  assert.equal(fixture.opened[1].selectedItemId, scene.items[1].id);
});

test('clock factory keeps the small preview live while shared editor sessions are open', async () => {
  const fixture = await loadOwner('clock-card.js');
  assert.equal(fixture.registry.getComponentPreviews().length, 0);
  const small = fixture.document.getElementById('clockPreview');
  const messages = [];
  small.contentWindow = { postMessage: (message) => messages.push(plain(message)) };
  const controller = fixture.owner.initClockCard();
  fixture.owner.initClockCard();
  await new Promise((resolve) => setImmediate(resolve));
  const [preview] = fixture.registry.getComponentPreviews();
  const source = small.src;
  assert.equal(preview.controller, controller);
  assert.ok(source);
  preview.onOpen?.();
  assert.equal(small.src, source, 'Opening an editor session must retain the inline preview.');
  controller.edit({ style: 'timeline-vertical' });
  assert.equal(small.src, source);
  assert.equal(small.dataset.clockStyle, 'timeline-vertical');
  assert.equal(messages.at(-1).type, 'component-preview:config');
  assert.equal(messages.at(-1).config.style, 'timeline-vertical');
  assert.deepEqual(plain(preview.size(controller.getState().draft)), [48, 80]);
  preview.onClose?.();
  assert.equal(small.src, source);
  fixture.document.getElementById('clockOpenPreview').fire('click');
  assert.equal(fixture.opened.length, 1);
  assert.equal(fixture.opened[0].controller, controller);
  fixture.opened[0].onOpen?.();
  controller.edit({ style: 'digital', showSeconds: false });
  assert.equal(small.src, source, 'The clock entry must also keep the existing frame loaded.');
  assert.equal(messages.at(-1).config.style, 'digital');
  assert.equal(messages.at(-1).config.showSeconds, false);
  fixture.opened[0].onClose?.();
  controller.discard();
  assert.equal(small.src, source);
  assert.deepEqual(messages.at(-1).config, plain(controller.getState().saved));
});

test('queue initialization is idempotent and both entry points reuse its parameter binding and sample data', async () => {
  const fixture = await loadOwner('theme.js');
  assert.equal(fixture.registry.getComponentPreviews().length, 0);
  const controller = fixture.owner.theme.initThemeForm();
  assert.equal(fixture.owner.theme.initThemeForm(), controller);
  const [preview] = fixture.registry.getComponentPreviews();
  controller.edit({ overlayQueueStyle: 'storybook', storybookQueueFontSize: '36' });
  preview.createPanel(createNode());
  fixture.document.getElementById('queueThemePreview').fire('click');
  assert.equal(fixture.opened.length, 1);
  const single = fixture.opened[0];
  single.createPanel(createNode());
  assert.equal(preview.controller, controller);
  assert.equal(single.controller, controller);
  assert.equal(fixture.bindings.length, 3);
  assert.ok(fixture.bindings.every((binding) => binding.controller === controller));
  const samples = [];
  preview.startData({ emit: (data) => samples.push(plain(data)) });
  single.startData({ emit: (data) => samples.push(plain(data)) });
  assert.deepEqual(samples[0], samples[1]);
  assert.equal(controller.getState().draft.storybookQueueFontSize, '36');
});

test('overtime descriptions isolate read-only sample modes, share appearance drafts and release actual data subscriptions', async () => {
  const fixture = await loadOwner('overtime-preview.js');
  const appearance = fixture.owner.createOvertimeAppearance({ initial: { status: 'paused', effectiveRemainingMs: 30000 },
    onSavedState() { throw new Error('Demo must not save'); } });
  const [preview] = fixture.registry.getComponentPreviews();
  appearance.open();
  const single = fixture.opened[0];
  assert.equal(preview.controller, appearance.controller);
  assert.equal(single.controller, appearance.controller);
  const firstPanel = createNode();
  const secondPanel = createNode();
  const firstView = preview.createPanel(firstPanel);
  const secondView = single.createPanel(secondPanel);
  const firstData = [];
  const secondData = [];
  const stopFirst = preview.startData({ mode: 'paused', emit: (data) => firstData.push(data) });
  const stopSecond = single.startData({ mode: 'running', emit: (data) => secondData.push(data) });
  assert.equal(firstData.at(-1).status, 'paused');
  assert.equal(secondData.at(-1).status, 'running');
  assert.equal(firstPanel.children[2].hidden, true);
  assert.equal(secondPanel.children[2].hidden, true);
  assert.equal(secondData.at(-1).effectiveRemainingMs, 120000);
  stopFirst();
  const stopActual = preview.startData({ mode: 'actual', emit: (data) => firstData.push(data) });
  assert.equal(firstPanel.children[2].hidden, false);
  assert.equal(secondPanel.children[2].hidden, true);
  appearance.controller.edit({ fit: 'contain' });
  appearance.receive({ revision: 3, status: 'paused', effectiveRemainingMs: 60000,
    background: { path: '', fit: 'cover' } });
  assert.equal(firstData.at(-1).effectiveRemainingMs, 60000);
  assert.equal(secondData.length, 1, 'sample data does not subscribe to actual countdown changes');
  assert.equal(appearance.controller.getState().draft.fit, 'contain');
  stopActual();
  appearance.receive({ revision: 4, status: 'finished' });
  assert.equal(firstData.at(-1).revision, 3);
  stopSecond();
  firstView.dispose();
  secondView.dispose();
});

test('danmaku registers its shared controller and keeps account reset and single-dialog close behavior', async () => {
  let accountChanged;
  const fixture = await loadOwner('danmaku-overlay-settings.js', {
    './authorized-account.js': { observeAuthorizedAccount: (listener) => { accountChanged = listener; } },
  });
  const elements = Object.fromEntries(['overlayUrl', 'styleChip', 'styleSaveState', 'copyOverlayUrlButton',
    'openOverlayButton', 'previewOverlayButton'].map((name) => [name, createNode()]));
  elements.styleButtons = [];
  const controller = fixture.owner.initDanmakuOverlaySettings(elements, () => {});
  const [preview] = fixture.registry.getComponentPreviews();
  controller.receive({ style: 'signal', fullscreenDurationSeconds: 8, styleOptions: { signal: { fontSize: 36 } } });
  elements.previewOverlayButton.fire('click');
  assert.equal(preview.controller, controller);
  assert.equal(fixture.opened[0].controller, controller);
  assert.deepEqual(plain(preview.projectConfig(controller.getState().draft)),
    plain(fixture.opened[0].projectConfig(controller.getState().draft)));
  let closed = 0;
  fixture.opened[0].onClose = () => closed++;
  accountChanged('https://example.test/overlay/new-account');
  assert.equal(closed, 1);
  assert.equal(controller.getState().loaded, false);
  assert.equal(Object.hasOwn(controller.getState().draft, 'styleOptions'), false);
  assert.equal(fixture.registry.getComponentPreviews()[0].controller, controller);
});

test('danmaku added from older layouts uses missing style defaults and preserves saved regions', async () => {
  const fixture = await loadOwner('danmaku-overlay-settings.js');
  const elements = Object.fromEntries(['overlayUrl', 'styleChip', 'styleSaveState', 'copyOverlayUrlButton',
    'openOverlayButton', 'previewOverlayButton'].map((name) => [name, createNode()]));
  elements.styleButtons = [];
  const controller = fixture.owner.initDanmakuOverlaySettings(elements, () => {});
  const [preview] = fixture.registry.getComponentPreviews();
  const { createLayout, defaultRegion } = require('../../src/shared/danmaku-layout');
  const layout = createLayout();
  const savedRegion = { x: 123, y: 234, width: 400, height: 500 };
  layout.regions = Object.fromEntries(['bubble', 'signal', 'minimal', 'ranked', 'transparent', 'identity', 'outline', 'cream', 'glow']
    .map(style => [style, style === 'signal' ? savedRegion : layout.regions[style]]));
  const savedRegions = structuredClone(layout.regions);
  controller.receive({ style: 'signal', fullscreenDurationSeconds: 6, layout });
  const draft = controller.getState().draft;
  for (const style of Object.keys(createLayout().regions)) {
    assert.deepEqual(plain(preview.bounds({ ...draft, style }) ?? null),
      savedRegions[style] || defaultRegion(style, layout.canvas, layout.contentScale), style);
  }
  assert.deepEqual(plain(controller.getState().draft.layout.regions), savedRegions);
});
