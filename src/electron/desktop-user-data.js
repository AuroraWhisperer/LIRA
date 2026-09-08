const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGED_USER_DATA_DIR_NAME = 'com.aurorawhisperer.lira';

/**
 * Resolve the durable and pre-migration data roots for the current desktop mode.
 * @param {{isPackaged?: boolean, appDataPath?: string, exePath?: string, rootDir?: string}} options
 * @returns {{dataDir: string, legacyDataDir: string}}
 */
function resolveDesktopUserDataPaths(options) {
  const rootDir = path.resolve(String(options.rootDir || ''));
  if (!options.isPackaged) {
    const dataDir = path.join(rootDir, 'data');
    return { dataDir, legacyDataDir: dataDir };
  }

  const appDataPath = path.resolve(String(options.appDataPath || ''));
  const exePath = path.resolve(String(options.exePath || ''));
  return {
    dataDir: path.join(appDataPath, PACKAGED_USER_DATA_DIR_NAME, 'data'),
    legacyDataDir: path.join(path.dirname(exePath), 'data'),
  };
}

/**
 * Publish a complete legacy directory without overwriting an existing target.
 * @param {{sourceDir: string, targetDir: string, fileSystem?: typeof fs}} options
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
  const stagingDir = path.join(
    path.dirname(targetDir),
    `.${path.basename(targetDir)}.migration-${migrationId}`,
  );

  fileSystem.mkdirSync(path.dirname(targetDir), { recursive: true });
  try {
    fileSystem.cpSync(sourceDir, stagingDir, { recursive: true });
    fileSystem.renameSync(stagingDir, targetDir);
  } catch (error) {
    if (fileSystem.existsSync(targetDir)) {
      removeStagingDirectory(fileSystem, stagingDir);
      return { status: 'target-exists' };
    }

    removeStagingDirectory(fileSystem, stagingDir);
    throw error;
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
