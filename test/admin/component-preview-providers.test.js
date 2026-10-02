'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

const adminPath = path.join(__dirname, '../../public/js/admin');

function createNode() {
  const fields = new Map();
  const handlers = new Map();
  return {
    children: [], dataset: {}, value: '',
    append(...children) { this.children.push(...children); },
    addEventListener(name, handler) { handlers.set(name, handler); },
    fire(name) { handlers.get(name)?.(); },
    querySelectorAll() { return []; },
    querySelector() { return createNode(); },
    cloneNode() { return createNode(); },
    hasAttribute() { return false; },
    setAttribute() {},
    getElementById(id) {
      if (!fields.has(id)) fields.set(id, createNode());
      return fields.get(id);
    },
  };
}

async function createFixture(initial = { revision: 1, status: 'paused', effectiveRemainingMs: 30000 }) {
  const document = createNode();
  document.createElement = createNode;
  const { createOvertimePreview } = await loadModuleExports(path.join(adminPath, 'overtime-preview-factory.js'), {
    document, URL, location: new URL('http://127.0.0.1:3000/component-preview'),
  });
  const data = { starts: 0, stops: 0, receive: null };
  const controller = {
    subscribe(listener) { listener({ draft: { path: '', fit: 'cover' } }); return () => {}; },
    edit() { throw new Error('Preview data must not edit configuration'); },
  };
  const preview = createOvertimePreview({ controller, embedded: true, startActualData(emit) {
    data.starts++;
    data.receive = emit;
    emit(initial);
    return () => { data.stops++; data.receive = null; };
  } });
  const host = createNode();
  const panel = preview.createPanel(host);
  const select = host.children[0].children[0];
  return { preview, data, panel, mode(value) { select.value = value; select.fire('change'); } };
}

test('overtime layers share one provider until the last layer leaves and tolerate repeated disposal', async () => {
  const { preview, data, panel } = await createFixture();
  const first = [];
  const second = [];
  const emitFirst = (value) => first.push(value);
  const stopFirst = preview.startLayerData({ emit: emitFirst });
  const stopSecond = preview.startLayerData({ emit: (value) => second.push(value) });
  assert.equal(data.starts, 1);
  assert.equal(first[0], second[0]);
  data.receive({ revision: 2, status: 'running' });
  assert.equal(first.at(-1), second.at(-1));
  stopFirst();
  assert.equal(data.stops, 0);
  data.receive({ revision: 3, status: 'finished' });
  assert.equal(first.at(-1).revision, 2);
  assert.equal(second.at(-1).revision, 3);
  stopSecond();
  stopSecond();
  assert.equal(data.stops, 1);
  const stopRemount = preview.startLayerData({ emit: emitFirst });
  assert.equal(data.starts, 2);
  stopFirst();
  assert.equal(data.stops, 1);
  data.receive({ revision: 4, status: 'paused' });
  assert.equal(first.at(-1).revision, 4);
  stopRemount();
  assert.equal(data.stops, 2);
  panel.dispose();
});

test('overtime mode changes start data only for active layers and switch their shared provider once', async () => {
  const { preview, data, panel, mode } = await createFixture();
  mode('paused');
  mode('actual');
  assert.equal(data.starts, 0);
  const first = [];
  const second = [];
  const stopFirst = preview.startLayerData({ emit: (value) => first.push(value) });
  const stopSecond = preview.startLayerData({ emit: (value) => second.push(value) });
  mode('paused');
  assert.equal(data.starts, 1);
  assert.equal(data.stops, 1);
  assert.equal(first.at(-1).effectiveRemainingMs, 120000);
  assert.equal(first.at(-1), second.at(-1));
  mode('actual');
  assert.equal(data.starts, 2);
  assert.equal(data.stops, 1);
  assert.equal(first.at(-1).effectiveRemainingMs, 30000);
  stopFirst();
  stopSecond();
  assert.equal(data.stops, 2);
  mode('paused');
  mode('actual');
  assert.equal(data.starts, 2);
  assert.equal(data.stops, 2);
  panel.dispose();
});

test('offline recovery injects null display data for every layer without inventing actual state', async () => {
  const { preview, data, panel } = await createFixture(null);
  const values = [];
  const first = preview.startLayerData({ emit: (value) => values.push(value) });
  const second = preview.startLayerData({ emit: (value) => values.push(value) });
  assert.deepEqual(values, [null, null]);
  assert.equal(data.starts, 1);
  first();
  second();
  assert.equal(data.stops, 1);
  panel.dispose();
});

test('preview factories, browser definitions and stage have no transitive desktop owner or state dependency', async () => {
  const blocked = new Set(['clock-card.js', 'danmaku-canvas-dialog.js', 'overtime-preview.js',
    'component-preview-dialog.js', 'component-preview-registry.js', 'scene-editor-preview-data.js', 'state.js', 'event-bus.js']);
  const context = vm.createContext({});
  const modules = new Map();
  function load(file) {
    assert.equal(blocked.has(path.basename(file)), false, `Preview module imported ${file}`);
    if (!modules.has(file)) {
      modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file }));
    }
    return modules.get(file);
  }
  for (const name of ['clock-preview.js', 'danmaku-preview.js', 'overtime-preview-factory.js', 'queue-preview.js',
    'component-preview-definitions.js', 'scene-editor-stage.js', 'scene-item-controller.js']) {
    const module = load(path.join(adminPath, name));
    if (module.status === 'unlinked') {
      await module.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
    }
    if (module.status === 'linked') await module.evaluate();
  }
});
