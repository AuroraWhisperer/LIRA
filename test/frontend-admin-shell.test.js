'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { readCssBundle } = require('./helpers/css-bundle');
const { readJsModuleBundle } = require('./helpers/js-module-bundle');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const {
  createLyricToggleButton,
  loadModuleExports,
  response,
} = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('toast stack stays below the top application bar', () => {
  const layoutStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'layout.css'),
    'utf8',
  );
  const toastStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'system.css'),
    'utf8',
  );
  const topbarHeight = Number(
    layoutStyles.match(/\.topbar\s*\{[\s\S]*?min-height:\s*(\d+)px/)?.[1],
  );
  const toastOffset = Number(
    toastStyles.match(/\.toast-stack\s*\{[\s\S]*?top:\s*(\d+)px/)?.[1],
  );

  assert.ok(
    topbarHeight > 0,
    'top application bar height should remain defined',
  );
  assert.ok(
    toastOffset >= topbarHeight + 8,
    'toast stack should clear the top application bar',
  );
});

test('live refresh toast resolves its migrated image from the nested stylesheet', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'system.css'),
    'utf8',
  );
  const imagePath = path.join(
    ROOT_DIR,
    'public',
    'img',
    'shared',
    'live-refresh-icon.webp',
  );

  assert.match(
    source,
    /url\('\.\.\/\.\.\/\.\.\/img\/shared\/live-refresh-icon\.webp'\)/,
  );
  assert.equal(fs.existsSync(imagePath), true);
});

