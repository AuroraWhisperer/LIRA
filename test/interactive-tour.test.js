'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('./helpers/frontend-modules');

let tour;
test.before(async () => {
  tour = await loadModuleExports(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    { window: {} }
  );
});

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test('tour auto-opens only once for a fresh installation profile', () => {
  const freshStorage = createStorage();

  assert.equal(tour.claimFirstRunTour(freshStorage), true);
  assert.equal(
    freshStorage.getItem(tour.TOUR_FIRST_RUN_SHOWN_KEY),
    '1'
  );
  assert.equal(tour.claimFirstRunTour(freshStorage), false);
});

test('tour version changes do not reopen it for existing installations', () => {
  const legacyCompletion = createStorage({ liraTourCompleted: '' });
  const oldCompletion = createStorage({ liraTourCompleted: '1' });
  const currentCompletion = createStorage({ liraTourCompleted: String(tour.TOUR_VERSION) });

  assert.equal(tour.claimFirstRunTour(legacyCompletion), false);
  assert.equal(tour.claimFirstRunTour(oldCompletion), false);
  assert.equal(tour.claimFirstRunTour(currentCompletion), false);
});

test('manual tour reset does not clear first-run display history', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    'utf8'
  );
  const resetBody = js.match(/reset:\s*\(\)\s*=>\s*\{([\s\S]*?)\n\s*\},/)?.[1];

  assert.ok(resetBody, 'tour reset implementation should remain defined');
  assert.doesNotMatch(resetBody, /removeItem\s*\(/);
  assert.match(resetBody, /open\(\)/);
});

test('tour tooltip stays beside a right-edge target by clamping its horizontal position', () => {
  const position = tour.calculateTooltipPosition(
    { top: 20, left: 1480, right: 1560, bottom: 60, width: 80, height: 40 },
    380,
    250,
    'bottom',
    { width: 1600, height: 900 }
  );

  assert.equal(position.position, 'bottom');
  assert.equal(position.left, 1204);
  assert.equal(position.top, 72);
  assert.equal(position.arrowOffset, 316);
});

test('tour tooltip flips to an available side instead of falling back to the viewport center', () => {
  const position = tour.calculateTooltipPosition(
    { top: 740, left: 500, right: 620, bottom: 780, width: 120, height: 40 },
    380,
    250,
    'bottom',
    { width: 1200, height: 900 }
  );

  assert.equal(position.position, 'top');
  assert.equal(position.left, 370);
  assert.equal(position.top, 478);
});

test('tour tooltip uses the viewport center only for steps without a target', () => {
  const position = tour.calculateTooltipPosition(
    null,
    380,
    250,
    'center',
    { width: 1000, height: 600 }
  );

  assert.equal(position.position, 'center');
  assert.equal(position.top, 175);
  assert.equal(position.left, 310);
  assert.equal(position.arrowOffset, null);
});

test('tour styles leave the spotlight interior interactive and point the arrow at its target', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
    'utf8'
  );
  const backdropRule = css.match(/\.lira-tour-backdrop\s*\{[\s\S]*?\n\}/)?.[0];
  const targetBackdropRule = css.match(/\.lira-tour\.has-target \.lira-tour-backdrop\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(backdropRule, /pointer-events:\s*none/);
  assert.match(targetBackdropRule, /display:\s*none/);
  assert.match(css, /--tour-arrow-offset/);
});

test('tour avoids continuously expensive rendering effects and polling', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
    'utf8'
  );

  assert.ok(tour.TOUR_COMPLETION_CHECK_INTERVAL_MS >= 1000);
  assert.doesNotMatch(css, /backdrop-filter/i);
  assert.doesNotMatch(css, /9999px/);
  assert.doesNotMatch(css, /animation\s*:/i);
  assert.equal((js.match(/lira-tour-shade lira-tour-shade-/g) || []).length, 4);
  assert.doesNotMatch(js, /setInterval\s*\(/);
  assert.doesNotMatch(js, /setTimeout\(resolve, 300\)/);
  assert.doesNotMatch(js, /setTimeout\(resolve, 200\)/);
  assert.match(js, /window\.requestAnimationFrame\(resolve\)/);
  assert.match(js, /renderSequence/);
  assert.match(js, /addEventListener\('scroll', scheduleRefresh, \{ capture: true, passive: true \}\)/);
});

test('tour introduces LIRA and the four primary buttons before seven sequential actions', () => {
  const actionSteps = tour.TOUR_STEPS.filter(step => !['welcome', 'complete'].includes(step.id));

  assert.equal(tour.TOUR_VERSION, 6);
  assert.equal(tour.TOUR_STEPS[0].kicker, '第 0 步 · 认识 LIRA');
  assert.match(tour.TOUR_STEPS[0].content, /Live Interactive Request Assistant/);
  assert.match(tour.TOUR_STEPS[0].content, /直播互动点歌助手/);
  assert.deepEqual(Array.from(actionSteps, step => step.kicker), [
    '第 1 步 · 认识主功能',
    '第 2 步 · 登录账号',
    '第 3 步 · 填写直播间',
    '第 4 步 · 刷新连接',
    '第 5 步 · 导入歌单',
    '第 6 步 · 选择音乐',
    '第 7 步 · 查看帮助',
  ]);
  assert.match(actionSteps[0].content, /点歌/);
  assert.match(actionSteps[0].content, /播放/);
  assert.match(actionSteps[0].content, /礼物/);
  assert.match(actionSteps[0].content, /百宝箱/);
  assert.equal(actionSteps[0].targetSelector, '.main-page-tabs');
  assert.match(actionSteps[1].content, /用手机 Bilibili 扫描/);
  assert.match(actionSteps[2].note, /live\.bilibili\.com\/123456/);
  assert.match(actionSteps[3].content, /页面右上角/);
  assert.match(actionSteps[4].note, /暂时没有歌单也没关系/);
  assert.match(actionSteps[5].content, /全民 K 歌客户端/);
  assert.match(actionSteps[6].note, /重新打开交互式引导/);
});

