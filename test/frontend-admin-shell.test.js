'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');

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
    path.join(ROOT_DIR, 'public', 'css', 'admin', 'toasts', 'live.css'),
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
      new RegExp(
        `<div class="queue-heading">(?:(?!</div>)[\\s\\S])*id="${counterId}"`,
      ),
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

  assert.ok(
    baseQueueRule,
    'default desktop queue sizing should remain defined',
  );
  assert.match(baseQueueRule, /--queue-height:\s*clamp\(280px,\s*calc\(\(100vh - 58px - var\(--player-dock-height, 96px\)\) \* 0\.48\),\s*380px\)/);
  assert.match(baseQueueRule, /height:\s*var\(--queue-height\)/);
  assert.match(baseQueueRule, /flex:\s*0 0 var\(--queue-height\)/);
  assert.doesNotMatch(responsiveSource, /height:\s*418px/);
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
  const lyric = readCssBundle('public/css/admin/desktop-lyric-preview.css');
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
    path.join(ROOT_DIR, 'public', 'pages', 'admin', 'toolbox', 'settings.html'),
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