test('queue headers share a fixed minimum height and song queue controls stay compact', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const headerRule = source.match(
    /\.queues-row \.queue-panel \.panel-header\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const buttonRule = source.match(
    /\.queues-row \.queue-panel \.panel-header button\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(headerRule, 'queue header sizing should remain defined');
  assert.match(headerRule, /min-height:\s*72px/);
  assert.ok(buttonRule, 'song queue header controls should remain compact');
  assert.match(buttonRule, /min-height:\s*32px/);
});

test('queue headers group counts with titles and keep passive surfaces still', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'workspace.css');
  for (const counterId of ['superChatSize', 'queueSize']) {
    assert.match(
      html,
      new RegExp(`<div class="queue-heading">(?:(?!</div>)[\\s\\S])*id="${counterId}"`),
    );
  }
  const clearRule = styles.match(
    /\.queues-row \.queue-panel \.panel-header button\.danger\s*\{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(clearRule);
  assert.match(clearRule, /border:\s*1px solid var\(--border\)/);
  assert.match(clearRule, /color:\s*var\(--muted\)/);
  const emptyRule = styles.match(
    /\.queues-row \.queue-panel \.queue-list > \.empty\s*\{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(emptyRule);
  assert.match(emptyRule, /border:\s*0/);
  assert.match(emptyRule, /background:\s*transparent/);
  assert.doesNotMatch(styles, /\.queue-panel:hover|\.empty:hover/);
});

test('minimum-height desktop reclaims space before the point-song page heading', () => {
  const workspaceSource = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const responsiveSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'),
    'utf8',
  );
  const baseQueueRule = workspaceSource.match(
    /\.queues-row\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const compactDesktopRule = responsiveSource.match(
    /@media \(min-width: 901px\) and \(max-height: 700px\) \{\s*(\.queues-row\s*\{[\s\S]*?\n\s*\})\s*\}/,
  )?.[1];
  const baseHeight = Number(baseQueueRule?.match(/height:\s*(\d+)px/)?.[1]);
  const compactHeight = Number(
    compactDesktopRule?.match(/height:\s*(\d+)px/)?.[1],
  );
  const compactBasis = Number(
    compactDesktopRule?.match(/flex-basis:\s*(\d+)px/)?.[1],
  );

  assert.ok(
    baseQueueRule,
    'default desktop queue sizing should remain defined',
  );
  assert.ok(
    compactDesktopRule,
    'minimum-height desktop queue sizing should be height-scoped',
  );
  assert.equal(compactHeight, compactBasis);
  assert.ok(
    baseHeight - compactHeight >= 32,
    'minimum-height desktop should reclaim at least one page-heading row',
  );
  assert.doesNotMatch(
    compactDesktopRule,
    /panel-header|queue-list|font-|line-height/,
  );
});

test('point-song subviews rely on tabs instead of repeated page headings', () => {
  const html = readAdminHtml();
  const views = [
    'songsPage',
    'settingsPage',
    'themePage',
    'displayPage',
    'overlayPage',
    'importPage',
    'desktopLyricPage',
  ];

  for (const id of views) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /class="song-subview-header"/);
  assert.doesNotMatch(
    html,
    /<h2 class="ui-page-title">(?:歌库|设置|点歌板|展示板|浏览器源|导入导出|桌面歌词)<\/h2>/,
  );
});

test('colored action buttons use solid or frameless treatments', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'styles-base.css'),
    'utf8',
  );
  const primaryRule = source.match(/button\.primary\s*\{[\s\S]*?\n\}/)?.[0];
  const primaryHoverRule = source.match(
    /button\.primary:hover\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const secondaryRule = source.match(/button\.secondary\s*\{[\s\S]*?\n\}/)?.[0];
  const dangerRule = source.match(/button\.danger\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(primaryRule, 'primary button styling should remain defined');
  assert.ok(
    primaryHoverRule,
    'primary button hover styling should remain defined',
  );
  assert.ok(secondaryRule, 'secondary button styling should remain defined');
  assert.ok(dangerRule, 'danger button styling should remain defined');
  assert.match(primaryRule, /border-color:\s*transparent/);
  assert.match(primaryRule, /background:\s*var\(--primary\)/);
  assert.match(primaryHoverRule, /border-color:\s*transparent/);
  assert.match(primaryHoverRule, /background:\s*var\(--primary-strong\)/);
  assert.match(secondaryRule, /border-color:\s*var\(--border\)/);
  assert.match(dangerRule, /border-color:\s*transparent/);
  assert.match(dangerRule, /background:\s*transparent/);
});

test('top navigation keeps its outer track and colored moving active capsule', () => {
  const mainTabs = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'css',
      'admin',
      'gifts',
      'main-page-tabs.css',
    ),
    'utf8',
  );
  const workspace = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const desktop = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'overlays', 'desktop.css'),
    'utf8',
  );
  const appSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );
  const tabsRule = mainTabs.match(/\.main-page-tabs\s*\{[\s\S]*?\n\}/)?.[0];
  const movingLayersRule = workspace.match(
    /\.main-page-tabs::before,\s*\.main-page-tabs::after\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const pillRule = workspace.match(
    /\.main-page-tabs::before\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const railRule = Array.from(
    workspace.matchAll(/\.main-page-tabs::after\s*\{[\s\S]*?\n\}/g),
  )
    .map((match) => match[0])
    .find((rule) => /background:/.test(rule));
  const readyRule = workspace.match(
    /\.main-page-tabs\.indicator-ready::before,\s*\.main-page-tabs\.indicator-ready::after\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const activeRule = workspace.match(
    /\.main-page-tab\.active\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const desktopTabsRule = desktop.match(
    /body\.desktop-shell \.main-page-tabs\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const desktopActiveRule = desktop.match(
    /body\.desktop-shell \.main-page-tab\.active\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(tabsRule, 'top navigation layout should remain defined');
  assert.match(tabsRule, /gap:\s*8px/);
  assert.match(tabsRule, /border:\s*1px solid rgba\(183, 133, 50, 0\.22\)/);
  assert.match(tabsRule, /background:\s*#fffaf1/);
  assert.match(tabsRule, /border-radius:\s*12px/);
  assert.match(tabsRule, /padding:\s*3px/);
  assert.ok(
    movingLayersRule,
    'top navigation moving layers should share the active geometry',
  );
  assert.match(
    movingLayersRule,
    /width:\s*var\(--main-page-indicator-width,\s*0px\)/,
  );
  assert.match(
    movingLayersRule,
    /transform:\s*translateX\(var\(--main-page-indicator-x,\s*0px\)\)/,
  );
  assert.ok(
    pillRule,
    'top navigation should use one shared moving active capsule',
  );
  assert.match(
    pillRule,
    /linear-gradient\(135deg,\s*#fff0d2 0%,\s*#ffd99a 100%\)/,
  );
  assert.match(pillRule, /inset 0 0 0 1px rgba\(183, 133, 50, 0\.34\)/);
  assert.match(pillRule, /transition:[\s\S]*width[\s\S]*transform/);
  assert.ok(
    railRule,
    'top navigation should keep the accent rail inside the colored capsule',
  );
  assert.match(railRule, /center bottom 3px \/ 22px 3px no-repeat/);
  assert.ok(
    readyRule,
    'top navigation capsule should appear after positioning',
  );
  assert.match(readyRule, /opacity:\s*1/);
  assert.match(activeRule, /background:\s*transparent/);
  assert.match(activeRule, /box-shadow:\s*none/);
  assert.match(desktopTabsRule, /background:\s*#fffaf1/);
  assert.match(desktopActiveRule, /background:\s*transparent/);
  assert.match(desktopActiveRule, /box-shadow:\s*none/);
  assert.match(appSource, /function syncMainPageIndicator\(/);
  assert.match(appSource, /--main-page-indicator-x/);
  assert.match(appSource, /--main-page-indicator-width/);
});

test('desktop live status and refresh control keep visible separation', () => {
  const layout = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'layout.css'),
    'utf8',
  );
  const statusStripRule = layout.match(/\.status-strip\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(
    statusStripRule,
    'desktop status strip layout should remain defined',
  );
  assert.match(statusStripRule, /gap:\s*8px/);
});

test('accent actions do not add a colored frame around their fill or active state', () => {
  const layout = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'layout.css'),
    'utf8',
  );
  const lyric = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'desktop-lyric-preview.css'),
    'utf8',
  );
  const responsive = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'),
    'utf8',
  );
  const toolbox = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const playback = readCssBundle('public', 'css', 'styles-playback.css');
  const rules = [
    layout.match(/\.status-strip button\.danger\s*\{[\s\S]*?\n\}/)?.[0],
    lyric.match(/\.desktop-lyric-reset-button\s*\{[\s\S]*?\n\}/)?.[0],
    responsive.match(/\.gift-history-open-btn\s*\{[\s\S]*?\n\}/)?.[0],
    toolbox.match(/\.other-feature-button\.active\s*\{[\s\S]*?\n\}/)?.[0],
    toolbox.match(
      /\.opening-upload-button,\s*\.button-quiet\s*\{[\s\S]*?\n\}/,
    )?.[0],
    toolbox.match(
      /\.usage-guide-hero-actions a,\s*\.usage-guide-hero-actions button\s*\{[\s\S]*?\n\}/,
    )?.[0],
    playback.match(/\.playback-quality-btn\s*\{[\s\S]*?\n\}/)?.[0],
  ];

  assert.equal(
    rules.every(Boolean),
    true,
    'all audited accent action rules should remain defined',
  );
  for (const rule of rules) {
    assert.match(rule, /border(?:-color)?:\s*(?:0|transparent)/);
  }
});

test('SuperChat clear control lives in the SC queue header', () => {
  const queueShell = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'song', 'shell-start.html'),
    'utf8',
  );
  const importPage = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'pages',
      'admin',
      'song',
      'import-export.html',
    ),
    'utf8',
  );
  const scPanel = queueShell.match(
    /<section class="panel queue-panel sc-queue-panel">[\s\S]*?<\/section>/,
  )?.[0];

  assert.ok(scPanel, 'SC queue panel should remain present');
  assert.match(
    scPanel,
    /id="clearSuperChatsBtn"[^>]*>\s*<svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>\s*清空 SC 记录\s*<\/button>/,
  );
  assert.doesNotMatch(importPage, /id="clearSuperChatsBtn"/);
});

