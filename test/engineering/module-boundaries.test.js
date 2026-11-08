'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildDependencyGraph, findDependencyCycles } = require('../helpers/module-dependency-graph');
const { sanitizeSource } = require('../helpers/esm-source-sanitizer');

const ROOT_DIR = path.resolve(__dirname, '../..');
const EMPTY_CATCH_LIMITS = {
  'src/ai/model-client.js': 1,
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
  'src/server/lifecycle.js': 2,
  'src/server/data-maintenance-runtime.js': 1,
  'src/server/ws.js': 3,
  'src/server.js': 1,
  'public/js/admin/toolbox-navigation.js': 2,
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
    else if (/\.(?:c|m)?js$/.test(entry.name)) files.push(relativePath.replaceAll('\\', '/'));
  }
  return files;
}

const productGraph = buildDependencyGraph(new Map(
  [...listJavaScriptFiles('src'), ...listJavaScriptFiles('public/js')].map(file => [file, read(file)]),
));

test('product module imports and literal require/import calls have no dependency cycles', () => {
  assert.deepEqual(findDependencyCycles(productGraph), []);
});

test('dependency graph distinguishes executable imports, directory modules, and URL query suffixes', () => {
  const graph = buildDependencyGraph(new Map([
    ['src/app.js', `
      // require('./ignored');
      const example = "import('./ignored')";
      const pattern = /require('ignored')/;
      const load = () => require('./feature');
      import('./later.js');
    `],
    ['src/feature/index.js', "module.exports = require('../leaf');"],
    ['src/later.js', "export { value } from './leaf.js';"],
    ['src/leaf.js', 'export const value = 1;'],
    ['src/ignored.js', "require('./app');"],
    ['public/js/page.js', "import '/js/shared/value.js?v=1#module';"],
    ['public/js/shared/value.js', 'export const value = 1;'],
  ]));
  assert.deepEqual(graph.get('src/app.js'), ['src/feature/index.js', 'src/later.js']);
  assert.deepEqual(graph.get('public/js/page.js'), ['public/js/shared/value.js']);
  assert.deepEqual(findDependencyCycles(graph), []);
  graph.get('src/leaf.js').push('src/app.js');
  assert.deepEqual(findDependencyCycles(graph), [['src/app.js', 'src/feature/index.js', 'src/leaf.js', 'src/app.js']]);
  assert.deepEqual(findDependencyCycles(new Map([['self.js', ['self.js']]])), [['self.js', 'self.js']]);
});

test('domain modules receive stores and never import storage, transport, or desktop implementations', () => {
  for (const [file, dependencies] of productGraph) {
    if (!/^src\/(?:ai|bilibili|music|overtime|fans|games|scenes)\//.test(file)) continue;
    for (const dependency of dependencies) {
      assert.doesNotMatch(dependency, /^src\/(?:storage\/|server(?:\/|\.js$)|electron\/)/, `${file} imports ${dependency}`);
    }
  }
});

test('shared modules have no upward imports or implicit Admin registry dependencies', () => {
  for (const [file, dependencies] of productGraph) {
    if (file.startsWith('public/js/shared/')) {
      assert.doesNotMatch(sanitizeSource(read(file)), /\bAdminApp\b/, file);
      for (const dependency of dependencies) {
        assert.ok(dependency.startsWith('public/js/shared/'), `${file} imports ${dependency}`);
      }
    } else if (file.startsWith('src/shared/')) {
      for (const dependency of dependencies) {
        assert.ok(/^(?:src\/shared\/|public\/js\/shared\/)/.test(dependency), `${file} imports ${dependency}`);
      }
    }
  }
});

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
  const aiConfiguration = read('src/ai/config-store.js');
  assert.doesNotMatch(aiConfiguration, /\.(?:prepare|exec)\s*\(/);
  assert.doesNotMatch(aiConfiguration, /require\([^\n]*storage\//);
  for (const file of listJavaScriptFiles('src/overtime')) {
    const source = read(file);
    assert.doesNotMatch(source, /\.(?:prepare|exec)\s*\(|\bgiftDb\b|context\.db/, file);
    assert.doesNotMatch(source, /require\([^\n]*storage\//, file);
  }
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
  for (const [file, dependencies] of productGraph) {
    if (!file.startsWith('src/')) continue;
    if (entrypoints.has(file)) continue;
    for (const target of dependencies) {
      assert.equal(entrypoints.has(target), false, `${file} imports composition entry ${target}`);
    }
  }
});

test('storage adapters do not depend on server, desktop, or browser modules', () => {
  for (const [file, dependencies] of productGraph) {
    if (!file.startsWith('src/storage/')) continue;
    for (const target of dependencies) {
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

test('composition owns wheel cleanup', () => {
  assert.match(read('src/server.js'), /wheelSessionService\?\.dispose\(\)/);
});

test('frontend modules use explicit dependencies without an Admin registry', () => {
  assert.doesNotMatch(read('public/js/admin/app.js'), /shared\/container\.js|\bcontainer\./);
  for (const file of listJavaScriptFiles('public/js')) {
    const source = read(file);
    assert.doesNotMatch(sanitizeSource(source), /\bAdminApp\b|getLegacyAdminModules/, file);
    assert.doesNotMatch(source, /\b(?:window|globalThis)\s*\[\s*['"]AdminApp['"]\s*\]/, file);
  }
});

test('domain SQL detection includes statements split across lines', () => {
  for (const source of ['db.prepare(sql)', 'songDb\n  .prepare(sql)', 'giftDb . exec (sql)', 'musicDb\n.\nexec\n(sql)']) {
    assert.equal(source.match(DOMAIN_SQL_PATTERN)?.length, 1, source);
  }
  assert.equal('store.prepare(sql)'.match(DOMAIN_SQL_PATTERN), null);
});

test('domain SQL receivers stay inside storage', () => {
  const candidates = listJavaScriptFiles('src').filter((relativePath) => !relativePath.startsWith('src/storage/'));

  for (const relativePath of candidates) {
    assert.doesNotMatch(read(relativePath), DOMAIN_SQL_PATTERN, `${relativePath} issues SQL outside storage`);
  }
});

test('pure frontend helper consumers bypass the legacy utility aggregation', () => {
  const pureHelpers = new Set([
    'escapeHtml', 'escapeAttr', 'formatTime', 'formatDateTime', 'formatBytes',
    'formatDuration', 'formatSuperChatPrice', 'formatMoney', 'formatCompactNumber',
  ]);
  for (const file of listJavaScriptFiles('public/js')) {
    for (const match of read(file).matchAll(/\b(?:import|export)\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2]));
      if (target !== 'public/js/shared/utils.js') continue;
      const imported = match[1].split(',').map(binding => binding.trim().split(/\s+/)[0]);
      assert.deepEqual(imported.filter(name => pureHelpers.has(name)), [], `${file} must import pure helpers from their owner`);
    }
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
  assert.match(desktop, /createDesktopLifecycle/);
  assert.match(desktop, /createDesktopMainWindow/);
  assert.doesNotMatch(desktop, /createDesktopState|\b(?:shutdownPromise|closePromptPromise)\b/);
});
