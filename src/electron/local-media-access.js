'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ACCESS_FILE_NAME = 'local-media-access.json';
const { LOCAL_AUDIO_EXTENSIONS } = require('./local-audio-formats');

function createLocalMediaAccess(dataDir) {
  const dataRoot = path.resolve(dataDir);
  const accessFilePath = path.join(dataRoot, ACCESS_FILE_NAME);
  let allowedPaths = loadAllowedPaths(accessFilePath);

  function isCanonicalAllowed(canonical) {
    return allowedPaths.has(canonical) && LOCAL_AUDIO_EXTENSIONS.includes(path.extname(canonical).toLowerCase());
  }

  function isAllowed(filePath) {
    try {
      return isCanonicalAllowed(fs.realpathSync(filePath));
    } catch (_) {
      return false;
    }
  }

  function allowPaths(filePaths) {
    const resolvedPaths = [];
    for (const filePath of Array.isArray(filePaths) ? filePaths : []) {
      try {
        const canonical = fs.realpathSync(filePath);
        const ext = path.extname(canonical).toLowerCase();
        if (LOCAL_AUDIO_EXTENSIONS.includes(ext)) {
          resolvedPaths.push(canonical);
        }
      } catch (_) {
        // Skip inaccessible paths or symlink resolution failures
      }
    }
    const nextPaths = new Set([...allowedPaths, ...resolvedPaths]);
    if (nextPaths.size !== allowedPaths.size) {
      persistAllowedPaths(accessFilePath, nextPaths);
      allowedPaths = nextPaths;
    }
    return resolvedPaths;
  }

  function getAllowedPaths() {
    return [...allowedPaths];
  }

  return { allowPaths, isAllowed, isCanonicalAllowed, getAllowedPaths };
}

// Shared by desktop IPC, permissions and media adapters; compares origins only.
// Callers retain their own window/frame, route and permission checks.
function hasExactOrigin(candidateUrl, expectedUrl) {
  try {
    return new URL(candidateUrl).origin === new URL(expectedUrl).origin;
  } catch (_) {
    return false;
  }
}

function loadAllowedPaths(accessFilePath) {
  try {
    const values = JSON.parse(fs.readFileSync(accessFilePath, 'utf8'));
    if (!Array.isArray(values)) return new Set();
    return new Set(values.filter((value) => typeof value === 'string').map((value) => path.resolve(value)));
  } catch (_) {
    return new Set();
  }
}

function persistAllowedPaths(accessFilePath, allowedPaths) {
  fs.mkdirSync(path.dirname(accessFilePath), { recursive: true });
  fs.writeFileSync(accessFilePath, JSON.stringify([...allowedPaths], null, 2), 'utf8');
}

module.exports = { createLocalMediaAccess, hasExactOrigin };