test('toolbox owns independent settings, overtime, streamer planner, start animation, performance, usage guide, and update features', () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'styles-admin.css'),
    'utf8',
  );
  const tabStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'tabs.css'),
    'utf8',
  );
  const featureStyles = readCssBundle(
    'public',
    'css',
    'admin',
    'other-features.css',
  );
  const performanceHtml = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'pages',
      'admin',
      'toolbox',
      'performance.html',
    ),
    'utf8',
  );
  const accountSettingsHtml = fs.readFileSync(
    path.join(
      ROOT_DIR,
      'public',
      'pages',
      'admin',
      'toolbox',
      'settings.html',
    ),
    'utf8',
  );
  const managementTabs = html.match(
    /<div class="tabs" role="tablist">([\s\S]*?)<\/div>/,
  )?.[1];
  const directTabRule = tabStyles.match(/\.tabs > \.tab\s*\{[\s\S]*?\n\}/)?.[0];
  const overtimePosition = html.indexOf(
    'data-other-feature="otherOvertimeMachineFeature"',
  );
  const dailyTodoPosition = html.indexOf(
    'data-other-feature="otherDailyTodoFeature"',
  );
  const startAnimationPosition = html.indexOf(
    'data-other-feature="otherStartAnimationFeature"',
  );
  const performancePosition = html.indexOf(
    'data-other-feature="otherPerformanceFeature"',
  );
  const settingsPosition = html.indexOf(
    'data-other-feature="otherSettingsFeature"',
  );
  const usageGuidePosition = html.indexOf(
    'data-other-feature="otherUsageGuideFeature"',
  );
  const updatePosition = html.indexOf(
    'data-other-feature="otherDesktopUpdateFeature"',
  );

  assert.doesNotMatch(html, /data-tab="performancePage"/);
  assert.doesNotMatch(html, /id="performancePage"/);
  assert.match(
    html,
    /data-main-page="otherAssistantPage"[\s\S]*?<span>百宝箱<\/span>/,
  );
  assert.ok(managementTabs, 'song management tabs should remain present');
  assert.equal(managementTabs.match(/data-tab=/g)?.length, 7);
  assert.doesNotMatch(managementTabs, /<details|更多|desktopUpdate/);
  assert.ok(directTabRule, 'direct tab sizing should remain defined');
  assert.match(directTabRule, /flex:\s*1 1 0/);
  assert.match(directTabRule, /min-width:\s*0/);
  assert.doesNotMatch(tabStyles, /tab-overflow/);
  assert.match(html, /data-other-feature="otherOvertimeMachineFeature"/);
  assert.match(
    html,
    /id="otherOvertimeMachineFeature"[^>]+data-other-feature-panel/,
  );
  assert.match(html, /data-other-feature="otherDailyTodoFeature"/);
  assert.match(
    html,
    /id="otherDailyTodoFeature"[^>]+data-other-feature-panel[\s\S]*?id="streamerPlanner"[\s\S]*?id="plannerTaskForm"/,
  );
  assert.match(html, /data-other-feature="otherStartAnimationFeature"/);
  assert.match(
    html,
    /id="otherStartAnimationFeature"[^>]+data-other-feature-panel/,
  );
  assert.match(html, /data-other-feature="otherPerformanceFeature"/);
  assert.match(
    html,
    /id="otherPerformanceFeature"[^>]+data-other-feature-panel/,
  );
  assert.match(html, /data-other-feature="otherSettingsFeature"/);
  assert.match(html, /id="otherSettingsFeature"[^>]+data-other-feature-panel/);
  assert.match(html, /id="licenseAccountDevice"[^>]+hidden/);
  assert.match(html, /id="licenseAccountName"/);
  assert.match(html, /id="licenseDeviceName"/);
  assert.match(html, /账号信息/);
  assert.match(html, /忘记密码？[\s\S]*?请联系管理员重置密码。/);
  assert.doesNotMatch(
    accountSettingsHtml,
    /安全存储|设备私钥|首次授权|激活密钥|设备管理/,
  );
  assert.match(html, /data-other-feature="otherUsageGuideFeature"/);
  assert.match(html, /id="otherUsageGuideFeature"[\s\S]*?usage-guide-panel/);
  assert.match(html, /id="otherUsageGuideFeature"[\s\S]*?usage-guide-faq-grid/);
  assert.match(
    html,
    /id="otherDesktopUpdateFeature"[^>]+data-other-feature-panel/,
  );
  assert.ok(
    overtimePosition < performancePosition,
    'overtime machine should be first in the toolbox',
  );
  assert.ok(
    dailyTodoPosition > overtimePosition,
    'daily todo should follow overtime machine in the toolbox',
  );
  assert.ok(
    dailyTodoPosition < performancePosition,
    'daily todo should precede performance in the toolbox',
  );
  assert.ok(
    startAnimationPosition < performancePosition,
    'start animation should precede performance in the toolbox',
  );
  assert.ok(
    usageGuidePosition > performancePosition,
    'usage guide should follow performance in the toolbox',
  );
  assert.ok(
    updatePosition > performancePosition,
    'desktop update should follow performance in the toolbox',
  );
  assert.ok(
    settingsPosition < performancePosition,
    'settings should precede performance in the toolbox',
  );
  assert.equal(performanceHtml.match(/<button/g)?.length, 1);
  assert.doesNotMatch(performanceHtml, /<input|metricsToggle/);
  assert.match(
    performanceHtml,
    /id="metricsCountdown"[^>]*role="timer"[^>]*aria-label="每次检测采样 5 秒"/,
  );
  assert.match(performanceHtml, /id="metricsCountdownValue">5<\/strong>/);
  assert.match(
    performanceHtml,
    /class="monitor-status">[\s\S]*?<span>检测状态<\/span>[\s\S]*?id="metricsStatus">未检测<\/p>/,
  );
  assert.match(
    performanceHtml,
    /id="metricsRefreshBtn"[^>]*>\s*开始检测\s*<\/button>/,
  );
  assert.equal(html.match(/id="desktopCheckUpdateBtn"/g)?.length, 1);
  assert.match(
    html,
    /class="desktop-current-version">[\s\S]*?<span>当前版本<\/span>[\s\S]*?id="desktopVersionPill">--<\/strong>/,
  );
  assert.match(styles, /@import url\('\.\/admin\/other-features\.css'\);/);
  assert.match(
    featureStyles,
    /\.other-feature-panel-body\.stack\s*\{[^}]*grid-auto-rows:\s*max-content;/,
  );
});

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

