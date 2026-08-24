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
  assert.match(html, /data-other-feature="otherDanmakuFeature"[^>]*>[\s\S]*?弹幕姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/);
  assert.match(html, /data-other-feature="otherGiftFeature"[^>]*>[\s\S]*?礼物姬[\s\S]*?class="other-feature-arrow"[\s\S]*?<\/button>/);
  assert.match(html, /data-other-feature="otherOvertimeMachineFeature"[^>]*>[\s\S]*?<strong>加班机<\/strong>\s*<small>用礼物延长直播倒计时<\/small>/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-workspace\s*\{[^}]*grid-template-columns:\s*76px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label/);
  assert.match(styles, /\.other-sidebar-toolbar\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-sidebar-toolbar\s*\{[^}]*justify-content:\s*flex-start/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-sidebar-toggle\s*\{[^}]*transform:\s*translateX\(8px\)/);
  assert.match(styles, /\.other-feature-button\s*\{[^}]*height:\s*56px[^}]*min-height:\s*56px[^}]*padding:\s*8px 10px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-button\s*\{[^}]*grid-template-columns:\s*38px minmax\(0, 1fr\) 16px[^}]*justify-content:\s*initial[^}]*min-height:\s*56px/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*visibility 0s linear 260ms/);
  assert.match(styles, /\.other-page\.sidebar-collapsed \.other-feature-arrow\s*\{[^}]*visibility 0s linear 180ms/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-sidebar-toolbar\s*\{[^}]*display:\s*none/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*?\.other-page\.sidebar-collapsed \.other-feature-label\s*\{[^}]*display:\s*grid/);
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
