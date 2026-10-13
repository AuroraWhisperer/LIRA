const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { resolveDataPaths } = require('../shared/data-paths');
const { assertRuntimeStopped } = require('../storage/data-directory-migration');

// Compatibility source used by releases that stored data outside the installation.
const PACKAGED_USER_DATA_DIR_NAME = 'com.aurorawhisperer.lira';

/**
 * Resolve the durable and pre-migration data roots for the current desktop mode.
 * @param {{isPackaged?: boolean, appDataPath?: string, exePath?: string, rootDir?: string}} options
 * @returns {ReturnType<typeof resolveDataPaths> & {legacyDataDir: string, recoveryDataDir?: string}}
 */
function resolveDesktopUserDataPaths(options) {
  const rootDir = path.resolve(String(options.rootDir || ''));
  if (!options.isPackaged) {
    const dataDir = path.join(rootDir, 'data');
    return { ...resolveDataPaths(dataDir), legacyDataDir: dataDir };
  }

  const appDataPath = path.resolve(String(options.appDataPath || ''));
  const exePath = path.resolve(String(options.exePath || ''));
  return {
    ...resolveDataPaths(path.join(path.dirname(exePath), 'data')),
    legacyDataDir: path.join(appDataPath, PACKAGED_USER_DATA_DIR_NAME, 'data'),
    recoveryDataDir: path.dirname(exePath) + '.lira-data-backup',
  };
}

/**
 * Hold the legacy instance lock until its complete directory has been published.
 * Call before acquiring the destination's instance lock or opening databases.
 * @param {{app: import('electron').App, sourceDir: string, targetDir: string, fileSystem?: typeof fs}} options
 * @returns {{status: string, sourceDir?: string, targetDir?: string}}
 */
function migrateLegacyUserData(options) {
  const fileSystem = options.fileSystem || fs;
  const sourceDir = path.resolve(String(options.sourceDir || ''));
  const targetDir = path.resolve(String(options.targetDir || ''));

  if (sourceDir === targetDir) return { status: 'same-path' };
  if (fileSystem.existsSync(targetDir)) return { status: 'target-exists' };
  if (!fileSystem.existsSync(sourceDir)) return { status: 'source-missing' };

  const migrationId = crypto.randomUUID();
  const stagingDir = path.join(path.dirname(targetDir), `.${path.basename(targetDir)}.migration-${migrationId}`);
  const singletonFiles = new Set(['lockfile', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']
    .map((name) => path.join(sourceDir, name)));
  const { app } = options;
  if (app.hasSingleInstanceLock()) throw new Error('Legacy migration must run before acquiring the destination lock.');
  // Old AppData releases use this exact data root as their singleton identity.
  // Keeping that lock through publication prevents a restart after the PID check.
  app.setPath('userData', sourceDir);
  if (!app.requestSingleInstanceLock()) throw new Error('Close the running LIRA before migrating legacy storage.');

  try {
    assertRuntimeStopped(fileSystem, sourceDir);
    fileSystem.mkdirSync(path.dirname(targetDir), { recursive: true });
    fileSystem.cpSync(sourceDir, stagingDir, {
      recursive: true,
      filter: (entry) => !singletonFiles.has(entry),
    });
    fileSystem.renameSync(stagingDir, targetDir);
  } catch (error) {
    if (fileSystem.existsSync(targetDir)) {
      removeStagingDirectory(fileSystem, stagingDir);
      return { status: 'target-exists' };
    }

    removeStagingDirectory(fileSystem, stagingDir);
    throw error;
  } finally {
    app.releaseSingleInstanceLock();
  }

  return { status: 'migrated', sourceDir, targetDir };
}

function removeStagingDirectory(fileSystem, stagingDir) {
  try {
    fileSystem.rmSync(stagingDir, { recursive: true, force: true });
    return true;
  } catch {
    // The original migration failure remains the actionable error.
    return false;
  }
}

module.exports = {
  PACKAGED_USER_DATA_DIR_NAME,
  migrateLegacyUserData,
  resolveDesktopUserDataPaths,
};