test('usage guide main-flow steps keep body text out of the number gutter', () => {
  const source = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const stepRule = source.match(/\.usage-guide-steps li\s*\{[\s\S]*?\n\}/)?.[0];
  const markerRule = source.match(
    /\.usage-guide-steps li::before\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(stepRule, 'usage guide step layout should remain defined');
  assert.ok(markerRule, 'usage guide step marker should remain defined');
  assert.match(stepRule, /position:\s*relative/);
  assert.match(stepRule, /padding:\s*11px 2px 11px 40px/);
  assert.doesNotMatch(stepRule, /grid-template-columns/);
  assert.match(markerRule, /position:\s*absolute/);
  assert.match(markerRule, /left:\s*2px/);
});

test('usage guide fills the available panel and lead width in both sidebar states', () => {
  const source = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const panelRule = source.match(/\.usage-guide-panel\s*\{[\s\S]*?\n\}/)?.[0];
  const leadRule = source.match(/\.usage-guide-lead\s*\{[\s\S]*?\n\}/)?.[0];
  const collapsedRule = source.match(
    /\.other-page\.sidebar-collapsed \.usage-guide-panel\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(panelRule, 'usage guide panel sizing should remain defined');
  assert.ok(leadRule, 'usage guide lead sizing should remain defined');
  assert.ok(collapsedRule, 'collapsed sidebar sizing should remain defined');
  assert.match(panelRule, /max-width:\s*none/);
  assert.match(leadRule, /max-width:\s*none/);
  assert.match(collapsedRule, /max-width:\s*none/);
});

test('usage guide presents overlays for both live companion and OBS users', () => {
  const html = readAdminHtml();

  assert.match(html, />\s*直播姬 \/ OBS 投屏\s*<\/a>/);
  assert.match(html, />\s*直播姬 \/ OBS 投屏设置\s*<\/h3>/);
  assert.match(html, /添加到直播姬的「浏览器」或\s*OBS\s*的「浏览器源」/);
  assert.match(html, />直播姬 \/ OBS 投屏画面不显示或尺寸不对<\/strong>/);
});

test('usage guide defers image loading and avoids sticky backdrop blur', () => {
  const html = readAdminHtml();
  const styles = readCssBundle('public', 'css', 'admin', 'other-features.css');
  const images =
    html.match(/<img\b[^>]*class="usage-guide-image"[^>]*>/g) || [];
  const tocRule = styles.match(/\.usage-guide-toc\s*\{[\s\S]*?\n\}/)?.[0];

  assert.equal(images.length, 9);
  assert.equal(
    images.every((image) => /loading="lazy"/.test(image)),
    true,
  );
  assert.equal(
    images.every((image) => /decoding="async"/.test(image)),
    true,
  );
  assert.equal(
    images.every(
      (image) => /\bwidth="\d+"/.test(image) && /\bheight="\d+"/.test(image),
    ),
    true,
  );
  assert.ok(tocRule, 'usage guide table of contents should remain defined');
  assert.match(tocRule, /background:\s*var\(--surface-2\)/);
  assert.match(tocRule, /display:\s*grid/);
  assert.match(tocRule, /grid-template-columns:[\s\S]*auto-fit/);
  assert.doesNotMatch(tocRule, /white-space:\s*nowrap|overflow-x:\s*(?:auto|scroll)/);
  assert.doesNotMatch(tocRule, /backdrop-filter/);
});

test('usage guide names the AI assistant section without removing the DeepSeek anchor', () => {
  const html = readAdminHtml();

  assert.match(html, /href="#ug-deepseek"[^>]*>配置 AI 助手<\/a>/);
  assert.match(html, /id="ug-deepseek"[^>]*>[\s\S]*?>\s*配置 AI 助手\s*<\/h3>/);
});

function createUsageGuideFixture({
  flexDirection = 'row',
  tocTop = '8px',
  tocHeight = 72,
  scrollerTop = 0,
  sectionTops = [0, 200],
  scrollerHeight = 400,
  scrollerScrollHeight = 1000,
} = {}) {
  const observers = [];
  const windowListeners = new Map();
  const createClassList = () => {
    const names = new Set();
    return {
      contains: (name) => names.has(name),
      toggle(name, enabled) {
        if (enabled) names.add(name);
        else names.delete(name);
      },
    };
  };
  const sections = sectionTops.map((_, index) => ({
    id: `usage-section-${index + 1}`,
    getBoundingClientRect: () => ({ top: sectionTops[index] }),
  }));
  const links = sections.map((section) => ({
    hash: `#${section.id}`,
    classList: createClassList(),
    addEventListener() {},
  }));
  const toc = {
    height: tocHeight,
    reads: 0,
    getBoundingClientRect() {
      this.reads += 1;
      return { height: this.height };
    },
  };
  const scrollerListeners = new Map();
  const scroller = {
    clientHeight: scrollerHeight,
    scrollHeight: scrollerScrollHeight,
    scrollTop: 0,
    addEventListener: (name, listener) => scrollerListeners.set(name, listener),
    getBoundingClientRect: () => ({ top: scrollerTop }),
  };
  const panel = {
    hidden: false,
    style: {
      setProperty(name, value) {
        this[name] = value;
      },
    },
    querySelector(selector) {
      if (selector === '.other-feature-panel-body') return scroller;
      if (selector === '.usage-guide-toc') return toc;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-usage-guide-link]') return links;
      if (selector === '.usage-guide-section[id]') return sections;
      return [];
    },
  };
  const document = {
    documentElement: { scrollHeight: 2000 },
    getElementById: (id) =>
      id === 'otherUsageGuideFeature' ? panel : null,
  };
  const window = {
    innerHeight: 600,
    scrollY: 0,
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ flexDirection, top: tocTop }),
    requestAnimationFrame: (callback) => callback(),
    addEventListener(name, listener) {
      windowListeners.set(name, listener);
    },
  };
  const ResizeObserver = class {
    constructor(callback) {
      observers.push(callback);
    }

    observe() {}
  };

  return {
    document,
    panel,
    sectionTops,
    links,
    toc,
    window,
    ResizeObserver,
    triggerResize: () => observers.at(-1)?.(),
    get scrollOffset() {
      return panel.style['--usage-guide-scroll-offset'];
    },
    triggerScrollerScroll() {
      scrollerListeners.get('scroll')?.();
    },
    triggerWindowScroll() {
      windowListeners.get('scroll')?.();
    },
  };
}

async function loadUsageGuide(fixture) {
  const { initUsageGuide } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'usage-guide.js'),
    fixture,
  );
  initUsageGuide();
}

test('usage guide recalculates visible toc offset and skips hidden layout updates', async () => {
  const fixture = createUsageGuideFixture({ tocHeight: 72, tocTop: '8px' });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '92px');

  fixture.toc.height = 108;
  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '128px');

  const visibleReads = fixture.toc.reads;
  fixture.panel.hidden = true;
  fixture.toc.height = 180;
  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '128px');
  assert.equal(fixture.toc.reads, visibleReads);
});

test('usage guide keeps a compact offset for the vertical toc regardless of its height', async () => {
  const fixture = createUsageGuideFixture({
    flexDirection: 'column',
    tocHeight: 320,
    tocTop: '18px',
  });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '24px');

  fixture.toc.height = 640;
  fixture.triggerResize();
  assert.equal(fixture.scrollOffset, '24px');
});

