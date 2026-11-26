// 编写人：Aurora
// Admin 页面固定片段组合，生产与测试共用同一顺序。
'use strict';

const { ADMIN_PAGE_PATHS } = require('../shared/admin-page-paths');

const fs = require('node:fs');
const path = require('node:path');
const {
  CLIENT_THEMES,
  CLIENT_THEME_CATEGORIES,
  CLIENT_THEME_CATEGORY_MAP,
  DEFAULT_CLIENT_THEME_ID,
} = require('../shared/client-theme');

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function replacePlaceholder(template, token, value) {
  const safe = escapeHtml(value);
  return template.replaceAll(token, () => safe);
}

const ADMIN_PAGE_ROUTES = new Set(ADMIN_PAGE_PATHS);
const composedHtmlCache = new Map();
const ADMIN_FRAGMENT_INCLUDE_PATTERN =
  /<!--\s*admin-fragment:\s*(pages\/admin\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html)\s*-->/g;

const ADMIN_FRAGMENT_PATHS = Object.freeze([
  'pages/admin/shell-start.html',
  'pages/admin/song/shell-start.html',
  'pages/admin/song/library.html',
  'pages/admin/song/settings.html',
  'pages/admin/song/request-rules.html',
  'pages/admin/song/queue-theme.html',
  'pages/admin/song/song-board.html',
  'pages/admin/song/overlay-addresses.html',
  'pages/admin/song/import-export.html',
  'pages/admin/song/shell-end.html',
  'pages/admin/gifts/page.html',
  'pages/admin/live-components/page.html',
  'pages/admin/toolbox/shell-start.html',
  'pages/admin/toolbox/danmaku.html',
  'pages/admin/toolbox/pk-score-calculator.html',
  'pages/admin/toolbox/games.html',
  'pages/admin/toolbox/dynamic-lottery.html',
  'pages/admin/toolbox/gift-effects.html',
  'pages/admin/toolbox/audio-assistant.html',
  'pages/admin/toolbox/planner.html',
  'pages/admin/toolbox/weekly-schedule.html',
  'pages/admin/toolbox/world-clock.html',
  'pages/admin/toolbox/fan-profiles.html',
  'pages/admin/toolbox/settings.html',
  'pages/admin/toolbox/performance.html',
  'pages/admin/toolbox/usage-guide.html',
  'pages/admin/toolbox/shell-end.html',
  'pages/admin/playback/page.html',
  'pages/admin/playback/queue-popup.html',
  'pages/admin/playback/fullscreen.html',
  'pages/admin/playback/drawer.html',
  'pages/admin/gifts/blindbox-analysis.html',
  'pages/admin/gifts/history.html',
  'pages/admin/main-end.html',
  'pages/admin/shared/audio-assistant.html',
  'pages/admin/shared/topbar-status.html',
  'pages/admin/shared/song-confirmation.html',
  'pages/admin/document-end.html',
]);

function isAdminPageRoute(pathname) {
  return ADMIN_PAGE_ROUTES.has(pathname);
}

function readAdminFragment(publicDir, relativePath, ancestors = []) {
  if (ancestors.includes(relativePath)) {
    throw new Error(`Circular admin fragment: ${[...ancestors, relativePath].join(' -> ')}`);
  }
  const html = fs.readFileSync(path.join(publicDir, relativePath), 'utf8');
  return html.replace(ADMIN_FRAGMENT_INCLUDE_PATTERN, (_marker, includePath) =>
    readAdminFragment(publicDir, includePath, [...ancestors, relativePath]),
  );
}

function composeAdminHtml(publicDir) {
  const cacheKey = path.resolve(String(publicDir));
  const cached = composedHtmlCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const fragments = ADMIN_FRAGMENT_PATHS.map((relativePath) => readAdminFragment(publicDir, relativePath)).join('');
  const lightThemes = CLIENT_THEMES.filter(({ mode }) => mode !== 'dark');
  const darkThemes = CLIENT_THEMES.filter(({ mode }) => mode === 'dark');
  const categoryCounts = new Map();
  for (const theme of CLIENT_THEMES) {
    categoryCounts.set(theme.category, (categoryCounts.get(theme.category) || 0) + 1);
  }
  const renderThemeOptions = (template, themes) =>
    themes.map(({ id, name, mode, category, surface, family, temperature }) => {
      const categoryLabel = CLIENT_THEME_CATEGORY_MAP[category]?.label || '';
      let output = template;
      output = replacePlaceholder(output, '{{client-theme-id}}', id);
      output = replacePlaceholder(output, '{{client-theme-name}}', name);
      output = replacePlaceholder(output, '{{client-theme-mode}}', mode || 'light');
      output = replacePlaceholder(output, '{{client-theme-category}}', category || '');
      output = replacePlaceholder(output, '{{client-theme-category-label}}', categoryLabel);
      output = replacePlaceholder(output, '{{client-theme-surface}}', surface || 'solid');
      output = replacePlaceholder(output, '{{client-theme-family}}', family || '');
      output = replacePlaceholder(output, '{{client-theme-temperature}}', temperature || 'neutral');
      return output.replaceAll('{{client-theme-checked}}', () => (id === DEFAULT_CLIENT_THEME_ID ? 'checked' : ''));
    }).join('');
  const renderCategoryOptions = (template) =>
    CLIENT_THEME_CATEGORIES.map(({ id, label }) => {
      let output = template;
      output = replacePlaceholder(output, '{{client-theme-category-id}}', id);
      output = replacePlaceholder(output, '{{client-theme-category-label}}', label);
      output = replacePlaceholder(output, '{{client-theme-category-count}}', String(categoryCounts.get(id) || 0));
      return output;
    }).join('');
  const defaultTheme = CLIENT_THEMES.find(({ id }) => id === DEFAULT_CLIENT_THEME_ID) || CLIENT_THEMES[0];
  let sharedThemeOptionTemplate = '';
  const html = fragments
    .replaceAll('{{client-theme-count-all}}', () => String(CLIENT_THEMES.length))
    .replaceAll('{{client-theme-count-light}}', () => String(lightThemes.length))
    .replaceAll('{{client-theme-count-dark}}', () => String(darkThemes.length))
    .replaceAll('{{client-theme-default-name}}', () => escapeHtml(defaultTheme?.name || ''))
    .replaceAll('{{client-theme-default-mode-label}}', () => (defaultTheme?.mode === 'dark' ? '深色' : '浅色'))
    .replaceAll('{{client-theme-default-category-label}}', () =>
      escapeHtml(CLIENT_THEME_CATEGORY_MAP[defaultTheme?.category]?.label || ''))
    .replace(/<template data-client-theme-category-option>([\s\S]*?)<\/template>/g, (_marker, template) =>
      renderCategoryOptions(template))
    .replace(/<template data-client-theme-option-template>([\s\S]*?)<\/template>/g, (_marker, template) => {
      sharedThemeOptionTemplate = template;
      return '';
    })
    .replace(/<template data-client-theme-option(?:="(light|dark)")?>([\s\S]*?)<\/template>/g, (_marker, mode, template) => {
      const source = template.trim() ? template : sharedThemeOptionTemplate;
      return renderThemeOptions(source, mode === 'light' ? lightThemes : mode === 'dark' ? darkThemes : CLIENT_THEMES);
    });
  composedHtmlCache.set(cacheKey, html);
  return html;
}

module.exports = { ADMIN_FRAGMENT_PATHS, composeAdminHtml, isAdminPageRoute, readAdminFragment };
