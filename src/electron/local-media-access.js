'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ACCESS_FILE_NAME = 'local-media-access.json';

function createLocalMediaAccess(dataDir) {
  const dataRoot = path.resolve(dataDir);
  const accessFilePath = path.join(dataRoot, ACCESS_FILE_NAME);
  const allowedPaths = loadAllowedPaths(accessFilePath);

  function isAllowed(filePath) {
    const resolved = path.resolve(filePath);
    if (resolved === dataRoot || resolved.startsWith(dataRoot + path.sep)) return true;
    return allowedPaths.has(resolved);
  }

  function allowPath(filePath) {
    return allowPaths([filePath])[0];
  }

  function allowPaths(filePaths) {
    const resolvedPaths = (Array.isArray(filePaths) ? filePaths : [])
      .map((filePath) => path.resolve(filePath));
    let changed = false;
    for (const resolved of resolvedPaths) {
      if (!allowedPaths.has(resolved)) {
        allowedPaths.add(resolved);
        changed = true;
      }
    }
    if (changed) persistAllowedPaths(accessFilePath, allowedPaths);
    return resolvedPaths;
  }

  return { allowPath, allowPaths, isAllowed };
}

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
