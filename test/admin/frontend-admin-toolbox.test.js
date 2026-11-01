'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

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

test('desktop update opens its toolbox feature through module APIs', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'desktop.js'), 'utf8');
  let showUpdatePage;
  let selectedPage = '';
  let selectedFeature = '';
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll: () => [],
    },
    window: {
      AdminApp: {
        utils: {
          toast() {},
          showStackedToast() {},
          showError() {},
          api: async () => ({}),
        },
        navigation: {
          setMainPage(pageId) {
            selectedPage = pageId;
          },
        },
        other: {
          selectFeatureById(featureId) {
            selectedFeature = featureId;
          },
        },
      },
      songAssistantDesktop: {
        onShowUpdatePage(callback) {
          showUpdatePage = callback;
        },
        onUpdateState() {},
        getInfo: () => new Promise(() => {}),
      },
    },
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktop.initDesktopShell();
  showUpdatePage();

  assert.equal(selectedPage, 'otherAssistantPage');
  assert.equal(selectedFeature, 'otherDesktopUpdateFeature');
});
