'use strict';

const { readAdminHtml } = require('../helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../../src/storage/settings-store');
const { loadModuleExports } = require('../helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '../..');

test('admin state events render queue empty states and song data', () => {
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'), 'utf8');

  assert.match(source, /eventBus\.on\(\s*Events\.STATE_LOADED/);
  assert.match(source, /eventBus\.on\(\s*Events\.STATE_LOADED,\s*createAdminStateRenderer\(\{\s*renderGifts:/);
  assert.match(source, /eventBus\.on\(Events\.SONG_UPDATED/);
  assert.match(source, /songPanel\.renderSongs\s*\(\s*songs\s*,\s*languages\s*,\s*artists\s*,\s*tags\s*,?\s*\)/);
});

test('admin wires gift catalog updates into the overtime picker', () => {
  const stateSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'state.js'), 'utf8');
  const overtimeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'overtime.js'), 'utf8');

  assert.match(stateSource, /payload\.type === ["']gift-catalog:update["']/);
  assert.match(stateSource, /Events\.GIFT_CATALOG_UPDATED/);
  assert.match(overtimeSource, /eventBus\.on\(Events\.GIFT_CATALOG_UPDATED/);
  assert.match(overtimeSource, /requestGeneration !== giftCatalogApplyGeneration/);
  assert.match(overtimeSource, /snapshot\?\.source === ["']server["'][\s\S]*applyServerGiftArtwork\(snapshot\)/);
  assert.match(overtimeSource, /renderRules: \(rules\) =>\s*ruleEditor\.renderRules\(decorateOvertimeRules\(rules\)\)/);
  assert.match(overtimeSource, /row\.dataset\.imagePath = imagePath/);
  assert.match(stateSource, /assetsUpdatedAt: String\(snapshot\.assetsUpdatedAt/);
  assert.match(overtimeSource, /function openGiftPicker\(row = null\)[\s\S]*refreshGiftCatalog\(\{ notify: false \}\)/);
});

test('admin idle timers are lifecycle-bound', () => {
  const overtime = ['overtime.js', 'overtime-status-view.js']
    .map((file) => fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', file), 'utf8'))
    .join('\n');
  const games = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'games.js'), 'utf8');
  assert.match(overtime, /document\.addEventListener\(["']visibilitychange["'], syncClockLoop\)/);
  assert.match(overtime, /cancelAnimationFrame\(clockRafId\)/);
  assert.match(games, /let drawClockTimer = null;/);
  assert.match(games, /function syncDrawClockTimer\(\)/);
  assert.doesNotMatch(games, /setInterval\(updateDrawClock, 250\);\s*Promise\.all/);
});

test('blind-box statistics are not reloaded for every state render', () => {
  const queue = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue.js'), 'utf8');
  const blindbox = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'gifts', 'blindbox.js'), 'utf8');
  assert.doesNotMatch(queue, /loadBlindBoxStats\(\)/);
  assert.match(blindbox, /if \(!statsInitialized\) \{[\s\S]*?loadBlindBoxStats\(\);/);
});

test('queue theme uses explicit draft saves while the display board retains autosave', () => {
  const themeSource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'queue-theme-view.js'), 'utf8');
  const displaySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'display.js'), 'utf8');

  assert.match(themeSource, /root\.addEventListener\('input', edit\)/);
  assert.match(themeSource, /root\.addEventListener\('change', edit\)/);
  assert.match(themeSource, /'submit'[\s\S]*controller\.save\(\)/);
  assert.match(displaySource, /displayForm\.addEventListener\('input', autosaveDisplay\)/);
  assert.match(displaySource, /displayForm\.addEventListener\('change', autosaveDisplay\)/);
  assert.match(displaySource, /await copyText\(url\)/);
  assert.doesNotMatch(displaySource, /navigator\.clipboard\.writeText\(url\)/);

  assert.match(themeSource, /classicPresets[\s\S]*?controller\.edit\(/);
  assert.match(themeSource, /quickBeautifyBtn[\s\S]*?controller\.edit\(/);
  assert.match(themeSource, /resetClassicTheme[\s\S]*?controller\.edit\(/);
  assert.match(displaySource, /songBoardPresets[\s\S]*?await saveDisplay\(\)/);
  assert.match(displaySource, /songBoardResetTheme[\s\S]*?await saveDisplay\(\)/);
});

test('early theme preset references receive asynchronously loaded data', async () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'data', 'theme-presets.json'), 'utf8'));
  const browserWindow = { AdminApp: {} };
  const themeModule = await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'), {
    window: browserWindow,
    fetch: async () => ({ ok: true, json: async () => config }),
  });
  const earlyClassicPresets = themeModule.getAllClassicPresets();
  const earlySongBoardPresets = themeModule.getAllSongBoardPresets();

  assert.deepEqual(Object.keys(earlyClassicPresets), []);
  await themeModule.loadThemeConfig();
  assert.equal(themeModule.getAllClassicPresets(), earlyClassicPresets);
  assert.equal(themeModule.getAllSongBoardPresets(), earlySongBoardPresets);
  assert.deepEqual(JSON.parse(JSON.stringify(earlyClassicPresets)), config.presets.classic);
  assert.deepEqual(JSON.parse(JSON.stringify(earlySongBoardPresets)), config.presets.songBoard);
});

test('tracked theme defaults match first-run storage defaults', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'public', 'data', 'theme-presets.json'), 'utf8'));

  for (const key of ['themePrimary', 'themeAccent', 'themeText', 'themeBackground', 'themeOpacity', 'themeRadius']) {
    assert.equal(config.default[key], DEFAULT_SETTINGS[key], `${key} should have one default value`);
  }
});