test('usage guide desktop active section follows a resized toc in the internal scroller', async () => {
  const fixture = createUsageGuideFixture({
    tocHeight: 40,
    tocTop: '8px',
    scrollerTop: 100,
    sectionTops: [120, 210, 340],
    scrollerHeight: 400,
    scrollerScrollHeight: 1600,
  });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), true);
  assert.equal(fixture.links[1].classList.contains('active'), false);

  fixture.toc.height = 100;
  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), false);
  assert.equal(fixture.links[1].classList.contains('active'), true);
  fixture.sectionTops[1] = 300;
  fixture.triggerScrollerScroll();
  assert.equal(fixture.links[0].classList.contains('active'), true);
});

test('usage guide narrow-window active section follows a resized toc', async () => {
  const fixture = createUsageGuideFixture({
    tocHeight: 40,
    tocTop: '4px',
    scrollerTop: -200,
    sectionTops: [55, 100, 180],
    scrollerHeight: 600,
    scrollerScrollHeight: 600,
  });
  await loadUsageGuide(fixture);

  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), true);
  assert.equal(fixture.links[1].classList.contains('active'), false);

  fixture.toc.height = 90;
  fixture.triggerResize();
  assert.equal(fixture.links[0].classList.contains('active'), false);
  assert.equal(fixture.links[1].classList.contains('active'), true);
  fixture.sectionTops[1] = 140;
  fixture.triggerWindowScroll();
  assert.equal(fixture.links[0].classList.contains('active'), true);
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

test('song board defaults to a clear frosted glass theme', () => {
  const themeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const defaultsSource = fs.readFileSync(
    path.join(ROOT_DIR, 'src', 'storage', 'settings-defaults.js'),
    'utf8',
  );

  assert.match(defaultsSource, /themeOpacity: '0\.48'/);
  assert.match(defaultsSource, /backdropBlur: '14'/);
  assert.match(defaultsSource, /glowIntensity: '2'/);
  assert.match(themeSource, /if \(!Object\.keys\(defaultThemeLook\)\.length\)/);
  assert.match(
    themeSource,
    /const resetValues = \{\s*\.\.\.defaultThemeLook\s*\};/,
  );
  assert.match(
    themeSource,
    /bindRangePair\(\s*'backdropBlur',\s*'backdropBlurNumber',\s*0,\s*30,\s*14\s*\)/,
  );
  assert.match(
    themeSource,
    /bindRangePair\(\s*'glowIntensity',\s*'glowIntensityNumber',\s*0,\s*20,\s*2\s*\)/,
  );
});

test('gift workspace rows keep their content height inside the scroll container', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const giftWorkspaceRule = source.match(
    /\.gift-workspace\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(giftWorkspaceRule, 'gift workspace styles should remain defined');
  assert.match(
    giftWorkspaceRule,
    /grid-template-rows:\s*repeat\(7, max-content\)/,
  );
});

test('song workspace scrolls within the viewport above the player dock', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const songWorkspaceRule = source.match(
    /\.song-workspace\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const expandedRule = source.match(
    /body\.player-dock-expanded \.song-workspace\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(songWorkspaceRule, 'song workspace styles should remain defined');
  assert.ok(expandedRule, 'expanded player sizing should remain defined');
  assert.match(
    songWorkspaceRule,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
  assert.match(songWorkspaceRule, /overflow-y:\s*auto/);
  assert.match(
    expandedRule,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 218px\)\)/,
  );
});

