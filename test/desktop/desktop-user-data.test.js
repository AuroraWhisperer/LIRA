const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

const {
  PACKAGED_USER_DATA_DIR_NAME,
  migrateLegacyUserData,
  migrateLegacyPartitions,
  resolveDesktopUserDataPaths,
} = require('../../src/electron/desktop-user-data');

function migrationApp(granted = true) {
  let held = false;
  const calls = [];
  return {
    calls,
    setPath(name, value) { calls.push({ name, value }); },
    requestSingleInstanceLock() { calls.push('lock'); held = granted; return held; },
    hasSingleInstanceLock() { return held; },
    releaseSingleInstanceLock() { calls.push('release'); held = false; },
  };
}

test('packaged desktop data stays beside the installed executable', () => {
  const paths = resolveDesktopUserDataPaths({
    isPackaged: true,
    appDataPath: 'C:\\Users\\Tester\\AppData\\Roaming',
    exePath: 'D:\\Apps\\LIRA\\LIRA.exe',
    rootDir: 'D:\\Work\\Live',
  });

  assert.equal(
    paths.legacyDataDir,
    path.resolve('C:\\Users\\Tester\\AppData\\Roaming', PACKAGED_USER_DATA_DIR_NAME, 'data'),
  );
  assert.equal(paths.dataDir, path.resolve('D:\\Apps\\LIRA\\data'));
  assert.equal(paths.recoveryDataDir, path.resolve('D:\\Apps\\LIRA.lira-data-backup'));
});

test('development desktop data remains in the repository data directory', () => {
  const rootDir = path.resolve('D:\\Work\\Live');
  const paths = resolveDesktopUserDataPaths({ isPackaged: false, appDataPath: 'ignored', exePath: 'ignored', rootDir });
  assert.equal(paths.dataDir, path.join(rootDir, 'data'));
  assert.equal(paths.legacyDataDir, path.join(rootDir, 'data'));
});

