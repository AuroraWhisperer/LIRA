'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '..');
const LEGACY_ADMIN_GLOBAL_LIMITS = {
  'public/js/admin/danmaku-tool.js': 5,
  'public/js/admin/desktop-lyric-preview.js': 5,
  'public/js/admin/desktop-lyric.js': 11,
  'public/js/admin/display.js': 27,
  'public/js/admin/forms.js': 8,
  'public/js/admin/gift-effects.js': 4,
  'public/js/admin/gifts/blindbox-analysis.js': 4,
  'public/js/admin/gifts/blindbox.js': 10,
  'public/js/admin/gifts/detection.js': 6,
  'public/js/admin/gifts/history.js': 14,
  'public/js/admin/gifts/index.js': 18,
  'public/js/admin/gifts/notification.js': 6,
  'public/js/admin/gifts/recent.js': 6,
  'public/js/admin/gifts/sprint.js': 6,
  'public/js/admin/import.js': 10,
  'public/js/admin/metrics.js': 4,
  'public/js/admin/other.js': 8,
  'public/js/admin/overtime.js': 3,
  'public/js/admin/queue.js': 26,
  'public/js/admin/settings.js': 54,
  'public/js/admin/songs.js': 37,
  'public/js/admin/state.js': 4,
  'public/js/admin/theme.js': 51,
  'public/js/admin/todo.js': 3,
  'public/js/admin/xiaomi-ai-settings.js': 4,
  'public/js/desktop.js': 7
};

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT_DIR, relativePath), 'utf8');
}

function listJavaScriptFiles(relativeDirectory) {
  const directory = path.join(ROOT_DIR, relativeDirectory);
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...listJavaScriptFiles(relativePath));
    else if (entry.name.endsWith('.js')) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files;
}

test('domain services use stores instead of SQLite statements', () => {
  const queueService = read('src/music/queue-service.js');
  const superChatService = read('src/bilibili/superchat-service.js');

  assert.doesNotMatch(queueService, /\.(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(superChatService, /\.(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(queueService, /context\.db|\bdb\.songDb\b/);
  assert.doesNotMatch(superChatService, /context\.db|\bdb\.superChatDb\b/);
});

test('Admin application accesses legacy globals only through its bridge', () => {
  const app = read('public/js/admin/app.js');
  const bridge = read('public/js/admin/legacy-admin-bridge.js');

  assert.doesNotMatch(app, /window\.AdminApp/);
  assert.doesNotMatch(app, /shared\/container\.js|\bcontainer\./);
  assert.match(bridge, /window\.AdminApp/);
});

test('Admin legacy global usage is frozen and can only decrease', () => {
  const candidates = [
    ...listJavaScriptFiles('public/js/admin'),
    'public/js/desktop.js'
  ];

  for (const relativePath of candidates) {
    if (relativePath === 'public/js/admin/legacy-admin-bridge.js') continue;
    const count = read(relativePath).match(/window\.AdminApp/g)?.length || 0;
    if (count === 0) continue;
    assert.ok(
      Object.hasOwn(LEGACY_ADMIN_GLOBAL_LIMITS, relativePath),
      `${relativePath} introduces a new legacy Admin global dependency`
    );
    assert.ok(
      count <= LEGACY_ADMIN_GLOBAL_LIMITS[relativePath],
      `${relativePath} increases legacy Admin global usage`
    );
  }
});

test('playback composition uses explicit factory dependencies', () => {
  const controller = read('public/js/playback/controller.js');

  assert.doesNotMatch(controller, /\bsharedDeps\b/);
  assert.doesNotMatch(controller, /前向声明（解决循环依赖）/);
});

test('generic shared utilities exclude spreadsheet and ZIP codecs', () => {
  const utilities = read('src/shared/utils.js');

  assert.doesNotMatch(utilities, /\b(?:createZip|readZipFiles|parseSharedStrings|parseWorksheetXml)\b/);
});

test('composition roots delegate mutable subsystem state to runtimes', () => {
  const server = read('src/server.js');
  const desktop = read('src/electron/main.js');

  assert.match(server, /createBilibiliRuntime/);
  assert.doesNotMatch(server, /function (?:configure|reconnect|replace)Bilibili/);
  assert.match(desktop, /createDesktopState/);
  assert.doesNotMatch(desktop, /^let\s+/m);
});
