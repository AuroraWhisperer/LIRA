'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

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
    fire(name) { for (const handler of handlers.get(name) || []) handler(); },
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
  const replacements = {
    '../shared/utils.js': { api: async () => { throw new Error('Unexpected business write'); },
      localOverlayOrigin: () => 'http://127.0.0.1:3000', copyText() {}, toast() {}, value() {}, setValue() {} },
    './component-preview-dialog.js': { openComponentPreview(options) {
      opened.push(options);
      return { close() { options.onClose?.(); } };
    } },
    './component-preview-panel.js': { cloneComponentPanel: createNode,
      componentField: (root, id) => root.getElementById(id) },
    './forms.js': { formsService: {} },
    './component-style-parameters.js': { mountStyleParameters: () => ({ dispose() {} }) },
    './state.js': { stateService: { getAppState: () => ({ settings: {} }) } },
    './queue.js': { applyAdminQueueFontPreview() {} },
    './theme-style-view.js': { setOverlayStyle() {} },
    './legacy-admin-bridge.js': { publishTheme() {} },
    './theme-preset-cards.js': { renderPresetCards() {} },
    './queue-theme-view.js': { bindQueueTheme: (root, controller) => {
      bindings.push({ root, controller });
      return { dispose() {} };
    } },
    './danmaku-parameter-view.js': { bindDanmakuParameters: () => ({ dispose() {} }) },
    './server-overlay-url.js': { observeServerOverlayUrl() {} },
    ...overrides,
  };
  const stubs = new Map(Object.entries(replacements).map(([name, exports]) => [path.resolve(adminPath, name), exports]));
  const context = vm.createContext({ console, document, URL, location: new URL('http://127.0.0.1:3000/admin'),
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

test('registry stays lazy, orders initialized owners and creates fresh descriptions with shared controllers', async () => {
  const registry = await loadModuleExports(path.join(adminPath, 'component-preview-registry.js'));
  assert.equal(registry.getComponentPreviews().length, 0);
  let calls = 0;
  const controllers = new Map();
  for (const id of ['overtime', 'queue', 'danmaku', 'clock']) {
    const controller = {};
    controllers.set(id, controller);
    const factory = () => { calls++; return { id, controller }; };
    registry.registerComponentPreview(id, factory);
    registry.registerComponentPreview(id, factory);
  }
  assert.equal(calls, 0);
  const first = registry.getComponentPreviews();
  const second = registry.getComponentPreviews();
  assert.deepEqual(plain(first.map(({ id }) => id)), ['danmaku', 'clock', 'queue', 'overtime']);
  assert.equal(calls, 8);
  first.forEach((description, index) => {
    assert.notEqual(description, second[index]);
    assert.equal(description.controller, controllers.get(description.id));
    assert.equal(description.controller, second[index].controller);
  });
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

test('overtime descriptions isolate demo closures, share appearance drafts and release actual data subscriptions', async () => {
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
  const stopSecond = single.startData({ mode: 'paused', emit: (data) => secondData.push(data) });
  const addMinute = firstPanel.children[2].children[1];
  addMinute.fire('click');
  assert.equal(firstData.at(-1).effectiveRemainingMs, 180000);
  assert.equal(secondData.at(-1).effectiveRemainingMs, 120000);
  stopFirst();
  addMinute.fire('click');
  assert.equal(firstData.length, 2);
  const stopActual = preview.startData({ mode: 'actual', emit: (data) => firstData.push(data) });
  appearance.controller.edit({ fit: 'contain' });
  appearance.receive({ revision: 3, status: 'paused', effectiveRemainingMs: 60000,
    background: { path: '', fit: 'cover' } });
  assert.equal(firstData.at(-1).effectiveRemainingMs, 60000);
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
    './server-overlay-url.js': { observeServerOverlayUrl: (listener) => { accountChanged = listener; } },
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
