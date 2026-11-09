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
  const listeners = new Map();
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, disabled: false, dataset: {}, textContent: '',
      type: id.endsWith('Enabled') ? 'checkbox' : id.endsWith('TextMode') ? 'hidden' : 'number',
      handlers: new Map(),
      addEventListener(type, handler) { this.handlers.set(type, handler); },
      reportValidity: () => true,
    });
    return nodes.get(id);
  }
  function save(patch) {
    const pending = Promise.withResolvers();
    requests.push({ patch, resolve: pending.resolve });
    return pending.promise;
  }
  const context = vm.createContext({
    console,
    document: { getElementById: node },
    window: {
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
    },
  });
  const dependencies = {
    '../shared/utils.js': { toast() {} },
    '../shared/gift-motion-settings.js': { GIFT_MOTION_EFFECTS, GIFT_MOTION_DEFAULTS, giftMotionSettingKeys },
    '../shared/gift-motion-samples.js': { createGiftMotionSamples() {} },
    '../shared/scene-extra-components.js': require('../../public/js/shared/scene-extra-components.js'),
    './gift-motion-parameters.js': { mountGiftMotionParameters(_host, effect, { onEdit }) {
      const inputs = new Map(Object.keys(effect.fields).map(name => {
        const key = `${effect.prefix}${name}`;
        const input = node(key);
        input.addEventListener('input', () => onEdit({ [key]: input.value }));
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
    requests, confirmations, node,
    edit(key, value) { node(key).value = value; node(key).handlers.get('input')(); },
    receive(settings) { listeners.get('app:settings-state')({ detail: { ...GIFT_MOTION_DEFAULTS, ...settings } }); },
    save: () => node('giftDropSaveBtn').handlers.get('click')(),
  };
}

test('gift motion card reconciles a late save with canvas updates and preserves subsequent edits', async () => {
  const f = await fixture();
  f.edit('giftDropSpeed', '120');
  const saving = f.save();
  f.receive({ giftDropSpeed: '120' });
  f.receive({ giftDropSpeed: '160', giftDropSize: '130' });
  f.requests[0].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '120' });
  await new Promise(resolve => setImmediate(resolve));
  f.confirmations[0]?.resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '160', giftDropSize: '130' });
  await saving;
  assert.equal(f.node('giftDropSpeed').value, '160');
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'false');
  assert.equal(f.node('giftDropSize').value, '130');

  f.edit('giftDropSpeed', '180');
  const retry = f.save();
  assert.equal(f.requests[1].patch.giftDropSpeed, '180');
  assert.equal(Object.hasOwn(f.requests[1].patch, 'giftDropSize'), false);
  f.edit('giftDropSpeed', '200');
  f.requests[1].resolve({ ...GIFT_MOTION_DEFAULTS, giftDropSpeed: '180', giftDropSize: '130' });
  await retry;
  assert.equal(f.node('giftDropSpeed').value, '200');
  assert.equal(f.node('giftDropSpeed').dataset.dirty, 'true');
});
