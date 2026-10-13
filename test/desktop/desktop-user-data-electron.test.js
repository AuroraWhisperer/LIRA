'use strict';

const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createScratchDirectory, removeScratchDirectory } = require('../helpers/scratch-directory');

test('real Electron protects the legacy copy and switches to the installed instance identity', {
  skip: process.platform !== 'win32',
  timeout: 30_000,
}, async () => {
  const root = createScratchDirectory('legacy-data-electron-');
  const sourceDir = path.join(root, 'legacy');
  const targetDir = path.join(root, 'install', 'data');
  const probe = path.join(root, 'probe.cjs');
  const children = [];
  fs.mkdirSync(sourceDir);
  const filename = 'song-request-data.db';
  // Exit without SQLite close/checkpoint to model an old process that crashed.
  const seed = spawnSync(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(${JSON.stringify(path.join(sourceDir, filename))});
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE records(value TEXT); PRAGMA wal_checkpoint(TRUNCATE)');
    db.prepare('INSERT INTO records VALUES (?)').run('committed-in-wal');
    process.exit(0);
  `], { windowsHide: true, encoding: 'utf8' });
  assert.equal(seed.status, 0, seed.stderr);
  assert.ok(fs.statSync(path.join(sourceDir, filename + '-wal')).size > 0);
  fs.writeFileSync(probe, `
    const fs = require('node:fs');
    const path = require('node:path');
    const { app } = require('electron');
    const { migrateLegacyUserData } = require(${JSON.stringify(require.resolve('../../src/electron/desktop-user-data'))});
    const root = ${JSON.stringify(root)};
    const sourceDir = ${JSON.stringify(sourceDir)};
    const targetDir = ${JSON.stringify(targetDir)};
    const mode = process.argv[2];
    const profile = process.argv[3];
    const sessionDir = path.join(root, 'session-' + process.pid);
    fs.mkdirSync(sessionDir);
    app.setPath('userData', sessionDir);
    app.setPath('sessionData', sessionDir);
    app.setPath('crashDumps', path.join(sessionDir, 'crashes'));
    app.disableHardwareAcceleration();
    process.on('message', () => app.exit(0));
    let result;
    if (mode === 'lock') {
      app.setPath('userData', profile);
      result = { held: app.requestSingleInstanceLock() };
    } else {
      let copied = false;
      let sourceProtected = false;
      try {
        const migration = migrateLegacyUserData({
          app, sourceDir, targetDir,
          fileSystem: {
            ...fs,
            cpSync(from, to, options) {
              copied = true;
              if (app.getPath('userData') !== sourceDir || !app.hasSingleInstanceLock()) {
                throw new Error('copy is missing the source identity lock');
              }
              try { fs.closeSync(fs.openSync(path.join(sourceDir, 'lockfile'), 'w')); }
              catch (error) { sourceProtected = ['EACCES', 'EPERM', 'EBUSY'].includes(error.code); }
              if (!sourceProtected) throw new Error('source singleton file was not protected');
              fs.cpSync(from, to, options);
            },
          },
        });
        const released = !app.hasSingleInstanceLock();
        const copiedLock = fs.existsSync(path.join(targetDir, 'lockfile'));
        app.setPath('userData', targetDir);
        result = { status: migration.status, copied, sourceProtected, released, copiedLock, targetLock: app.requestSingleInstanceLock() };
      } catch (error) {
        result = { error: error.message, copied, held: app.hasSingleInstanceLock() };
      }
    }
    app.whenReady().then(() => process.send(result));
  `);

  async function start(mode, profile) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), [probe, mode, profile || sourceDir], {
      env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let output = '';
    child.stderr.on('data', (data) => { output = (output + data).slice(-4000); });
    const closed = new Promise((resolve) => child.once('close', resolve));
    const timer = setTimeout(() => child.kill(), 10_000);
    const handle = {
      async stop() {
        if (child.exitCode === null && child.signalCode === null) child.send('quit');
        const code = await closed;
        clearTimeout(timer);
        assert.equal(code, 0, output);
      },
    };
    children.push(handle);
    const message = await new Promise((resolve, reject) => {
      child.once('message', resolve);
      child.once('error', reject);
      child.once('close', (code) => reject(new Error('Electron exited before reporting: ' + code + ' ' + output)));
    });
    return { ...handle, message };
  }

  try {
    const legacy = await start('lock');
    assert.equal(legacy.message.held, true);
    const blocked = await start('migrate');
    assert.match(blocked.message.error, /Close the running LIRA/);
    assert.equal(blocked.message.copied, false);
    assert.equal(blocked.message.held, false);
    assert.equal(fs.existsSync(targetDir), false);
    await blocked.stop();
    await legacy.stop();

    const migrated = await start('migrate');
    assert.deepEqual(migrated.message, {
      status: 'migrated', copied: true, sourceProtected: true, released: true, copiedLock: false, targetLock: true,
    });
    const db = new DatabaseSync(path.join(targetDir, filename), { readOnly: true });
    try { assert.equal(db.prepare('SELECT value FROM records').get().value, 'committed-in-wal'); }
    finally { db.close(); }

    const targetContender = await start('lock', targetDir);
    assert.equal(targetContender.message.held, false);
    await targetContender.stop();
    await migrated.stop();

    const restartedLegacy = await start('lock');
    assert.equal(restartedLegacy.message.held, true, 'successful copy must release the source identity');
    const existingTarget = await start('migrate');
    assert.equal(existingTarget.message.status, 'target-exists');
    assert.equal(existingTarget.message.copied, false);
    assert.equal(existingTarget.message.targetLock, true);
  } finally {
    await Promise.all(children.map((child) => child.stop()));
    removeScratchDirectory(root);
  }
});
