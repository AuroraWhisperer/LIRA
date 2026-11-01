'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolboxRuntime } = require('../helpers/toolbox-runtime');

test('toolbox navigation and feature capabilities work without the legacy registry', () => {
  const runtime = createToolboxRuntime();
  runtime.sandbox.window.AdminApp = {};
  const calls = [];
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
    return { click: () => calls.push('settingsPage') };
  };
  runtime.other.initOtherPage({
    reconnectBilibili,
    onNavigate: (page) => calls.push(page),
    danmakuTool: {
      init: (options) => assert.equal(options.reconnectBilibili, reconnectBilibili),
      refresh: (options) => calls.push(options.reconnectIfDisconnected),
    },
    aiAssistantSettings: {
      init: () => calls.push('ai:init'),
      refresh: () => calls.push('ai:refresh'),
    },
  });
  navigate();
  runtime.other.selectFeatureById('otherDanmakuFeature');
  assert.deepEqual(calls, ['ai:init', 'songAssistantPage', 'settingsPage', true, 'ai:refresh']);
});

test('explicit toolbox feature selection reopens and persists its collapsed group', () => {
  const persisted = [];
  const runtime = createToolboxRuntime({
    initialStorage: { 'admin.toolboxCollapsedFeatureGroups': '["live-scene"]' },
  });
  runtime.sandbox.window.AdminApp.other.initOtherPage({
    persistCollapsedFeatureGroups: (groupIds) => persisted.push([...groupIds]),
  });
  runtime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '["live-scene"]',
  });

  runtime.sandbox.window.AdminApp.other.selectFeature(runtime.root, 'otherClockFeature');

  assert.deepEqual(persisted, [[]]);
});
