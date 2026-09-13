'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const { createToolboxRuntime } = require('./helpers/toolbox-runtime');

const ROOT_DIR = path.resolve(__dirname, '..');

test('toolbox navigation has uninitialized durable preferences by default', () => {
  assert.equal(DEFAULT_SETTINGS.toolboxSidebarCollapsed, '');
  assert.equal(DEFAULT_SETTINGS.toolboxCollapsedFeatureGroups, '');
});

test('toolbox sidebar restores the durable preference when the legacy cache is absent', () => {
  for (const [setting, expected] of [
    ['true', true],
    ['false', false],
  ]) {
    const persisted = [];
    const runtime = createToolboxRuntime();
    runtime.sandbox.window.AdminApp.other.initOtherPage({
      persistSidebarCollapsed: (collapsed) => persisted.push(collapsed),
    });

    runtime.dispatchWindowEvent('app:settings-state', {
      toolboxSidebarCollapsed: setting,
    });

    assert.equal(
      runtime.root.classList.contains('sidebar-collapsed'),
      expected,
    );
    assert.equal(runtime.stored.get('admin.toolboxSidebarCollapsed'), setting);
    assert.deepEqual(persisted, []);
  }
});

test('toolbox sidebar migrates the legacy preference and saves explicit toggles', () => {
  const persisted = [];
  const runtime = createToolboxRuntime({
    initialStorage: { 'admin.toolboxSidebarCollapsed': 'true' },
  });
  runtime.sandbox.window.AdminApp.other.initOtherPage({
    persistSidebarCollapsed: (collapsed) => persisted.push(collapsed),
  });

  assert.equal(runtime.root.classList.contains('sidebar-collapsed'), true);
  runtime.dispatchWindowEvent('app:settings-state', {
    toolboxSidebarCollapsed: '',
  });
  assert.deepEqual(persisted, [true]);

  runtime.sidebarToggle.dispatch('click');
  assert.equal(runtime.root.classList.contains('sidebar-collapsed'), false);
  assert.equal(runtime.stored.get('admin.toolboxSidebarCollapsed'), 'false');
  assert.deepEqual(persisted, [true, false]);
});

test('admin app persists toolbox sidebar changes through the settings API', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );

  assert.match(
    source,
    /initOtherPage\?\.\(\{[\s\S]*?persistSidebarCollapsed:[\s\S]*?Utils\.api\('\/api\/settings',\s*\{\s*toolboxSidebarCollapsed:/,
  );
  assert.match(
    source,
    /persistCollapsedFeatureGroups:[\s\S]*?Utils\.api\('\/api\/settings',\s*\{\s*toolboxCollapsedFeatureGroups:/,
  );
});

test('toolbox feature groups restore after a full application restart', () => {
  let durableGroups = '';
  const firstRuntime = createToolboxRuntime();
  firstRuntime.sandbox.window.AdminApp.other.initOtherPage({
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
  secondRuntime.sandbox.window.AdminApp.other.initOtherPage();
  secondRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: durableGroups,
  });

  assert.equal(
    secondRuntime.headings[0].getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(
    secondRuntime.headings[1].getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(
    secondRuntime.buttons.slice(0, 7).every((button) => button.hidden),
    true,
  );
  assert.equal(
    secondRuntime.stored.get('admin.toolboxCollapsedFeatureGroups'),
    '["live-interaction","live-scene"]',
  );
});

test('toolbox feature groups migrate cached state and ignore malformed or stale IDs', () => {
  const migrated = [];
  const cachedRuntime = createToolboxRuntime({
    initialStorage: {
      'admin.toolboxCollapsedFeatureGroups': '["live-interaction"]',
      'admin.toolboxSelectedFeature': 'otherDanmakuFeature',
    },
  });
  cachedRuntime.sandbox.window.AdminApp.other.initOtherPage({
    persistCollapsedFeatureGroups: (groupIds) => migrated.push([...groupIds]),
  });
  cachedRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '',
  });

  assert.equal(
    cachedRuntime.headings[0].getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(
    cachedRuntime.buttons.slice(0, 3).every((button) => button.hidden),
    true,
  );
  assert.equal(cachedRuntime.buttons[8].getAttribute('aria-selected'), 'true');
  assert.deepEqual(migrated, [['live-interaction']]);

  const durableRuntime = createToolboxRuntime({
    initialStorage: { 'admin.toolboxCollapsedFeatureGroups': '{invalid' },
  });
  durableRuntime.sandbox.window.AdminApp.other.initOtherPage();
  durableRuntime.dispatchWindowEvent('app:settings-state', {
    toolboxCollapsedFeatureGroups: '["live-scene","removed-group"]',
  });

  assert.equal(
    durableRuntime.headings[0].getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(
    durableRuntime.headings[1].getAttribute('aria-expanded'),
    'false',
  );
  assert.equal(
    durableRuntime.stored.get('admin.toolboxCollapsedFeatureGroups'),
    '["live-scene"]',
  );
});
