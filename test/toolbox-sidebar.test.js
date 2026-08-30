'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');

const ROOT_DIR = path.resolve(__dirname, '..');

test('toolbox styles load feature-owned stylesheets in order', () => {
  const entry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8',
  );

  assert.match(
    entry,
    /@import url\('\.\/other-features\/streamer-planner\.css'\);/,
  );
});

test('toolbox defers offscreen rendering in its heaviest panels', () => {
  const usageGuideStyles = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'css',
      'admin',
      'other-features',
      'usage-guide.css',
    ),
    'utf8',
  );
  const overtimeStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'),
    'utf8',
  );
  const usageGuideScript = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'usage-guide.js'),
    'utf8',
  );

  assert.match(
    usageGuideStyles,
    /\.usage-guide-section\s*\{[^}]*content-visibility:\s*auto/,
  );
  assert.match(
    usageGuideStyles,
    /\.usage-guide-section\s*\{[^}]*contain-intrinsic-size:\s*auto 720px/,
  );
  assert.match(
    usageGuideStyles,
    /\.usage-guide-render-all \.usage-guide-section\s*\{[^}]*content-visibility:\s*visible/,
  );
  assert.match(
    usageGuideScript,
    /panel\.classList\.add\('usage-guide-render-all'\)/,
  );
  assert.match(
    overtimeStyles,
    /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*content-visibility:\s*auto/,
  );
  assert.match(
    overtimeStyles,
    /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*contain-intrinsic-size:\s*auto 260px/,
  );
});

test('toolbox sidebar switches between labeled and icon-only layouts', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(html, /data-other-sidebar-toggle/);
  assert.match(
    html,
    /class="other-sidebar-toggle-state other-sidebar-toggle-collapse"/,
  );
  assert.match(
    html,
    /class="other-sidebar-toggle-state other-sidebar-toggle-expand"/,
  );
  assert.match(
    html,
    /data-other-feature="otherDanmakuFeature"[^>]*>[\s\S]*?弹幕姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/,
  );
  assert.match(
    html,
    /data-other-feature="otherGiftFeature"[^>]*>[\s\S]*?礼物姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/,
  );
  assert.match(
    html,
    /data-other-feature="otherOvertimeMachineFeature"[^>]*>[\s\S]*?<strong>加班机<\/strong>\s*<small>用礼物延长直播倒计时<\/small>/,
  );
  assert.match(html, /aria-expanded="true"/);
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-workspace\s*\{[^}]*grid-template-columns:\s*76px/,
  );
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label/);
  assert.match(
    styles,
    /\.other-sidebar-toolbar\s*\{[^}]*justify-content:\s*flex-start[^}]*padding:\s*10px 10px 2px/,
  );
  assert.match(
    styles,
    /\.other-sidebar-toggle\s*\{[^}]*flex:\s*0 0 42px[^}]*width:\s*42px[^}]*height:\s*34px[^}]*border-radius:\s*9px/,
  );
  assert.doesNotMatch(
    styles,
    /\.other-page\.sidebar-collapsed \.other-sidebar-toggle\s*\{/,
  );
  assert.match(
    styles,
    /\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*opacity\s+140ms\s+ease,\s*transform\s+220ms\s+cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-sidebar-toggle-collapse\s*\{[^}]*opacity:\s*0[^}]*translateX\(-3px\) scale\(0\.94\)/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-sidebar-toggle-expand\s*\{[^}]*opacity:\s*1[^}]*translateX\(0\) scale\(1\)/,
  );
  assert.match(
    styles,
    /\.other-feature-button\s*\{[^}]*height:\s*56px[^}]*min-height:\s*56px[^}]*padding:\s*8px 10px/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-button\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) 16px[^}]*justify-content:\s*initial[^}]*min-height:\s*56px/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*visibility 0s linear 260ms/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-arrow\s*\{[^}]*visibility 0s linear 180ms/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.other-sidebar-toolbar\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*display:\s*grid/,
  );
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*none/,
  );
});

