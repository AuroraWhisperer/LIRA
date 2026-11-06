'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');
const { createDom } = require('../helpers/toast-dom');

const ROOT_DIR = path.join(__dirname, '../..');

function clientSettingsFixture() {
  const { documentRef } = createDom();
  const root = documentRef.createElement('section');
  const content = documentRef.createElement('div');
  const ids = ['settingsAppearanceTab', 'settingsAccountTab', 'settingsAboutTab'];
  const nodes = new Map([['otherSettingsFeature', root]]);
  const tabs = ids.map((id) => {
    const tab = documentRef.createElement('button');
    tab.setAttribute('aria-controls', `${id}-panel`);
    nodes.set(id, tab);
    nodes.set(`${id}-panel`, documentRef.createElement('section'));
    return tab;
  });
  root.querySelectorAll = () => tabs;
  root.querySelector = () => content;
  documentRef.getElementById = (id) => nodes.get(id);
  return { documentRef, nodes, tabs };
}

test('client settings restores the old update destination and supports keyboard section changes', async () => {
  const { documentRef, nodes, tabs } = clientSettingsFixture();
  let stored = 'otherDesktopUpdateFeature';
  const { initClientSettings } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/client-settings.js'));
  initClientSettings({ documentRef, storage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } } });
  assert.equal(stored, 'otherSettingsFeature');
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  tabs[1].fire('click');
  assert.equal(nodes.get('settingsAccountTab-panel').hidden, false);
  assert.equal(nodes.get('settingsAboutTab-panel').hidden, true);
  tabs[1].fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  assert.equal(documentRef.activeElement, tabs[2]);
  tabs[2].fire('keydown', { key: 'Home', preventDefault() {} });
  assert.equal(documentRef.activeElement, tabs[0]);
  assert.equal(nodes.get('settingsAppearanceTab-panel').hidden, false);
  assert.equal(nodes.get('settingsAboutTab-panel').hidden, true);
});

test('client settings restores the destination even when its preference cannot be persisted', async () => {
  const { documentRef, nodes, tabs } = clientSettingsFixture();
  const failure = new Error('Storage is unavailable');
  const warnings = [];
  const { initClientSettings } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/client-settings.js'), {
    console: { warn: (_message, error) => warnings.push(error) },
  });
  initClientSettings({ documentRef, storage: {
    getItem: () => 'otherDesktopUpdateFeature',
    setItem() { throw failure; },
  } });
  assert.equal(tabs[2].getAttribute('aria-selected'), 'true');
  tabs[1].fire('click');
  assert.equal(nodes.get('settingsAccountTab-panel').hidden, false);
  assert.equal(warnings[0], failure);
});

test('metrics distinguish unavailable samples from real zero load', async () => {
  const elements = new Map();
  const card = {};
  const { metrics } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/metrics.js'), {
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { style: {}, closest: () => card });
      return elements.get(id);
    } }, window: {},
  });
  metrics.setMetric('gpuUsage', null, 'GPU 负载不可用');
  const unavailable = elements.get('gpuUsage').textContent;
  metrics.setMetric('gpuUsage', 0, 'GPU 空闲');
  assert.equal(elements.get('gpuUsage').textContent, '0.0%');
  assert.notEqual(unavailable, '0.0%');
});

test('desktop update invokes the supplied navigation action', async () => {
  let showUpdatePage;
  let opened = 0;
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    window: {
      songAssistantDesktop: {
        onShowUpdatePage(callback) {
          showUpdatePage = callback;
        },
        onUpdateState() {},
        getInfo: () => new Promise(() => {}),
      },
    },
  };

  const { createDesktopShell } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/desktop.js'), sandbox);
  createDesktopShell({
    showError() {},
    openUpdatePage: () => { opened++; },
  }).initDesktopShell();
  showUpdatePage();

  assert.equal(opened, 1);
});
