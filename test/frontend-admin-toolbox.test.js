'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '..');

test('hardware summary hides memory temperature and renders missing CPU temperature as unknown', () => {
  const html = readAdminHtml();
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'metrics.js'),
    'utf8',
  );
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '' });
    return elements.get(id);
  };
  const sandbox = {
    document: { getElementById },
    window: {
      AdminApp: {
        utils: {
          formatDateTime: String,
          formatBytes: (value) => `${value} B`,
          formatDuration: String,
          toast() {},
          showError() {},
        },
      },
    },
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.metrics.renderHardwareSummary(
    {
      cpu: {
        model: 'Example CPU',
        physicalCores: 8,
        logicalCores: 16,
        temperatureCelsius: null,
        temperatureMessage: 'Windows 未提供可靠的 CPU 温度',
      },
      memory: { totalBytes: 16, modules: [] },
      gpus: [],
    },
    false,
  );

  assert.equal(elements.get('hardwareCpuTemperature').textContent, '未知');
  assert.doesNotMatch(html, /id="hardwareMemoryTemperature"/);
});

test('first-run onboarding fragment is hidden by default and wired into the admin shell', () => {
  const page = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'server', 'admin-page.js'),
    'utf8',
  );
  const onboarding = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'pages',
      'admin',
      'toolbox',
      'onboarding.html',
    ),
    'utf8',
  );
  const css = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'other-features.css'),
    'utf8',
  );
  const app = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );
  assert.match(page, /pages\/admin\/toolbox\/onboarding\.html/);
  assert.match(onboarding, /id="liraOnboarding"[^>]*role="dialog"[^>]*hidden/);
  for (const id of [
    'onboardingStepContent',
    'onboardingProgress',
    'onboardingNextBtn',
    'onboardingFinishBtn',
    'onboardingAiTest',
  ]) {
    assert.match(onboarding, new RegExp(`id="${id}"`));
  }
  assert.match(css, /other-features\/onboarding\.css/);
  assert.match(app, /initOnboarding\(/);
});

test('wheel expand control optically centers its plus mark', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const iconRule = styles.match(/\.wheel-expand-icon\s*\{[^}]*\}/)?.[0];
  const markRule = styles.match(/\.wheel-expand-mark\s*\{[^}]*\}/)?.[0];

  assert.match(
    html,
    /<span\b[^>]*class=["']wheel-expand-icon["'][^>]*>[\s\S]*?<span\b[^>]*class=["']wheel-expand-mark["'][^>]*>\s*＋\s*<\/span>[\s\S]*?<\/span>/,
  );
  assert.ok(iconRule, 'wheel expand icon styles should remain defined');
  assert.match(iconRule, /display:\s*grid/);
  assert.match(iconRule, /place-items:\s*center/);
  assert.ok(
    markRule,
    'wheel expand mark should have an optical alignment rule',
  );
  assert.match(markRule, /transform:\s*translateY\(-1px\)/);
});

test('interactive tour close control optically centers its exit mark', () => {
  const styles = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'css',
      'admin',
      'other-features',
      'interactive-tour.css',
    ),
    'utf8',
  );
  const script = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'interactive-tour.js'),
    'utf8',
  );
  const closeRule = styles.match(/\.lira-tour-close\s*\{[\s\S]*?\n\}/)?.[0];
  const closeMarkRule = styles.match(
    /\.lira-tour-close-mark\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(
    closeRule,
    'interactive tour close control styles should remain defined',
  );
  assert.match(closeRule, /display:\s*inline-flex/);
  assert.match(closeRule, /align-items:\s*center/);
  assert.match(closeRule, /justify-content:\s*center/);
  assert.ok(
    closeMarkRule,
    'interactive tour close mark should have an optical alignment rule',
  );
  assert.match(closeMarkRule, /transform:\s*translateY\(-1px\)/);
  assert.match(
    script,
    /<span class="lira-tour-close-mark" aria-hidden="true">×<\/span>/,
  );
});

