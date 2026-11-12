'use strict';

const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function writeAtomicFile(filePath, contents) {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

module.exports = { writeAtomicFile };
