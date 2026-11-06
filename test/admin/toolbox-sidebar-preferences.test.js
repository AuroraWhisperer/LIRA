'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createToolboxRuntime } = require('../helpers/toolbox-runtime');

test('toolbox sidebar restores the durable preference when the legacy cache is absent', () => {
  const persisted = [];
  const runtime = createToolboxRuntime();
  runtime.other.initOtherPage({
    persistSidebarCollapsed: (collapsed) => persisted.push(collapsed),
  });

  runtime.dispatchWindowEvent('app:settings-state', {
    toolboxSidebarCollapsed: 'true',
  });

  assert.equal(runtime.root.classList.contains('sidebar-collapsed'), true);
  assert.equal(runtime.stored.get('admin.toolboxSidebarCollapsed'), 'true');
  assert.deepEqual(persisted, []);
});

test('toolbox sidebar migrates the legacy preference and saves explicit toggles', () => {
  const persisted = [];
  const runtime = createToolboxRuntime({
    initialStorage: { 'admin.toolboxSidebarCollapsed': 'true' },
  });
  runtime.other.initOtherPage({
    persistSidebarCollapsed: (collapsed) => persisted.push(collapsed),
  });

  assert.equal(runtime.root.classList.contains('sidebar-collapsed'), true);
  runtime.dispatchWindowEvent('app:settings-state', {
    toolboxSidebarCollapsed: '',
  });
  assert.deepEqual(persisted, [true]);

  runtime.sidebarToggle.dispatch('click');
  assert.equal(runtime.stored.get('admin.toolboxSidebarCollapsed'), 'false');
  assert.deepEqual(persisted, [true, false]);
});

test('toolbox feature groups restore after a full application restart', () => {
  let durableGroups = '';
  const firstRuntime = createToolboxRuntime();
  firstRuntime.other.initOtherPage({
    persistCollapsedFeatureGroups: (groupIds) => {
      durableGroups = JSON.stringify(groupIds);
    },
  });
  firstRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '',
  });

  firstRuntime.headings[0].dispatch('click');
  firstRuntime.headings[1].dispatch('click');
  assert.equal(durableGroups, '["live-interaction","live-scene"]');

  const secondRuntime = createToolboxRuntime();
  secondRuntime.other.initOtherPage();
  secondRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: durableGroups,
  });

  assert.equal(secondRuntime.headings[0].getAttribute('aria-expanded'), 'false');
  assert.equal(secondRuntime.stored.get('admin.toolboxCollapsedFeatureGroups'), '["live-interaction","live-scene"]');
});

test('toolbox feature groups migrate cached state and ignore malformed or stale IDs', () => {
  const migrated = [];
  const cachedRuntime = createToolboxRuntime({
    initialStorage: {
      'admin.toolboxCollapsedFeatureGroups': '["live-interaction"]',
      'admin.toolboxSelectedFeature': 'otherDanmakuFeature',
    },
  });
  cachedRuntime.other.initOtherPage({
    persistCollapsedFeatureGroups: (groupIds) => migrated.push([...groupIds]),
  });
  cachedRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '',
  });

  assert.equal(cachedRuntime.headings[0].getAttribute('aria-expanded'), 'false');
  assert.equal(cachedRuntime.buttons[8].getAttribute('aria-selected'), 'true');
  assert.deepEqual(migrated, [['live-interaction']]);

  const durableRuntime = createToolboxRuntime({
    initialStorage: { 'admin.toolboxCollapsedFeatureGroups': '{invalid' },
  });
  durableRuntime.other.initOtherPage();
  durableRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '["live-scene","removed-group"]',
  });

  assert.equal(durableRuntime.headings[0].getAttribute('aria-expanded'), 'true');
  assert.equal(durableRuntime.headings[1].getAttribute('aria-expanded'), 'false');
  assert.equal(durableRuntime.stored.get('admin.toolboxCollapsedFeatureGroups'), '["live-scene"]');
});
