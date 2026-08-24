'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.resolve(__dirname, '..');

test('toolbox styles load feature-owned stylesheets in order', () => {
  const entry = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8'
  );

  assert.match(entry, /@import url\('\.\/other-features\/streamer-planner\.css'\);/);
});

test('toolbox defers offscreen rendering in its heaviest panels', () => {
  const usageGuideStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features', 'usage-guide.css'),
    'utf8'
  );
  const overtimeStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'overtime.css'),
    'utf8'
  );
  const usageGuideScript = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'usage-guide.js'),
    'utf8'
  );

  assert.match(usageGuideStyles, /\.usage-guide-section\s*\{[^}]*content-visibility:\s*auto/);
  assert.match(usageGuideStyles, /\.usage-guide-section\s*\{[^}]*contain-intrinsic-size:\s*auto 720px/);
  assert.match(usageGuideStyles, /\.usage-guide-render-all \.usage-guide-section\s*\{[^}]*content-visibility:\s*visible/);
  assert.match(usageGuideScript, /panel\.classList\.add\('usage-guide-render-all'\)/);
  assert.match(overtimeStyles, /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*content-visibility:\s*auto/);
  assert.match(overtimeStyles, /\.overtime-admin > \.overtime-admin-section\s*\{[^}]*contain-intrinsic-size:\s*auto 260px/);
});

test('toolbox sidebar switches between labeled and icon-only layouts', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');

  assert.match(html, /data-other-sidebar-toggle/);
  assert.match(html, /class="other-sidebar-toggle-state other-sidebar-toggle-collapse"/);
  assert.match(html, /class="other-sidebar-toggle-state other-sidebar-toggle-expand"/);
  assert.match(html, /data-other-feature="otherDanmakuFeature"[^>]*>[\s\S]*?弹幕姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/);
  assert.match(html, /data-other-feature="otherGiftFeature"[^>]*>[\s\S]*?礼物姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/);
  assert.match(html, /data-other-feature="otherOvertimeMachineFeature"[^>]*>[\s\S]*?<strong>加班机<\/strong>\s*<small>用礼物延长直播倒计时<\/small>/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-workspace\s*\{[^}]*grid-template-columns:\s*76px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label/);
  assert.match(styles, /\.other-sidebar-toolbar\s*\{[^}]*justify-content:\s*flex-start[^}]*padding:\s*10px 10px 2px/);
  assert.match(styles, /\.other-sidebar-toggle\s*\{[^}]*flex:\s*0 0 42px[^}]*width:\s*42px[^}]*height:\s*34px[^}]*border-radius:\s*9px/);
  assert.doesNotMatch(styles, /\.other-page\.sidebar-collapsed \.other-sidebar-toggle\s*\{/);
  assert.match(styles, /\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*opacity 140ms ease, transform 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\)/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-sidebar-toggle-collapse\s*\{[^}]*opacity:\s*0[^}]*translateX\(-3px\) scale\(0\.94\)/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-sidebar-toggle-expand\s*\{[^}]*opacity:\s*1[^}]*translateX\(0\) scale\(1\)/);
  assert.match(styles, /\.other-feature-button\s*\{[^}]*height:\s*56px[^}]*min-height:\s*56px[^}]*padding:\s*8px 10px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-button\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) 16px[^}]*justify-content:\s*initial[^}]*min-height:\s*56px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*visibility 0s linear 260ms/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-arrow\s*\{[^}]*visibility 0s linear 180ms/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-sidebar-toolbar\s*\{[^}]*display:\s*none/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*display:\s*grid/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-sidebar-toggle-state\s*\{[^}]*transition:\s*none/);
});

