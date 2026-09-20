'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { createToolboxRuntime } = require('./helpers/toolbox-runtime');

const ROOT_DIR = path.resolve(__dirname, '..');

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

test('danmaku detail panel fills the workspace and keeps actions grouped', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(
    html,
    /class="danmaku-feature-section danmaku-connection-section"[\s\S]*?id="danmakuAccountState"[\s\S]*?id="danmakuRoomState"[\s\S]*?id="danmakuToolStatus"/,
  );
  assert.match(
    html,
    /class="danmaku-feature-section danmaku-compose-section"[\s\S]*?id="danmakuSendForm"[\s\S]*?id="danmakuSendResult"/,
  );
  assert.match(
    html,
    /id="danmakuCounter"[\s\S]*?id="danmakuAutoBtn"[\s\S]*?id="danmakuSendBtn"/,
  );
  assert.match(
    html,
    /data-danmaku-style="ranked"[^>]*>\s*<img[^>]*>\s*<span class="danmaku-style-name">经典样式<\/span>/,
  );
  assert.match(
    html,
    /data-danmaku-style="transparent"[^>]*>\s*<img[^>]*>\s*<span class="danmaku-style-name">透明文字<\/span>/,
  );
  assert.match(
    html,
    /data-danmaku-style="outline"[^>]*>\s*<img[^>]*>\s*<span class="danmaku-style-name">简洁白卡<\/span>/,
  );
  assert.match(html, /danmaku-style-group-fixed/);
  assert.match(html, /danmaku-style-group-random/);
  assert.doesNotMatch(html, /danmaku-style-option-visual/);
  assert.match(html, /id="danmakuFullscreenDurationSeconds"/);
  assert.match(
    html,
    /id="danmakuStyleTitle"[\s\S]*?class="danmaku-overlay-link"[\s\S]*?class="danmaku-style-options\b/,
  );
  assert.match(
    styles,
    /\.danmaku-style-picker\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 3fr\) minmax\(220px, 1fr\);/s,
  );
  assert.match(
    styles,
    /\.danmaku-style-option\s*\{[^}]*min-height:\s*36px;[^}]*border-radius:\s*6px;/s,
  );
  assert.doesNotMatch(styles, /\.danmaku-style-preview/);
  assert.match(
    styles,
    /\.danmaku-tool-panel\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/,
  );
  assert.match(
    styles,
    /\.danmaku-feature-section\s*\{[^}]*border:\s*2px solid var\(--danmaku-section-border\)/,
  );
  assert.match(
    styles,
    /\.danmaku-bot-switch-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /#danmakuSendForm \.form-actions-row > \.hint\s*\{[^}]*margin-right:\s*auto/,
  );
  assert.match(
    styles,
    /@media \(max-width: 600px\)[\s\S]*?\.danmaku-bot-switch-grid\s*\{\s*grid-template-columns:\s*1fr;/,
  );
});

test('toolbox sidebar toggle updates accessibility state and stores the preference', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
    'utf8',
  );
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