test('refresh step spotlights the live-room status together with the refresh button', () => {
  const refreshStep = tour.TOUR_STEPS.find(step => step.id === 'refresh-live');
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    'utf8'
  );

  assert.equal(refreshStep.targetSelector, '#liveStatus, #reconnectBtn');
  assert.match(refreshStep.content, /一起框选/);
  assert.match(js, /document\.querySelectorAll\(selector\)/);
});

test('disabled tour actions use an unavailable cursor instead of a busy cursor', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
    'utf8'
  );
  const disabledRule = css.match(/\.lira-tour-actions button:disabled\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(disabledRule, /cursor:\s*not-allowed/);
  assert.doesNotMatch(disabledRule, /cursor:\s*wait/);
});

test('tour status circles carry waiting and completed meanings without an image asset', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
    'utf8'
  );
  const waitingIconRule = css.match(/\.lira-tour-status\.waiting::before\s*\{[\s\S]*?\n\}/)?.[0];
  const completedIconRule = css.match(/\.lira-tour-status\.completed::before\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(waitingIconRule, /content:\s*"…"/);
  assert.match(completedIconRule, /content:\s*"✓"/);
  assert.match(completedIconRule, /opacity:\s*1/);
  assert.match(js, /请按上面的提示完成这一步/);
  assert.match(js, /这一步已完成，可以点击「下一步」/);
  assert.doesNotMatch(js, /✓ 完成！可以继续下一步了/);
});

test('tour uses an accessible styled exit confirmation instead of the native dialog', () => {
  const js = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'admin', 'interactive-tour.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'css', 'admin', 'other-features', 'interactive-tour.css'),
    'utf8'
  );

  assert.doesNotMatch(js, /\bconfirm\s*\(/);
  assert.match(js, /class="lira-tour-exit-dialog"/);
  assert.match(js, /role="dialog"/);
  assert.match(js, /aria-modal="true"/);
  assert.match(js, /event\.key === 'Escape'/);
  assert.match(js, /event\.key !== 'Tab'/);
  assert.match(js, /container\.classList\.add\('is-exit-confirming'\)/);
  assert.match(js, /container\.classList\.remove\('is-exit-confirming'\)/);
  assert.match(css, /\.lira-tour-exit-confirmation\s*\{/);
  assert.match(css, /\.lira-tour\.is-exit-confirming \.lira-tour-tooltip/);
  assert.match(css, /\.lira-tour-exit-actions button:focus-visible/);
});

test('Bilibili setup steps target the real settings tab', () => {
  const loginStep = tour.TOUR_STEPS.find(step => step.id === 'bilibili-login');
  const roomStep = tour.TOUR_STEPS.find(step => step.id === 'room-id');
  const settingsPage = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'pages', 'admin', 'song', 'settings.html'),
    'utf8'
  );

  assert.equal(loginStep.targetTab, '[data-tab="settingsPage"]');
  assert.equal(roomStep.targetTab, '[data-tab="settingsPage"]');
  assert.equal(loginStep.targetSelector, '.bilibili-auth-row');
  assert.match(settingsPage, /class="bilibili-auth-row"/);
  assert.equal(roomStep.targetSelector, '#roomId');
  assert.match(settingsPage, /id="roomId"/);
});

test('song import step opens the import tab and points at the file input', () => {
  const importStep = tour.TOUR_STEPS.find(step => step.id === 'import-songs');

  assert.equal(importStep.targetTab, '[data-tab="importPage"]');
  assert.equal(importStep.targetSelector, '#importFile');
  assert.equal(importStep.waitForAction, false);
  assert.match(importStep.content, /现在已打开/);
  assert.match(importStep.content, /Excel（\.xlsx）/);
});

test('music setup step targets the real playback source switcher', () => {
  const musicStep = tour.TOUR_STEPS.find(step => step.id === 'music-platform');
  const playbackPage = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'pages', 'admin', 'playback', 'page.html'),
    'utf8'
  );

  assert.equal(musicStep.targetSelector, '.source-tabs');
  assert.equal(musicStep.position, 'bottom');
  assert.match(playbackPage, /class="source-tabs"/);
  assert.match(musicStep.content, /选择你平时使用的平台/);
  assert.match(musicStep.content, /点击右上方的「登录」/);
});

test('usage guide step opens and points to the real toolbox document button', () => {
  const usageStep = tour.TOUR_STEPS.find(step => step.id === 'usage-guide');
  const toolboxShell = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'pages', 'admin', 'toolbox', 'shell-start.html'),
    'utf8'
  );

  assert.equal(usageStep.targetTab, '[data-other-feature="otherUsageGuideFeature"]');
  assert.equal(usageStep.targetSelector, '[data-other-feature="otherUsageGuideFeature"]');
  assert.match(toolboxShell, /data-other-feature="otherUsageGuideFeature"/);
  assert.match(usageStep.content, /忘记怎么登录、导入歌单或设置其他功能/);
  assert.match(usageStep.note, /重新打开交互式引导/);
});
