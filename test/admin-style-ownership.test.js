'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { readCssBundle } = require('./helpers/css-bundle');

const ROOT_DIR = path.join(__dirname, '..');

function read(...segments) {
  return fs.readFileSync(path.join(ROOT_DIR, ...segments), 'utf8');
}

function cssImports(source) {
  return [...source.matchAll(/@import url\('([^']+)'\);/g)].map(
    ([, importPath]) => importPath,
  );
}

test('admin stylesheet entries load shared and feature-owned styles in order', () => {
  const adminEntry = read('public', 'css', 'styles-admin.css');
  const toastEntry = read('public', 'css', 'admin', 'toasts.css');
  const workspaceEntry = read('public', 'css', 'admin', 'workspace.css');
  const toolboxEntry = read('public', 'css', 'admin', 'other-features.css');

  assert.match(
    adminEntry,
    /@import url\('\.\/components\/switch-control\.css'\);/,
  );
  assert.deepEqual(cssImports(toastEntry), [
    './toasts/system.css',
    './toasts/ai.css',
    './toasts/playback.css',
    './toasts/live.css',
    './toasts/desktop-update.css',
    './toasts/gifts.css',
  ]);
  assert.match(
    workspaceEntry,
    /@import url\('\.\/workspace\/song-overlay-settings\.css'\);/,
  );
  assert.match(
    toolboxEntry,
    /@import url\('\.\/other-features\/performance\.css'\);/,
  );
  assert.match(
    toolboxEntry,
    /@import url\('\.\/other-features\/usage-guide-navigation\.css'\);\s*@import url\('\.\/other-features\/usage-guide\.css'\);/,
  );
});

test('toast implementation files contain only shared or transient surface rules', () => {
  const systemStyles = read('public', 'css', 'admin', 'toasts', 'system.css');
  const giftStyles = read('public', 'css', 'admin', 'toasts', 'gifts.css');
  const tabStyles = read('public', 'css', 'admin', 'tabs.css');

  assert.match(systemStyles, /\.toast-stack\s*\{/);
  assert.doesNotMatch(
    systemStyles,
    /\.(?:gift-catalog-update|xiaomi-ai-test|playback-|music-cookie|admin-live-refresh|desktop-update)-toast/,
  );
  assert.match(giftStyles, /\.gift-catalog-update-toast\s*\{/);
  assert.match(giftStyles, /\.gift-notify-toast\s*\{/);
  assert.doesNotMatch(
    giftStyles,
    /\.(?:overlay-address|identity-rule|style-picker|monitor-|metrics-countdown|hardware-|switch-control)/,
  );
  assert.doesNotMatch(
    tabStyles,
    /\.(?:toast-stack|toast|playback-login-toast)/,
  );
});

test('resolved admin styles keep one toast foundation and all moved consumers', () => {
  const styles = [
    readCssBundle('public', 'css', 'admin', 'tabs.css'),
    readCssBundle('public', 'css', 'admin', 'toasts.css'),
    readCssBundle('public', 'css', 'components', 'switch-control.css'),
    readCssBundle('public', 'css', 'admin', 'workspace.css'),
    readCssBundle('public', 'css', 'admin', 'other-features.css'),
  ].join('\n');
  const countRules = (selector) =>
    [...styles.matchAll(new RegExp(`${selector}\\s*\\{`, 'g'))].length;

  assert.equal(countRules('\\.toast-stack'), 1);
  assert.equal(countRules('\\.playback-login-toast'), 1);
  for (const selector of [
    '.gift-catalog-update-toast',
    '.xiaomi-ai-test-toast',
    '.admin-live-refresh-toast',
    '.desktop-update-toast',
    '.switch-control',
    '.overlay-address-grid',
    '.style-picker',
    '.monitor-toolbar',
    '.hardware-summary',
  ]) {
    assert.match(styles, new RegExp(`\\${selector}\\s*\\{`), selector);
  }
});

test('live refresh toast keeps a resolvable image', () => {
  const livePath = path.join(
    ROOT_DIR,
    'public',
    'css',
    'admin',
    'toasts',
    'live.css',
  );
  const liveStyles = fs.readFileSync(livePath, 'utf8');
  const assetReference = liveStyles.match(
    /url\(['"]([^'"]*live-refresh-icon\.webp)['"]\)/,
  )?.[1];

  assert.ok(
    assetReference,
    'live refresh image reference should remain defined',
  );
  assert.equal(
    fs.existsSync(path.resolve(path.dirname(livePath), assetReference)),
    true,
  );
});
