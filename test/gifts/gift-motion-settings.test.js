'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS, giftMotionSettingKeys } = require('../../public/js/shared/gift-motion-settings.js');

async function fixture() {
  const requests = [];
  const confirmations = [];
  const copied = [];
  const toasts = [];
  const timers = new Map();
  let timerId = 0;
  const listeners = new Map();
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, disabled: false, valid: true, dataset: {}, textContent: '',
      type: id.endsWith('Enabled') ? 'checkbox' : id.endsWith('TextMode') ? 'hidden' : 'number',
      handlers: new Map(),
      addEventListener(type, handler) { this.handlers.set(type, handler); },
      checkValidity() { return this.valid; },
      reportValidity: () => true,
    });
    return nodes.get(id);
  }
  function save(patch) {
    const pending = Promise.withResolvers();
    requests.push({ patch, resolve: pending.resolve, reject: pending.reject });
    return pending.promise;
  }
  const context = vm.createContext({
    console,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    document: { getElementById: node },
    window: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    },
  });
  const dependencies = {
    '../shared/utils.js': { toast: (message, options) => toasts.push({ message, options }), copyText: async text => copied.push(text),
      localOverlayOrigin: () => 'http://127.0.0.1:3000' },
    '../shared/gift-motion-settings.js': { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS, giftMotionSettingKeys },
    '../shared/gift-motion-samples.js': { createGiftMotionSamples() {} },
    '../shared/scene-extra-components.js': require('../../public/js/shared/scene-extra-components.js'),
    './gift-motion-parameters.js': { mountGiftMotionParameters(_host, effect, { onEdit }) {
      const inputs = new Map(Object.keys(effect.fields).map(name => {
        const key = `${effect.prefix}${name}`;
        const input = node(key);
        input.addEventListener('input', () => onEdit({ [key]: input.value }));
        input.addEventListener('change', () => {
          onEdit({ [key]: input.value });
          _host.handlers.get('change')();
        });
        return [key, input];
      }));
      return { inputs, sync() {}, dispose() {} };
    } },
    './component-settings-save.js': {
      saveComponentSettings: patch => save(patch),
      confirmComponentSettings() {
        const pending = Promise.withResolvers();
        confirmations.push(pending);
        return pending.promise;
      },
    },
    './component-preview-registry.js': { prepareComponentPreviews() {} },
    './component-preview-session.js': { getActiveComponentPreview() {} },
    './component-preview-dialog.js': { openComponentPreview() {} },
  };
  const file = path.resolve(__dirname, '../../public/js/admin/gift-motion-settings.js');
  const entry = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
  await entry.link(specifier => {
    if (specifier === './component-config-controller.js') {
      return new vm.SourceTextModule(fs.readFileSync(path.join(path.dirname(file), specifier), 'utf8'), { context });
    }
    const values = dependencies[specifier];
    if (!values) throw new Error(`Unexpected import ${specifier}`);
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await entry.evaluate();
  entry.namespace.initGiftMotionSettings();
  return {
    requests, confirmations, copied, toasts, node,
    edit(key, value) { node(key).value = value; node(key).handlers.get('input')(); },
    receive(settings) { listeners.get('app:settings-state')({ detail: { ...GIFT_MOTION_DEFAULTS, ...settings } }); },
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    change: key => node(key).handlers.get('change')(),
    settle: () => new Promise(resolve => setImmediate(resolve)),
  };
}

test('gift motion autosave reconciles canvas updates and drains subsequent edits', async () => {
  const f = await fixture();
  f.edit('giftDropSpeed', '120');
  f.flush();
  f.receive({ giftDropSpeed: '120' });
  f.receive({ giftDropSpeed: '160', giftDropSize: '130' });
  f.requests[0].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '120' });
  await new Promise(resolve => setImmediate(resolve));
  f.confirmations[0]?.resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '160', giftDropSize: '130' });
  await f.settle();
  assert.equal(f.node('giftDropSpeed').value, '160');
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'false');
  assert.equal(f.node('giftDropSize').value, '130');

  f.edit('giftDropSpeed', '180');
  f.flush();
  assert.equal(f.requests[1].patch.giftDropSpeed, '180');
  assert.equal(Object.hasOwn(f.requests[1].patch, 'giftDropSize'), false);
  f.edit('giftDropSpeed', '200');
  f.flush();
  f.requests[1].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '180', giftDropSize: '130' });
  await f.settle();
  assert.equal(f.node('giftDropSpeed').value, '200');
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'true');
  assert.equal(f.requests[2].patch.giftDropSpeed, '200');
  f.requests[2].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '200', giftDropSize: '130' });
  await f.settle();
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'false');
});

test('motion cards copy separate live sources without forcing a pending autosave', async () => {
  const f = await fixture();
  f.edit('giftDropSpeed', '120');
  await f.node('giftDropCopyBtn').handlers.get('click')();
  await f.node('giftSwingCopyBtn').handlers.get('click')();
  assert.deepEqual(f.copied, ['http://127.0.0.1:3000/gift-effects?giftStyle=gift-drop',
    'http://127.0.0.1:3000/gift-effects?giftStyle=gift-swing']);
  assert.equal(f.requests.length, 0);
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'true');
});

test('motion autosave waits for a valid threshold and batches continuous edits', async () => {
  const f = await fixture();
  f.node('giftDropThresholdRmb').valid = false;
  f.edit('giftDropThresholdRmb', '-1');
  f.edit('giftDropSpeed', '120');
  f.edit('giftDropSpeed', '140');
  f.flush();
  await f.settle();
  assert.equal(f.requests.length, 0);
  f.node('giftDropThresholdRmb').valid = true;
  f.edit('giftDropThresholdRmb', '1');
  f.flush();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].patch.giftDropThresholdRmb, '1');
  assert.equal(f.requests[0].patch.giftDropSpeed, '140');
  f.requests[0].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropThresholdRmb: '1', giftDropSpeed: '140' });
  await f.settle();
});

test('failed motion autosave retains the edit and retries on the next committed change', async () => {
  const f = await fixture();
  f.edit('giftDropSpeed', '120');
  f.flush();
  f.requests[0].reject(new Error('offline'));
  await f.settle();
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'true');
  assert.equal(f.toasts.at(-1).options.type, 'error');
  assert.equal(f.requests.length, 1);
  f.edit('giftDropSpeed', '160');
  f.change('giftDropSpeed');
  assert.equal(f.requests[1].patch.giftDropSpeed, '160');
  f.requests[1].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '160' });
  await f.settle();
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'false');
});
