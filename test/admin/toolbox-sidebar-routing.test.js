'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolboxRuntime } = require('../helpers/toolbox-runtime');

test('toolbox navigation and feature capabilities work without the legacy registry', async () => {
  const runtime = await createToolboxRuntime();
  runtime.sandbox.window.AdminApp = {};
  const navigation = [];
  const reconnects = [];
  let aiInits = 0;
  let aiRefreshes = 0;
  let navigate;
  const querySelectorAll = runtime.root.querySelectorAll;
  runtime.root.querySelectorAll = (selector) =>
    selector === '[data-main-page-link]'
      ? [
          {
            dataset: { mainPageLink: 'songAssistantPage', songTabTarget: 'settingsPage' },
            addEventListener: (_type, handler) => {
              navigate = handler;
            },
          },
        ]
      : querySelectorAll(selector);
  const reconnectBilibili = () => {};
  runtime.sandbox.document.querySelector = (selector) => {
    assert.equal(selector, '[data-tab="settingsPage"]');
    return { click: () => navigation.push('settingsPage') };
  };
  runtime.other.initOtherPage({
    reconnectBilibili,
    onNavigate: (page) => navigation.push(page),
    danmakuTool: {
      init: (options) => assert.equal(options.reconnectBilibili, reconnectBilibili),
      refresh: (options) => reconnects.push(options.reconnectIfDisconnected),
    },
    aiAssistantSettings: {
      init: () => aiInits++,
      refresh: () => aiRefreshes++,
    },
  });
  navigate();
  runtime.other.selectFeatureById('otherDanmakuFeature');
  assert.deepEqual(navigation, ['songAssistantPage', 'settingsPage']);
  assert.deepEqual(reconnects, [true]);
  assert.equal(aiInits, 1);
  assert.equal(aiRefreshes, 1);
});

test('explicit toolbox feature selection reopens and persists its collapsed group', async () => {
  const persisted = [];
  const runtime = await createToolboxRuntime({
    initialStorage: { 'admin.toolboxCollapsedFeatureGroups': '["live-scene"]' },
  });
  runtime.other.initOtherPage({
    persistCollapsedFeatureGroups: (groupIds) => persisted.push([...groupIds]),
  });
  runtime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '["live-scene"]',
  });

  runtime.other.selectFeature(runtime.root, 'otherClockFeature');

  assert.deepEqual(persisted, [[]]);
});
