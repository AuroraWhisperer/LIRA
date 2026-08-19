'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

test('confirmation dialog keeps one accessible shared contract', () => {
  const source = read('public', 'js', 'shared', 'confirmation-dialog.js');
  const styles = read('public', 'css', 'components', 'confirmation-dialog.css');

  assert.match(source, /variant = \['normal', 'caution', 'destructive'\]/);
  assert.match(source, /role="dialog" aria-modal="true"/);
  assert.match(source, /aria-labelledby="\$\{titleId\}" aria-describedby="\$\{descriptionId\}"/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /element\.inert = true/);
  assert.match(source, /previousFocus\?\.focus/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /\.is-destructive \.lira-confirm-confirm/);
});

test('native selects and custom menus use the control accent without replacing semantics', () => {
  const baseStyles = read('public', 'css', 'styles-base.css');
  const blindboxHtml = read('public', 'pages', 'admin', 'gifts', 'blindbox-analysis.html');
  const blindboxJs = read('public', 'js', 'admin', 'gifts', 'blindbox-analysis.js');
  const qualityJs = read('public', 'js', 'playback', 'core', 'event-handlers.js');
  const qualityUi = read('public', 'js', 'playback', 'ui', 'playback-bar.js');
  const qualityHtml = read('public', 'pages', 'admin', 'playback', 'page.html');
  const aiHtml = read('public', 'pages', 'admin', 'toolbox', 'danmaku.html');
  const aiJs = read('public', 'js', 'admin', 'ai-assistant-settings.js');

  assert.match(baseStyles, /select\s*\{[\s\S]*appearance:\s*none/);
  assert.match(baseStyles, /select:focus-visible\s*\{[\s\S]*var\(--color-control-focus\)/);
  assert.match(blindboxHtml, /aria-haspopup="listbox"/);
  assert.match(blindboxHtml, /role="listbox"/);
  assert.match(blindboxJs, /event\.key === 'Escape'/);
  assert.match(blindboxJs, /event\.key === ' '/);
  assert.match(qualityHtml, /role="menu"/);
  assert.match(qualityJs, /focusQualityOption/);
  assert.match(qualityUi, /role="menuitemradio"/);
  assert.match(aiHtml, /role="combobox" aria-autocomplete="list" aria-haspopup="listbox"/);
  assert.match(aiJs, /modelMenu\.addEventListener\('keydown'/);
});

test('native select options are rendered through contextual listbox panels', () => {
  const source = read('public', 'js', 'shared', 'select-menu.js');
  const styles = read('public', 'css', 'components', 'select-menu.css');
  const adminEntry = read('public', 'js', 'admin', 'app.js');
  const adminCss = read('public', 'css', 'styles-admin.css');
  const settings = read('public', 'pages', 'admin', 'song', 'queue-theme.html');
  const filters = read('public', 'pages', 'admin', 'song', 'library.html');
  const games = read('public', 'pages', 'admin', 'toolbox', 'games.html');
  const onboarding = read('public', 'js', 'admin', 'onboarding.js');

  assert.match(source, /role', 'listbox'/);
  assert.match(source, /role', 'option'/);
  assert.match(source, /event\.key === 'ArrowDown'/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /dispatchEvent\(new Event\('change'/);
  assert.match(source, /MutationObserver/);
  assert.match(styles, /\.lira-select-option\.is-selected/);
  assert.match(styles, /data-select-variant/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(adminEntry, /enhanceSelects\(\)/);
  assert.match(adminCss, /components\/select-menu\.css/);
  assert.match(settings, /data-dropdown-variant="settings"/);
  assert.match(filters, /data-dropdown-variant="filter"/);
  assert.match(games, /data-dropdown-variant="game"/);
  assert.match(onboarding, /select:not\(\[disabled\]\):not\(\.lira-select-native\)/);
});

test('admin runtime no longer composes the obsolete restart confirmation fragment', () => {
  const adminPage = read('src', 'server', 'admin-page.js');
  const desktop = read('public', 'js', 'desktop.js');

  assert.doesNotMatch(adminPage, /restart-confirm\.html/);
  assert.match(desktop, /showConfirmationDialog\(/);
});

test('renderer code has no native confirm calls', () => {
  const roots = [path.join(ROOT, 'public', 'js'), path.join(ROOT, 'src', 'electron')];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (entry.name.endsWith('.js')) files.push(fullPath);
    }
  };
  roots.forEach(visit);
  const nativeConfirmPattern = /\bconfirm\s*\(/;
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), nativeConfirmPattern, path.relative(ROOT, file));
  }
});
