'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { loadModuleExports } = require('../helpers/frontend-modules');

let tour;
test.before(async () => {
  tour = await loadModuleExports(path.join(__dirname, '../..', 'public', 'js', 'admin', 'interactive-tour.js'), {
    window: {},
  });
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
  assert.equal(freshStorage.getItem(tour.TOUR_FIRST_RUN_SHOWN_KEY), '1');
  assert.equal(tour.claimFirstRunTour(freshStorage), false);
});

test('tour version changes do not reopen it for existing installations', () => {
  const legacyCompletion = createStorage({ liraTourCompleted: '' });
  const oldCompletion = createStorage({ liraTourCompleted: '1' });
  const currentCompletion = createStorage({
    liraTourCompleted: String(tour.TOUR_VERSION),
  });

  assert.equal(tour.claimFirstRunTour(legacyCompletion), false);
  assert.equal(tour.claimFirstRunTour(oldCompletion), false);
  assert.equal(tour.claimFirstRunTour(currentCompletion), false);
});

test('manual tour reset does not clear first-run display history', () => {
  const js = fs.readFileSync(path.join(__dirname, '../..', 'public', 'js', 'admin', 'interactive-tour.js'), 'utf8');
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
    { width: 1600, height: 900 },
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
    { width: 1200, height: 900 },
  );

  assert.equal(position.position, 'top');
  assert.equal(position.left, 370);
  assert.equal(position.top, 478);
});

test('tour tooltip uses the viewport center only for steps without a target', () => {
  const position = tour.calculateTooltipPosition(null, 380, 250, 'center', {
    width: 1000,
    height: 600,
  });

  assert.equal(position.position, 'center');
  assert.equal(position.top, 175);
  assert.equal(position.left, 310);
  assert.equal(position.arrowOffset, null);
});

test('tour styles leave the spotlight interior interactive and point the arrow at its target', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../..', 'public', 'css', 'admin', 'toolbox', 'interactive-tour.css'),
    'utf8',
  );
  const backdropRule = css.match(/\.lira-tour-backdrop\s*\{[\s\S]*?\n\}/)?.[0];
  const targetBackdropRule = css.match(/\.lira-tour\.has-target \.lira-tour-backdrop\s*\{[\s\S]*?\n\}/)?.[0];

  assert.match(backdropRule, /pointer-events:\s*none/);
  assert.match(targetBackdropRule, /display:\s*none/);
  assert.match(css, /--tour-arrow-offset/);
});