test('player dock exposes a collapse handle and shares its height with route workspaces', () => {
  const html = readAdminHtml();
  const playerStyles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'),
    'utf8',
  );
  const playbackLayout = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'layout.css'),
    'utf8',
  );
  const adminWorkspace = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const otherWorkspace = readCssBundle(
    'public',
    'css',
    'admin',
    'other-features.css',
  );

  assert.match(
    html,
    /id="playerDockToggle"[^>]*aria-expanded="true"[^>]*aria-controls="playbackPlayerBody"/,
  );
  assert.match(
    html,
    /id="playbackPlayerBody" class="panel-body playback-player"/,
  );
  assert.match(playerStyles, /--player-dock-collapsed-height:\s*0px/);
  assert.match(playerStyles, /body\.player-dock-collapsed\s*\{/);
  assert.match(
    playerStyles,
    /\.playback-player-panel\.is-collapsed \.playback-player\s*\{/,
  );
  assert.match(
    playbackLayout,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
  assert.match(
    adminWorkspace,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
  assert.match(
    otherWorkspace,
    /height:\s*calc\(100vh - 58px - var\(--player-dock-height, 96px\)\)/,
  );
});

test('player dock starts collapsed and toggles open without opening fullscreen', async () => {
  const makeClassList = () => {
    const names = new Set();
    return {
      add(...values) {
        values.forEach((value) => names.add(value));
      },
      remove(...values) {
        values.forEach((value) => names.delete(value));
      },
      toggle(value, force) {
        const next = force === undefined ? !names.has(value) : force;
        if (next) names.add(value);
        else names.delete(value);
        return next;
      },
      contains(value) {
        return names.has(value);
      },
    };
  };
  const makeElement = () => {
    const listeners = new Map();
    const attributes = new Map();
    return {
      classList: makeClassList(),
      listeners,
      attributes,
      title: '',
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      setAttribute(name, value) {
        attributes.set(name, String(value));
      },
      getAttribute(name) {
        return attributes.get(name);
      },
      closest() {
        return null;
      },
    };
  };

  const playerPanel = makeElement();
  const fullscreen = makeElement();
  const dockToggle = makeElement();
  const playerBody = makeElement();
  const elements = {
    playerFullscreen: fullscreen,
    playerDockToggle: dockToggle,
    playbackPlayerBody: playerBody,
    playbackVolumePanel: makeElement(),
    playbackVolumeIcon: makeElement(),
    queuePopup: makeElement(),
    queuePopupBackdrop: makeElement(),
    playbackQueueBtn: makeElement(),
  };
  const body = { classList: makeClassList() };
  const document = {
    body,
    addEventListener() {},
    querySelector(selector) {
      return selector === '.playback-player-panel' ? playerPanel : null;
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const window = { AdminApp: {} };

  const { FormsService } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'forms.js'),
    { document, window },
  );
  const service = new FormsService();
  let fullscreenOpened = false;
  service.openFullscreenPlayer = () => {
    fullscreenOpened = true;
  };

  service.initWorkspaceControls();
  assert.equal(body.classList.contains('player-dock-collapsed'), true);
  assert.equal(playerPanel.classList.contains('is-collapsed'), true);
  assert.equal(playerBody.getAttribute('aria-hidden'), 'true');
  assert.equal(dockToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(dockToggle.getAttribute('aria-label'), '展开播放器');

  const panelClick = playerPanel.listeners.get('click');
  panelClick({
    target: {
      closest(selector) {
        return selector.includes('button') ? dockToggle : null;
      },
    },
  });
  assert.equal(fullscreenOpened, false);

  const dockClick = dockToggle.listeners.get('click');
  dockClick({ stopPropagation() {} });
  assert.equal(body.classList.contains('player-dock-collapsed'), false);
  assert.equal(playerPanel.classList.contains('is-collapsed'), false);
  assert.equal(playerBody.getAttribute('aria-hidden'), 'false');
  assert.equal(dockToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(dockToggle.getAttribute('aria-label'), '收起播放器');
});

test('queue panels remain the same height on desktop', () => {
  const workspaceSource = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const responsiveSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'),
    'utf8',
  );
  const queueRowRule = workspaceSource.match(
    /\.queues-row\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const responsiveQueueRule = responsiveSource.match(
    /@media \(max-width: 900px\) \{[\s\S]*?(\.queues-row\s*\{[\s\S]*?\n\s*\})/,
  )?.[1];
  const responsivePanelRule = responsiveSource.match(
    /\.queues-row \.sc-queue-panel,[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(queueRowRule, 'desktop queue row styles should remain defined');
  assert.ok(
    responsiveQueueRule,
    'responsive queue row styles should remain defined',
  );
  assert.ok(
    responsivePanelRule,
    'narrow-layout queue panel sizing should remain defined',
  );
  assert.match(queueRowRule, /flex:\s*0 0 450px/);
  assert.match(queueRowRule, /height:\s*450px/);
  assert.match(responsiveQueueRule, /flex:\s*0 0 auto/);
  assert.match(responsiveQueueRule, /height:\s*auto/);
  assert.match(responsivePanelRule, /height:\s*auto/);
});

test('admin queue cards have enough height for their text and metadata', () => {
  const source = readCssBundle('public', 'css', 'admin', 'workspace.css');
  const collapsibleSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'collapsible.css'),
    'utf8',
  );
  const queueListRule = source.match(
    /\.queues-row \.queue-panel \.queue-list\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const scListRule = source.match(
    /\.queues-row \.queue-panel \.sc-list\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const queueItemRule = source.match(
    /\.queues-row \.queue-panel \.queue-row\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const scRowRule = collapsibleSource.match(/\.sc-row\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(queueListRule, 'queue list styles should remain defined');
  assert.ok(scListRule, 'SC queue list styles should remain defined');
  assert.ok(queueItemRule, 'queue item styles should remain defined');
  assert.ok(scRowRule, 'SC queue item styles should remain defined');
  assert.match(queueListRule, /grid-auto-rows:\s*76px/);
  assert.match(scListRule, /grid-auto-rows:\s*82px/);
  assert.match(queueListRule, /align-content:\s*start/);
  assert.match(queueItemRule, /min-height:\s*0/);
  assert.match(queueItemRule, /overflow:\s*hidden/);
  assert.match(scRowRule, /align-items:\s*center/);
});

test('assisted super chat cards keep a single status color on hover', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'collapsible.css'),
    'utf8',
  );
  const assistedHoverRule = source.match(
    /\.sc-row\.assisted:hover::before\s*\{[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(
    assistedHoverRule,
    'assisted SC hover override should remain defined',
  );
  assert.match(assistedHoverRule, /opacity:\s*0/);
});

test('admin queue wheel scrolls overflowing lists and releases the page at their edges', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue.js'),
    'utf8',
  );
  const makeTarget = () => ({
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
  });
  const superChatPanel = makeTarget();
  const queuePanel = makeTarget();
  const superChatList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => superChatPanel,
  };
  const queueList = {
    clientHeight: 100,
    scrollHeight: 100,
    scrollTop: 0,
    closest: () => queuePanel,
  };
  const elements = {
    nextBtn: makeTarget(),
    clearBtn: makeTarget(),
    superChatList,
    queueList,
  };
  const sandbox = {
    console,
    confirm: () => false,
    document: { getElementById: (id) => elements[id] || null },
    window: {
      AdminApp: {
        utils: {
          escapeHtml: String,
          escapeAttr: String,
          value: () => '',
          setValue() {},
          formatTime: String,
          formatSuperChatPrice: String,
          withMultilingualFallback: String,
          toast() {},
          api: async () => ({}),
        },
      },
    },
  };

  vm.runInNewContext(source, sandbox);
  sandbox.window.AdminApp.queue.initQueueForm();
  const wheel = superChatPanel.listeners.get('wheel');
  const dispatchWheel = (deltaY) => {
    let prevented = false;
    wheel({
      deltaY,
      deltaMode: 0,
      preventDefault() {
        prevented = true;
      },
    });
    return prevented;
  };

  assert.equal(
    dispatchWheel(120),
    false,
    'a non-overflowing queue should leave page scrolling alone',
  );
  superChatList.scrollHeight = 300;
  assert.equal(
    dispatchWheel(120),
    true,
    'an overflowing queue should consume downward wheel input',
  );
  assert.equal(superChatList.scrollTop, 36);
  superChatList.scrollTop = 200;
  assert.equal(
    dispatchWheel(120),
    false,
    'the bottom edge should release downward input to the page',
  );
  assert.equal(
    dispatchWheel(-120),
    true,
    'the list should still consume input away from the bottom edge',
  );
  superChatList.scrollTop = 0;
  assert.equal(
    dispatchWheel(-120),
    false,
    'the top edge should release upward input to the page',
  );
});

test('desktop admin keeps scrolling on the workspace instead of nesting it in tabs', () => {
  const workspaceSource = readCssBundle(
    'public',
    'css',
    'admin',
    'workspace.css',
  );
  const responsiveSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'responsive.css'),
    'utf8',
  );
  const activeTabRule = workspaceSource.match(
    /\.song-management-panel > \.tab-page\.active\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const desktopBodyRule = responsiveSource.match(
    /@media \(min-width: 901px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/,
  )?.[0];
  const mobileBodyRule = responsiveSource.match(
    /@media \(max-width: 900px\)[\s\S]*?body\s*\{[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(
    activeTabRule,
    'active management tab styles should remain defined',
  );
  assert.ok(
    desktopBodyRule,
    'desktop body overflow rule should remain defined',
  );
  assert.ok(mobileBodyRule, 'mobile body overflow rule should remain defined');
  assert.match(activeTabRule, /overflow:\s*visible/);
  assert.match(desktopBodyRule, /overflow:\s*hidden/);
  assert.match(mobileBodyRule, /overflow:\s*auto/);
});

test('hidden switches and the narrow player do not widen the page', () => {
  const adminSource = readCssBundle('public', 'css', 'admin', 'toasts.css');
  const playbackSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'responsive.css'),
    'utf8',
  );
  const switchInputRule = adminSource.match(
    /\.switch-control input\s*\{[\s\S]*?\n\}/,
  )?.[0];
  const narrowPlayerRule = playbackSource.match(
    /@media \(max-width: 900px\)[\s\S]*?\.playback-progress-row\s*\{[\s\S]*?\n\s*\}/,
  )?.[0];

  assert.ok(switchInputRule, 'switch input styles should remain defined');
  assert.ok(
    narrowPlayerRule,
    'narrow player progress styles should remain defined',
  );
  assert.match(switchInputRule, /width:\s*1px/);
  assert.match(switchInputRule, /height:\s*1px/);
  assert.match(narrowPlayerRule, /width:\s*auto/);
  assert.match(narrowPlayerRule, /padding-left:\s*0/);
});

test('playback labels scroll independently without resizing the progress slot', async () => {
  const html = readAdminHtml();
  const styles = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'css', 'playback', 'player.css'),
    'utf8',
  );
  const nowPlayingRule = styles.match(/\.playback-now\s*\{[\s\S]*?\n\}/)?.[0];

  assert.ok(nowPlayingRule, 'now-playing layout styles should remain defined');
  assert.match(
    nowPlayingRule,
    /grid-template-columns:\s*minmax\(0, 180px\) minmax\(520px, 1fr\)/,
  );
  assert.match(html, /id="playbackTrackTitle" class="playback-marquee"/);
  assert.match(html, /id="playbackTrackArtist" class="playback-marquee"/);

  const { PlaybackBar } = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'playback', 'ui', 'playback-bar.js'),
  );
  const player = new PlaybackBar();
  const classes = new Set();
  let animationKeyframes = null;
  let animationOptions = null;
  let cancelled = false;
  const animation = {
    cancel() {
      cancelled = true;
    },
  };
  const textElement = {
    scrollWidth: 260,
    animate(keyframes, options) {
      animationKeyframes = keyframes;
      animationOptions = options;
      return animation;
    },
  };
  const element = {
    clientWidth: 100,
    querySelector() {
      return textElement;
    },
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
    },
  };

  player.updateMarquee(element);

  assert.equal(classes.has('is-scrolling'), true);
  assert.equal(animationKeyframes[0].transform, 'translateX(0)');
  assert.equal(animationKeyframes[2].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[3].transform, 'translateX(-160px)');
  assert.equal(animationKeyframes[4].transform, 'translateX(0)');
  assert.equal(
    Math.round(
      (animationKeyframes[1].offset - animationKeyframes[0].offset) *
        animationOptions.duration,
    ),
    1000,
  );
  assert.equal(
    Math.round(
      (animationKeyframes[3].offset - animationKeyframes[2].offset) *
        animationOptions.duration,
    ),
    1000,
  );

  element.clientWidth = 300;
  player.updateMarquee(element);
  assert.equal(cancelled, true);
  assert.equal(classes.has('is-scrolling'), false);
});

test('admin state events render queue empty states and song data', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );

  assert.match(source, /eventBus\.on\(Events\.STATE_LOADED/);
  assert.match(
    source,
    /getLegacyAdminModules\(\)\.queue\?\.renderState\?\.\(state, songs\)/,
  );
  assert.match(source, /eventBus\.on\(Events\.SONG_UPDATED/);
  assert.match(
    source,
    /getLegacyAdminModules\(\)\s*\.\s*songs\s*\?\.\s*renderSongs\s*\?\.\s*\(\s*songs\s*,\s*languages\s*,\s*artists\s*,\s*tags\s*,?\s*\)/,
  );
});

test('overtime picker keeps the room catalog primary when the global cache updates', () => {
  const stateSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'),
    'utf8',
  );
  const overtimeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'),
    'utf8',
  );
  const html = readAdminHtml();

  assert.match(stateSource, /payload\.type === ["']gift-catalog:update["']/);
  assert.match(stateSource, /Events\.GIFT_CATALOG_UPDATED/);
  assert.match(overtimeSource, /eventBus\.on\(Events\.GIFT_CATALOG_UPDATED/);
  assert.match(
    overtimeSource,
    /requestGeneration !== giftCatalogApplyGeneration/,
  );
  assert.match(
    overtimeSource,
    /snapshot\?\.source === ["']server["'][\s\S]*applyServerGiftArtwork\(snapshot\)/,
  );
  assert.match(overtimeSource, /function applyServerGiftArtwork\(snapshot\)/);
  assert.match(overtimeSource, /serverGiftArtworkById\.get\(gift\.id\)/);
  assert.match(
    overtimeSource,
    /globalGiftMatches = globalGiftMatches\.map\(\(gift\) => \{[\s\S]*?serverGiftArtworkById\.get\(gift\.id\)/,
  );
  assert.match(overtimeSource, /function decorateOvertimeRules\(rules\)/);
  assert.match(
    overtimeSource,
    /renderRules: \(rules\) =>\s*ruleEditor\.renderRules\(decorateOvertimeRules\(rules\)\)/,
  );
  assert.match(overtimeSource, /row\.dataset\.imagePath = imagePath/);
  assert.match(stateSource, /assetsUpdatedAt: String\(snapshot\.assetsUpdatedAt/);
  assert.match(
    overtimeSource,
    /function openGiftPicker\(\)[\s\S]*refreshGiftCatalog\(\{ notify: false \}\)/,
  );
  assert.match(overtimeSource, /if \(picker\?\.open\) renderGiftPicker\(\)/);
  assert.match(overtimeSource, /全部礼物中没有匹配项/);
  assert.match(overtimeSource, /没有找到当前在售礼物/);
  assert.match(
    html,
    /id="overtimeGiftCatalogStatus"[^>]*>\s*在售目录：未刷新\s*<\/span\s*>/,
  );
  assert.match(
    html,
    /id="overtimeRefreshGiftsBtn"[^>]*>\s*刷新在售礼物\s*<\/button>/,
  );
});

test('admin initialization waits for sibling module scripts at interactive ready state', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );

  assert.match(source, /document\.readyState === 'complete'/);
  assert.match(
    source,
    /document\.addEventListener\('DOMContentLoaded', initApp, \{ once: true \}\)/,
  );
});

test('admin state loading avoids duplicate state requests and filters song reloads by snapshot reason', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'),
    'utf8',
  );
  assert.match(source, /await this\.reloadSongs\(\{ reloadState: false \}\);/);
  assert.match(
    source,
    /if \(options\.reloadState !== false\) \{\s*await this\.reloadState\(\);/,
  );
  assert.match(
    source,
    /if \(isSongsSnapshotReason\(payload\.reason\)\) \{\s*this\.scheduleSongReload\(\);/,
  );
  assert.match(source, /function isSongsSnapshotReason\(reason\)/);
});

test('admin idle timers are lifecycle-bound', () => {
  const overtime = ['overtime.js', 'overtime-status-view.js']
    .map((file) =>
      fs.readFileSync(
        path.join(ROOT_DIR, 'public', 'js', 'admin', file),
        'utf8',
      ),
    )
    .join('\n');
  const games = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'),
    'utf8',
  );
  assert.match(
    overtime,
    /document\.addEventListener\(["']visibilitychange["'], syncClockLoop\)/,
  );
  assert.match(overtime, /cancelAnimationFrame\(clockRafId\)/);
  assert.match(games, /let drawClockTimer = null;/);
  assert.match(games, /function syncDrawClockTimer\(\)/);
  assert.doesNotMatch(
    games,
    /setInterval\(updateDrawClock, 250\);\s*Promise\.all/,
  );
});

test('blind-box statistics are not reloaded for every state render', () => {
  const queue = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue.js'),
    'utf8',
  );
  const blindbox = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'),
    'utf8',
  );
  assert.doesNotMatch(queue, /loadBlindBoxStats\(\)/);
  assert.match(
    blindbox,
    /if \(!statsInitialized\) \{[\s\S]*?loadBlindBoxStats\(\);/,
  );
});

test('admin loads theme presets before initializing theme forms', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );
  const loadPosition = source.indexOf('await Theme.loadThemeConfig()');
  const themeFormPosition = source.indexOf('modules.theme?.initThemeForm?.()');
  const displayFormPosition = source.indexOf(
    'modules.display.initDisplayForm()',
  );

  assert.ok(loadPosition >= 0, 'theme configuration should be loaded');
  assert.ok(
    loadPosition < themeFormPosition,
    'theme presets should load before the theme form',
  );
  assert.ok(
    loadPosition < displayFormPosition,
    'theme presets should load before the display form',
  );
});

test('song request and display board forms autosave every parameter change', () => {
  const themeSource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'theme.js'),
    'utf8',
  );
  const displaySource = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'),
    'utf8',
  );

  assert.match(
    themeSource,
    /themeForm\.addEventListener\('input', scheduleThemeAutosave\)/,
  );
  assert.match(
    themeSource,
    /themeForm\.addEventListener\('change', scheduleThemeAutosave\)/,
  );
  assert.match(
    themeSource,
    /autosaveTheme\(normalizePersistedQueueStyle\(value\('overlayQueueStyle'\)\)\)/,
  );
  assert.match(
    displaySource,
    /displayForm\.addEventListener\('input', autosaveDisplay\)/,
  );
  assert.match(
    displaySource,
    /displayForm\.addEventListener\('change', autosaveDisplay\)/,
  );
  assert.match(displaySource, /await copyText\(url\)/);
  assert.doesNotMatch(displaySource, /navigator\.clipboard\.writeText\(url\)/);

  assert.match(themeSource, /classicPresets[\s\S]*?await saveTheme\(\)/);
  assert.match(themeSource, /quickBeautifyBtn[\s\S]*?await saveTheme\(\)/);
  assert.match(themeSource, /resetClassicTheme[\s\S]*?await saveTheme\(\)/);
  assert.match(displaySource, /songBoardPresets[\s\S]*?await saveDisplay\(\)/);
  assert.match(
    displaySource,
    /songBoardResetTheme[\s\S]*?await saveDisplay\(\)/,
  );
  assert.doesNotMatch(themeSource, /保存后生效/);
  assert.doesNotMatch(displaySource, /保存后生效/);
});

