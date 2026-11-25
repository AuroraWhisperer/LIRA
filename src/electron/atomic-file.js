'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

function writeAtomicFile(filePath, contents) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); }
    catch { throw error; }
    throw error;
  }
}

async function renameWithRetry(source, destination, { fileSystem = fs.promises, retryCodes = ['EPERM', 'EBUSY'] } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await fileSystem.rename(source, destination); return; }
    catch (error) {
      // Windows scanners and readers can briefly hold the destination.
      if (attempt >= 4 || !retryCodes.includes(error?.code)) throw error;
      await delay(50 * (attempt + 1));
    }
  }
}

async function writeAtomicFileAsync(filePath, contents, fileSystem = fs.promises) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fileSystem.writeFile(temporaryPath, contents, { flag: 'wx', flush: true });
    await renameWithRetry(temporaryPath, filePath, { fileSystem });
  } catch (error) {
    try { await fileSystem.unlink(temporaryPath); }
    catch { throw error; }
    throw error;
  }
}

module.exports = { writeAtomicFile, writeAtomicFileAsync, renameWithRetry };