test('shared theme compatibility keeps admin theme form methods', async () => {
  const initThemeForm = () => {};
  const browserWindow = { AdminApp: { theme: { initThemeForm } } };

  await loadModuleExports(path.join(ROOT_DIR, 'public', 'js', 'shared', 'theme.js'), { window: browserWindow });

  assert.equal(browserWindow.AdminApp.theme.initThemeForm, initThemeForm);
  assert.equal(typeof browserWindow.AdminApp.theme.loadThemeConfig, 'function');
  const defaultThemeDescriptor = Object.getOwnPropertyDescriptor(browserWindow.AdminApp.theme, 'defaultThemeLook');
  assert.equal(typeof defaultThemeDescriptor.get, 'function');
});

test('admin page uses one ordered module entrypoint', () => {
  const html = readAdminHtml();
  const entrySource = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', 'admin', 'index.js'), 'utf8');

  const scripts = html.match(/<script\b[^>]*>/g) || [];
  const entries = scripts.filter((tag) => /\ssrc=["']\/js\/admin\/index\.js(?:\?[^"']*)?["']/.test(tag));
  assert.equal(entries.length, 1);
  assert.match(entries[0], /\stype=["']module["']/);
  assert.doesNotMatch(html, /<script[^>]+src="\/js\/admin\/queue\.js/);

  assert.ok(entrySource.includes("import './gifts/index.js';"));
  const giftEntry = fs.readFileSync(path.join(ROOT_DIR, 'public/js/admin/gifts/index.js'), 'utf8');
  for (const name of ['notification', 'detection', 'sprint', 'recent', 'blindbox', 'history']) {
    assert.ok(giftEntry.includes(`from './${name}.js'`), `${name} is an explicit dependency`);
    assert.ok(
      !entrySource.includes(`import './gifts/${name}.js';`),
      'composition does not rely on side-effect ordering',
    );
  }

  const importLines = entrySource.match(/^import .+;$/gm) ?? [];
  assert.equal(importLines.at(-1), "import './app.js';");
});

test('admin form refresh preserves the active edit and updates inactive fields', async () => {
  const edited = { value: '正在输入', dataset: {}, closest: () => null };
  const inactive = { value: '旧值', dataset: {}, closest: () => null };
  const document = {
    activeElement: edited,
    getElementById: (id) => ({ edited, inactive })[id] || null,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  const { FormsService } = await loadModuleExports(path.join(ROOT_DIR, 'public/js/admin/forms.js'), {
    document,
    window: { AdminApp: {} },
  });
  new FormsService().fillForm({ edited: '服务端值', inactive: '新值' });
  assert.equal(edited.value, '正在输入');
  assert.equal(inactive.value, '新值');
});