test('toolbox sidebar groups features by live and local workflows', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const navigation = html.match(
    /<nav\b[^>]*class=["']other-feature-menu["'][^>]*>([\s\S]*?)<\/nav\s*>/,
  )?.[1];
  const expectedGroups = [
    [
      'live-interaction',
      '直播互动',
      ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature'],
    ],
    [
      'live-scene',
      '直播画面',
      [
        'otherOvertimeMachineFeature',
        'otherGiftEffectsFeature',
        'otherStartAnimationFeature',
        'otherClockFeature',
      ],
    ],
    ['streamer-work', '主播工作', ['otherDailyTodoFeature']],
    [
      'software-help',
      '软件与帮助',
      [
        'otherPerformanceFeature',
        'otherUsageGuideFeature',
        'otherDesktopUpdateFeature',
      ],
    ],
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');

  const headingPositions = expectedGroups.map(([groupId]) =>
    navigation.indexOf(`data-other-feature-group="${groupId}"`),
  );
  assert.deepEqual(
    [...headingPositions].sort((left, right) => left - right),
    headingPositions,
    'workflow groups should keep their intended order',
  );
  assert.ok(
    headingPositions.every((position) => position >= 0),
    'every workflow group should be labeled',
  );

  expectedGroups.forEach(([groupId, label, featureIds], groupIndex) => {
    const groupStart = headingPositions[groupIndex];
    const groupEnd = headingPositions[groupIndex + 1] ?? navigation.length;
    const groupHtml = navigation.slice(groupStart, groupEnd);

    assert.match(
      groupHtml,
      new RegExp(`<strong>${label}<\\/strong>`),
      `${label} should label its workflow group`,
    );
    const featurePositions = featureIds.map((featureId) =>
      groupHtml.indexOf(`data-other-feature="${featureId}"`),
    );
    assert.ok(
      featurePositions.every((position) => position >= 0),
      `${label} should contain its assigned features`,
    );
    assert.deepEqual(
      [...featurePositions].sort((left, right) => left - right),
      featurePositions,
      `${label} features should keep their intended order`,
    );

    for (const [otherGroupId, , otherFeatureIds] of expectedGroups) {
      if (otherGroupId === groupId) continue;
      for (const featureId of otherFeatureIds) {
        assert.doesNotMatch(
          groupHtml,
          new RegExp(`data-other-feature="${featureId}"`),
        );
      }
    }
  });

  assert.match(
    styles,
    /\.other-feature-group-heading\s*\{[^}]*border-top:\s*1px solid var\(--border\)/,
  );
  assert.match(
    styles,
    /\.other-page\.sidebar-collapsed \.other-feature-group-heading\s*\{[^}]*overflow:\s*hidden/,
  );
  assert.match(
    styles,
    /@media \(max-width: 900px\)[\s\S]*?\.other-feature-group-heading\s*\{[^}]*grid-column:\s*1 \/ -1/,
  );
});

test('toolbox group headings are collapsible buttons with the intended type scale', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const navigation = html.match(
    /<nav\b[^>]*class=["']other-feature-menu["'][^>]*>([\s\S]*?)<\/nav\s*>/,
  )?.[1];
  const groups = [
    ['live-interaction', '直播互动'],
    ['live-scene', '直播画面'],
    ['streamer-work', '主播工作'],
    ['software-help', '软件与帮助'],
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');
  assert.equal(
    (navigation.match(/data-other-feature-group=/g) || []).length,
    groups.length,
  );

  groups.forEach(([groupId, label]) => {
    const heading = navigation.match(
      new RegExp(
        `<button\\s+class="other-feature-group-heading"[\\s\\S]*?data-other-feature-group="${groupId}"[\\s\\S]*?<\\/button>`,
      ),
    )?.[0];
    assert.ok(heading, `${label} should use a real button heading`);
    assert.match(heading, /type="button"/);
    assert.match(heading, /aria-expanded="true"/);
    assert.match(heading, new RegExp(`aria-label="收起${label}"`));
    assert.match(heading, new RegExp(`title="收起${label}"`));
  });

  assert.match(
    styles,
    /\.other-feature-group-heading strong\s*\{[^}]*font-size:\s*var\(--type-size-card-title\)/,
  );
  assert.match(
    styles,
    /\.other-feature-group-heading small\s*\{[^}]*font-size:\s*var\(--type-size-caption\)/,
  );
  assert.match(
    styles,
    /\.other-feature-label strong\s*\{[^}]*font-size:\s*var\(--type-size-control\)/,
  );
  assert.match(
    styles,
    /\.other-feature-label small\s*\{[^}]*font-size:\s*var\(--type-size-caption\)/,
  );
  assert.match(styles, /\.other-feature-group-heading:focus-visible\s*\{/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-feature-group-arrow\s*\{[^}]*transition:\s*none/,
  );
});

function createToolboxRuntime({ initialStorage = {} } = {}) {
  function createNode({ dataset = {}, id = '', textContent = '' } = {}) {
    const attributes = new Map();
    const listeners = new Map();
    const classes = new Set();
    const node = {
      dataset,
      id,
      textContent,
      hidden: false,
      disabled: false,
      tabIndex: 0,
      nextElementSibling: null,
      classList: {
        contains(name) {
          return classes.has(name);
        },
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name) ?? null;
      },
      removeAttribute(name) {
        attributes.delete(name);
      },
      querySelector(selector) {
        if (selector === 'strong' && textContent) return { textContent };
        if (
          selector === '.other-feature-label strong' &&
          dataset.otherFeature
        ) {
          return { textContent: dataset.otherFeature };
        }
        return null;
      },
      addEventListener(type, handler) {
        const handlers = listeners.get(type) || [];
        handlers.push(handler);
        listeners.set(type, handlers);
      },
      dispatch(type, event = {}) {
        (listeners.get(type) || []).forEach((handler) => handler(event));
      },
      focus() {},
    };
    return node;
  }

  const groups = [
    [
      'live-interaction',
      ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature'],
    ],
    [
      'live-scene',
      [
        'otherOvertimeMachineFeature',
        'otherGiftEffectsFeature',
        'otherStartAnimationFeature',
        'otherClockFeature',
      ],
    ],
    ['streamer-work', ['otherDailyTodoFeature']],
    [
      'software-help',
      [
        'otherPerformanceFeature',
        'otherUsageGuideFeature',
        'otherDesktopUpdateFeature',
      ],
    ],
  ];
  const headings = [];
  const buttons = [];
  const panels = [];
  const orderedNodes = [];

  groups.forEach(([groupId, featureIds]) => {
    const heading = createNode({
      dataset: { otherFeatureGroup: groupId },
      textContent: groupId,
    });
    heading.setAttribute('aria-expanded', 'true');
    heading.querySelector = (selector) =>
      selector === 'strong' ? { textContent: groupId } : null;
    headings.push(heading);
    orderedNodes.push(heading);
    featureIds.forEach((featureId) => {
      const button = createNode({ dataset: { otherFeature: featureId } });
      button.querySelector = (selector) =>
        selector === '.other-feature-label strong'
          ? { textContent: featureId }
          : null;
      button.setAttribute(
        'aria-selected',
        featureId === 'otherPerformanceFeature' ? 'true' : 'false',
      );
      if (featureId === 'otherDesktopUpdateFeature') button.hidden = true;
      buttons.push(button);
      panels.push(createNode({ id: featureId }));
      orderedNodes.push(button);
    });
  });
  orderedNodes.forEach((node, index) => {
    node.nextElementSibling = orderedNodes[index + 1] || null;
  });

  const sidebarToggle = createNode();
  const rootClasses = new Set();
  const root = {
    classList: {
      contains(name) {
        return rootClasses.has(name);
      },
      toggle(name, enabled) {
        if (enabled) rootClasses.add(name);
        else rootClasses.delete(name);
      },
    },
    querySelector(selector) {
      return selector === '[data-other-sidebar-toggle]' ? sidebarToggle : null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-other-feature]') return buttons;
      if (selector === '[data-other-feature-panel]') return panels;
      if (selector === '[data-other-feature-group]') return headings;
      if (selector === '[data-main-page-link]') return [];
      return [];
    },
  };
  const stored = new Map(Object.entries(initialStorage));
  const windowListeners = new Map();
  const sandbox = {
    console,
    document: {
      getElementById() {
        return root;
      },
    },
    window: {
      AdminApp: {},
      addEventListener(type, handler) {
        const handlers = windowListeners.get(type) || [];
        handlers.push(handler);
        windowListeners.set(type, handlers);
      },
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
  vm.runInNewContext(
    fs.readFileSync(
      path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
      'utf8',
    ),
    sandbox,
  );
  return {
    sandbox,
    root,
    headings,
    buttons,
    panels,
    sidebarToggle,
    stored,
    dispatchWindowEvent(type, detail) {
      (windowListeners.get(type) || []).forEach((handler) =>
        handler({ detail }),
      );
    },
  };
}

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
    /data-danmaku-style="ranked"[\s\S]*?class="danmaku-style-option-visual is-ranked"[\s\S]*?<strong>\s*身份横卡\s*<\/strong\s*>/,
  );
  assert.match(
    html,
    /id="danmakuStyleTitle"[\s\S]*?class="danmaku-overlay-link"[\s\S]*?class="danmaku-style-options"/,
  );
  assert.match(styles, /\.danmaku-style-option-visual\.is-ranked\s*\{/);
  assert.match(
    styles,
    /\.danmaku-tool-panel\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/,
  );
  assert.match(
    styles,
    /\.danmaku-feature-section\s*\{[^}]*border:\s*1px solid var\(--border\)/,
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
  assert.match(
    usageGuideHtml,
    /class="usage-guide-lead">\s*把直播间的互动交给 LIRA/,
  );
  assert.match(usageGuideHtml, /class="usage-guide-hero-actions"/);
  assert.doesNotMatch(usageGuideHtml, /other-feature-page-header/);
  assert.doesNotMatch(styles, /\.other-feature-page-header\b/);
  assert.match(
    styles,
    /\.planner-session-form label > span,[\s\S]*?font-size:\s*var\(--type-size-control\)/,
  );
});
