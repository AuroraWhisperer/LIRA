'use strict';

const { readAdminHtml } = require('./helpers/admin-html');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DEFAULT_SETTINGS } = require('../src/storage/settings-store');
const { loadModuleExports } = require('./helpers/frontend-modules');

const ROOT_DIR = path.join(__dirname, '..');

test('admin state events render queue empty states and song data', () => {
  const source = fs.readFileSync(
    path.join(ROOT_DIR, 'public', 'js', 'admin', 'app.js'),
    'utf8',
  );

  assert.match(source, /eventBus\.on\(Events\.STATE_LOADED/);
  assert.match(
    source,
    /eventBus\.on\(Events\.STATE_LOADED, createAdminStateRenderer\(\)\)/,
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
  assert.match(
    overtimeSource,
    /serverGiftArtworkById\.get\(giftArtworkKey\(gift\)\)/,
  );
  assert.match(
    overtimeSource,
    /globalGiftMatches = globalGiftMatches\.map\(\(gift\) => \{[\s\S]*?serverGiftArtworkById\.get\(giftArtworkKey\(gift\)\)/,
  );
  assert.match(overtimeSource, /function decorateOvertimeRules\(rules\)/);
  assert.match(
    overtimeSource,
    /renderRules: \(rules\) =>\s*ruleEditor\.renderRules\(decorateOvertimeRules\(rules\)\)/,
  );
  assert.match(overtimeSource, /row\.dataset\.imagePath = imagePath/);
  assert.match(
    stateSource,
    /assetsUpdatedAt: String\(snapshot\.assetsUpdatedAt/,
  );
  assert.match(
    overtimeSource,
    /function openGiftPicker\(row = null\)[\s\S]*refreshGiftCatalog\(\{ notify: false \}\)/,
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
