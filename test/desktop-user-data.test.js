const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  PACKAGED_USER_DATA_DIR_NAME,
  migrateLegacyUserData,
  resolveDesktopUserDataPaths,
} = require('../src/electron/desktop-user-data');

test('packaged desktop data uses a stable AppData path', () => {
  const paths = resolveDesktopUserDataPaths({
    isPackaged: true,
    appDataPath: 'C:\\Users\\Tester\\AppData\\Roaming',
    exePath: 'D:\\Apps\\LIRA\\LIRA.exe',
    rootDir: 'D:\\Work\\Live',
  });

  assert.equal(
    paths.dataDir,
    path.resolve(
      'C:\\Users\\Tester\\AppData\\Roaming',
      PACKAGED_USER_DATA_DIR_NAME,
      'data',
    ),
  );
  assert.equal(
    paths.legacyDataDir,
    path.resolve('D:\\Apps\\LIRA\\data'),
  );
});

test('development desktop data remains in the repository data directory', () => {
  const rootDir = path.resolve('D:\\Work\\Live');
  assert.deepEqual(
    resolveDesktopUserDataPaths({
      isPackaged: false,
      appDataPath: 'ignored',
      exePath: 'ignored',
      rootDir,
    }),
    {
      dataDir: path.join(rootDir, 'data'),
      legacyDataDir: path.join(rootDir, 'data'),
    },
  );
});

test('legacy desktop data is completely published after a successful copy', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lira-user-data-'));
  const sourceDir = path.join(tempDir, 'install', 'data');
  const targetDir = path.join(
    tempDir,
    'appdata',
    PACKAGED_USER_DATA_DIR_NAME,
    'data',
  );

  try {
    fs.mkdirSync(path.join(sourceDir, 'music-auth'), { recursive: true });
    fs.writeFileSync(path.join(sourceDir, 'song-request-data.db'), 'songs');
    fs.writeFileSync(
      path.join(sourceDir, 'music-auth', 'qq.cookies.enc'),
      'auth',
    );

    const result = migrateLegacyUserData({
      sourceDir,
      targetDir,
    });

    assert.equal(result.status, 'migrated');
    assert.equal(
      fs.readFileSync(path.join(targetDir, 'song-request-data.db'), 'utf8'),
      'songs',
    );
    assert.equal(
      fs.readFileSync(
        path.join(targetDir, 'music-auth', 'qq.cookies.enc'),
        'utf8',
      ),
      'auth',
    );
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
    assert.equal(
      fs.readFileSync(path.join(targetDir, 'song-request-data.db'), 'utf8'),
      'current',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

  try {
    assert.throws(
      () =>
        migrateLegacyUserData({
          sourceDir,
          targetDir,
          fileSystem,
        }),
      /copy failed/,
    );
    assert.equal(fs.existsSync(targetDir), false);
    assert.deepEqual(
      fs
        .readdirSync(tempDir)
        .filter((name) => name.startsWith('.durable-data.migration-')),
      [],
    );
    assert.equal(fs.existsSync(sourceDir), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test(
  'the Windows installer preserves legacy data before uninstalling an update',
  () => {
    const installer = fs.readFileSync(
      path.join(__dirname, '..', 'build', 'installer.nsh'),
      'utf8',
    );

    assert.match(installer, /\$INSTDIR\\data/);
    assert.match(
      installer,
      /\$APPDATA\\com\.aurorawhisperer\.lira\\data/,
    );
    assert.match(installer, /robocopy\.exe/);
    assert.match(installer, /Abort "LIRA 无法把旧版用户数据迁移/);
    assert.doesNotMatch(installer, /RMDir \/r "\$APPDATA\\LIRA"/);
  },
);