test('toolbox sidebar groups features by live and local workflows', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const navigation = html.match(/<nav class="other-feature-menu"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  const expectedGroups = [
    ['live-interaction', '直播互动', ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature']],
    ['live-scene', '直播画面', ['otherOvertimeMachineFeature', 'otherGiftEffectsFeature', 'otherStartAnimationFeature', 'otherClockFeature']],
    ['streamer-work', '主播工作', ['otherDailyTodoFeature']],
    ['software-help', '软件与帮助', ['otherPerformanceFeature', 'otherUsageGuideFeature', 'otherDesktopUpdateFeature']]
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');

  const headingPositions = expectedGroups.map(([groupId]) => (
    navigation.indexOf(`data-other-feature-group="${groupId}"`)
  ));
  assert.deepEqual(
    [...headingPositions].sort((left, right) => left - right),
    headingPositions,
    'workflow groups should keep their intended order'
  );
  assert.ok(headingPositions.every((position) => position >= 0), 'every workflow group should be labeled');

  expectedGroups.forEach(([groupId, label, featureIds], groupIndex) => {
    const groupStart = headingPositions[groupIndex];
    const groupEnd = headingPositions[groupIndex + 1] ?? navigation.length;
    const groupHtml = navigation.slice(groupStart, groupEnd);

    assert.match(groupHtml, new RegExp(`<strong>${label}<\\/strong>`), `${label} should label its workflow group`);
    const featurePositions = featureIds.map((featureId) => (
      groupHtml.indexOf(`data-other-feature="${featureId}"`)
    ));
    assert.ok(featurePositions.every((position) => position >= 0), `${label} should contain its assigned features`);
    assert.deepEqual(
      [...featurePositions].sort((left, right) => left - right),
      featurePositions,
      `${label} features should keep their intended order`
    );

    for (const [otherGroupId, , otherFeatureIds] of expectedGroups) {
      if (otherGroupId === groupId) continue;
      for (const featureId of otherFeatureIds) {
        assert.doesNotMatch(groupHtml, new RegExp(`data-other-feature="${featureId}"`));
      }
    }
  });

  assert.match(styles, /\.other-feature-group-heading\s*\{[^}]*border-top:\s*1px solid var\(--border\)/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-group-heading\s*\{[^}]*overflow:\s*hidden/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-feature-group-heading\s*\{[^}]*grid-column:\s*1 \/ -1/);
});

test('toolbox group headings are collapsible buttons with the intended type scale', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const navigation = html.match(/<nav class="other-feature-menu"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  const groups = [
    ['live-interaction', '直播互动'],
    ['live-scene', '直播画面'],
    ['streamer-work', '主播工作'],
    ['software-help', '软件与帮助']
  ];

  assert.ok(navigation, 'toolbox navigation should remain present');
  assert.equal((navigation.match(/data-other-feature-group=/g) || []).length, groups.length);

  groups.forEach(([groupId, label]) => {
    const heading = navigation.match(new RegExp(
      `<button\\s+class="other-feature-group-heading"[\\s\\S]*?data-other-feature-group="${groupId}"[\\s\\S]*?<\\/button>`
    ))?.[0];
    assert.ok(heading, `${label} should use a real button heading`);
    assert.match(heading, /type="button"/);
    assert.match(heading, /aria-expanded="true"/);
    assert.match(heading, new RegExp(`aria-label="收起${label}"`));
    assert.match(heading, new RegExp(`title="收起${label}"`));
  });

  assert.match(styles, /\.other-feature-group-heading strong\s*\{[^}]*font-size:\s*var\(--type-size-card-title\)/);
  assert.match(styles, /\.other-feature-group-heading small\s*\{[^}]*font-size:\s*var\(--type-size-caption\)/);
  assert.match(styles, /\.other-feature-label strong\s*\{[^}]*font-size:\s*var\(--type-size-control\)/);
  assert.match(styles, /\.other-feature-label small\s*\{[^}]*font-size:\s*var\(--type-size-caption\)/);
  assert.match(styles, /\.other-feature-group-heading:focus-visible\s*\{/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.other-feature-group-arrow\s*\{[^}]*transition:\s*none/);
});

function createToolboxRuntime() {
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
        contains(name) { return classes.has(name); },
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        }
      },
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
      removeAttribute(name) { attributes.delete(name); },
      querySelector(selector) {
        if (selector === 'strong' && textContent) return { textContent };
        if (selector === '.other-feature-label strong' && dataset.otherFeature) {
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
      focus() {}
    };
    return node;
  }

  const groups = [
    ['live-interaction', ['otherDanmakuFeature', 'otherGiftFeature', 'otherGamesFeature']],
    ['live-scene', ['otherOvertimeMachineFeature', 'otherGiftEffectsFeature', 'otherStartAnimationFeature', 'otherClockFeature']],
    ['streamer-work', ['otherDailyTodoFeature']],
    ['software-help', ['otherPerformanceFeature', 'otherUsageGuideFeature', 'otherDesktopUpdateFeature']]
  ];
  const headings = [];
  const buttons = [];
  const panels = [];
  const orderedNodes = [];

  groups.forEach(([groupId, featureIds]) => {
    const heading = createNode({ dataset: { otherFeatureGroup: groupId }, textContent: groupId });
    heading.setAttribute('aria-expanded', 'true');
    heading.querySelector = (selector) => selector === 'strong' ? { textContent: groupId } : null;
    headings.push(heading);
    orderedNodes.push(heading);
    featureIds.forEach((featureId) => {
      const button = createNode({ dataset: { otherFeature: featureId } });
      button.querySelector = (selector) => selector === '.other-feature-label strong'
        ? { textContent: featureId }
        : null;
      button.setAttribute('aria-selected', featureId === 'otherPerformanceFeature' ? 'true' : 'false');
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
      contains(name) { return rootClasses.has(name); },
      toggle(name, enabled) {
        if (enabled) rootClasses.add(name);
        else rootClasses.delete(name);
      }
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
    }
  };
  const stored = new Map();
  const sandbox = {
    console,
    document: { getElementById() { return root; } },
    window: {
      AdminApp: {},
      localStorage: {
        getItem(key) { return stored.get(key) || null; },
        setItem(key, value) { stored.set(key, value); }
      }
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'), 'utf8'),
    sandbox
  );
  return { sandbox, root, headings, buttons, panels };
}

test('toolbox groups hide and restore only their own features and deep links reopen them', () => {
  const runtime = createToolboxRuntime();
  runtime.sandbox.window.AdminApp.other.initOtherPage();
  const liveSceneHeading = runtime.headings[1];
  const liveSceneButtons = runtime.buttons.slice(3, 7);
  const clockButton = runtime.buttons[6];
  const clockPanel = runtime.panels[6];

  runtime.sandbox.window.AdminApp.other.setSidebarCollapsed(runtime.root, true, false);
  assert.equal(runtime.headings.every((heading) => heading.disabled), true);
  assert.equal(runtime.headings.every((heading) => heading.tabIndex === -1), true);
  runtime.sandbox.window.AdminApp.other.setSidebarCollapsed(runtime.root, false, false);
  assert.equal(runtime.headings.every((heading) => !heading.disabled), true);

  liveSceneHeading.dispatch('click');
  assert.equal(liveSceneHeading.getAttribute('aria-expanded'), 'false');
  assert.equal(liveSceneButtons.every((button) => button.hidden), true);
  assert.equal(runtime.buttons[0].hidden, false);

  liveSceneHeading.dispatch('click');
  assert.equal(liveSceneHeading.getAttribute('aria-expanded'), 'true');
  assert.equal(liveSceneButtons.every((button) => !button.hidden), true);
  assert.equal(clockButton.hidden, false);

  runtime.sandbox.window.AdminApp.other.selectFeature(runtime.root, 'otherClockFeature');
  liveSceneHeading.dispatch('click');
  assert.equal(clockButton.hidden, true);
  assert.equal(clockPanel.hidden, false, 'collapsing a group should keep its current panel visible');

  runtime.sandbox.window.AdminApp.other.selectFeature(runtime.root, 'otherClockFeature');
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

  assert.match(html, /class="danmaku-feature-section danmaku-connection-section"[\s\S]*?id="danmakuAccountState"[\s\S]*?id="danmakuRoomState"[\s\S]*?id="danmakuToolStatus"/);
  assert.match(html, /class="danmaku-feature-section danmaku-compose-section"[\s\S]*?id="danmakuSendForm"[\s\S]*?id="danmakuSendResult"/);
  assert.match(html, /id="danmakuCounter"[\s\S]*?id="danmakuAutoBtn"[\s\S]*?id="danmakuSendBtn"/);
  assert.match(html, /data-danmaku-style="ranked"[\s\S]*?class="danmaku-style-option-visual is-ranked"[\s\S]*?<strong>身份横卡<\/strong>/);
  assert.match(styles, /\.danmaku-style-option-visual\.is-ranked\s*\{/);
  assert.match(styles, /\.danmaku-tool-panel\s*\{[^}]*width:\s*100%[^}]*max-width:\s*none/);
  assert.match(styles, /\.danmaku-feature-section\s*\{[^}]*border:\s*1px solid var\(--border\)/);
  assert.match(styles, /\.danmaku-bot-switch-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /#danmakuSendForm \.form-actions-row > \.hint\s*\{[^}]*margin-right:\s*auto/);
  assert.match(styles, /@media \(max-width: 600px\)[\s\S]*?\.danmaku-bot-switch-grid\s*\{\s*grid-template-columns:\s*1fr;/);
});

test('toolbox sidebar toggle updates accessibility state and stores the preference', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
    'utf8'
  );
  const classes = new Set();
  const attributes = new Map();
  const stored = new Map();
  const toggle = {
    title: '',
    setAttribute(name, value) { attributes.set(name, value); }
  };
  const root = {
    classList: {
      contains(name) { return classes.has(name); },
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    },
    querySelector: () => toggle,
    querySelectorAll: () => []
  };
  const sandbox = {
    console,
    document: { getElementById: () => root },
    window: {
      AdminApp: {},
      localStorage: {
        getItem(key) { return stored.get(key) || null; },
        setItem(key, value) { stored.set(key, value); }
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.other.setSidebarCollapsed(root, true);

  assert.equal(classes.has('sidebar-collapsed'), true);
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(toggle.title, '展开功能导航');
  assert.equal(stored.get('admin.toolboxSidebarCollapsed'), 'true');
});

test('desktop shell reveals the desktop update toolbox feature', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'desktop.js'), 'utf8');
  const desktopOnlyNodes = [{ hidden: true }, { hidden: true }];
  const sandbox = {
    console,
    document: {
      body: { classList: { add() {} } },
      getElementById: () => null,
      querySelectorAll(selector) {
        return selector === '.desktop-only' ? desktopOnlyNodes : [];
      }
    },
    window: {
      AdminApp: {
        utils: {
          toast() {},
          showStackedToast() {},
          showError() {},
          api: async () => ({})
        }
      },
      songAssistantDesktop: {
        onShowUpdatePage() {},
        onUpdateState() {},
        getInfo: () => new Promise(() => {})
      }
    }
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.desktop.initDesktopShell();

  assert.equal(desktopOnlyNodes.every((node) => node.hidden === false), true);
});

test('desktop update feature keeps its tab and panel mapping', () => {
  const html = readAdminHtml();
  assert.match(html, /id="otherDesktopUpdateFeatureTab"[\s\S]*data-other-feature="otherDesktopUpdateFeature"/);
  assert.match(html, /id="otherDesktopUpdateFeature"[\s\S]*data-other-feature-panel/);
  assert.match(html, /aria-labelledby="otherDesktopUpdateFeatureTab"/);
});

test('toolbox features share one semantic page-header contract', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const pageTitles = [
    '把直播间准备好',
    '弹幕姬',
    '礼物姬',
    '小游戏',
    '加班机',
    '礼物特效',
    '主播工作台',
    '开播画面',
    '萌时钟',
    '性能检测',
    '使用文档',
    '桌面更新'
  ];

  for (const title of pageTitles) {
    assert.match(
      html,
      new RegExp(`class="[^"]*ui-page-title[^"]*"[^>]*>${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|<)`),
      `${title} should use the common page-title role`
    );
  }

  assert.match(styles, /\.other-feature-page-header\s*\{[^}]*display:\s*flex/);
  assert.match(styles, /\.app-shell \.other-feature-page-header \.ui-page-title\s*\{[^}]*font-size:\s*var\(--type-size-page-title\)/);
  assert.match(styles, /\.app-shell \.other-feature-page-header \.ui-page-subtitle\s*\{[^}]*font-size:\s*var\(--type-size-body\)/);
  assert.match(styles, /\.planner-session-form label > span,[\s\S]*?font-size:\s*var\(--type-size-control\)/);
});