test('legacy desktop data is completely published after a successful copy', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-user-data-'));
  const sourceDir = path.join(tempDir, 'appdata', PACKAGED_USER_DATA_DIR_NAME, 'data');
  const targetDir = path.join(tempDir, 'install', 'data');

  try {
    fs.mkdirSync(path.join(sourceDir, 'music-auth'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'song-request-data.db'), 'songs');
    fs.writeFileSync(path.join(sourceDir, 'music-auth', 'qq.cookies.enc'), 'auth');

    const result = migrateLegacyUserData({
      app: migrationApp(),
      sourceDir,
      targetDir,
    });

    assert.equal(result.status, 'migrated');
    assert.equal(fs.readFileSync(path.join(targetDir, 'song-request-data.db'), 'utf8'), 'songs');
    assert.equal(fs.readFileSync(path.join(targetDir, 'music-auth', 'qq.cookies.enc'), 'utf8'), 'auth');
    assert.equal(fs.existsSync(sourceDir), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('an existing durable destination is never overwritten by legacy data', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-user-data-'));
  const sourceDir = path.join(tempDir, 'install-data');
  const targetDir = path.join(tempDir, 'durable-data');

  try {
    fs.mkdirSync(sourceDir);
    fs.mkdirSync(targetDir);
    fs.writeFileSync(path.join(sourceDir, 'song-request-data.db'), 'stale');
    fs.writeFileSync(path.join(targetDir, 'song-request-data.db'), 'current');

    assert.deepEqual(migrateLegacyUserData({ sourceDir, targetDir }), {
      status: 'target-exists',
    });
    assert.equal(fs.readFileSync(path.join(targetDir, 'song-request-data.db'), 'utf8'), 'current');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a missing legacy source does not create a directory or acquire its instance lock', (t) => {
  const root = createScratchDirectory('legacy-data-missing-', t);
  const sourceDir = path.join(root, 'legacy');
  const targetDir = path.join(root, 'install', 'data');
  const app = migrationApp(false);
  assert.deepEqual(migrateLegacyUserData({ app, sourceDir, targetDir }), { status: 'source-missing' });
  assert.deepEqual(app.calls, []);
  assert.equal(fs.existsSync(sourceDir), false);
  assert.equal(fs.existsSync(targetDir), false);
});

test('a target published concurrently is preserved and the temporary source lock is released', (t) => {
  const root = createScratchDirectory('legacy-data-publish-', t);
  const sourceDir = path.join(root, 'legacy');
  const targetDir = path.join(root, 'install', 'data');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(path.join(sourceDir, 'settings'), 'legacy');
  const app = migrationApp();
  const result = migrateLegacyUserData({ app, sourceDir, targetDir, fileSystem: {
    ...fs,
    cpSync(from, to, options) {
      fs.cpSync(from, to, options);
      fs.mkdirSync(targetDir);
      fs.writeFileSync(path.join(targetDir, 'settings'), 'current');
    },
  } });
  assert.equal(result.status, 'target-exists');
  assert.equal(fs.readFileSync(path.join(targetDir, 'settings'), 'utf8'), 'current');
  assert.deepEqual(fs.readdirSync(path.dirname(targetDir)), ['data']);
  assert.equal(app.hasSingleInstanceLock(), false);
});

test('a failed copy does not publish a partial durable destination', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-user-data-'));
  const sourceDir = path.join(tempDir, 'install-data');
  const targetDir = path.join(tempDir, 'durable-data');
  fs.mkdirSync(sourceDir);

  const fileSystem = {
    ...fs,
    cpSync(_source, stagingDir) {
      fs.mkdirSync(stagingDir, { recursive: true });
      fs.writeFileSync(path.join(stagingDir, 'partial.db'), 'partial');
      throw new Error('copy failed');
    },
  };
  const app = migrationApp();

  try {
    assert.throws(
      () =>
        migrateLegacyUserData({
          app,
          sourceDir,
          targetDir,
          fileSystem,
        }),
      /copy failed/,
    );
    assert.equal(fs.existsSync(targetDir), false);
    assert.deepEqual(
      fs.readdirSync(tempDir).filter((name) => name.startsWith('.durable-data.migration-')),
      [],
    );
    assert.equal(fs.existsSync(sourceDir), true);
    assert.equal(app.hasSingleInstanceLock(), false);
    assert.equal(app.calls.at(-1), 'release');
    assert.equal(migrateLegacyUserData({ app, sourceDir, targetDir }).status, 'migrated');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('a running legacy instance blocks migration without creating the target', (t) => {
  const root = createScratchDirectory('legacy-data-locked-', t);
  const sourceDir = path.join(root, 'legacy');
  const targetDir = path.join(root, 'install', 'data');
  fs.mkdirSync(sourceDir);
  const app = migrationApp(false);
  assert.throws(() => migrateLegacyUserData({ app, sourceDir, targetDir }), /Close.*LIRA/i);
  assert.equal(fs.existsSync(path.dirname(targetDir)), false);
  assert.deepEqual(app.calls, [{ name: 'userData', value: sourceDir }, 'lock']);
});

test('an active runtime prevents the main-file/WAL copy interleaving before any bytes are copied', (t) => {
  const root = createScratchDirectory('legacy-data-wal-');
  const sourceDir = path.join(root, 'legacy');
  const targetDir = path.join(root, 'install', 'data');
  fs.mkdirSync(sourceDir);
  const db = new DatabaseSync(path.join(sourceDir, 'song-request-data.db'));
  t.after(() => { db.close(); removeScratchDirectory(root); });
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); PRAGMA wal_checkpoint(TRUNCATE)');
  db.prepare('INSERT INTO records VALUES (?)').run('committed-in-wal');
  fs.writeFileSync(path.join(sourceDir, '.server-runtime.json'), JSON.stringify({ pid: process.pid }));
  const app = migrationApp();
  let copied = false;
  assert.throws(() => migrateLegacyUserData({
    app,
    sourceDir,
    targetDir,
    fileSystem: {
      ...fs,
      cpSync(from, to, options) {
        copied = true;
        fs.cpSync(from, to, { ...options, filter(source) {
          if (source.endsWith('.db-wal')) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
          return true;
        } });
      },
    },
  }), /still using this data directory/);
  assert.equal(copied, false);
  assert.equal(fs.existsSync(targetDir), false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM records').get().n, 1);
  assert.equal(app.hasSingleInstanceLock(), false);
});

for (const marker of ['invalid JSON', '{"pid":0}']) {
  test(`uncertain runtime state aborts copying and releases the source lock (${marker})`, (t) => {
    const root = createScratchDirectory('legacy-data-runtime-', t);
    const sourceDir = path.join(root, 'legacy');
    const targetDir = path.join(root, 'install', 'data');
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, '.server-runtime.json'), marker);
    const app = migrationApp();
    assert.throws(() => migrateLegacyUserData({ app, sourceDir, targetDir }));
    assert.equal(fs.existsSync(targetDir), false);
    assert.equal(app.hasSingleInstanceLock(), false);
  });
}

for (const stage of ['copy', 'publish']) {
  test(`failed legacy partition ${stage} leaves no active target and a later launch retries`, (t) => {
    const root = createScratchDirectory('legacy-partitions-', t);
    const appData = path.join(root, 'appdata');
    const userData = path.join(root, 'browser');
    const source = path.join(appData, 'LIRA', 'Partitions');
    const target = path.join(userData, 'Partitions');
    const app = { getPath: name => name === 'appData' ? appData : userData, getName: () => 'LIRA' };
    fs.mkdirSync(path.join(source, 'music-qq'), { recursive: true });
    fs.mkdirSync(path.join(source, 'bilibili'), { recursive: true });
    fs.mkdirSync(userData);
    fs.writeFileSync(path.join(source, 'music-qq', 'fixture'), 'music');
    fs.writeFileSync(path.join(source, 'bilibili', 'fixture'), 'bilibili');
    const failure = Object.assign(new Error('injected migration failure'), stage === 'publish' ? { code: 'EPERM' } : {});
    const fileSystem = {
      ...fs,
      cpSync(from, to, options) {
        assert.equal(fs.existsSync(target), false);
        if (stage === 'copy') {
          fs.cpSync(path.join(from, 'music-qq'), path.join(to, 'music-qq'), options);
          throw failure;
        }
        fs.cpSync(from, to, options);
      },
      renameSync() { throw failure; },
    };
    assert.throws(() => migrateLegacyPartitions({ app, fileSystem, writeLog() {} }), error => error === failure);
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(fs.readdirSync(userData), []);
    assert.equal(fs.readFileSync(path.join(source, 'bilibili', 'fixture'), 'utf8'), 'bilibili');

    migrateLegacyPartitions({ app, writeLog() {} });
    assert.equal(fs.readFileSync(path.join(target, 'music-qq', 'fixture'), 'utf8'), 'music');
    assert.equal(fs.readFileSync(path.join(target, 'bilibili', 'fixture'), 'utf8'), 'bilibili');
  });
}

test('a temporary legacy partition publish lock retries the prepared copy without recopying', (t) => {
  const root = createScratchDirectory('legacy-partitions-locked-', t);
  const appData = path.join(root, 'appdata');
  const userData = path.join(root, 'browser');
  const source = path.join(appData, 'LIRA', 'Partitions');
  const target = path.join(userData, 'Partitions');
  const app = { getPath: name => name === 'appData' ? appData : userData, getName: () => 'LIRA' };
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(source, 'fixture'), 'original');
  let copies = 0;
  let publishes = 0;
  migrateLegacyPartitions({
    app, writeLog() {}, fileSystem: {
      ...fs,
      cpSync(...args) { copies++; fs.cpSync(...args); },
      renameSync(...args) {
        if (++publishes === 1) throw Object.assign(new Error('transient Windows directory lock'), { code: 'EPERM' });
        fs.renameSync(...args);
      },
    },
  });
  assert.equal(copies, 1);
  assert.equal(fs.readFileSync(path.join(target, 'fixture'), 'utf8'), 'original');
  assert.equal(fs.readFileSync(path.join(source, 'fixture'), 'utf8'), 'original');
});

test('existing browser partitions keep their current state without merging legacy data', (t) => {
  const root = createScratchDirectory('legacy-partitions-existing-', t);
  const appData = path.join(root, 'appdata');
  const userData = path.join(root, 'browser');
  const source = path.join(appData, 'LIRA', 'Partitions');
  const target = path.join(userData, 'Partitions');
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(source, 'shared'), 'legacy');
  fs.writeFileSync(path.join(source, 'legacy-only'), 'legacy');
  fs.writeFileSync(path.join(target, 'shared'), 'current');
  migrateLegacyPartitions({
    app: { getPath: name => name === 'appData' ? appData : userData, getName: () => 'LIRA' },
    writeLog() {},
  });
  assert.equal(fs.readFileSync(path.join(target, 'shared'), 'utf8'), 'current');
  assert.equal(fs.existsSync(path.join(target, 'legacy-only')), false);
});