test('early theme preset references receive asynchronously loaded data', async () => {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(ROOT_DIR, 'public', 'data', 'theme-presets.json'),
      'utf8',
    ),
  );
  const browserWindow = { AdminApp: {} };
  const themeModule = await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'),
    {
      window: browserWindow,
      fetch: async () => ({ ok: true, json: async () => config }),
    },
  );
  const earlyClassicPresets = themeModule.getAllClassicPresets();
  const earlySongBoardPresets = themeModule.getAllSongBoardPresets();

  assert.deepEqual(Object.keys(earlyClassicPresets), []);
  await themeModule.loadThemeConfig();
  assert.equal(themeModule.getAllClassicPresets(), earlyClassicPresets);
  assert.equal(themeModule.getAllSongBoardPresets(), earlySongBoardPresets);
  assert.equal(Object.keys(earlyClassicPresets).length, 14);
  assert.equal(Object.keys(earlySongBoardPresets).length, 14);
});

test('tracked theme defaults match first-run storage defaults', () => {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(ROOT_DIR, 'public', 'data', 'theme-presets.json'),
      'utf8',
    ),
  );

  for (const key of [
    'themePrimary',
    'themeAccent',
    'themeText',
    'themeBackground',
    'themeOpacity',
    'themeRadius',
  ]) {
    assert.equal(
      config.default[key],
      DEFAULT_SETTINGS[key],
      `${key} should have one default value`,
    );
  }
});

test('shared theme compatibility keeps admin theme form methods', async () => {
  const initThemeForm = () => {};
  const browserWindow = { AdminApp: { theme: { initThemeForm } } };

  await loadModuleExports(
    path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'),
    { window: browserWindow },
  );

  assert.equal(browserWindow.AdminApp.theme.initThemeForm, initThemeForm);
  assert.equal(typeof browserWindow.AdminApp.theme.loadThemeConfig, 'function');
  const defaultThemeDescriptor = Object.getOwnPropertyDescriptor(
    browserWindow.AdminApp.theme,
    'defaultThemeLook',
  );
  assert.equal(typeof defaultThemeDescriptor.get, 'function');
});
