'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT_DIR = path.resolve(__dirname, '../..');
const LEGACY_ADMIN_GLOBAL_LIMITS = {
  'public/js/desktop.js': 7,
  'public/js/playback/index.js': 3,
  'public/js/playback/operations/provider-operations.js': 1,
  'public/js/shared/event-bus.js': 5,
  'public/js/shared/logger.js': 4,
  'public/js/shared/theme.js': 5,
  'public/js/shared/utils.js': 4,
};
const DOMAIN_SQL_LIMITS = {
  'src/ai/api-quota-store.js': 3,
  'src/ai/config-store.js': 18,
  // Includes pre-existing multiline calls that the original pattern missed.
  'src/overtime/overtime-store.js': 23,
};
const EMPTY_CATCH_LIMITS = {
  'src/ai/deepseek-client.js': 1,
  'src/ai/http-client.js': 1,
  'src/bilibili/danmaku/websocket-connection.js': 3,
  'src/electron/bilibili-login-window.js': 1,
  'src/electron/local-media-access.js': 1,
  'src/electron/terminal-log.js': 2,
  'src/music/music-cache.js': 2,
  'src/music/providers/netease-provider.js': 1,
  'src/music/providers/qq-provider.js': 1,
  'src/music/wesing-cache.js': 1,
  'src/music/wesing-capture-engine.js': 3,
  'src/music/wesing-monitor.js': 4,
  'src/music/wesing-native-monitor-source.js': 2,
  'src/overtime/overtime-service.js': 1,
  'src/server/bilibili-runtime.js': 1,
  'src/server/lifecycle.js': 2,
  'src/server/routes/data-routes.js': 1,
  'src/server/ws.js': 3,
  'src/server.js': 1,
  'public/js/admin/toolbox-navigation.js': 2,
  'public/js/admin/overtime.js': 3,
  'public/js/gift-audit/index.js': 2,
  'public/js/playback/cache/manager.js': 3,
  'public/js/playback/content/loader.js': 1,
  'public/js/playback/core/initializer.js': 2,
  'public/js/playback/features/playback-controls.js': 2,
  'public/js/playback/local/manager.js': 2,
  'public/js/playback/operations/state-persistence.js': 4,
  'public/js/playback/ui/components.js': 2,
};
const DOMAIN_SQL_PATTERN = /\b(?:db|songDb|superChatDb|giftDb|musicDb|checkinDb)\s*\.\s*(?:prepare|exec)\s*\(/g;
const EMPTY_CATCH_PATTERN = /\bcatch(?:\s*\([^)]*\))?\s*\{(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\}/g;

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
  const songs = read('src/music/song-service.js');

  assert.doesNotMatch(queueService, /\.(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(superChatService, /\.(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(queueService, /context\.db|\bdb\.songDb\b/);
  assert.doesNotMatch(superChatService, /context\.db|\bdb\.superChatDb\b/);
  assert.doesNotMatch(songs, /\.(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(songs, /require\([^\n]*storage\//);
  for (const name of [
    'projection-service',
    'statistics-consumer',
    'query-service',
    'blind-box-analysis',
    'source-scope',
  ]) {
    const source = read(`src/bilibili/gift/${name}.js`);
    assert.doesNotMatch(source, /\.(?:prepare|exec)\s*\(|\bgiftDb\b|context\.db/);
    assert.doesNotMatch(source, /require\([^\n]*storage\//);
    assert.doesNotMatch(source, /\b(?:SELECT|UPDATE|DELETE FROM)\b|source_id/);
  }
});

test('internal backend modules do not import composition entrypoints', () => {
  const entrypoints = new Set(['src/server.js', 'src/electron/entry.js', 'src/electron/main.js']);
  for (const file of listJavaScriptFiles('src')) {
    if (entrypoints.has(file)) continue;
    for (const match of read(file).matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      if (!path.posix.extname(target)) target += '.js';
      assert.equal(entrypoints.has(target), false, `${file} imports composition entry ${target}`);
    }
  }
});

test('storage adapters do not depend on server, desktop, or browser modules', () => {
  for (const file of listJavaScriptFiles('src/storage')) {
    for (const match of read(file).matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      assert.doesNotMatch(target, /^(?:src\/(?:server(?:\.js|\/|$)|electron\/)|public\/)/, file);
    }
  }
});

test('overlay pages connect only through the owned socket adapter', () => {
  const adHocConnections = listJavaScriptFiles('public/js/overlays')
    .filter((relativePath) => path.basename(relativePath) !== 'socket-client.js')
    .filter((relativePath) => /new WebSocket\s*\(/.test(read(relativePath)));
  assert.deepEqual(adHocConnections, [], 'overlay code must connect through overlays/socket-client.js');
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'public/js/shared/overlay-socket.js')), false);
});

test('composition owns wheel cleanup and does not revive the obsolete player', () => {
  assert.match(read('src/server.js'), /wheelSessionService\?\.dispose\(\)/);
  assert.equal(fs.existsSync(path.join(ROOT_DIR, 'public/js/playback/player/controller.js')), false);
  for (const file of listJavaScriptFiles('public/js/playback')) {
    assert.doesNotMatch(read(file), /PlayerController|player\/controller\.js/, file);
  }
});

test('Admin application accesses legacy globals only through its bridge', () => {
  const app = read('public/js/admin/app.js');
  const bridge = read('public/js/admin/legacy-admin-bridge.js');

  assert.doesNotMatch(app, /window\.AdminApp/);
  assert.doesNotMatch(app, /shared\/container\.js|\bcontainer\./);
  assert.match(bridge, /window\.AdminApp/);
  for (const relativePath of [
    'public/js/admin/songs.js',
    'public/js/admin/state-renderer.js',
    'public/js/admin/state.js',
    'public/js/admin/metrics.js',
    'public/js/admin/streamer-planner.js',
    'public/js/admin/gift-effects.js',
    'public/js/admin/danmaku-tool.js',
    'public/js/admin/ai-assistant-settings.js',
    'public/js/admin/toolbox-navigation.js',
    'public/js/admin/desktop-lyric.js',
    'public/js/admin/desktop-lyric-preview.js',
    'public/js/admin/song-import.js',
    'public/js/admin/settings.js',
    'public/js/admin/display.js',
    'public/js/admin/forms.js',
    'public/js/admin/theme.js',
    'public/js/admin/theme-style-view.js',
    ...listJavaScriptFiles('public/js/admin/gifts'),
  ]) {
    assert.doesNotMatch(
      read(relativePath),
      /\bAdminApp\b|getLegacyAdminModules/,
      `${relativePath} must use explicit dependencies, not legacy registry reads`,
    );
  }
});

test('Admin legacy global usage is frozen and can only decrease', () => {
  const candidates = listJavaScriptFiles('public/js');

  for (const relativePath of candidates) {
    if (relativePath === 'public/js/admin/legacy-admin-bridge.js') continue;
    const count = read(relativePath).match(/window\.AdminApp/g)?.length || 0;
    if (count === 0) continue;
    assert.ok(
      Object.hasOwn(LEGACY_ADMIN_GLOBAL_LIMITS, relativePath),
      `${relativePath} introduces a new legacy Admin global dependency`,
    );
    assert.ok(count <= LEGACY_ADMIN_GLOBAL_LIMITS[relativePath], `${relativePath} increases legacy Admin global usage`);
  }

  for (const [relativePath, limit] of Object.entries(LEGACY_ADMIN_GLOBAL_LIMITS)) {
    const count = read(relativePath).match(/window\.AdminApp/g)?.length || 0;
    assert.ok(count > 0, `${relativePath} has no legacy Admin global usage; remove its baseline`);
    assert.ok(count <= limit, `${relativePath} increases legacy Admin global usage`);
  }
});

test('domain SQL detection includes statements split across lines', () => {
  for (const source of ['db.prepare(sql)', 'songDb\n  .prepare(sql)', 'giftDb . exec (sql)', 'musicDb\n.\nexec\n(sql)']) {
    assert.equal(source.match(DOMAIN_SQL_PATTERN)?.length, 1, source);
  }
  assert.equal('store.prepare(sql)'.match(DOMAIN_SQL_PATTERN), null);
});

test('receiver-aware domain SQL usage is frozen and can only decrease', () => {
  const candidates = listJavaScriptFiles('src').filter((relativePath) => !relativePath.startsWith('src/storage/'));

  for (const relativePath of candidates) {
    const count = read(relativePath).match(DOMAIN_SQL_PATTERN)?.length || 0;
    if (count === 0) continue;
    assert.ok(
      Object.hasOwn(DOMAIN_SQL_LIMITS, relativePath),
      `${relativePath} introduces receiver-aware SQL usage outside storage`,
    );
    assert.ok(
      count <= DOMAIN_SQL_LIMITS[relativePath],
      `${relativePath} increases receiver-aware SQL usage outside storage`,
    );
  }

  for (const [relativePath, limit] of Object.entries(DOMAIN_SQL_LIMITS)) {
    const count = read(relativePath).match(DOMAIN_SQL_PATTERN)?.length || 0;
    assert.ok(count > 0, `${relativePath} has no receiver-aware SQL usage; remove its baseline`);
    assert.ok(count <= limit, `${relativePath} increases receiver-aware SQL usage outside storage`);
  }
});

test('empty catch text debt is frozen and can only decrease', () => {
  const candidates = [...listJavaScriptFiles('src'), ...listJavaScriptFiles('public/js')];

  for (const relativePath of candidates) {
    const count = read(relativePath).match(EMPTY_CATCH_PATTERN)?.length || 0;
    if (count === 0) continue;
    assert.ok(
      Object.hasOwn(EMPTY_CATCH_LIMITS, relativePath),
      `${relativePath} introduces empty or comment-only catch text debt`,
    );
    assert.ok(
      count <= EMPTY_CATCH_LIMITS[relativePath],
      `${relativePath} increases empty or comment-only catch text debt`,
    );
  }

  for (const [relativePath, limit] of Object.entries(EMPTY_CATCH_LIMITS)) {
    const count = read(relativePath).match(EMPTY_CATCH_PATTERN)?.length || 0;
    assert.ok(count > 0, `${relativePath} has no empty catch text debt; remove its baseline`);
    assert.ok(count <= limit, `${relativePath} increases empty or comment-only catch text debt`);
  }
});

test('playback composition uses explicit factory dependencies', () => {
  const controller = read('public/js/playback/controller.js');

  assert.doesNotMatch(controller, /\bsharedDeps\b/);
  assert.doesNotMatch(controller, /前向声明（解决循环依赖）/);
});

test('generic shared utilities exclude codecs and Bilibili rules', () => {
  const utilities = read('src/shared/utils.js');

  assert.doesNotMatch(utilities, /\b(?:createZip|readZipFiles|parseSharedStrings|parseWorksheetXml)\b/);
  assert.doesNotMatch(utilities, /\b(?:normalizeSuperChatPrice|normalizeGuardLevel|normalizeRoomInput|publicBilibiliErrorMessage)\b/);
});

test('HTTP primitives do not aggregate page composition or domain media handlers', () => {
  const utilities = read('src/server/http-utils.js');
  assert.doesNotMatch(utilities, /\b(?:servePageOrAsset|serveOpeningMedia|serveOpeningCharacter|serveOvertimeGiftImage|addFrameProtectionHeaders)\b/);
  assert.doesNotMatch(utilities, /require\(['"][^'"]*(?:bilibili\/|page-assets|opening-|gift-image|admin-page|component-preview-page)/);
});

test('opening consumers and settings operations stay independent of their HTTP routes', () => {
  for (const file of ['scene-extra-display', 'scene-shared-appearance', 'overlay-http', 'opening-service']) {
    assert.doesNotMatch(read(`src/server/${file}.js`), /require\(['"][^'"]*routes\/opening-routes/, file);
  }
  for (const file of ['opening-service', 'opening-media-store']) {
    assert.doesNotMatch(read(`src/server/${file}.js`), /require\(['"][^'"]*(?:http-utils|routes\/)/, file);
  }
  assert.doesNotMatch(read('src/server/routes/opening-preview-routes.js'), /require\(['"]\.\/opening-routes['"]\)/);
  assert.doesNotMatch(read('src/server/settings-service.js'), /require\(['"][^'"]*(?:http-utils|routes\/)/);
  assert.doesNotMatch(read('src/server/routes/settings-routes.js'), /\b(?:prepareConfiguration|setMany|CLOCK_APPEARANCE_KEYS)\b/);
});

test('Admin state owns state ordering without reading or rendering controls', () => {
  assert.doesNotMatch(read('public/js/admin/state.js'), /\bdocument\b|querySelector|getElementById/);
});

test('composition roots delegate mutable subsystem state to runtimes', () => {
  const server = read('src/server.js');
  const desktop = read('src/electron/main.js');

  assert.match(server, /createBilibiliRuntime/);
  assert.doesNotMatch(server, /function (?:configure|reconnect|replace)Bilibili/);
  assert.match(desktop, /createDesktopState/);
  assert.doesNotMatch(desktop, /^let\s+/m);
});
