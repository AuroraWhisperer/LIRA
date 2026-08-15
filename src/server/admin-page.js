// 编写人：Aurora
// Admin 页面固定片段组合，生产与测试共用同一顺序。
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ADMIN_PAGE_ROUTES = new Set(['/', '/admin', '/settings', '/songs']);

const ADMIN_FRAGMENT_PATHS = Object.freeze([
  'pages/admin/shell-start.html',
  'pages/admin/song/shell-start.html',
  'pages/admin/song/library.html',
  'pages/admin/song/settings.html',
  'pages/admin/song/queue-theme.html',
  'pages/admin/song/song-board.html',
  'pages/admin/song/overlay-addresses.html',
  'pages/admin/song/import-export.html',
  'pages/admin/song/desktop-lyric.html',
  'pages/admin/song/shell-end.html',
  'pages/admin/gifts/page.html',
  'pages/admin/toolbox/shell-start.html',
  'pages/admin/toolbox/danmaku.html',
  'pages/admin/toolbox/gift.html',
  'pages/admin/toolbox/overtime.html',
  'pages/admin/toolbox/planner.html',
  'pages/admin/toolbox/performance.html',
  'pages/admin/toolbox/usage-guide.html',
  'pages/admin/toolbox/desktop-update.html',
  'pages/admin/toolbox/shell-end.html',
  'pages/admin/playback/page.html',
  'pages/admin/playback/queue-popup.html',
  'pages/admin/playback/fullscreen.html',
  'pages/admin/playback/drawer.html',
  'pages/admin/gifts/blindbox-analysis.html',
  'pages/admin/gifts/history.html',
  'pages/admin/main-end.html',
  'pages/admin/shared/restart-confirm.html',
  'pages/admin/shared/song-confirmation.html',
  'pages/admin/document-end.html'
]);

function isAdminPageRoute(pathname) {
  return ADMIN_PAGE_ROUTES.has(pathname);
}

function composeAdminHtml(publicDir) {
  return ADMIN_FRAGMENT_PATHS
    .map(relativePath => fs.readFileSync(path.join(publicDir, relativePath), 'utf8'))
    .join('');
}

module.exports = { ADMIN_FRAGMENT_PATHS, composeAdminHtml, isAdminPageRoute };