test('other feature navigation selects panels without feature-specific dependencies', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'other.js'),
    'utf8',
  );
  const createNode = ({ id = '', feature = '', hidden = false } = {}) => {
    const classes = new Set();
    const attributes = new Map();
    const listeners = new Map();
    return {
      id,
      dataset: feature ? { otherFeature: feature } : {},
      hidden,
      tabIndex: -1,
      focused: false,
      classList: {
        contains(name) {
          return classes.has(name);
        },
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      },
      addEventListener(name, listener) {
        listeners.set(name, listener);
      },
      dispatch(name, event) {
        listeners.get(name)?.(event);
      },
      focus() {
        this.focused = true;
      },
      setAttribute(name, value) {
        attributes.set(name, value);
      },
      getAttribute(name) {
        return attributes.get(name);
      },
    };
  };
  const buttons = [
    createNode({ feature: 'performanceFeature' }),
    createNode({ feature: 'diagnosticsFeature' }),
    createNode({ feature: 'desktopFeature', hidden: true }),
  ];
  const panels = [
    createNode({ id: 'performanceFeature' }),
    createNode({ id: 'diagnosticsFeature' }),
    createNode({ id: 'desktopFeature', hidden: true }),
  ];
  const root = {
    querySelectorAll(selector) {
      return selector === '[data-other-feature]' ? buttons : panels;
    },
  };
  const sandbox = {
    console,
    document: { getElementById: () => root },
    window: { AdminApp: {} },
  };

  vm.runInNewContext(source, sandbox);
  const selected = sandbox.window.AdminApp.other.selectFeature(
    root,
    'diagnosticsFeature',
  );

  assert.equal(selected, true);
  assert.equal(buttons[0].classList.contains('active'), false);
  assert.equal(buttons[0].getAttribute('aria-selected'), 'false');
  assert.equal(buttons[0].tabIndex, -1);
  assert.equal(buttons[1].classList.contains('active'), true);
  assert.equal(buttons[1].getAttribute('aria-selected'), 'true');
  assert.equal(buttons[1].tabIndex, 0);
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);

  sandbox.window.AdminApp.other.initOtherPage();
  let prevented = false;
  buttons[1].dispatch('keydown', {
    key: 'ArrowUp',
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(buttons[0].focused, true);
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);

  sandbox.window.AdminApp.other.selectFeature(root, 'desktopFeature');
  assert.equal(buttons[0].classList.contains('active'), true);
  assert.equal(buttons[2].classList.contains('active'), false);
  assert.equal(panels[2].hidden, true);
});

test('desktop update opens its toolbox feature through module APIs', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'desktop.js'),
    'utf8',
  );
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

test('browser source tab classifies and exposes every overlay address', () => {
  const html = readAdminHtml();
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8',
  );
  const sources = [
    ['queueUrl', '/queue'],
    ['songsUrl', '/songlist'],
    ['lyricsUrl', '/lyrics'],
    ['liveDanmakuUrl', '/danmaku'],
    ['liveBlindboxUrl', '/blindbox'],
    ['liveGamesUrl', '/games'],
    ['liveWheelUrl', '/wheel'],
    ['liveOvertimeUrl', '/overtime'],
    ['liveGiftEffectsUrl', '/gift-effects'],
    ['liveOpeningUrl', '/opening'],
    ['liveClockUrl', '/clock'],
  ];

  assert.match(html, /data-tab="overlayPage"[^>]*>\s*浏览器源\s*<\/button>/);
  for (const [id, route] of sources) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(html, new RegExp(`data-copy-url="${id}"`));
    const assignmentPattern = new RegExp(
      'document\\s*\\.\\s*getElementById\\(\\s*[\'\"]' +
        id +
        '[\'\"]\\s*\\)\\s*\\.textContent\\s*=\\s*`\\$\\{origin\\}' +
        route +
        '`;',
    );
    assert.match(
      displaySource,
      assignmentPattern,
      `${route} should be initialized in the live screen tab`,
    );
  }
  assert.match(html, />\s*点歌与音乐\s*<\/h3\s*>/);
  assert.match(html, />\s*直播互动\s*<\/h3\s*>/);
  assert.match(html, />\s*场景与氛围\s*<\/h3\s*>/);
  assert.doesNotMatch(html, /playbackLyricBtn|playbackLyricLockBtn/);
});
