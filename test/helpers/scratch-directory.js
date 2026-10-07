'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCRATCH_ROOT = path.resolve(__dirname, '../../tmp');

// Creates a unique test scratch directory inside the repository-root tmp/.
// tmp/ is ignored by Git and may not exist in a fresh checkout. When a test
// context is supplied, the directory is removed by its after hook; otherwise
// the caller owns removal (for example after closing a server using it).
function createScratchDirectory(prefix, t) {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  const directory = fs.mkdtempSync(path.join(SCRATCH_ROOT, prefix));
  if (t) t.after(() => removeScratchDirectory(directory));
  return directory;
}

function removeScratchDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

module.exports = { SCRATCH_ROOT, createScratchDirectory, removeScratchDirectory };
