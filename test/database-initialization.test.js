'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

function loadModule(relativePath, overrides = {}, warnings = []) {
  const filename = path.join(__dirname, '..', relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    require: (name) => overrides[name] || localRequire(name),
    console: { ...console, warn: (...args) => warnings.push(args) },
  }, { filename });
  return module.exports;
}

function fixture({ phase, index = 0, closeFails = false } = {}) {
  const originalError = new Error(`initialization: ${phase}`);
  const warnings = [];
  const handles = [];
  const closes = [];
  let attempts = 0;
  class Database {
    constructor() {
      this.index = attempts++;
      if (phase === 'constructor' && this.index === index) throw originalError;
      this.execCount = 0;
      handles.push(this);
    }
    exec() {
      this.execCount += 1;
      if (this.index === index && (
        (phase === 'pragma' && this.execCount === 1) ||
        (phase === 'schema' && this.execCount === 2) ||
        (phase === 'index' && this.execCount === 3)
      )) throw originalError;
    }
    close() {
      closes.push(this.index);
      if (closeFails) throw new Error(`close: ${this.index}`);
    }
  }
  const maintenance = loadModule('src/storage/database-maintenance.js', {}, warnings);
  const database = loadModule('src/storage/database.js', {
    'node:fs': { mkdirSync() {} },
    'node:sqlite': { DatabaseSync: Database },
    './database-maintenance': maintenance,
    './database-migrations': {
      runAllMigrations() { if (phase === 'migration') throw originalError; },
      migrateLegacySuperChatsToDedicatedDatabase() {
        if (phase === 'legacy') throw originalError;
      },
    },
  });
  return { database, originalError, handles, closes, warnings };
}

for (const phase of ['constructor', 'pragma']) {
  for (const index of [0, 2, 4]) {
    for (const closeFails of [false, true]) {
      test(`${phase} failure at database ${index + 1}, close fails=${closeFails}`, () => {
        const f = fixture({ phase, index, closeFails });
        assert.throws(() => f.database.createDatabases({ dataDir: 'isolated-fake' }),
          (error) => error === f.originalError);
        const expected = Array.from({ length: index }, (_, i) => i);
        if (phase === 'pragma') expected.unshift(index);
        assert.deepEqual(f.closes, expected);
        assert.equal(f.handles.length, expected.length);
        assert.equal(f.warnings.length, closeFails ? expected.length : 0);
      });
    }
  }
}

for (const phase of ['schema', 'migration', 'index', 'legacy']) {
  test(`${phase} failure cleans every registered handle despite close errors`, () => {
    const f = fixture({ phase, closeFails: true });
    assert.throws(() => f.database.createDatabases({ dataDir: 'isolated-fake' }),
      (error) => error === f.originalError);
    assert.deepEqual(f.closes, [0, 1, 2, 3, 4]);
    assert.equal(f.warnings.length, 5);
  });
}

test('successful creation transfers every handle without closing it', () => {
  const f = fixture();
  const db = f.database.createDatabases({ dataDir: 'isolated-fake' });
  assert.deepEqual(Object.values(db), f.handles);
  assert.deepEqual(f.closes, []);
  f.database.closeDatabases(db);
  assert.deepEqual(f.closes, [0, 1, 2, 3, 4]);
});

test('real databases close after a PRAGMA failure and reopen with data and migrations intact', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-db-init-'));
  const realRoot = fs.realpathSync(root);
  const handles = [];
  const originalError = new Error('injected PRAGMA failure');
  let fail = true;
  class ObservedDatabase extends DatabaseSync {
    constructor(filePath) {
      super(filePath);
      this.filePath = filePath;
      this.closeCount = 0;
      handles.push(this);
    }
    exec(sql) {
      super.exec(sql);
      if (fail && this.filePath.endsWith('gift-data.db') && sql.startsWith('PRAGMA')) {
        fail = false;
        throw originalError;
      }
    }
    close() { this.closeCount += 1; super.close(); }
  }
  const database = loadModule('src/storage/database.js', {
    'node:sqlite': { DatabaseSync: ObservedDatabase },
  });
  try {
    assert.throws(() => database.createDatabases({ dataDir: root }),
      (error) => error === originalError);
    assert.equal(handles.length, 3);
    for (const handle of handles) {
      assert.equal(handle.closeCount, 1);
      assert.throws(() => handle.prepare('SELECT 1'), /not open/i);
    }
    const db = database.createDatabases({ dataDir: root });
    const versions = database.getSchemaVersions(db);
    for (const handle of Object.values(db)) {
      assert.equal(handle.closeCount, 0);
      assert.equal(handle.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    }
    assert.equal(db.giftDb.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.songDb.exec("CREATE TABLE init_probe (value TEXT); INSERT INTO init_probe VALUES ('kept');");
    database.closeDatabases(db);
    const reopened = database.createDatabases({ dataDir: root });
    assert.equal(reopened.songDb.prepare('SELECT value FROM init_probe').get().value, 'kept');
    assert.deepEqual(database.getSchemaVersions(reopened), versions);
    database.closeDatabases(reopened);
    assert.ok(handles.every((handle) => handle.closeCount === 1));
  } finally {
    for (const handle of handles) {
      if (handle.isOpen) handle.close();
    }
    assert.equal(fs.realpathSync(root), realRoot);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
