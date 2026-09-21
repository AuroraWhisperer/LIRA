'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { createToolboxRuntime } = require('./helpers/toolbox-runtime');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');

test('toolbox navigation and feature capabilities work without the legacy registry', () => {
  const runtime = createToolboxRuntime();
  runtime.sandbox.window.AdminApp = {};
  const calls = [];
  let navigate;
  const querySelectorAll = runtime.root.querySelectorAll;
  runtime.root.querySelectorAll = (selector) => selector === '[data-main-page-link]'
    ? [{ dataset: { mainPageLink: 'songAssistantPage' },
      addEventListener: (_type, handler) => { navigate = handler; } }]
    : querySelectorAll(selector);
  const reconnectBilibili = () => {};
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
  assert.deepEqual(calls, ['ai:init', 'songAssistantPage', true, 'ai:refresh']);
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

  runtime.sandbox.window.AdminApp.other.selectFeature(
    runtime.root,
    'otherClockFeature',
  );

  assert.equal(runtime.headings[1].getAttribute('aria-expanded'), 'true');
  assert.deepEqual(persisted, [[]]);
});

test('toolbox groups hide and restore only their own features and deep links reopen them', () => {
  const runtime = createToolboxRuntime();
  runtime.sandbox.window.AdminApp.other.initOtherPage();
  const liveSceneHeading = runtime.headings[1];
  const liveSceneButtons = runtime.buttons.slice(3, 7);
  const clockButton = runtime.buttons[6];
  const clockPanel = runtime.panels[6];

  runtime.sandbox.window.AdminApp.other.setSidebarCollapsed(
    runtime.root,
    true,
    false,
  );
  assert.equal(
    runtime.headings.every((heading) => heading.disabled),
    true,
  );
  assert.equal(
    runtime.headings.every((heading) => heading.tabIndex === -1),
    true,
  );
  runtime.sandbox.window.AdminApp.other.setSidebarCollapsed(
    runtime.root,
    false,
    false,
  );
  assert.equal(
    runtime.headings.every((heading) => !heading.disabled),
    true,
  );

  liveSceneHeading.dispatch('click');
  assert.equal(liveSceneHeading.getAttribute('aria-expanded'), 'false');
  assert.equal(
    liveSceneButtons.every((button) => button.hidden),
    true,
  );
  assert.equal(runtime.buttons[0].hidden, false);

  liveSceneHeading.dispatch('click');
  assert.equal(liveSceneHeading.getAttribute('aria-expanded'), 'true');
  assert.equal(
    liveSceneButtons.every((button) => !button.hidden),
    true,
  );
  assert.equal(clockButton.hidden, false);

  runtime.sandbox.window.AdminApp.other.selectFeature(
    runtime.root,
    'otherClockFeature',
  );
  liveSceneHeading.dispatch('click');
  assert.equal(clockButton.hidden, true);
  assert.equal(
    clockPanel.hidden,
    false,
    'collapsing a group should keep its current panel visible',
  );

  runtime.sandbox.window.AdminApp.other.selectFeature(
    runtime.root,
    'otherClockFeature',
  );
  assert.equal(liveSceneHeading.getAttribute('aria-expanded'), 'true');
  assert.equal(clockButton.hidden, false);
  assert.equal(clockButton.getAttribute('aria-selected'), 'true');
});

test('toolbox feature arrow navigation loops through visible features only', () => {
  const runtime = createToolboxRuntime();
  runtime.sandbox.window.AdminApp.other.initOtherPage();
  runtime.headings[1].dispatch('click');
  const gamesButton = runtime.buttons[2];
  gamesButton.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });

  assert.equal(runtime.buttons[7].getAttribute('aria-selected'), 'true');
  assert.equal(runtime.buttons[3].hidden, true);
});

test('danmaku toolbox feature mounts its dedicated panel', () => {
  const html = readAdminHtml();
  assert.match(
    html,
    /aria-controls="otherDanmakuFeature"\s+data-other-feature="otherDanmakuFeature"/,
  );
  assert.match(html, /id="otherDanmakuFeature"[^>]*data-other-feature-panel/);
});

test('toolbox sidebar toggle updates accessibility state and stores the preference', () => {
  const source = readJsModuleBundle('public', 'js', 'admin', 'other.js');
  const classes = new Set();
  const attributes = new Map();
  const stored = new Map();
  const toggle = {
    title: '',
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
  const root = {
    classList: {
      contains(name) {
        return classes.has(name);
      },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    querySelector: () => toggle,
    querySelectorAll: () => [],
  };
  const sandbox = {
    console,
    document: { getElementById: () => root },
    window: {
      AdminApp: {},
      localStorage: {
        getItem(key) {
          return stored.get(key) || null;
        },
        setItem(key, value) {
          stored.set(key, value);
        },
      },
    },
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.other.setSidebarCollapsed(root, true);

  assert.equal(classes.has('sidebar-collapsed'), true);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(toggle.title, '展开功能导航');
  assert.equal(stored.get('admin.toolboxSidebarCollapsed'), 'true');
});

test('desktop shell reveals the desktop update toolbox feature', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'desktop.js'),
    'utf8',
  );
  const desktopOnlyNodes = [{ hidden: true }, { hidden: true }];
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll(selector) {
        return selector === '.desktop-only' ? desktopOnlyNodes : [];
      },
    },
    window: {
      AdminApp: {
        utils: {
          toast() {},
          showStackedToast() {},
          showError() {},
          api: async () => ({}),
        },
      },
      songAssistantDesktop: {
        onShowUpdatePage() {},
        onUpdateState() {},
        getInfo: () => new Promise(() => {}),
      },
    },
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktop.initDesktopShell();

  assert.equal(
    desktopOnlyNodes.every((node) => node.hidden === false),
    true,
  );
});

test('desktop update feature keeps its tab and panel mapping', () => {
  const html = readAdminHtml();
  assert.match(
    html,
    /id="otherDesktopUpdateFeatureTab"[\s\S]*data-other-feature="otherDesktopUpdateFeature"/,
  );
  assert.match(
    html,
    /id="otherDesktopUpdateFeature"[\s\S]*data-other-feature-panel/,
  );
  assert.match(html, /aria-labelledby="otherDesktopUpdateFeatureTab"/);
});

test('toolbox tabs rely on sidebar titles instead of repeating page headers', () => {
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const featureFiles = [
    'danmaku.html',
    'gift.html',
    'games.html',
    'overtime.html',
    'gift-effects.html',
    'start-animation.html',
    'clock.html',
    'planner.html',
    'performance.html',
    'desktop-update.html',
  ];

  for (const file of featureFiles) {
    const featureHtml = fs.readFileSync(
      path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', file),
      'utf8',
    );
    assert.doesNotMatch(
      featureHtml,
      /ui-page-(?:title|subtitle)|other-feature-page-header/,
    );
  }

  const usageGuideHtml = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'pages',
      'admin',
      'toolbox',
      'usage-guide.html',
    ),
    'utf8',
  );
  assert.match(
    usageGuideHtml,
    /<h2 id="usageGuideTitle" class="usage-guide-title">使用文档<\/h2>/,
  );
  assert.doesNotMatch(usageGuideHtml, /class="usage-guide-lead"/);
  assert.match(usageGuideHtml, /class="usage-guide-hero-actions"/);
  assert.doesNotMatch(usageGuideHtml, /other-feature-page-header/);
  assert.doesNotMatch(styles, /\.other-feature-page-header\b/);
  assert.match(
    styles,
    /\.planner-event-dialog label:not\(\.planner-all-day\),[\s\S]*?font-size:\s*var\(--type-size-control\)/,
  );
});