test('tour avoids continuously expensive rendering effects and polling', () => {
  const js = fs.readFileSync(path.join(__dirname, '../..', 'public', 'js', 'admin', 'interactive-tour.js'), 'utf8');
  const css = fs.readFileSync(
    path.join(__dirname, '../..', 'public', 'css', 'admin', 'toolbox', 'interactive-tour.css'),
    'utf8',
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
  assert.match(
    js,
    /addEventListener\(["']scroll["'],\s*scheduleRefresh,\s*\{\s*capture: true,\s*passive: true,?\s*\}\)/,
  );
});

test('tour has unique steps between its introduction and completion', () => {
  const actionSteps = tour.TOUR_STEPS.filter((step) => !['welcome', 'complete'].includes(step.id));

  assert.equal(new Set(tour.TOUR_STEPS.map((step) => step.id)).size, tour.TOUR_STEPS.length);
  assert.equal(tour.TOUR_STEPS[0].id, 'welcome');
  assert.equal(tour.TOUR_STEPS.at(-1).id, 'complete');
  assert.ok(actionSteps.every((step) => step.content?.trim()));
  assert.equal(actionSteps[0].targetSelector, '.main-page-tabs');
});

test('refresh step spotlights the live-room status together with the refresh button', () => {
  const refreshStep = tour.TOUR_STEPS.find((step) => step.id === 'refresh-live');
  const js = fs.readFileSync(path.join(__dirname, '../..', 'public', 'js', 'admin', 'interactive-tour.js'), 'utf8');

  assert.equal(refreshStep.targetSelector, '#liveStatus, #reconnectBtn');
  assert.match(js, /document\.querySelectorAll\(selector\)/);
});

test('tour waits for the saved room and an actually connected live status', async () => {
  const window = {};
  const roomInput = { value: '12345' };
  let liveClass = '';
  const liveStatus = { classList: { contains: (name) => name === liveClass } };
  const config = await loadModuleExports(
    path.join(__dirname, '../..', 'public/js/admin/interactive-tour-config.js'),
    {
      window,
      document: { getElementById: (id) => id === 'roomId' ? roomInput : liveStatus },
      fetch: async () => ({ json: async () => ({ ok: true, data: { settings: { roomId: '12345' } } }) }),
    },
  );
  const roomStep = config.TOUR_CONFIG_STEPS.find((step) => step.id === 'room-id');
  const liveStep = config.TOUR_CONFIG_STEPS.find((step) => step.id === 'refresh-live');
  assert.equal(roomStep.checkCompleted(), false);
  await window.AdminApp.state.reloadState();
  assert.equal(roomStep.checkCompleted(), true);
  roomInput.value = '67890';
  assert.equal(roomStep.checkCompleted(), false);
  for (const status of ['', 'warn', 'good']) {
    liveClass = status;
    assert.equal(liveStep.checkCompleted(), status === 'good');
  }
});

test('tour uses an accessible styled exit confirmation instead of the native dialog', () => {
  const js = fs.readFileSync(path.join(__dirname, '../..', 'public', 'js', 'admin', 'interactive-tour.js'), 'utf8');
  const css = fs.readFileSync(
    path.join(__dirname, '../..', 'public', 'css', 'admin', 'toolbox', 'interactive-tour.css'),
    'utf8',
  );

  assert.doesNotMatch(js, /\bconfirm\s*\(/);
  assert.match(js, /class="lira-tour-exit-dialog"/);
  assert.match(js, /role="dialog"/);
  assert.match(js, /aria-modal="true"/);
  assert.match(js, /event\.key === ["']Escape["']/);
  assert.match(js, /event\.key !== ["']Tab["']/);
  assert.match(js, /container\.classList\.add\(["']is-exit-confirming["']\)/);
  assert.match(js, /container\.classList\.remove\(["']is-exit-confirming["']\)/);
  assert.match(css, /\.lira-tour-exit-confirmation\s*\{/);
  assert.match(css, /\.lira-tour\.is-exit-confirming \.lira-tour-tooltip/);
  assert.match(css, /\.lira-tour-exit-actions button:focus-visible/);
});

test('Bilibili setup steps target the real settings tab', () => {
  const loginStep = tour.TOUR_STEPS.find((step) => step.id === 'bilibili-login');
  const roomStep = tour.TOUR_STEPS.find((step) => step.id === 'room-id');
  const settingsPage = fs.readFileSync(
    path.join(__dirname, '../..', 'public', 'pages', 'admin', 'song', 'settings.html'),
    'utf8',
  );

  assert.equal(loginStep.targetTab, '[data-tab="settingsPage"]');
  assert.equal(roomStep.targetTab, '[data-tab="settingsPage"]');
  assert.equal(loginStep.targetSelector, '.bilibili-auth-row');
  assert.match(settingsPage, /class="bilibili-auth-row"/);
  assert.equal(roomStep.targetSelector, '#roomId');
  assert.match(settingsPage, /id="roomId"/);
});

test('song import step opens the import tab and points at the file input', () => {
  const importStep = tour.TOUR_STEPS.find((step) => step.id === 'import-songs');

  assert.equal(importStep.targetTab, '[data-tab="importPage"]');
  assert.equal(importStep.targetSelector, '#importFile');
  assert.equal(importStep.waitForAction, false);
});

test('music setup step targets the real playback source switcher', () => {
  const musicStep = tour.TOUR_STEPS.find((step) => step.id === 'music-platform');
  const playbackPage = fs.readFileSync(
    path.join(__dirname, '../..', 'public', 'pages', 'admin', 'playback', 'page.html'),
    'utf8',
  );

  assert.equal(musicStep.targetSelector, '.source-tabs');
  assert.equal(musicStep.position, 'bottom');
  assert.match(playbackPage, /class="source-tabs"/);
});

test('usage guide step opens and points to the real toolbox document button', () => {
  const usageStep = tour.TOUR_STEPS.find((step) => step.id === 'usage-guide');
  const toolboxShell = fs.readFileSync(
    path.join(__dirname, '../..', 'public', 'pages', 'admin', 'toolbox', 'shell-start.html'),
    'utf8',
  );

  assert.equal(usageStep.targetTab, '[data-other-feature="otherUsageGuideFeature"]');
  assert.equal(usageStep.targetSelector, '[data-other-feature="otherUsageGuideFeature"]');
  assert.match(toolboxShell, /data-other-feature="otherUsageGuideFeature"/);
});
